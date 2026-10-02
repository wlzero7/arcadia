// ========================================
// ARCADIA - BALANCE SOCKET (v0.9.7)
// Assina o balanceBus e entrega balanceUpdate SOMENTE ao dono da carteira,
// via sala pessoal user:<id>. Cada evento carrega o kind da carteira
// (solo/coop/duel) — o front atualiza só os elementos daquele tipo.
// ========================================

const { JWT_SECRET } = require("../middleware/auth");
const jwt = require("jsonwebtoken");
const { bus } = require("../services/balanceBus");

function initBalanceSocket(io) {
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
        // sala pessoal do usuário (mesma usada pelos convites — join duplicado é inofensivo)
        socket.join(`user:${socket.userId}`);
    });

    bus.on("balance:changed", ({ userId, kind, balance, delta }) => {
        io.to(`user:${userId}`).emit("balanceUpdate", {
            kind,        // 'solo' | 'coop' | 'duel'
            balance,     // novo saldo da carteira
            delta,       // variação (+ganhou / -perdeu)
            at: Date.now(),
        });
    });
}

module.exports = { initBalanceSocket };
