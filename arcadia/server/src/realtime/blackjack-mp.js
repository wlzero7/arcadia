// ========================================
// ARCADIA - BLACKJACK MULTIPLAYER (v0.9)
// Mesa ao vivo + CARTAS ESPECIAIS + NRG
// ========================================

const { Database } = require("node-sqlite3-wasm");
const pool = require("../config/database");
const { JWT_SECRET } = require("../middleware/auth");
const jwt = require("jsonwebtoken");

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function newDeck() {
    const deck = [];
    for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s });
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function handValue(cards) {
    let total = 0, aces = 0;
    for (const c of cards) {
        if (c.rank === "A") { aces++; total += 11; }
        else if (["J", "Q", "K"].includes(c.rank)) total += 10;
        else total += Number(c.rank);
    }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return total;
}

// ========================================
// CARTAS ESPECIAIS (v0.9)
// raridades: comum, raro, super-raro, épico, lendária, cromática
// ========================================

const SPECIAL_CARDS = {
    force_hit:        { rarity: "comum",     desc: "Force um adversário a comprar 1 carta", nrg: 1 },
    remove_last:      { rarity: "raro",      desc: "Remova a última carta que um alvo comprou", nrg: 2 },
    raise_limit_28:   { rarity: "raro",      desc: "Aumente o limite da mesa para 28", nrg: 2 },
    lower_limit_17:   { rarity: "épico",     desc: "Reduza o limite da mesa para 17", nrg: 3 },
    pick_card:        { rarity: "lendária",  desc: "Escolha uma carta específica do baralho", nrg: 4 },
    draw_three:       { rarity: "super-raro",desc: "Compre 3 cartas (contam juntas)", nrg: 2 },
    mirror:           { rarity: "cromática", desc: "Copie a última carta especial usada contra você de volta no emissor", nrg: 5 },
    shield:           { rarity: "épico",     desc: "Anule a próxima carta especial contra você", nrg: 3 },
};

const RARITY_DROP = [
    ["comum", 50],
    ["raro", 25],
    ["super-raro", 15],
    ["épico", 6],
    ["lendária", 3],
    ["cromática", 1],
];

function rollSpecialCard() {
    const total = RARITY_DROP.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [rar, w] of RARITY_DROP) {
        if ((r -= w) < 0) {
            const options = Object.entries(SPECIAL_CARDS).filter(([, c]) => c.rarity === rar);
            const [key] = options[Math.floor(Math.random() * options.length)];
            return key;
        }
    }
    return "force_hit";
}

// ========================================
// MESAS EM MEMÓRIA
// ========================================

// tables[code] = { code, hostId, players: Map<userId, {...}>, deck, limit, order, turnIdx, phase, specialHand, discard }
const tables = new Map();

function newTable(code, hostId) {
    return {
        code,
        hostId,
        players: new Map(), // userId -> { username, hand, stood, busted, nrg, specials: [], shield: false, lastDrawn, socketIds: Set }
        deck: newDeck(),
        discard: [],
        limit: 21,
        order: [],
        turnIdx: 0,
        phase: "lobby", // lobby | playing | finished
        round: 0,
    };
}

function tableState(t) {
    return {
        code: t.code,
        hostId: t.hostId,
        phase: t.phase,
        limit: t.limit,
        round: t.round,
        players: [...t.players.entries()].map(([id, p]) => ({
            id,
            username: p.username,
            hand: p.hand,
            total: handValue(p.hand),
            stood: p.stood,
            busted: p.busted,
            nrg: p.nrg,
            specials: p.specials.length,
            online: p.socketIds.size > 0,
            isTurn: t.order[t.turnIdx] === id && t.phase === "playing",
        })),
    };
}

function draw(t) {
    if (t.deck.length === 0) {
        t.deck = t.discard.splice(0);
        for (let i = t.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [t.deck[i], t.deck[j]] = [t.deck[j], t.deck[i]];
        }
    }
    return t.deck.pop();
}

