// ========================================
// ARCADIA - GAME ROUTES (jogos solo, server-side)
// ========================================

const express = require("express");
const pool = require("../config/database");
const { authenticate } = require("../middleware/auth");
const { checkGameAchievements, trackGameActivity } = require("../services/progression.routes");
const { grantXP } = require("../services/progression");

const router = express.Router();

// ========================================
// MOTOR DE JOGOS — toda aleatoriedade no SERVIDOR
// ========================================

const GAMES = {
    // Dados: aposta num número 1-6. Acerto paga 5x (edge da casa ~16.7%... sem casa!
    // Cassino FREE: RTP 100% — acerto paga 6x justo. A graça é entre amigos.
    dice: {
        minBet: 10,
        play(wager, choice) {
            const n = choice ? Number(choice) : 1 + Math.floor(Math.random() * 6);
            const roll = 1 + Math.floor(Math.random() * 6);
            const win = roll === n;
            return {
                outcome: win ? "win" : "loss",
                multiplier: win ? 6 : 0,
                payout: win ? wager * 6 : 0,
                detail: { roll, picked: n },
            };
        },
    },

    // Coinflip: 2x justo
    coinflip: {
        minBet: 10,
        play(wager, choice) {
            const side = choice === "tails" ? "tails" : "heads";
            const flip = Math.random() < 0.5 ? "heads" : "tails";
            const win = flip === side;
            return {
                outcome: win ? "win" : "loss",
                multiplier: win ? 2 : 0,
                payout: win ? wager * 2 : 0,
                detail: { flip, picked: side },
            };
        },
    },

    // Mines simplificado: 5x5, N minas, escolhe quantas casas abrir (auto-resolve)
    mines: {
        minBet: 10,
        play(wager, choice) {
            const minesCount = Math.min(Math.max(Number(choice && choice.mines) || 3, 1), 24);
            const picks = Math.min(Math.max(Number(choice && choice.picks) || 3, 1), 25 - minesCount);

            const cells = Array.from({ length: 25 }, (_, i) => i);
            // Fisher-Yates para sortear minas
            for (let i = cells.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [cells[i], cells[j]] = [cells[j], cells[i]];
            }
            const minePositions = new Set(cells.slice(0, minesCount));

            // Simula as escolhas do jogador (server-side, sem reveal parcial por enquanto)
            let survived = 0;
            let hit = false;
            const opened = [];
            for (let i = 0; i < picks; i++) {
                const pos = cells[25 - 1 - i]; // pega posições aleatórias restantes
                if (minePositions.has(pos)) {
                    hit = true;
                    break;
                }
                survived++;
                opened.push(pos);
            }

            // Multiplicador justo: combinações de C(25, picks) sem mina / C(25-mines, picks)
            const c = (n, k) => {
                let r = 1;
                for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
                return r;
            };
            const fairMultiplier = c(25, picks) / c(25 - minesCount, picks);

            const win = !hit;
            return {
                outcome: win ? "win" : "loss",
                multiplier: win ? Number(fairMultiplier.toFixed(4)) : 0,
                payout: win ? Math.floor(wager * fairMultiplier) : 0,
                detail: { mines: minesCount, picks, survived, minePositions: [...minePositions] },
            };
        },
    },
};


// ========================================
// POST /api/games/:game/play — jogos instantâneos
// ========================================

