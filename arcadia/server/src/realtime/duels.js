// ========================================
// ARCADIA - DUELO x1 (SERVIDOR, Socket.IO)
// ⚠️ CÓDIGO DE SERVIDOR (Node) — a versão anterior deste arquivo
// continha código de navegador (document/io do cliente) e crashava
// o server no boot, derrubando TODOS os deploys.
// Carteira DUEL separada. Primeiro a falir, perde.
// ========================================

const pool = require("../config/database");
const { JWT_SECRET } = require("../middleware/auth");
const jwt = require("jsonwebtoken");
const { TRUMPS, resolveSpin } = require("../services/slotsEngine");

const ROULETTE_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

// duels[code] = { code, phase, round, turn, players:{p1,p2}, auction, auctionWinner, chosenGame, log }
const duels = new Map();

function pushLog(duel, message, system = false) {
    duel.log.push({ system, message, at: Date.now() });
    if (duel.log.length > 100) duel.log.shift();
}

function duelState(duel) {
    const p1 = duel.players.p1;
    const p2 = duel.players.p2;
    return {
        code: duel.code,
        phase: duel.phase,
        round: duel.round,
        turn: duel.turn,
        p1: { userId: p1.userId, username: p1.username, balance: p1.balance, ready: p1.ready },
        p2: p2 ? { userId: p2.userId, username: p2.username, balance: p2.balance, ready: p2.ready } : null,
        auction: duel.auction,
        auctionWinner: duel.auctionWinner,
        chosenGame: duel.chosenGame,
        log: duel.log.slice(-50),
    };
}

async function syncBalances(duel) {
    for (const key of ["p1", "p2"]) {
        const p = duel.players[key];
        if (!p) continue;
        const w = await pool.getWallet(p.userId, "duel");
        p.balance = w.balance;
    }
}

// ========================================
// ENGINE DOS JOGOS DO DUELO (server-side)
// ========================================

function playGame(game, wager, choice) {
    switch (game) {
        case "dice": {
            const n = choice && choice.number != null ? Number(choice.number) : null;
            const roll = 1 + Math.floor(Math.random() * 6);
            const win = n !== null && Number.isInteger(n) && n >= 1 && n <= 6 && roll === n;
            return { outcome: win ? "win" : "loss", multiplier: win ? 6 : 0, payout: win ? wager * 6 : 0, detail: { roll, picked: n } };
        }
        case "coinflip": {
            const side = choice && choice.side === "tails" ? "tails" : "heads";
            const flip = Math.random() < 0.5 ? "heads" : "tails";
            const win = flip === side;
            return { outcome: win ? "win" : "loss", multiplier: win ? 2 : 0, payout: win ? wager * 2 : 0, detail: { flip, picked: side } };
        }
        case "crash": {
            const target = Math.max(1.01, Math.min(Number(choice && choice.autoCashout) || 2, 100));
            const u = Math.random();
            const crashPoint = Math.max(1, Math.floor((1 / (1 - u)) * 100) / 100);
            const win = crashPoint >= target;
            return { outcome: win ? "win" : "loss", multiplier: win ? target : 0, payout: win ? Math.floor(wager * target) : 0, detail: { crashPoint, target } };
        }
        case "mines": {
            const picks = Math.min(Math.max(Number(choice && choice.picks) || 3, 1), 20);
            const cells = Array.from({ length: 25 }, (_, i) => i);
            for (let i = cells.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [cells[i], cells[j]] = [cells[j], cells[i]];
            }
            const mines = new Set(cells.slice(0, 5)); // 5 minas fixas no duelo
            let hit = false;
            for (let i = 0; i < picks; i++) {
                if (mines.has(cells[24 - i])) { hit = true; break; }
            }
            const c = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1); return r; };
            const fair = c(25, picks) / c(20, picks);
            const win = !hit;
            return { outcome: win ? "win" : "loss", multiplier: win ? Number(fair.toFixed(4)) : 0, payout: win ? Math.floor(wager * fair) : 0, detail: { picks, mines: [...mines] } };
        }
        case "roulette": {
            const bet = choice && choice.bet ? String(choice.bet) : "red";
            const number = Math.floor(Math.random() * 37);
            const color = number === 0 ? "green" : ROULETTE_RED.has(number) ? "red" : "black";
            let mult = 0;
            if (bet === "red" && color === "red") mult = 2;
            else if (bet === "black" && color === "black") mult = 2;
            else if (bet === "even" && number !== 0 && number % 2 === 0) mult = 2;
            else if (bet === "odd" && number % 2 === 1) mult = 2;
            else if (bet === "low" && number >= 1 && number <= 18) mult = 2;
            else if (bet === "high" && number >= 19 && number <= 36) mult = 2;
            return { outcome: mult > 0 ? "win" : "loss", multiplier: mult, payout: wager * mult, detail: { number, color, bet } };
        }
        default:
            throw new Error("Jogo inválido no duelo.");
    }
}