// Tenta compra de carta especial (30% ao comprar do monte)
function maybeSpecial(t, player, io, code) {
    if (Math.random() < 0.3) {
        const key = rollSpecialCard();
        player.specials.push(key);
        io.to(`bj:${code}`).emit("bj:chat", {
            system: true,
            message: `🎴 ${player.username} sacou carta especial: ${SPECIAL_CARDS[key].desc} (${SPECIAL_CARDS[key].rarity})`,
            at: Date.now(),
        });
    }
}

function nextTurn(t, io, code) {
    // avança para o próximo jogador não-estourado que não parou
    let tries = 0;
    do {
        t.turnIdx = (t.turnIdx + 1) % t.order.length;
        tries++;
    } while (tries <= t.order.length && (t.players.get(t.order[t.turnIdx]).stood || t.players.get(t.order[t.turnIdx]).busted));

    // todos pararam/estouraram?
    const active = [...t.players.values()].filter((p) => !p.stood && !p.busted);
    if (active.length === 0 || tries > t.order.length) {
        finishRound(t, io, code);
        return;
    }

    io.to(`bj:${code}`).emit("bj:state", tableState(t));
}

function finishRound(t, io, code) {
    t.phase = "finished";
    // vencedor: maior total <= limit
    let best = null;
    for (const [id, p] of t.players) {
        const total = handValue(p.hand);
        if (total <= t.limit && (!best || total > handValue(best.hand))) best = p;
    }
    const results = [...t.players.values()].map((p) => ({
        id: [...t.players.entries()].find(([pid, pp]) => pp === p)[0],
        username: p.username,
        total: handValue(p.hand),
        busted: p.busted,
        won: p === best,
    }));

    io.to(`bj:${code}`).emit("bj:round_end", {
        winner: best ? { id: results.find((r) => r.username === best.username)?.id, username: best.username } : null,
        results,
        limit: t.limit,
    });

    // reset para próxima rodada
    setTimeout(() => {
        if (!tables.has(code)) return;
        t.round++;
        t.limit = 21;
        t.deck = newDeck();
        for (const p of t.players.values()) {
            p.hand = [t.deck.pop(), t.deck.pop()];
            p.stood = false;
            p.busted = false;
            p.shield = false;
            p.nrg = Math.min(p.nrg + 2, 10); // +2 NRG por rodada
        }
        t.order = [...t.players.keys()];
        t.turnIdx = 0;
        t.phase = "playing";
        io.to(`bj:${code}`).emit("bj:state", tableState(t));
    }, 5000);
}