router.post("/:game/play", authenticate, async (req, res) => {
    const gameName = req.params.game;
    const game = GAMES[gameName];

    if (!game) {
        return res.status(404).json({ status: "error", message: "Jogo não encontrado." });
    }

    const wager = Math.floor(Number(req.body.wager));
    if (!Number.isFinite(wager) || wager < game.minBet) {
        return res.status(400).json({ status: "error", message: `Aposta mínima: ${game.minBet} AC.` });
    }
    if (wager > 1000000) {
        return res.status(400).json({ status: "error", message: "Aposta máxima: 1.000.000 AC." });
    }

    try {
        const wallet = await pool.get("SELECT id, balance FROM wallets WHERE user_id = ?", [req.user.id]);
        if (!wallet) {
            return res.status(404).json({ status: "error", message: "Carteira não encontrada." });
        }
        if (wallet.balance < wager) {
            return res.status(400).json({ status: "error", message: "Saldo insuficiente." });
        }

        const result = game.play(wager, req.body.choice);

        const afterDebit = await pool.adjustBalance(wallet.id, -wager, "bet", "game", gameName);
        let finalBalance = afterDebit;
        if (result.payout > 0) {
            finalBalance = await pool.adjustBalance(wallet.id, result.payout, "payout", "game", gameName);
        }

        await pool.run(
            `INSERT INTO bets (user_id, game, wager, multiplier, payout, outcome, detail)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [req.user.id, gameName, wager, result.multiplier, result.payout, result.outcome, JSON.stringify(result.detail)]
        );

        // v0.9: XP + conquistas + missões
        const levelInfo = grantXP(req.user.id, 10 + Math.floor(wager / 100));
        const unlocked = checkGameAchievements(req.user.id, { game: gameName, outcome: result.outcome, multiplier: result.multiplier, wager, detail: result.detail });
        trackGameActivity(req.user.id, { game: gameName, outcome: result.outcome, wager });

        return res.status(200).json({
            status: "success",
            outcome: result.outcome,
            multiplier: result.multiplier,
            payout: result.payout,
            detail: result.detail,
            balance: finalBalance,
            levelInfo,
            unlocked,
        });
    } catch (error) {
        console.error("Play error:", error.message);
        return res.status(500).json({ status: "error", message: "Erro ao processar aposta." });
    }
});

// ========================================
// MINES — jogo por rodadas (start → picks → cashout)
// ========================================

// minesSessions[userId] = { wager, mines:Set, picked:Set, walletId }
const minesSessions = new Map();

const comb = (n, k) => {
    let r = 1;
    for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
    return r;
};

function minesMultiplier(minesCount, picks) {
    return comb(25, picks) / comb(25 - minesCount, picks);
}

// POST /api/games/mines/start { wager, mines }
router.post("/mines/start", authenticate, async (req, res) => {
    try {
        if (minesSessions.has(req.user.id)) {
            return res.status(400).json({ status: "error", message: "Você já tem um jogo de mines em andamento." });
        }

        const wager = Math.floor(Number(req.body.wager));
        const minesCount = Math.min(Math.max(Number(req.body.mines) || 3, 1), 24);

        if (!Number.isFinite(wager) || wager < 10) {
            return res.status(400).json({ status: "error", message: "Aposta mínima: 10 AC." });
        }

        const wallet = await pool.get("SELECT id, balance FROM wallets WHERE user_id = ?", [req.user.id]);
        if (!wallet || wallet.balance < wager) {
            return res.status(400).json({ status: "error", message: "Saldo insuficiente." });
        }

        // Sorteia posições das minas (Fisher-Yates)
        const cells = Array.from({ length: 25 }, (_, i) => i);
        for (let i = cells.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [cells[i], cells[j]] = [cells[j], cells[i]];
        }
        const mines = new Set(cells.slice(0, minesCount));

        await pool.adjustBalance(wallet.id, -wager, "bet", "game", "mines");
        const after = await pool.get("SELECT balance FROM wallets WHERE id = ?", [wallet.id]);

        minesSessions.set(req.user.id, {
            wager,
            mines,
            picked: new Set(),
            walletId: wallet.id,
            startedAt: Date.now(),
        });

        return res.json({
            status: "success",
            wager,
            minesCount,
            balance: after.balance,
        });
    } catch (error) {
        console.error("Mines start:", error.message);
        return res.status(500).json({ status: "error", message: "Erro ao iniciar mines." });
    }
});

// POST /api/games/mines/pick { cell }
router.post("/mines/pick", authenticate, async (req, res) => {
    try {
        const session = minesSessions.get(req.user.id);
        if (!session) {
            return res.status(400).json({ status: "error", message: "Nenhum jogo em andamento." });
        }

        const cell = Number(req.body.cell);
        if (!Number.isInteger(cell) || cell < 0 || cell > 24) {
            return res.status(400).json({ status: "error", message: "Célula inválida." });
        }
        if (session.picked.has(cell)) {
            return res.status(400).json({ status: "error", message: "Célula já aberta." });
        }

        if (session.mines.has(cell)) {
            // BOOM — perde a aposta
            minesSessions.delete(req.user.id);

            await pool.run(
                `INSERT INTO bets (user_id, game, wager, multiplier, payout, outcome, detail)
                 VALUES (?, 'mines', ?, 0, 0, 'loss', ?)`,
                [req.user.id, session.wager, JSON.stringify({ boom: cell, picks: session.picked.size })]
            );

            const wallet = await pool.get("SELECT balance FROM wallets WHERE id = ?", [session.walletId]);

            return res.json({
                status: "success",
                boom: true,
                cell,
                mines: [...session.mines],
                balance: wallet.balance,
            });
        }

        session.picked.add(cell);
        const mult = minesMultiplier(session.mines.size, session.picked.size);

        return res.json({
            status: "success",
            boom: false,
            cell,
            multiplier: Number(mult.toFixed(4)),
            potentialPayout: Math.floor(session.wager * mult),
            picks: session.picked.size,
        });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Erro no pick." });
    }
});

// POST /api/games/mines/cashout
router.post("/mines/cashout", authenticate, async (req, res) => {
    try {
        const session = minesSessions.get(req.user.id);
        if (!session) {
            return res.status(400).json({ status: "error", message: "Nenhum jogo em andamento." });
        }
        if (session.picked.size === 0) {
            return res.status(400).json({ status: "error", message: "Abra pelo menos uma célula antes de sacar." });
        }

        const mult = minesMultiplier(session.mines.size, session.picked.size);
        const payout = Math.floor(session.wager * mult);

        minesSessions.delete(req.user.id);

        const balance = await pool.adjustBalance(session.walletId, payout, "payout", "game", "mines");

        await pool.run(
            `INSERT INTO bets (user_id, game, wager, multiplier, payout, outcome, detail)
             VALUES (?, 'mines', ?, ?, ?, 'win', ?)`,
            [req.user.id, session.wager, Number(mult.toFixed(4)), payout, JSON.stringify({ picks: session.picked.size })]
        );

        return res.json({
            status: "success",
            multiplier: Number(mult.toFixed(4)),
            payout,
            balance,
            mines: [...session.mines],
        });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Erro no cashout." });
    }
});


// ========================================
// CRASH SOLO — multiplicador sobe, saque antes do crash
// Server controla o tempo via polling de estado
// ========================================

// crashSessions[userId] = { wager, crashPoint, startedAt, walletId, status }
const crashSessions = new Map();

// POST /api/games/crash/start { wager }
router.post("/crash/start", authenticate, async (req, res) => {
    try {
        if (crashSessions.has(req.user.id)) {
            return res.status(400).json({ status: "error", message: "Crash já em andamento." });
        }

        const wager = Math.floor(Number(req.body.wager));
        if (!Number.isFinite(wager) || wager < 10) {
            return res.status(400).json({ status: "error", message: "Aposta mínima: 10 AC." });
        }

        const wallet = await pool.get("SELECT id, balance FROM wallets WHERE user_id = ?", [req.user.id]);
        if (!wallet || wallet.balance < wager) {
            return res.status(400).json({ status: "error", message: "Saldo insuficiente." });
        }

        // Crash point: distribuição justa (RTP 100%): max(1, 1/(1-U))
        const u = Math.random();
        const crashPoint = Math.max(1.0, Math.floor((1 / (1 - u)) * 100) / 100);

        await pool.adjustBalance(wallet.id, -wager, "bet", "game", "crash");

        crashSessions.set(req.user.id, {
            wager,
            crashPoint,
            startedAt: Date.now(),
            walletId: wallet.id,
            cashedOut: false,
        });

        const after = await pool.get("SELECT balance FROM wallets WHERE id = ?", [wallet.id]);
        return res.json({ status: "success", wager, balance: after.balance });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Erro ao iniciar crash." });
    }
});

// GET /api/games/crash/state — cliente faz polling (~10x/s)
router.get("/crash/state", authenticate, async (req, res) => {
    const session = crashSessions.get(req.user.id);
    if (!session) {
        return res.json({ status: "success", active: false });
    }

    const elapsed = (Date.now() - session.startedAt) / 1000;
    // multiplicador cresce exponencialmente: 1.00 → 1.06/s... acelera com o tempo
    const current = Math.pow(1.06, elapsed * 6);

    if (current >= session.crashPoint) {
        // CRASH — perdeu
        crashSessions.delete(req.user.id);

        await pool.run(
            `INSERT INTO bets (user_id, game, wager, multiplier, payout, outcome, detail)
             VALUES (?, 'crash', ?, 0, 0, 'loss', ?)`,
            [req.user.id, session.wager, JSON.stringify({ crashPoint: session.crashPoint })]
        );

        const wallet = await pool.get("SELECT balance FROM wallets WHERE id = ?", [session.walletId]);

        return res.json({
            status: "success",
            active: false,
            crashed: true,
            crashPoint: session.crashPoint,
            balance: wallet.balance,
        });
    }

    return res.json({
        status: "success",
        active: true,
        multiplier: Number(current.toFixed(2)),
        potentialPayout: Math.floor(session.wager * current),
    });
});

// POST /api/games/crash/cashout
router.post("/crash/cashout", authenticate, async (req, res) => {
    try {
        const session = crashSessions.get(req.user.id);
        if (!session) {
            return res.status(400).json({ status: "error", message: "Nenhum crash em andamento." });
        }

        const elapsed = (Date.now() - session.startedAt) / 1000;
        const current = Math.pow(1.06, elapsed * 6);

        if (current >= session.crashPoint) {
            crashSessions.delete(req.user.id);
            await pool.run(
                `INSERT INTO bets (user_id, game, wager, multiplier, payout, outcome, detail)
                 VALUES (?, 'crash', ?, 0, 0, 'loss', ?)`,
                [req.user.id, session.wager, JSON.stringify({ crashPoint: session.crashPoint })]
            );
            const wallet = await pool.get("SELECT balance FROM wallets WHERE id = ?", [session.walletId]);
            return res.json({ status: "success", crashed: true, crashPoint: session.crashPoint, balance: wallet.balance });
        }

        const mult = Number(current.toFixed(2));
        const payout = Math.floor(session.wager * mult);
        crashSessions.delete(req.user.id);

        const balance = await pool.adjustBalance(session.walletId, payout, "payout", "game", "crash");

        await pool.run(
            `INSERT INTO bets (user_id, game, wager, multiplier, payout, outcome, detail)
             VALUES (?, 'crash', ?, ?, ?, 'win', ?)`,
            [req.user.id, session.wager, mult, payout, JSON.stringify({ cashout: mult })]
        );

        return res.json({ status: "success", crashed: false, multiplier: mult, payout, balance });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Erro no cashout." });
    }
});

// ========================================
// LEADERBOARD — top jogadores por lucro
// ========================================

router.get("/leaderboard", async (req, res) => {
    try {
        const rows = await pool.query(
            `SELECT u.username,
                    COALESCE(SUM(b.payout - b.wager), 0) AS net_profit,
                    COUNT(b.id) AS games,
                    SUM(CASE WHEN b.outcome = 'win' THEN 1 ELSE 0 END) AS wins
             FROM users u
             LEFT JOIN bets b ON b.user_id = u.id
             GROUP BY u.id
             ORDER BY net_profit DESC
             LIMIT 20`
        );

        return res.json({ status: "success", leaderboard: rows.rows });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Erro no ranking." });
    }
});

// ========================================
// GET /api/games/history — últimas apostas
// ========================================

router.get("/history", authenticate, async (req, res) => {
    try {
        const rows = await pool.query(
            `SELECT game, wager, multiplier, payout, outcome, detail, created_at
             FROM bets WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50`,
            [req.user.id]
        );

        return res.status(200).json({ status: "success", history: rows.rows });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Erro ao buscar histórico." });
    }
});

// ========================================
// GET /api/games/stats — estatísticas do usuário
// ========================================

router.get("/stats", authenticate, async (req, res) => {
    try {
        const totals = await pool.get(
            `SELECT COUNT(*) AS total_games,
                    SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) AS total_wins,
                    SUM(CASE WHEN outcome = 'loss' THEN 1 ELSE 0 END) AS total_losses,
                    COALESCE(SUM(payout - wager), 0) AS net
             FROM bets WHERE user_id = ?`,
            [req.user.id]
        );

        return res.status(200).json({ status: "success", stats: totals });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Erro ao buscar estatísticas." });
    }
});


// ========================================
// GET /api/games/stats/full — estatísticas completas (v0.9.3)
// ========================================

router.get("/stats/full", authenticate, async (req, res) => {
    try {
        const uid = req.user.id;

        // ---- básicas ----
        const totals = await pool.get(
            `SELECT COUNT(*) AS total_games,
                    SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) AS wins,
                    SUM(CASE WHEN outcome = 'loss' THEN 1 ELSE 0 END) AS losses,
                    SUM(CASE WHEN outcome = 'push' THEN 1 ELSE 0 END) AS pushes,
                    COALESCE(SUM(payout - wager), 0) AS net,
                    COALESCE(SUM(wager), 0) AS total_wagered,
                    COALESCE(SUM(payout), 0) AS total_payout
             FROM bets WHERE user_id = ?`,
            [uid]
        );

        // ---- por jogo ----
        const byGame = await pool.query(
            `SELECT game,
                    COUNT(*) AS games,
                    SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) AS wins,
                    COALESCE(SUM(payout - wager), 0) AS net
             FROM bets WHERE user_id = ?
             GROUP BY game`,
            [uid]
        );

        // melhor jogo (maior lucro, min 1 partida)
        const gameRows = byGame.rows || [];
        const bestGame = gameRows.length
            ? gameRows.reduce((a, b) => (Number(b.net) > Number(a.net) ? b : a))
            : null;
        const mostPlayed = gameRows.length
            ? gameRows.reduce((a, b) => (Number(b.games) > Number(a.games) ? b : a))
            : null;
        const leastPlayed = gameRows.length
            ? gameRows.reduce((a, b) => (Number(b.games) < Number(a.games) ? b : a))
            : null;

        // ---- maior lucro/déficit numa única rodada ----
        const bestRound = await pool.get(
            `SELECT game, wager, payout, (payout - wager) AS profit, created_at
             FROM bets WHERE user_id = ? ORDER BY (payout - wager) DESC LIMIT 1`,
            [uid]
        );
        const worstRound = await pool.get(
            `SELECT game, wager, payout, (payout - wager) AS profit, created_at
             FROM bets WHERE user_id = ?
             ORDER BY (payout - wager) ASC LIMIT 1`,
            [uid]
        );

        // ---- carteiras ----
        const wallets = await pool.query(`SELECT kind, balance FROM wallets WHERE user_id = ?`, [uid]);
        const walletMap = Object.fromEntries((wallets.rows || []).map((w) => [w.kind, w.balance]));

        // ---- conquistas ----
        const achCount = await pool.get(`SELECT COUNT(*) AS total FROM user_achievements WHERE user_id = ?`, [uid]);

        // ---- duelo ----
        const duel = await pool.get(`SELECT wins, losses FROM duel_stats WHERE user_id = ?`, [uid]);

        // ---- multiplayer: apostas em salas (ref_type room) e corridas ----
        const roomTx = await pool.get(
            `SELECT COALESCE(SUM(CASE WHEN t.kind = 'room_payout' THEN t.amount ELSE 0 END), 0) AS payouts,
                    COALESCE(SUM(CASE WHEN t.kind = 'room_stake' THEN -t.amount ELSE 0 END), 0) AS stakes
             FROM transactions t
             INNER JOIN wallets w ON w.id = t.wallet_id
             WHERE w.user_id = ? AND t.ref_type IN ('room','race')`,
            [uid]
        );

        // vitórias no multiplayer = rodadas ganhas em salas (game roulette) + corridas pagas
        const mpWins = await pool.get(
            `SELECT COUNT(*) AS wins FROM bets WHERE user_id = ? AND game = 'roulette' AND outcome = 'win'`,
            [uid]
        );

        const user = await pool.get(`SELECT level, xp, display_name, avatar, created_at FROM users WHERE id = ?`, [uid]);

        return res.json({
            status: "success",
            stats: {
                level: user ? user.level : 1,
                xp: user ? user.xp : 0,
                displayName: user ? (user.display_name || req.user.username) : req.user.username,
                avatar: user ? user.avatar || "🎰" : "🎰",
                memberSince: user ? user.created_at : null,

                totalGames: totals.total_games || 0,
                wins: totals.wins || 0,
                losses: totals.losses || 0,
                pushes: totals.pushes || 0,
                net: Number(totals.net) || 0,
                totalWagered: Number(totals.total_wagered) || 0,
                totalPayout: Number(totals.total_payout) || 0,

                bestGame: bestGame ? { game: bestGame.game, net: Number(bestGame.net), games: bestGame.games } : null,
                mostPlayed: mostPlayed ? { game: mostPlayed.game, games: mostPlayed.games, net: Number(mostPlayed.net) } : null,
                leastPlayed: leastPlayed ? { game: leastPlayed.game, games: leastPlayed.games } : null,
                byGame: gameRows.map((g) => ({ game: g.game, games: g.games, wins: g.wins || 0, net: Number(g.net) })),

                bestRound: bestRound ? { game: bestRound.game, profit: Number(bestRound.profit), wager: bestRound.wager, at: bestRound.created_at } : null,
                worstRound: worstRound ? { game: worstRound.game, profit: Number(worstRound.profit), wager: worstRound.wager, at: worstRound.created_at } : null,

                wallets: {
                    solo: walletMap.solo || 0,
                    coop: walletMap.coop || 0,
                    duel: walletMap.duel || 0,
                },

                achievementsUnlocked: achCount ? achCount.total : 0,

                duel: {
                    wins: duel ? duel.wins : 0,
                    losses: duel ? duel.losses : 0,
                },

                multiplayer: {
                    rouletteWins: mpWins ? mpWins.wins : 0,
                    roomStakes: Number(roomTx.stakes) || 0,
                    roomPayouts: Number(roomTx.payouts) || 0,
                },
            },
        });
    } catch (error) {
        console.error("Stats full:", error.message);
        return res.status(500).json({ status: "error", message: "Erro ao carregar estatísticas." });
    }
});

// ========================================
// GET /api/users/:username/profile — perfil PÚBLICO (v0.9.3)
// ========================================

router.get("/public/:username", async (req, res) => {
    try {
        const user = await pool.get(
            `SELECT id, username, display_name, avatar, level, xp, created_at FROM users WHERE LOWER(username) = LOWER(?)`,
            [String(req.params.username).trim()]
        );
        if (!user) {
            return res.status(404).json({ status: "error", message: "Jogador não encontrado." });
        }

        const totals = await pool.get(
            `SELECT COUNT(*) AS total_games,
                    SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) AS wins,
                    COALESCE(SUM(payout - wager), 0) AS net
             FROM bets WHERE user_id = ?`,
            [user.id]
        );

        const byGame = await pool.query(
            `SELECT game, COUNT(*) AS games, COALESCE(SUM(payout - wager), 0) AS net
             FROM bets WHERE user_id = ? GROUP BY game`,
            [user.id]
        );

        const achCount = await pool.get(`SELECT COUNT(*) AS total FROM user_achievements WHERE user_id = ?`, [user.id]);
        const duel = await pool.get(`SELECT wins, losses FROM duel_stats WHERE user_id = ?`, [user.id]);

        return res.json({
            status: "success",
            profile: {
                username: user.username,
                displayName: user.display_name || user.username,
                avatar: user.avatar || "🎰",
                level: user.level || 1,
                xp: user.xp || 0,
                memberSince: user.created_at,
                totalGames: totals.total_games || 0,
                wins: totals.wins || 0,
                net: Number(totals.net) || 0,
                achievements: achCount ? achCount.total : 0,
                duelWins: duel ? duel.wins : 0,
                duelLosses: duel ? duel.losses : 0,
                byGame: (byGame.rows || []).map((g) => ({ game: g.game, games: g.games, net: Number(g.net) })),
            },
        });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Erro ao carregar perfil." });
    }
});


// ========================================
// PLINKO (v0.9.4) — bola cai em pinos, multiplicadores na base
// ========================================

// Tabela de multiplicadores por risco (16 fileiras = 17 slots)
const PLINKO_TABLES = {
    low:    [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
    medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
    high:   [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
};

router.post("/plinko/drop", authenticate, async (req, res) => {
    try {
        const wager = Math.floor(Number(req.body.wager));
        const risk = ["low", "medium", "high"].includes(req.body.risk) ? req.body.risk : "medium";

        if (!Number.isFinite(wager) || wager < 10) {
            return res.status(400).json({ status: "error", message: "Aposta mínima: 10 AC." });
        }

        const wallet = await pool.get("SELECT id, balance FROM wallets WHERE user_id = ?", [req.user.id]);
        if (!wallet || wallet.balance < wager) {
            return res.status(400).json({ status: "error", message: "Saldo insuficiente." });
        }

        // Trajetória: 16 decisões esquerda/direita (server-side)
        const path = [];
        for (let i = 0; i < 16; i++) {
            path.push(Math.random() < 0.5 ? 0 : 1); // 0=esq 1=dir
        }
        const slot = path.reduce((a, b) => a + b, 0);

        const table = PLINKO_TABLES[risk];
        const mult = table[slot];
        const payout = Math.floor(wager * mult);
        const outcome = payout > wager ? "win" : payout > 0 ? "push" : "loss";

        const afterDebit = await pool.adjustBalance(wallet.id, -wager, "bet", "game", "plinko");
        let finalBalance = afterDebit;
        if (payout > 0) {
            finalBalance = await pool.adjustBalance(wallet.id, payout, "payout", "game", "plinko");
        }

        await pool.run(
            `INSERT INTO bets (user_id, game, wager, multiplier, payout, outcome, detail)
             VALUES (?, 'plinko', ?, ?, ?, ?, ?)`,
            [req.user.id, wager, mult, payout, outcome, JSON.stringify({ risk, slot, path })]
        );

        // XP + conquistas + missões (mesma pipeline dos outros jogos)
        const levelInfo = grantXP(req.user.id, 10 + Math.floor(wager / 100));
        const unlocked = checkGameAchievements(req.user.id, { game: "plinko", outcome, multiplier: mult, wager, detail: { results: mult >= 10 ? [{ type: "straight", won: true }] : [] } });
        trackGameActivity(req.user.id, { game: "plinko", outcome, wager });

        return res.json({
            status: "success",
            risk,
            slot,
            path,
            multiplier: mult,
            payout,
            outcome,
            balance: finalBalance,
            levelInfo,
            unlocked,
        });
    } catch (error) {
        console.error("Plinko:", error.message);
        return res.status(500).json({ status: "error", message: "Erro no Plinko." });
    }
});

module.exports = { router, GAMES };