// ========================================
// SETUP
// ========================================

function setupDuels(io) {
    io.use((socket, next) => {
        const token = socket.handshake.auth && socket.handshake.auth.token;
        if (!token) return next(new Error("Não autenticado."));
        try {
            const payload = jwt.verify(token, JWT_SECRET);
            socket.userId = payload.id;
            socket.username = payload.username;
            next();
        } catch (err) {
            next(new Error("Sessão inválida."));
        }
    });

    io.on("connection", (socket) => {
        socket.data.duelCode = null;

        // ---------- CRIAR ----------
        socket.on("duel:create", async (_, cb) => {
            try {
                let code;
                do { code = Math.random().toString(36).slice(2, 7).toUpperCase(); } while (duels.has(code));

                const w = await pool.getWallet(socket.userId, "duel");
                const duel = {
                    code,
                    phase: "waiting",
                    round: 1,
                    turn: "p1",
                    players: {
                        p1: { userId: socket.userId, username: socket.username, balance: w.balance, ready: false, socketIds: new Set([socket.id]) },
                        p2: null,
                    },
                    auction: null,
                    auctionWinner: null,
                    chosenGame: null,
                    log: [{ system: true, message: `${socket.username} criou o duelo!`, at: Date.now() }],
                };
                duels.set(code, duel);
                socket.data.duelCode = code;
                socket.join(`duel:${code}`);
                io.to(`duel:${code}`).emit("duel:state", duelState(duel));
                cb && cb({ ok: true, duel: duelState(duel) });
            } catch (err) {
                cb && cb({ ok: false, error: err.message });
            }
        });

        // ---------- ENTRAR ----------
        socket.on("duel:join", async (data, cb) => {
            try {
                const code = String(data && data.code || "").toUpperCase().trim();
                const duel = duels.get(code);
                if (!duel) return cb && cb({ ok: false, error: "Duelo não encontrado." });

                const w = await pool.getWallet(socket.userId, "duel");

                let key = null;
                if (duel.players.p1.userId === socket.userId) key = "p1";
                else if (duel.players.p2 && duel.players.p2.userId === socket.userId) key = "p2";
                else if (!duel.players.p2) {
                    duel.players.p2 = { userId: socket.userId, username: socket.username, balance: w.balance, ready: false, socketIds: new Set() };
                    key = "p2";
                    pushLog(duel, `${socket.username} entrou no duelo!`, true);
                    // ambos dentro → leilão de modos
                    duel.phase = "auction";
                    duel.auction = ["dice", "coinflip", "crash", "mines", "roulette"].map((g) => ({ game: g, bids: { p1: 0, p2: 0 } }));
                } else {
                    return cb && cb({ ok: false, error: "Esse duelo já está cheio." });
                }

                duel.players[key].socketIds.add(socket.id);
                duel.players[key].balance = w.balance;
                socket.data.duelCode = code;
                socket.join(`duel:${code}`);
                io.to(`duel:${code}`).emit("duel:state", duelState(duel));
                cb && cb({ ok: true, duel: duelState(duel) });
            } catch (err) {
                cb && cb({ ok: false, error: err.message });
            }
        });

        // ---------- PRONTO / INICIAR ----------
        socket.on("duel:ready", async (_, cb) => {
            try {
                const duel = duels.get(socket.data.duelCode);
                if (!duel) return cb && cb({ ok: false, error: "Você não está num duelo." });

                const key = duel.players.p1.userId === socket.userId ? "p1" : "p2";
                const me = duel.players[key];

                if (duel.phase === "waiting" || duel.phase === "ready") {
                    me.ready = !me.ready;
                    const both = duel.players.p1.ready && duel.players.p2 && duel.players.p2.ready;
                    if (both) {
                        duel.phase = "ready";
                        pushLog(duel, "Ambos prontos! O host pode iniciar.", true);
                    } else {
                        pushLog(duel, `${me.username} está pronto.`, true);
                    }
                }

                // host clica Iniciar com ambos prontos → leilão
                if (duel.phase === "ready" && key === "p1" && duel.players.p1.ready && duel.players.p2 && duel.players.p2.ready) {
                    duel.phase = "auction";
                    duel.auction = ["dice", "coinflip", "crash", "mines", "roulette"].map((g) => ({ game: g, bids: { p1: 0, p2: 0 } }));
                    pushLog(duel, "🔨 Leilão de modos aberto!", true);
                }

                io.to(`duel:${duel.code}`).emit("duel:state", duelState(duel));
                cb && cb({ ok: true });
            } catch (err) {
                cb && cb({ ok: false, error: err.message });
            }
        });

        // ---------- LEILÃO: LANCE ----------
        socket.on("duel:bid", async (data, cb) => {
            try {
                const duel = duels.get(socket.data.duelCode);
                if (!duel || duel.phase !== "auction") return cb && cb({ ok: false, error: "Não está em leilão." });

                const key = duel.players.p1.userId === socket.userId ? "p1" : "p2";
                const idx = Number(data && data.gameIdx);
                const amount = Math.floor(Number(data && data.amount));
                if (!duel.auction[idx]) return cb && cb({ ok: false, error: "Modo inválido." });
                if (!Number.isFinite(amount) || amount < 10) return cb && cb({ ok: false, error: "Lance mínimo: 10 AC." });

                const w = await pool.getWallet(socket.userId, "duel");
                if (w.balance < amount) return cb && cb({ ok: false, error: "Saldo DUEL insuficiente para esse lance." });

                duel.auction[idx].bids[key] = amount;
                pushLog(duel, `${socket.username} deu ${amount} AC no modo ${duel.auction[idx].game}.`);
                io.to(`duel:${duel.code}`).emit("duel:state", duelState(duel));
                cb && cb({ ok: true });
            } catch (err) {
                cb && cb({ ok: false, error: err.message });
            }
        });

        // ---------- LEILÃO: ESCOLHER MODO ----------
        socket.on("duel:choose", async (data, cb) => {
            try {
                const duel = duels.get(socket.data.duelCode);
                if (!duel || duel.phase !== "auction") return cb && cb({ ok: false, error: "Não está em leilão." });

                const key = duel.players.p1.userId === socket.userId ? "p1" : "p2";
                const oppKey = key === "p1" ? "p2" : "p1";
                const idx = Number(data && data.gameIdx);
                const slot = duel.auction[idx];
                if (!slot) return cb && cb({ ok: false, error: "Modo inválido." });
                if ((slot.bids[key] || 0) <= (slot.bids[oppKey] || 0)) {
                    return cb && cb({ ok: false, error: "Você precisa estar na frente nesse modo." });
                }

                // o lance vencedor é debitado da carteira DUEL
                const bid = slot.bids[key];
                const w = await pool.getWallet(socket.userId, "duel");
                if (w.balance < bid) return cb && cb({ ok: false, error: "Saldo DUEL insuficiente." });
                await pool.adjustBalance(w.id, -bid, "bet", "duel", duel.code);

                duel.auctionWinner = key;
                duel.chosenGame = slot.game;
                duel.phase = "playing";
                duel.turn = key;
                pushLog(duel, `${socket.username} venceu o leilão e escolheu ${slot.game}! (pagou ${bid} AC)`, true);
                await syncBalances(duel);
                io.to(`duel:${duel.code}`).emit("duel:state", duelState(duel));
                cb && cb({ ok: true });
            } catch (err) {
                cb && cb({ ok: false, error: err.message });
            }
        });

        // ---------- JOGAR RODADA ----------
        socket.on("duel:play", async (data, cb) => {
            try {
                const duel = duels.get(socket.data.duelCode);
                if (!duel || duel.phase !== "playing") return cb && cb({ ok: false, error: "O duelo não está em jogo." });

                const key = duel.players.p1.userId === socket.userId ? "p1" : "p2";
                const oppKey = key === "p1" ? "p2" : "p1";
                if (duel.turn !== key) return cb && cb({ ok: false, error: "Não é a sua vez." });

                const game = String(data && data.game || duel.chosenGame || "dice");
                const wager = Math.floor(Number(data && data.wager));
                if (!Number.isFinite(wager) || wager < 10) return cb && cb({ ok: false, error: "Aposta mínima: 10 AC." });

                const w = await pool.getWallet(socket.userId, "duel");
                if (w.balance < wager) return cb && cb({ ok: false, error: "Saldo DUEL insuficiente." });

                // SLOTS: valida e consome o trunfo antes de girar
                let trump = null;
                if (game === "slots" && data && data.choice && data.choice.trump) {
                    const trumpKey = String(data.choice.trump);
                    if (!TRUMPS[trumpKey]) return cb && cb({ ok: false, error: "Trunfo inválido." });
                    const owned = await pool.get(
                        `SELECT id FROM slots_cards WHERE user_id = ? AND card_key = ? LIMIT 1`,
                        [socket.userId, trumpKey]
                    );
                    if (!owned) return cb && cb({ ok: false, error: "Você não possui esse trunfo." });
                    await pool.run(`DELETE FROM slots_cards WHERE id = ?`, [owned.id]);
                    trump = trumpKey;
                }

                // debita a aposta do jogador da vez
                await pool.adjustBalance(w.id, -wager, "bet", "duel", duel.code);

                let result;
                if (game === "slots") {
                    const r = resolveSpin({ wager, trump });
                    result = { outcome: r.outcome, multiplier: r.mult, payout: r.payout, detail: { reels: r.reels, jackpot: r.jackpot } };
                } else {
                    result = playGame(game, wager, data && data.choice);
                }

                const opp = duel.players[oppKey];
                const oppWallet = await pool.getWallet(opp.userId, "duel");

                if (result.outcome === "win" && result.payout > 0) {
                    // o prêmio sai da carteira DUEL do oponente
                    const debit = Math.min(result.payout, oppWallet.balance);
                    await pool.adjustBalance(oppWallet.id, -debit, "bet", "duel", duel.code);
                    await pool.adjustBalance(w.id, debit, "payout", "duel", duel.code);
                    pushLog(duel, `${socket.username} jogou ${game} e GANHOU ${debit} AC de ${opp.username}!`);
                } else {
                    pushLog(duel, `${socket.username} jogou ${game} e perdeu ${wager} AC.`);
                }

                await syncBalances(duel);

                // falência? primeiro a zerar perde
                const p1b = duel.players.p1.balance;
                const p2b = duel.players.p2 ? duel.players.p2.balance : 1;
                if (p1b <= 0 || p2b <= 0) {
                    const winnerKey = p1b <= 0 ? "p2" : "p1";
                    await finishDuel(duel, io, winnerKey);
                    return cb && cb({ ok: true, result });
                }

                // passa a vez
                duel.turn = oppKey;
                if (duel.turn === "p1") duel.round++;
                io.to(`duel:${duel.code}`).emit("duel:state", duelState(duel));
                cb && cb({ ok: true, result });
            } catch (err) {
                cb && cb({ ok: false, error: err.message });
            }
        });

        // ---------- DISCONNECT ----------
        socket.on("disconnect", () => {
            const duel = duels.get(socket.data.duelCode);
            if (!duel) return;
            const key = duel.players.p1.userId === socket.userId ? "p1" : (duel.players.p2 && duel.players.p2.userId === socket.userId ? "p2" : null);
            if (key) duel.players[key].socketIds.delete(socket.id);
        });
    });

    async function finishDuel(duel, io, winnerKey) {
        duel.phase = "finished";
        const winner = duel.players[winnerKey];
        const loserKey = winnerKey === "p1" ? "p2" : "p1";
        const loser = duel.players[loserKey];

        // registra nas estatísticas de duelo
        try {
            await pool.run(
                `INSERT INTO duel_stats (user_id, wins, losses) VALUES (?, 1, 0)
                 ON CONFLICT(user_id) DO UPDATE SET wins = wins + 1`,
                [winner.userId]
            );
            await pool.run(
                `INSERT INTO duel_stats (user_id, wins, losses) VALUES (?, 0, 1)
                 ON CONFLICT(user_id) DO UPDATE SET losses = losses + 1`,
                [loser.userId]
            );
        } catch (_) {}

        pushLog(duel, `🏆 ${winner.username} venceu o duelo! ${loser.username} faliu.`, true);
        io.to(`duel:${duel.code}`).emit("duel:state", duelState(duel));
        io.to(`duel:${duel.code}`).emit("duel:finished", { winner: winner.username });
    }

    return { duels };
}

module.exports = { setupDuels, duels };