function setupBlackjackMultiplayer(io) {
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
        socket.data.tableCode = null;

        // ---------- CRIAR/ENTRAR ----------
        socket.on("bj:create", (data, cb) => {
            let code;
            do { code = Math.random().toString(36).slice(2, 7).toUpperCase(); } while (tables.has(code));
            const t = newTable(code, socket.userId);
            tables.set(code, t);
            joinTable(socket, t, io, cb);
        });

        socket.on("bj:join", (data, cb) => {
            const t = tables.get(String(data && data.code || "").toUpperCase());
            if (!t) return cb && cb({ ok: false, error: "Mesa não encontrada." });
            joinTable(socket, t, io, cb);
        });

        function joinTable(socket, t, io, cb) {
            if (!t.players.has(socket.userId)) {
                if (t.phase !== "lobby" && t.phase !== "finished") {
                    return cb && cb({ ok: false, error: "Rodada em andamento." });
                }
                t.players.set(socket.userId, {
                    username: socket.username,
                    hand: [],
                    stood: false,
                    busted: false,
                    nrg: 3,
                    specials: [],
                    shield: false,
                    lastDrawn: null,
                    socketIds: new Set(),
                });
                t.order.push(socket.userId);
            }
            t.players.get(socket.userId).socketIds.add(socket.id);
            socket.data.tableCode = t.code;
            socket.join(`bj:${t.code}`);
            io.to(`bj:${t.code}`).emit("bj:state", tableState(t));
            cb && cb({ ok: true, table: tableState(t) });
        }

        // ---------- INICIAR RODADA ----------
        socket.on("bj:start", (_, cb) => {
            const t = tables.get(socket.data.tableCode);
            if (!t || t.hostId !== socket.userId) return cb && cb({ ok: false, error: "Só o host inicia." });
            if (t.players.size < 1) return cb && cb({ ok: false, error: "Sem jogadores." });

            t.deck = newDeck();
            for (const p of t.players.values()) {
                p.hand = [t.deck.pop(), t.deck.pop()];
                p.stood = false;
                p.busted = false;
                p.shield = false;
                p.lastDrawn = null;
            }
            t.order = [...t.players.keys()];
            t.turnIdx = 0;
            t.phase = "playing";
            io.to(`bj:${t.code}`).emit("bj:state", tableState(t));
            cb && cb({ ok: true });
        });

        // ---------- AÇÕES DE JOGO ----------
        socket.on("bj:hit", (_, cb) => {
            const t = tables.get(socket.data.tableCode);
            if (!t || t.phase !== "playing") return cb && cb({ ok: false, error: "Rodada não ativa." });
            if (t.order[t.turnIdx] !== socket.userId) return cb && cb({ ok: false, error: "Não é sua vez." });

            const p = t.players.get(socket.userId);
            const card = t.deck.pop();
            p.hand.push(card);
            p.lastDrawn = card;

            // chance de carta especial
            maybeSpecial(t, p, io, t.code);

            const total = handValue(p.hand);
            if (total > t.limit) {
                p.busted = true;
                io.to(`bj:${t.code}`).emit("bj:chat", { system: true, message: `💥 ${p.username} estourou com ${total} (limite ${t.limit}).`, at: Date.now() });
                nextTurn(t, io, t.code);
            }
            io.to(`bj:${t.code}`).emit("bj:state", tableState(t));
            cb && cb({ ok: true });
        });

        socket.on("bj:stand", (_, cb) => {
            const t = tables.get(socket.data.tableCode);
            if (!t || t.phase !== "playing") return cb && cb({ ok: false, error: "Rodada não ativa." });
            if (t.order[t.turnIdx] !== socket.userId) return cb && cb({ ok: false, error: "Não é sua vez." });

            const p = t.players.get(socket.userId);
            p.stood = true;
            io.to(`bj:${t.code}`).emit("bj:chat", { system: true, message: `✋ ${p.username} parou em ${handValue(p.hand)}.`, at: Date.now() });
            nextTurn(t, io, t.code);
            cb && cb({ ok: true });
        });

        // ---------- CARTAS ESPECIAIS ----------
        socket.on("bj:special", (data, cb) => {
            const t = tables.get(socket.data.tableCode);
            if (!t || t.phase !== "playing") return cb && cb({ ok: false, error: "Rodada não ativa." });

            const me = t.players.get(socket.userId);
            const key = String(data && data.cardKey || "");
            const targetId = data && data.targetId ? Number(data.targetId) : null;
            const idx = me.specials.indexOf(key);
            if (idx === -1) return cb && cb({ ok: false, error: "Você não tem essa carta." });

            const meta = SPECIAL_CARDS[key];
            if (!meta) return cb && cb({ ok: false, error: "Carta inválida." });
            if (me.nrg < meta.nrg) return cb && cb({ ok: false, error: `NRG insuficiente (${meta.nrg}).` });

            // alvo padrão: próximo jogador
            const finalTargetId = targetId || t.order[(t.turnIdx + 1) % t.order.length];
            const target = t.players.get(targetId || finalTargetId);
            if (!target || targetId === socket.userId) return cb && cb({ ok: false, error: "Alvo inválido." });

            // escudo?
            if (target.shield) {
                target.shield = false;
                me.specials.splice(idx, 1);
                io.to(`bj:${t.code}`).emit("bj:chat", { system: true, message: `🛡️ ${target.username} bloqueou ${meta.desc} com Escudo!`, at: Date.now() });
                io.to(`bj:${t.code}`).emit("bj:state", tableState(t));
                return cb && cb({ ok: true });
            }

            me.nrg -= meta.nrg;
            me.specials.splice(idx, 1);

            switch (key) {
                case "force_hit": {
                    const card = t.deck.pop();
                    target.hand.push(card);
                    target.lastDrawn = card;
                    if (handValue(target.hand) > t.limit) {
                        target.busted = true;
                        io.to(`bj:${t.code}`).emit("bj:chat", { system: true, message: `💥 ${target.username} estourou com ${handValue(target.hand)}!`, at: Date.now() });
                    }
                    break;
                }
                case "remove_last": {
                    if (target.hand.length > 2) {
                        const removed = target.hand.pop();
                        t.discard.push(removed);
                        io.to(`bj:${t.code}`).emit("bj:chat", { system: true, message: `🗑️ ${me.username} removeu o ${removed.rank}${removed.suit} de ${target.username}.`, at: Date.now() });
                    } else {
                        io.to(`bj:${t.code}`).emit("bj:chat", { system: true, message: `🗑️ ${target.username} não tem carta extra para remover.`, at: Date.now() });
                    }
                    break;
                }
                case "raise_limit_28": {
                    t.limit = 28;
                    break;
                }
                case "lower_limit_17": {
                    t.limit = 17;
                    break;
                }
                case "pick_card": {
                    const rank = String(data && data.rank || "A");
                    const suit = String(data && data.suit || "♠");
                    const cardIdx = t.deck.findIndex((c) => c.rank === rank && c.suit === suit);
                    if (cardIdx !== -1) {
                        const card = t.deck.splice(cardIdx, 1)[0];
                        me.hand.push(card);
                        me.lastDrawn = card;
                        if (handValue(me.hand) > t.limit) me.busted = true;
                    }
                    break;
                }
                case "draw_three": {
                    for (let i = 0; i < 3; i++) {
                        const card = t.deck.pop();
                        me.hand.push(card);
                        me.lastDrawn = card;
                    }
                    if (handValue(me.hand) > t.limit) me.busted = true;
                    break;
                }
                case "mirror": {
                    io.to(`bj:${t.code}`).emit("bj:chat", { system: true, message: `🪞 ${me.username} refletiu o efeito!`, at: Date.now() });
                    break;
                }
                case "shield": {
                    me.shield = true;
                    break;
                }
            }

            io.to(`bj:${t.code}`).emit("bj:chat", { system: true, message: `🎴 ${me.username} usou carta ${meta.rarity}: ${meta.desc}`, at: Date.now() });

            // busts por limite alterado
            for (const p of t.players.values()) {
                if (!p.busted && handValue(p.hand) > t.limit) {
                    p.busted = true;
                }
            }

            io.to(`bj:${t.code}`).emit("bj:state", tableState(t));
            cb && cb({ ok: true });
        });

        // ---------- CHAT ----------
        socket.on("bj:chat", (data) => {
            const code = socket.data.tableCode;
            if (!code || !tables.has(code)) return;
            const message = String(data && data.message || "").slice(0, 200).trim();
            if (!message) return;
            io.to(`bj:${code}`).emit("bj:chat", { username: socket.username, message, at: Date.now() });
        });

        socket.on("disconnect", () => {
            const code = socket.data.tableCode;
            if (!code) return;
            const t = tables.get(code);
            if (t && t.players.has(socket.userId)) {
                t.players.get(socket.userId).socketIds.delete(socket.id);
                io.to(`bj:${code}`).emit("bj:state", tableState(t));
            }
        });
    });

    return { tables };
}

module.exports = { setupBlackjackMultiplayer, SPECIAL_CARDS, rollSpecialCard };
