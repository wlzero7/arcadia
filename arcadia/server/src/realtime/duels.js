// ========================================
// ARCADIA - DUELO x1 (v0.9)
// Você vs amigo, carteira DUEL separada, primeiro a falir perde
// Jogos: dice, coinflip, mines (instantâneo simplificado), crash
// ========================================

const pool = require("../config/database");
const { JWT_SECRET } = require("../middleware/auth");
const jwt = require("jsonwebtoken");

// duels[code] = { code, players: {p1:{userId,username,socketIds,ready}, p2}, turn: 'p1'|'p2', phase, round, log }
const duels = new Map();

const DUEL_GAMES = ["dice", "coinflip", "crash"];

// Leilão: 5 modos aleatórios sorteados; melhor lance escolhe o modo
const AUCTION_GAMES = ["dice", "coinflip", "crash", "mines", "roulette"];

function drawAuction() {
    const pool = [...AUCTION_GAMES].sort(() => Math.random() - 0.5).slice(0, 5);
    return pool.map((g) => ({ game: g, bids: { p1: 0, p2: 0 } }));
}

function duelState(d) {
    const p = (key) => {
        const pl = d.players[key];
        if (!pl) return null;
        return { key, userId: pl.userId, username: pl.username, balance: pl.balance, ready: pl.ready };
    };
    return {
        code: d.code,
        phase: d.phase,
        round: d.round,
        turn: d.turn,
        p1: p("p1"),
        p2: p("p2"),
        auction: d.auction || null,
        auctionWinner: d.auctionWinner || null,
        chosenGame: d.chosenGame || null,
        log: d.log.slice(-30),
    };
}

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

        socket.on("duel:create", (_, cb) => {
            let code;
            do { code = Math.random().toString(36).slice(2, 7).toUpperCase(); } while (duels.has(code));

            // carteira duel
            let w = pool.db.get("SELECT * FROM wallets WHERE user_id = ? AND kind = 'duel'", [socket.userId]);
            if (!w) {
                pool.db.run("INSERT INTO wallets (user_id, kind, balance) VALUES (?, 'duel', 1000000)", [socket.userId]);
                w = pool.db.get("SELECT * FROM wallets WHERE user_id = ? AND kind = 'duel'", [socket.userId]);
            }

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
                log: [{ system: true, message: `${socket.username} criou o duelo. Compartilhe o código ${code}!`, at: Date.now() }],
            };
            duels.set(code, duel);
            socket.data.duelCode = code;
            socket.join(`duel:${code}`);
            cb && cb({ ok: true, duel: duelState(duel) });
        });

        socket.on("duel:join", (data, cb) => {
            const d = duels.get(String(data && data.code || "").toUpperCase());
            if (!d) return cb && cb({ ok: false, error: "Duelo não encontrado." });
            if (d.players.p2) return cb && cb({ ok: false, error: "Duelo cheio." });
            if (d.players.p1.userId === socket.userId) {
                // reconexão
                d.players.p1.socketIds.add(socket.id);
                socket.data.duelCode = d.code;
                socket.join(`duel:${d.code}`);
                return cb && cb({ ok: true, duel: duelState(d) });
            }

            let w = pool.db.get("SELECT * FROM wallets WHERE user_id = ? AND kind = 'duel'", [socket.userId]);
            if (!w) {
                pool.db.run("INSERT INTO wallets (user_id, kind, balance) VALUES (?, 'duel', 1000000)", [socket.userId]);
                w = pool.db.get("SELECT * FROM wallets WHERE user_id = ? AND kind = 'duel'", [socket.userId]);
            }
            d.players.p2 = { userId: socket.userId, username: socket.username, balance: w.balance, ready: false, socketIds: new Set([socket.id]) };
            d.phase = "ready";
            socket.data.duelCode = d.code;
            socket.join(`duel:${d.code}`);
            d.log.push({ system: true, message: `${socket.username} entrou no duelo! ⚔️`, at: Date.now() });
            io.to(`duel:${d.code}`).emit("duel:state", duelState(d));
            cb && cb({ ok: true, duel: duelState(d) });
        });

        socket.on("duel:ready", (_, cb) => {
            const d = duels.get(socket.data.duelCode);
            if (!d) return cb && cb({ ok: false, error: "Duelo não encontrado." });
            const key = d.players.p1.userId === socket.userId ? "p1" : "p2";
            const me = d.players[key];

            // ready funciona em waiting (host antecipando) e ready
            if (d.phase === "waiting" && !d.players.p2) {
                me.ready = true;
                io.to(`duel:${d.code}`).emit("duel:state", duelState(d));
                return cb && cb({ ok: true, duel: duelState(d) });
            }
            if (d.phase !== "ready" && d.phase !== "auction") {
                return cb && cb({ ok: false, error: "Aguardando oponente." });
            }

            me.ready = true;

            if (d.players.p1.ready && d.players.p2.ready) {
                if (!d.auction) {
                    d.auction = drawAuction();
                    d.phase = "auction";
                    d.log.push({ system: true, message: "🔨 LEILÃO! 5 modos sorteados. Dê seu lance (da carteira DUEL) para escolher o modo de jogo!", at: Date.now() });
                } else {
                    d.phase = "playing";
                    d.log.push({ system: true, message: "⚔️ Duelo iniciado! Falir = perder.", at: Date.now() });
                }
            }
            io.to(`duel:${d.code}`).emit("duel:state", duelState(d));
            cb && cb({ ok: true, duel: duelState(d) });
        });

        // ---------- LEILÃO (v0.9.4) ----------
        socket.on("duel:bid", (data, cb) => {
            const d = duels.get(socket.data.duelCode);
            if (!d || d.phase !== "auction") return cb && cb({ ok: false, error: "Leilão não ativo." });

            const myKey = d.players.p1.userId === socket.userId ? "p1" : "p2";
            const me = d.players[myKey];
            const gameIdx = Number(data && data.gameIdx);
            const amount = Math.floor(Number(data && data.amount));

            if (!d.auction[gameIdx]) return cb && cb({ ok: false, error: "Modo inválido." });
            if (!Number.isFinite(amount) || amount < 10) return cb && cb({ ok: false, error: "Lance mínimo: 10 AC." });
            if (amount > me.balance) return cb && cb({ ok: false, error: "Saldo duel insuficiente para esse lance." });

            const slot = d.auction[gameIdx];
            const oppKey = myKey === "p1" ? "p2" : "p1";
            const oppBid = slot.bids[oppKey] || 0;

            if (amount <= oppBid) {
                return cb && cb({ ok: false, error: `Lance precisa superar o do oponente (${oppBid} AC).` });
            }

            slot.bids[myKey] = amount;
            d.log.push({ system: true, message: `🔨 ${me.username} deu lance de ${amount} AC no modo ${slot.game}!`, at: Date.now() });
            io.to(`duel:${d.code}`).emit("duel:state", duelState(d));
            cb && cb({ ok: true, duel: duelState(d) });
        });

        socket.on("duel:choose", (data, cb) => {
            const d = duels.get(socket.data.duelCode);
            if (!d || d.phase !== "auction") return cb && cb({ ok: false, error: "Leilão não ativo." });

            const myKey = d.players.p1.userId === socket.userId ? "p1" : "p2";
            const me = d.players[myKey];
            const oppKey = myKey === "p1" ? "p2" : "p1";

            // verifico em qual(is) modo(s) o jogador venceu o leilão
            const wonSlots = [];
            d.auction.forEach((slot, idx) => {
                const myBid = slot.bids[myKey] || 0;
                const oppBid = slot.bids[oppKey] || 0;
                if (myBid > oppBid && myBid > 0) wonSlots.push(idx);
            });

            if (!wonSlots.length) {
                return cb && cb({ ok: false, error: "Você não venceu nenhum lance. Dê um lance primeiro!" });
            }
            const gameIdx = Number(data && data.gameIdx);
            if (!wonSlots.includes(gameIdx)) {
                return cb && cb({ ok: false, error: "Você só pode escolher um modo que venceu no leilão." });
            }

            const slot = d.auction[gameIdx];
            const bidAmount = slot.bids[myKey];
            // o lance vencedor é DESCONTADO da carteira DUEL (aposta pra escolher)
            if (me.balance < (Number(slot.bids[myKey]) || 0)) {
                return cb && cb({ ok: false, error: "Saldo insuficiente para pagar o lance." });
            }
            me.balance -= slot.bids[myKey];
            d.auctionWinner = myKey;
            d.chosenGame = slot.game;
            d.phase = "playing";
            d.turn = "p1";

            d.log.push({ system: true, message: `⚔️ ${me.username} pagou ${slot.bids[myKey]} AC e escolheu ${slot.game.toUpperCase()}! Duelo iniciado — falir = perder.`, at: Date.now() });
            io.to(`duel:${d.code}`).emit("duel:state", duelState(d));
            cb && cb({ ok: true, duel: duelState(d) });
        });

        // jogar rodada: { game, wager, choice }
        socket.on("duel:play", (data, cb) => {
            const d = duels.get(socket.data.duelCode);
            if (!d || d.phase !== "playing") return cb && cb({ ok: false, error: "Duelo não ativo." });

            const myKey = d.players.p1.userId === socket.userId ? "p1" : "p2";
            if (d.turn !== myKey) return cb && cb({ ok: false, error: "Não é sua vez!" });

            const me = d.players[myKey];
            const wager = Math.floor(Number(data && data.wager));
            if (!Number.isFinite(wager) || wager < 10) return cb && cb({ ok: false, error: "Aposta mínima: 10 AC." });
            if (wager > me.balance) return cb && cb({ ok: false, error: "Saldo duel insuficiente." });

            const game = d.chosenGame || String(data && data.game || "dice");
            let outcome, mult;
            if (game === "dice") {
                const n = Number(data && data.choice && data.choice.number) || 1;
                const roll = 1 + Math.floor(Math.random() * 6);
                outcome = roll === n ? "win" : "loss";
                if (outcome === "win") { me.balance += wager * 5; }
                else { me.balance -= wager; }
            } else if (game === "coinflip") {
                const side = data && data.choice && data.choice.side === "tails" ? "tails" : "heads";
                const flip = Math.random() < 0.5 ? "heads" : "tails";
                outcome = flip === side ? "win" : "loss";
                if (outcome === "win") me.balance += wager;
                else me.balance -= wager;
            } else if (game === "crash") {
                const target = Math.max(1.1, Math.min(Number(data && data.choice && data.choice.autoCashout) || 2, 10));
                const u = Math.random();
                const crashPoint = Math.max(1, 1 / (1 - u));
                outcome = crashPoint >= target ? "win" : "loss";
                if (outcome === "win") me.balance += Math.floor(wager * (target - 1));
                else me.balance -= wager;
            } else if (game === "mines") {
                // mines instantâneo: 3 minas, jogador "abre" 3 células implícitas
                const mines = 3;
                const picks = Math.max(1, Math.min(Number(data && data.choice && data.choice.picks) || 3, 10));
                const comb = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1); return r; };
                const fairMult = comb(25, picks) / comb(25 - mines, picks);
                // probabilidade real de sobreviver
                outcome = Math.random() < Math.pow((25 - mines) / 25, picks) ? "win" : "loss";
                if (outcome === "win") me.balance += Math.floor(wager * (fairMult - 1));
                else me.balance -= wager;
            } else if (game === "roulette") {
                const betType = data && data.choice && data.choice.bet || "red";
                const number = Math.floor(Math.random() * 37);
                const RED = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
                let mult = 0;
                if (betType === "straight" && number === Number(data && data.choice && data.choice.value)) mult = 36;
                else if (betType === "red" && RED.includes(number)) mult = 2;
                else if (betType === "black" && number !== 0 && !RED.includes(number)) mult = 2;
                outcome = mult > 0 ? "win" : "loss";
                if (outcome === "win") me.balance += Math.floor(wager * (mult - 1));
                else me.balance -= wager;
            } else {
                return cb && cb({ ok: false, error: "Jogo inválido." });
            }

            d.log.push({
                system: false,
                username: me.username,
                message: `${game} — ${outcome === "win" ? "ganhou" : "perdeu"} ${wager} AC (saldo: ${me.balance})`,
                at: Date.now(),
            });

            // falência?
            if (me.balance < 10) {
                d.phase = "finished";
                const winnerKey = myKey === "p1" ? "p2" : "p1";
                const winner = d.players[winnerKey];
                d.log.push({ system: true, message: `💀 ${me.username} faliu! ${winner.username} VENCEU O DUELO! 🏆`, at: Date.now() });

                pool.db.run(
                    `INSERT INTO duel_stats (user_id, wins, losses) VALUES (?, 1, 0)
                     ON CONFLICT(user_id) DO UPDATE SET wins = wins + 1`,
                    [winner.userId]
                );
                pool.db.run(
                    `INSERT INTO duel_stats (user_id, wins, losses) VALUES (?, 0, 1)
                     ON CONFLICT(user_id) DO UPDATE SET losses = losses + 1`,
                    [me.userId]
                );

                // persiste saldos finais
                pool.db.run("UPDATE wallets SET balance = ? WHERE user_id = ? AND kind = 'duel'", [d.players.p1.balance, d.players.p1.userId]);
                pool.db.run("UPDATE wallets SET balance = ? WHERE user_id = ? AND kind = 'duel'", [d.players.p2.balance, d.players.p2.userId]);

                io.to(`duel:${d.code}`).emit("duel:state", duelState(d));
                io.to(`duel:${d.code}`).emit("duel:finished", { winner: winner.username });
                return cb && cb({ ok: true });
            }

            // troca o turno
            d.turn = myKey === "p1" ? "p2" : "p1";
            io.to(`duel:${d.code}`).emit("duel:state", duelState(d));
            cb && cb({ ok: true });
        });

        socket.on("duel:chat", (data) => {
            const d = duels.get(socket.data.duelCode);
            if (!d) return;
            const message = String(data && data.message || "").slice(0, 200).trim();
            if (!message) return;
            d.log.push({ username: socket.username, message, at: Date.now() });
            io.to(`duel:${d.code}`).emit("duel:state", duelState(d));
        });

        socket.on("disconnect", () => {
            // duelos persistem em memória para reconexão rápida
        });
    });

    return { duels };
}

module.exports = { setupDuels, duels };
