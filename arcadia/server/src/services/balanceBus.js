// ========================================
// ARCADIA - BALANCE BUS (v0.9.7)
// Barramento de eventos de carteira. A camada de dados emite aqui
// sem conhecer Socket.IO; o realtime assina e entrega ao usuário.
// ========================================

const { EventEmitter } = require("events");

const bus = new EventEmitter();
bus.setMaxListeners(50);

// Emitido SEMPRE que uma carteira muda de saldo.
// payload: { userId, kind: 'solo'|'coop'|'duel', balance, delta }
function emitBalanceChange(payload) {
    if (!payload || !Number.isFinite(payload.balance)) return;
    bus.emit("balance:changed", payload);
}

module.exports = { bus, emitBalanceChange };
