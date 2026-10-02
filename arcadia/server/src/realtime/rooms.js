// ========================================
// ARCADIA - MULTIPLAYER ROOMS (Socket.IO)
// A grande mecânica: carteira COMPARTILHADA entre amigos.
// Todos apostam do pote comum. O pote é dinheiro real do grupo (AC).
// v1.0: jogo Slots disponível nas salas (com trunfos e drop de cartas)
// ========================================

const pool = require("../config/database");
const { JWT_SECRET } = require("../middleware/auth");
const jwt = require("jsonwebtoken");
const { TRUMPS, resolveSpin, rollCardDrop } = require("../services/slotsEngine");

// ========================================
// ESTADO EM MEMÓRIA (fonte da verdade em tempo real)
// Persistimos no DB nos eventos-chave (entrada, aposta, saída).
// ========================================

// rooms[code] = {
//   code, name, hostId, game, minBet, maxBet, maxPlayers,
//   members: Map<userId, { username, socketIds:Set, lastSeen }>,
//   pot: number,          // saldo compartilhado
//   stakes: Map<userId, number>,  // quanto cada um contribuiu
//   history: [],          // últimas rodadas
//   createdAt
// }

const rooms = new Map();
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROULETTE_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

function generateCode(len = 6) {
    let code = "";
    for (let i = 0; i < len; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return code;
}

function roomSummary(room) {
    return {
        code: room.code,
        name: room.name,
        hostId: room.hostId,
        game: room.game,
        minBet: room.minBet,
        maxBet: room.maxBet,
        maxPlayers: room.maxPlayers,
        pot: room.pot,
        players: [...room.members.entries()].map(([id, m]) => ({
            id,
            username: m.username,
            stake: room.stakes.get(id) || 0,
            online: m.socketIds.size > 0,
        })),
        history: room.history.slice(-20),
        rBets: room.rBets || [],
        rLast: room.rLast || null,
    };
}

// ========================================
// JOGOS MULTIPLAYER (mesma engine do solo, mas debitando do POTE)
// ========================================

const MULTI_GAMES = {
    dice: {
        label: "Dados Compartilhados",
        play(room, wager, choice) {
            const n = choice && choice.number ? Number(choice.number) : null;
            const roll = 1 + Math.floor(Math.random() * 6);
            const win = n !== null && roll === n;
            return {
                type: "dice",
                roll,
                picked: n,
                outcome: win ? "win" : "loss",
                multiplier: win ? 6 : 0,
                payout: win ? wager * 6 : 0,
                wager,
            };
        },
    },
    coinflip: {
        label: "Cara ou Coroa",
        play(room, wager, choice) {
            const side = choice && choice.side === "tails" ? "tails" : "heads";
            const flip = Math.random() < 0.5 ? "heads" : "tails";
            const win = flip === side;
            return {
                type: "coinflip",
                flip,
                picked: side,
                outcome: win ? "win" : "loss",
                multiplier: win ? 2 : 0,
                payout: win ? wager * 2 : 0,
                wager,
            };
        },
    },
    roulette: {
        // Roleta do grupo (v0.9) — apostas via room:rbet, giro via room:rspin
        label: 'Roleta do Grupo',
    },
    crash: {
        // Crash compartilhado: todo mundo aposta, um multiplicador sobe até crashar.
        // Quem apostou e ficou até o fim ganha proporcional... v1: cada um escolhe
        // auto-cashout. Se crashar antes, perde. Se cashout antes, ganha wager*mult.
        label: "Crash do Grupo",
        play(room, wager, choice) {
            const target = Math.max(1.01, Math.min(Number(choice && choice.autoCashout) || 2, 100));
            // Distribuição de crash: house-edge zero → crash point = max(1, 0.99/(1-U))
            const u = Math.random();
            const crashPoint = Math.max(1, Math.floor((100 / (100 - 1)) / (1 - u) * 100) / 100);
            const win = crashPoint >= target;
            return {
                type: "crash",
                crashPoint,
                autoCashout: target,
                outcome: win ? "win" : "loss",
                multiplier: win ? target : 0,
                payout: win ? Math.floor(wager * target) : 0,
                wager,
            };
        },
    },
    slots: {
        // Slots do grupo (v1.0): mesma engine do solo/duelo, debitando do POTE.
        // O trunfo é validado e consumido no handler room:play (precisa de DB).
        label: "Slots do Grupo",
        play(room, wager, choice) {
            const trump = choice && choice.trump ? String(choice.trump) : null;
            const result = resolveSpin({ wager, trump });
            return {
                type: "slots",
                reels: result.reels,
                outcome: result.outcome,
                jackpot: result.jackpot,
                multiplier: result.mult,
                payout: result.payout,
                lossMultiplier: result.lossMultiplier,
                notes: result.notes,
                wager,
            };
        },
    },
};

// ========================================
// SETUP SOCKET.IO
// ========================================

// ========================================
// PERSISTÊNCIA (v0.7) — salas sobrevivem a restart
// ========================================

function persistRoomCreate(room) {
    try {
        pool.run(
            `INSERT INTO rooms (code, name, host_id, game, max_players, min_bet, max_bet, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'lobby')
             ON CONFLICT(code) DO UPDATE SET name=excluded.name, status='lobby'`,
            [room.code, room.name, room.hostId, room.game, room.maxPlayers, room.minBet, room.maxBet]
        ).then(() => {
            pool.get(`SELECT id FROM rooms WHERE code = ?`, [room.code]).then((r) => {
                if (!r) return;
                pool.run(
                    `INSERT INTO room_pot (room_id, balance) VALUES (?, ?)
                     ON CONFLICT(room_id) DO UPDATE SET balance = excluded.balance`,
                    [r.id, room.pot]
                );
                persistRoomMember(room, room.hostId, [...room.members.get(room.hostId)?.username || "host"][0] || [...room.members.values()][0].username);
            });
        }).catch(() => {});
    } catch (_) {}
}

function persistRoomMember(room, userId, username) {
    pool.get(`SELECT id FROM rooms WHERE code = ?`, [room.code]).then((r) => {
        if (!r) return;
        pool.run(
            `INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)
             ON CONFLICT(room_id, user_id) DO NOTHING`,
            [r.id, userId, userId === room.hostId ? "host" : "player"]
        ).catch(() => {});
    }).catch(() => {});
}

function persistRoomMemberRemove(room, userId) {
    pool.get(`SELECT id FROM rooms WHERE code = ?`, [room.code]).then((r) => {
        if (!r) return;
        pool.run(`DELETE FROM room_members WHERE room_id = ? AND user_id = ?`, [r.id, userId]).catch(() => {});
    }).catch(() => {});
}

function persistPot(room) {
    pool.get(`SELECT id FROM rooms WHERE code = ?`, [room.code]).then((r) => {
        if (!r) return;
        pool.run(`UPDATE room_pot SET balance = ? WHERE room_id = ?`, [room.pot, r.id]).catch(() => {});
    }).catch(() => {});
}

function persistRoomClose(room) {
    pool.run(`UPDATE rooms SET status = 'closed' WHERE code = ?`, [room.code]).catch(() => {});
}

// Hidrata salas do DB no boot (membros offline entram ao conectar de novo)
async function hydrateRooms() {
    try {
        const rows = await pool.query(
            `SELECT r.*, p.balance AS pot FROM rooms r
             INNER JOIN room_pot p ON p.room_id = r.id
             WHERE r.status IN ('lobby','playing')`
        );
        for (const row of rows.rows) {
            if (rooms.has(row.code)) continue;
            const members = await pool.query(
                `SELECT rm.user_id, rm.role, u.username FROM room_members rm
                 INNER JOIN users u ON u.id = rm.user_id WHERE rm.room_id = ?`,
                [row.id]
            );
            const room = {
                code: row.code,
                name: row.name,
                hostId: row.host_id,
                game: row.game,
                minBet: row.min_bet,
                maxBet: row.max_bet,
                maxPlayers: row.max_players,
                members: new Map(),
                stakes: new Map(),
                pot: row.pot || 0,
                history: [],
                createdAt: Date.now(),
            };
            for (const m of members.rows) {
                room.members.set(m.user_id, {
                    username: m.username,
                    socketIds: new Set(), // reconecta ao entrar
                    lastSeen: Date.now(),
                });
            }
            rooms.set(row.code, room);
        }
        if (rows.rows.length) console.log(`   ${rows.rows.length} sala(s) restaurada(s) do banco`);
    } catch (err) {
        console.warn("Hydrate rooms:", err.message);
    }
}

function setupMultiplayer(io) {
    // Auth no handshake
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
        socket.data.userId = socket.userId;
        socket.data.username = socket.username;
        socket.data.roomCode = null;

        // ---------- CRIAR SALA ----------
        socket.on("room:create", async (data, cb) => {
            try {
                let code;
                do {
                    code = generateCode();
                } while (rooms.has(code));

                const room = {
                    code,
                    name: (data && data.name ? String(data.name).slice(0, 40) : `Sala de ${socket.username}`),
                    hostId: socket.userId,
                    game: data && MULTI_GAMES[data.game] ? data.game : "dice",
                    minBet: Math.max(10, Number(data && data.minBet) || 10),
                    maxBet: Math.max(10, Number(data && data.maxBet) || 1000),
                    maxPlayers: Math.min(Math.max(Number(data && data.maxPlayers) || 8, 2), 16),
                    members: new Map(),
                    stakes: new Map(),
                    pot: 0,
                    history: [],
                    rBets: [],
                    rLast: null,
                    createdAt: Date.now(),
                };

                room.members.set(socket.userId, {
                    username: socket.username,
                    socketIds: new Set([socket.id]),
                    lastSeen: Date.now(),
                });

                rooms.set(code, room);
                persistRoomCreate(room);
                socket.data.roomCode = code;
                socket.join(`room:${code}`);
                if (typeof cb === "function") cb({ ok: true, room: roomSummary(room) });
            } catch (err) {
                if (typeof cb === "function") cb({ ok: false, error: err.message });
            }
        });

        // ---------- ENTRAR ----------
        socket.on("room:join", async (data, cb) => {
            try {
                const code = String(data && data.code || "").toUpperCase().trim();
                const room = rooms.get(code);
                if (!room) {
                    return typeof cb === "function" && cb({ ok: false, error: "Sala não encontrada." });
                }
                if (room.members.size >= room.maxPlayers && !room.members.has(socket.userId)) {
                    return typeof cb === "function" && cb({ ok: false, error: "Sala cheia." });
                }
                if (!room.members.has(socket.userId)) {
                    room.members.set(socket.userId, {
                        username: socket.username,
                        socketIds: new Set(),
                        lastSeen: Date.now(),
                    });
                    persistRoomMember(room, socket.userId, socket.username);
                }
                room.members.get(socket.userId).socketIds.add(socket.id);
                room.members.get(socket.userId).lastSeen = Date.now();
                socket.data.roomCode = code;
                socket.join(`room:${code}`);
                io.to(`room:${code}`).emit("room:update", roomSummary(room));
                if (typeof cb === "function") cb({ ok: true, room: roomSummary(room) });
            } catch (err) {
                if (typeof cb === "function") cb({ ok: false, error: err.message });
            }
        });

        // ---------- SAIR ----------
        socket.on("room:leave", async (_, cb) => {
            await leaveRoom(socket, io);
            if (typeof cb === "function") cb({ ok: true });
        });

        // ---------- DEPOSITAR NO POTE (stake) ----------
        socket.on("room:stake", async (data, cb) => {
            try {
                const code = socket.data.roomCode;
                const room = rooms.get(code);
                if (!room) return cb && cb({ ok: false, error: "Você não está numa sala." });

                const amount = Math.floor(Number(data && data.amount));
                if (!Number.isFinite(amount) || amount <= 0) {
                    return cb && cb({ ok: false, error: "Valor inválido." });
                }

                const wallet = await pool.get(`SELECT id, balance FROM wallets WHERE user_id = ?`, [socket.userId]);
                if (!wallet || wallet.balance < amount) {
                    return cb && cb({ ok: false, error: "Saldo insuficiente." });
                }

                await pool.adjustBalance(wallet.id, -amount, "room_stake", "room", code);
                room.pot += amount;
                room.stakes.set(socket.userId, (room.stakes.get(socket.userId) || 0) + amount);
                persistPot(room);

                io.to(`room:${code}`).emit("room:update", roomSummary(room));
                io.to(`room:${code}`).emit("room:chat", {
                    system: true,
                    message: `${socket.username} depositou ${amount} AC no pote.`,
                    at: Date.now(),
                });
                cb && cb({ ok: true, room: roomSummary(room) });
            } catch (err) {
                cb && cb({ ok: false, error: err.message });
            }
        });

        // ---------- JOGAR RODADA (debita do POTE, credita no POTE) ----------
        socket.on("room:play", async (data, cb) => {
            try {
                const code = socket.data.roomCode;
                const room = rooms.get(code);
                if (!room) return cb && cb({ ok: false, error: "Você não está numa sala." });

                const game = MULTI_GAMES[room.game];
                if (!game) return cb && cb({ ok: false, error: "Jogo indisponível." });

                const wager = Math.floor(Number(data && data.wager));
                if (!Number.isFinite(wager) || wager < room.minBet) {
                    return cb && cb({ ok: false, error: `Aposta mínima da sala: ${room.minBet} AC.` });
                }
                if (wager > room.maxBet) {
                    return cb && cb({ ok: false, error: `Aposta máxima da sala: ${room.maxBet} AC.` });
                }
                if (wager > room.pot) {
                    return cb && cb({ ok: false, error: "O pote não tem saldo para essa aposta." });
                }

                // SLOTS: valida e consome o trunfo ANTES de girar (server-authoritative)
                let trump = null;
                if (room.game === "slots" && data && data.choice && data.choice.trump) {
                    const trumpKey = String(data.choice.trump);
                    if (!TRUMPS[trumpKey]) {
                        return cb && cb({ ok: false, error: "Trunfo inválido." });
                    }
                    if (TRUMPS[trumpKey].duelOnly) {
                        return cb && cb({ ok: false, error: "Esse trunfo é exclusivo do modo Duelo." });
                    }
                    const owned = await pool.get(
                        `SELECT id FROM slots_cards WHERE user_id = ? AND card_key = ? LIMIT 1`,
                        [socket.userId, trumpKey]
                    );
                    if (!owned) {
                        return cb && cb({ ok: false, error: "Você não possui esse trunfo." });
                    }
                    await pool.run(`DELETE FROM slots_cards WHERE id = ?`, [owned.id]);
                    trump = trumpKey;
                }

                const choice = { ...(data && data.choice), trump };
                const result = game.play(room, wager, choice);

                // Debita do pote o wager; credita o payout
                room.pot -= wager;
                room.pot += result.payout;

                // Duplicador: derrota custa o dobro — debita o extra com clamp de segurança
                if (result.type === "slots" && result.outcome === "loss" && (result.lossMultiplier || 1) > 1) {
                    const extra = wager * ((result.lossMultiplier || 1) - 1);
                    room.pot -= Math.min(extra, room.pot);
                }

                // Ajusta stakes: quem ganhou, ganhou dos amigos. V1: o pote é único,
                // stakes ficam como registro de contribuição.
                const entry = {
                    id: Date.now() + "-" + Math.random().toString(36).slice(2, 6),
                    playerId: socket.userId,
                    playerName: socket.username,
                    ...result,
                    potAfter: room.pot,
                    at: Date.now(),
                };

                // SLOTS: drop de carta (50%) para quem girou
                if (room.game === "slots") {
                    const card = rollCardDrop(false);
                    if (card) {
                        await pool.run(
                            `INSERT INTO slots_cards (user_id, card_key, rarity) VALUES (?, ?, ?)`,
                            [socket.userId, card.key, card.rarity]
                        );
                        entry.card = card;
                    }
                }

                room.history.push(entry);
                if (room.history.length > 100) room.history.shift();
                persistPot(room);

                io.to(`room:${code}`).emit("room:round", entry);
                io.to(`room:${code}`).emit("room:update", roomSummary(room));
                cb && cb({ ok: true, round: entry });
            } catch (err) {
                cb && cb({ ok: false, error: err.message });
            }
        });

        // ---------- SAQUE DO POTE (withdraw stake) ----------
        socket.on("room:withdraw", async (data, cb) => {
            try {
                const code = socket.data.roomCode;
                const room = rooms.get(code);
                if (!room) return cb && cb({ ok: false, error: "Você não está numa sala." });

                const myStake = room.stakes.get(socket.userId) || 0;
                const amount = Math.floor(Number(data && data.amount) || myStake);
                if (amount <= 0) return cb && cb({ ok: false, error: "Você não tem stake para sacar." });
                if (amount > myStake) return cb && cb({ ok: false, error: "Valor maior que seu stake." });
                if (amount > room.pot) return cb && cb({ ok: false, error: "O pote não tem saldo suficiente (alguém está ganhando!)." });

                const wallet = await pool.get(`SELECT id FROM wallets WHERE user_id = ?`, [socket.userId]);
                if (!wallet) return cb && cb({ ok: false, error: "Carteira não encontrada." });

                await pool.adjustBalance(wallet.id, amount, "room_payout", "room", code);
                room.pot -= amount;
                room.stakes.set(socket.userId, myStake - amount);
                persistPot(room);

                io.to(`room:${code}`).emit("room:update", roomSummary(room));
                io.to(`room:${code}`).emit("room:chat", {
                    system: true,
                    message: `${socket.username} sacou ${amount} AC do pote.`,
                    at: Date.now(),
                });
                cb && cb({ ok: true, room: roomSummary(room) });
            } catch (err) {
                cb && cb({ ok: false, error: err.message });
            }
        });

        // ---------- CHAT ----------
        socket.on("room:chat", (data) => {
            const code = socket.data.roomCode;
            if (!code || !rooms.has(code)) return;
            const message = String(data && data.message || "").slice(0, 240).trim();
            if (!message) return;
            io.to(`room:${code}`).emit("room:chat", {
                username: socket.username,
                message,
                at: Date.now(),
            });
        });

        // ---------- LISTAR SALAS ----------
        socket.on("rooms:list", (_, cb) => {
            const list = [...rooms.values()]
                .filter((r) => r.members.size > 0)
                .map(roomSummary);
            if (typeof cb === "function") cb({ ok: true, rooms: list });
        });

        // ---------- ROLETA COMPARTILHADA (v0.9) ----------
        socket.on("room:rbet", async (data, cb) => {
            try {
                const code = socket.data.roomCode;
                const room = rooms.get(code);
                if (!room) return cb && cb({ ok: false, error: "Você não está numa sala." });
                if (room.game !== "roulette") return cb && cb({ ok: false, error: "Sala não é de roleta." });

                const type = String(data && data.type || "");
                const value = data && data.value != null ? Number(data.value) : null;
                const amount = Math.floor(Number(data && data.amount));

                if (!["red","black","even","odd","low","high","dozen1","dozen2","dozen3","straight"].includes(type)) {
                    return cb && cb({ ok: false, error: "Tipo de aposta inválido." });
                }
                if (type === "straight" && (value == null || value < 0 || value > 36)) {
                    return cb && cb({ ok: false, error: "Número inválido." });
                }
                if (!Number.isFinite(amount) || amount < room.minBet) {
                    return cb && cb({ ok: false, error: `Aposta mínima: ${room.minBet} AC.` });
                }
                if (amount > room.maxBet) {
                    return cb && cb({ ok: false, error: `Aposta máxima: ${room.maxBet} AC.` });
                }
                if (amount > room.pot) {
                    return cb && cb({ ok: false, error: "O pote não tem saldo para essa aposta." });
                }

                room.pot -= amount;
                room.rBets.push({ userId: socket.userId, username: socket.username, type, value, amount });

                io.to(`room:${code}`).emit("room:update", roomSummary(room));
                cb && cb({ ok: true, room: roomSummary(room) });
            } catch (err) {
                cb && cb({ ok: false, error: err.message });
            }
        });

        socket.on("room:rspin", async (_, cb) => {
            try {
                const code = socket.data.roomCode;
                const room = rooms.get(code);
                if (!room) return cb && cb({ ok: false, error: "Você não está numa sala." });
                if (room.game !== "roulette") return cb && cb({ ok: false, error: "Sala não é de roleta." });
                if (!room.rBets.length) return cb && cb({ ok: false, error: "Ninguém apostou ainda." });

                const number = Math.floor(Math.random() * 37);
                const color = number === 0 ? "green" : ROULETTE_RED.has(number) ? "red" : "black";

                let totalWager = 0;
                let totalPayout = 0;
                const results = room.rBets.map((b) => {
                    let mult = 0;
                    if (b.type === "straight" && b.value === number) mult = 36;
                    else if (b.type === "red" && color === "red") mult = 2;
                    else if (b.type === "black" && color === "black") mult = 2;
                    else if (b.type === "even" && number !== 0 && number % 2 === 0) mult = 2;
                    else if (b.type === "odd" && number % 2 === 1) mult = 2;
                    else if (b.type === "low" && number >= 1 && number <= 18) mult = 2;
                    else if (b.type === "high" && number >= 19 && number <= 36) mult = 2;
                    else if (b.type === "dozen1" && number >= 1 && number <= 12) mult = 3;
                    else if (b.type === "dozen2" && number >= 13 && number <= 24) mult = 3;
                    else if (b.type === "dozen3" && number >= 25 && number <= 36) mult = 3;
                    const payout = b.amount * mult;
                    totalWager += b.amount;
                    totalPayout += payout;
                    return { username: b.username, type: b.type, value: b.value, amount: b.amount, won: mult > 0, payout };
                });

                room.pot += totalPayout;
                const outcome = totalPayout > totalWager ? "win" : totalPayout > 0 ? "push" : "loss";
                room.rLast = { number, color, totalPayout, results };
                room.rBets = [];
                persistPot(room);

                const entry = {
                    id: Date.now() + "-" + Math.random().toString(36).slice(2, 6),
                    type: "roulette",
                    playerName: socket.username,
                    number, color,
                    wager: totalWager,
                    payout: totalPayout,
                    outcome,
                    potAfter: room.pot,
                    at: Date.now(),
                };
                room.history.push(entry);
                if (room.history.length > 100) room.history.shift();

                io.to(`room:${code}`).emit("room:round", entry);
                io.to(`room:${code}`).emit("room:update", roomSummary(room));
                cb && cb({ ok: true, round: entry });
            } catch (err) {
                cb && cb({ ok: false, error: err.message });
            }
        });

        // ---------- DISCONNECT ----------
        socket.on("disconnect", async () => {
            await leaveRoom(socket, io);
        });
    });

    // ========================================
    // SAIR DA SALA (helper)
    // ========================================
    async function leaveRoom(socket, io) {
        const code = socket.data.roomCode;
        if (!code) return;
        const room = rooms.get(code);
        if (!room) return;

        const member = room.members.get(socket.userId);
        if (member) {
            member.socketIds.delete(socket.id);

            // Só remove do roster se não tiver mais nenhum socket na sala
            if (member.socketIds.size === 0) {
                // Grace: espera 30s antes de remover de vez (reconnect)
                member.lastSeen = Date.now();
                setTimeout(() => {
                    const m = room.members.get(socket.userId);
                    if (m && m.socketIds.size === 0 && Date.now() - m.lastSeen >= 29000) {
                        room.members.delete(socket.userId);
                        room.stakes.delete(socket.userId);
                        persistRoomMemberRemove(room, socket.userId);
                        io.to(`room:${code}`).emit("room:chat", {
                            system: true,
                            message: `${socket.username} saiu da sala.`,
                            at: Date.now(),
                        });
                        io.to(`room:${code}`).emit("room:update", roomSummary(room));

                        // Host saiu? Passa o host pro próximo, ou fecha se vazio
                        if (room.hostId === socket.userId) {
                            const next = [...room.members.keys()][0];
                            if (next) {
                                room.hostId = next;
                                io.to(`room:${code}`).emit("room:chat", {
                                    system: true,
                                    message: `${room.members.get(next).username} é o novo host.`,
                                    at: Date.now(),
                                });
                            }
                        }
                        if (room.members.size === 0) {
                            rooms.delete(code);
                            persistRoomClose(room);
                        }
                    }
                }, 30000);
            }
        }

        socket.leave(`room:${code}`);
        socket.data.roomCode = null;
        io.to(`room:${code}`).emit("room:update", roomSummary(room));
    }

    hydrateRooms();

    return { rooms, MULTI_GAMES };
}

module.exports = { setupMultiplayer, rooms, persistRoomCreate, persistRoomMember };
