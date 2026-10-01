// ========================================
// ARCADIA - CONVITES DE AMIGOS (v0.9.5)
// Duelo x1 e Sala Coop direto da lista de amigos.
// Cada socket entra na sala pessoal "user:<id>" — é pra lá que o convite viaja.
// ========================================

const pool = require("../config/database");
const { JWT_SECRET } = require("../middleware/auth");
const jwt = require("jsonwebtoken");
const { duels } = require("./duels");
const { rooms, persistRoomCreate, persistRoomMember } = require("./rooms");

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
let ioRef = null;

function generateCode(len = 6) {
    let code = "";
    for (let i = 0; i < len; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return code;
}

function initInvites(io) {
    ioRef = io;

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
        // sala pessoal: convites chegam em user:<id>
        socket.join(`user:${socket.userId}`);
    });
}

async function sendInvite({ fromUserId, toUsername, kind }) {
    if (!ioRef) return { ok: false, error: "Realtime indisponível." };
    if (!["duel", "coop"].includes(kind)) return { ok: false, error: "Tipo de convite inválido." };

    const from = pool.db.get(`SELECT id, username FROM users WHERE id = ?`, [fromUserId]);
    if (!from) return { ok: false, error: "Remetente inválido." };

    const target = pool.db.get(
        `SELECT id, username FROM users WHERE LOWER(username) = LOWER(?)`,
        [String(toUsername || "").trim()]
    );
    if (!target) return { ok: false, error: "Jogador não encontrado." };
    if (target.id === fromUserId) return { ok: false, error: "Você não pode se convidar." };

    const friendship = pool.db.get(
        `SELECT id FROM friendships WHERE status = 'accepted'
         AND ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))`,
        [fromUserId, target.id, target.id, fromUserId]
    );
    if (!friendship) return { ok: false, error: "Vocês não são amigos ainda." };

    let code;

    if (kind === "duel") {
        do { code = Math.random().toString(36).slice(2, 7).toUpperCase(); } while (duels.has(code));

        // carteira duel do criador (mesma lógica do duel:create)
        let w = pool.db.get(`SELECT * FROM wallets WHERE user_id = ? AND kind = 'duel'`, [fromUserId]);
        if (!w) {
            pool.db.run(`INSERT INTO wallets (user_id, kind, balance) VALUES (?, 'duel', 1000)`, [fromUserId]);
            w = pool.db.get(`SELECT * FROM wallets WHERE user_id = ? AND kind = 'duel'`, [fromUserId]);
        }

        duels.set(code, {
            code,
            phase: "waiting",
            round: 1,
            turn: "p1",
            players: {
                p1: { userId: fromUserId, username: from.username, balance: w.balance, ready: false, socketIds: new Set() },
                p2: null,
            },
            auction: null,
            auctionWinner: null,
            chosenGame: null,
            log: [{ system: true, message: `${from.username} convidou ${target.username} para o duelo!`, at: Date.now() }],
        });
    } else {
        // coop: sala com pote compartilhado (dice por padrão)
        do { code = generateCode(); } while (rooms.has(code));

        const room = {
            code,
            name: `Sala de ${from.username}`,
            hostId: fromUserId,
            game: "dice",
            minBet: 10,
            maxBet: 1000,
            maxPlayers: 8,
            members: new Map(),
            stakes: new Map(),
            pot: 0,
            history: [],
            rBets: [],
            rLast: null,
            createdAt: Date.now(),
        };
        room.members.set(fromUserId, { username: from.username, socketIds: new Set(), lastSeen: Date.now() });
        rooms.set(code, room);
        persistRoomCreate(room);
        persistRoomMember(room, fromUserId, from.username);
    }

    ioRef.to(`user:${target.id}`).emit("friend:invite", {
        from: from.username,
        kind, // 'duel' | 'coop'
        code,
        at: Date.now(),
    });

    return { ok: true, code, kind };
}

module.exports = { initInvites, sendInvite };
