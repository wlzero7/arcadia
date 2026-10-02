// ========================================
// ARCADIA - HORSE RACING (v0.9) — multiplayer
// Corrida visual: cavalos com nomes, apostas no pote da sala
// v1.0.2: getWallet("coop") nas apostas (carteira garantida) + payouts com adjustBalance
// ========================================

const pool = require("../config/database");
const { JWT_SECRET } = require("../middleware/auth");
const jwt = require("jsonwebtoken");

const HORSE_NAMES = [
    "Barry", "Clade", "Lucy", "Nicolas", "Augusto", "Pé de Vento",
    "Trovão", "Biscate", "Cometa", "Fuscão Preto", "Relâmpago", "Maradona",
];

const HORSE_EMOJIS = ["🐎", "🐴", "🏇", "🦄", "🐴", "🐎"];

// races[code] = { code, hostId, phase, horses: [{id,name,emoji,odds}], bets: Map<userId,{horseId,amount}>, finishOrder, timers }
const races = new Map();

function rollOdds() {
    // pesos de 1 a 5 (5 = favorito); prob proporcional ao peso
    return 1 + Math.floor(Math.random() * 5);
}

function newRace(code, hostId) {
    const shuffled = [...HORSE_NAMES].sort(() => Math.random() - 0.5).slice(0, 6);
    return {
        code,
        hostId,
        phase: "betting", // betting | racing | finished
        horses: shuffled.map((name, i) => ({
            id: i,
            name,
            emoji: HORSE_EMOJIS[i % HORSE_EMOJIS.length],
            weight: rollOdds(), // maior = mais chance
            progress: 0,
        })),
        bets: new Map(), // userId -> { horseId, amount, username }
        finishOrder: [],
        pot: 0,
        round: 0,
    };
}

function payoutMultipliers(race) {
    // prob_i = weight_i / sum(weights); mult justo = 1/prob
    const total = race.horses.reduce((s, h) => s + h.weight, 0);
    return race.horses.map((h) => ({
        id: h.id,
        mult: Number((total / h.weight).toFixed(2)),
    }));
}

function raceState(race) {
    return {
        code: race.code,
        hostId: race.hostId,
        phase: race.phase,
        round: race.round,
        pot: race.pot,
        horses: race.horses.map((h) => ({ id: h.id, name: h.name, emoji: h.emoji, weight: h.weight, progress: race.phase === "betting" ? 0 : h.progress })),
        odds: payoutMultipliers(race),
        bets: [...race.bets.entries()].map(([uid, b]) => ({ userId: uid, username: b.username, horseId: b.horseId, amount: b.amount })),
    };
}

function setupRacing(io) {
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
        socket.data.raceCode = null;

        socket.on("race:create", (_, cb) => {
            let code;
            do { code = Math.random().toString(36).slice(2, 7).toUpperCase(); } while (races.has(code));
            const race = newRace(code, socket.userId);
            races.set(code, race);
            socket.data.raceCode = code;
            socket.join(`race:${code}`);
            io.to(`race:${code}`).emit("race:state", raceState(race));
            cb && cb({ ok: true, race: raceState(race) });
        });

        socket.on("race:join", (data, cb) => {
            const race = races.get(String(data && data.code || "").toUpperCase());
            if (!race) return cb && cb({ ok: false, error: "Corrida não encontrada." });
            socket.data.raceCode = race.code;
            socket.join(`race:${race.code}`);
            io.to(`race:${race.code}`).emit("race:state", raceState(race));
            cb && cb({ ok: true, race: raceState(race) });
        });

        // apostar num cavalo (debita da carteira COOP)
        socket.on("race:bet", async (data, cb) => {
            try {
                const race = races.get(socket.data.raceCode);
                if (!race) return cb && cb({ ok: false, error: "Entre em uma corrida primeiro." });
                if (race.phase !== "betting") return cb && cb({ ok: false, error: "Apostas fechadas — a corrida já começou. Aposte antes do host iniciar!" });

                const horseId = Number(data && data.horseId);
                const amount = Math.floor(Number(data && data.amount));
                if (!race.horses.some((h) => h.id === horseId)) return cb && cb({ ok: false, error: "Cavalo inválido." });
                if (!Number.isFinite(amount) || amount < 10) return cb && cb({ ok: false, error: "Aposta mínima: 10 AC." });

                // v1.0.2: getWallet garante a carteira COOP (cria com 1M se não existir)
                const wallet = await pool.getWallet(socket.userId, "coop");
                if (wallet.balance < amount) return cb && cb({ ok: false, error: "Saldo coop insuficiente." });

                // re-aposta substitui anterior (devolve o valor antigo primeiro)
                if (race.bets.has(socket.userId)) {
                    const old = race.bets.get(socket.userId);
                    await pool.adjustBalance(wallet.id, old.amount, "room_refund", "race", race.code);
                    race.pot -= old.amount;
                }

                await pool.adjustBalance(wallet.id, -amount, "room_stake", "race", race.code);

                race.bets.set(socket.userId, { horseId, amount, username: socket.username });
                race.pot += amount;

                io.to(`race:${race.code}`).emit("race:state", raceState(race));
                cb && cb({ ok: true, race: raceState(race) });
            } catch (err) {
                cb && cb({ ok: false, error: err.message });
            }
        });

        // host inicia a corrida
        socket.on("race:start", (_, cb) => {
            const race = races.get(socket.data.raceCode);
            if (!race || race.hostId !== socket.userId) return cb && cb({ ok: false, error: "Só o host inicia." });
            if (race.phase !== "betting") return cb && cb({ ok: false, error: "Corrida já em andamento." });

            race.phase = "racing";
            io.to(`race:${race.code}`).emit("race:state", raceState(race));

            // simulação: ticks a cada 500ms, cada cavalo avança aleatório ponderado pelo weight
            const timer = setInterval(() => {
                if (!races.has(race.code)) return clearInterval(timer);
                for (const h of race.horses) {
                    h.progress += Math.random() * 12 * (0.6 + h.weight * 0.16);
                }
                io.to(`race:${race.code}`).emit("race:tick", {
                    horses: race.horses.map((h) => ({ id: h.id, progress: Math.min(h.progress, 100) })),
                });

                const leader = race.horses.find((h) => h.progress >= 100);
                if (leader) {
                    clearInterval(timer);
                    finishRace(race, io, leader);
                }
            }, 500);
            race.timer = timer;
            cb && cb({ ok: true });
        });

        async function finishRace(race, io, winner) {
            race.phase = "finished";
            race.finishOrder = [winner.id];

            const odds = payoutMultipliers(race);
            const winnerOdds = odds.find((o) => o.id === winner.id).mult;

            // paga apostas vencedoras da carteira coop (com log de transação)
            const payouts = [];
            for (const [uid, b] of race.bets) {
                if (b.horseId === winner.id) {
                    const payout = Math.floor(b.amount * winnerOdds);
                    const w = await pool.get("SELECT id FROM wallets WHERE user_id = ? AND kind = 'coop'", [uid]);
                    if (w) {
                        await pool.adjustBalance(w.id, payout, "room_payout", "race", race.code);
                    }
                    payouts.push({ userId: uid, username: b.username, payout });
                }
            }

            io.to(`race:${race.code}`).emit("race:finished", {
                winner: { id: winner.id, name: winner.name, emoji: winner.emoji },
                odds: winnerOdds,
                payouts,
            });

            // nova corrida em 8s
            setTimeout(() => {
                if (!races.has(race.code)) return;
                const fresh = newRace(race.code, race.hostId);
                fresh.round = race.round + 1;
                races.set(race.code, fresh);
                io.to(`race:${race.code}`).emit("race:state", raceState(fresh));
            }, 8000);
        }

        socket.on("disconnect", () => {
            // corridas continuam; jogador só sai do canal
        });
    });

    return { races };
}

module.exports = { setupRacing, HORSE_NAMES };
