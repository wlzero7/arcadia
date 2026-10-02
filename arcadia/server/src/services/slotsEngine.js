// ========================================
// ARCADIA - SLOTS ENGINE (v1.0)
// Motor compartilhado do Slots: símbolos, giros, trunfos e drops.
// Usado pelo modo Solo (slots.routes) e pelo Duelo (duels.js).
// ========================================

// Símbolos: weight = chance relativa no rolo; mult = prêmio do trinca
const SYMBOLS = [
    { key: "cherry",  emoji: "🍒",  weight: 30, mult: 2 },
    { key: "lemon",   emoji: "🍋",  weight: 24, mult: 3 },
    { key: "orange",  emoji: "🍊",  weight: 18, mult: 5 },
    { key: "bell",    emoji: "🔔",  weight: 12, mult: 8 },
    { key: "star",    emoji: "⭐",  weight: 8,  mult: 15 },
    { key: "diamond", emoji: "💎",  weight: 5,  mult: 40 },
    { key: "seven",   emoji: "7️⃣", weight: 3,  mult: 100 },
];

// Catálogo de trunfos — usar uma carta a CONSUME do inventário
const TRUMPS = {
    abencoado:     { name: "O Abençoado",      rarity: "cromatica",  duelOnly: false, desc: "Vitória garantida com prêmio de 100x a aposta." },
    aumento_odds:  { name: "Aumento das Odds", rarity: "rara",       duelOnly: false, desc: "Vitória garantida com lucro de 2x a aposta." },
    sortudo:       { name: "Sortudo",          rarity: "epica",      duelOnly: false, desc: "Chance muito maior do prêmio máximo neste giro." },
    escudo:        { name: "Escudo",           rarity: "epica",      duelOnly: false, desc: "Se perder, a aposta é devolvida." },
    superestimado: { name: "Superestimado",    rarity: "lendaria",   duelOnly: false, desc: "Quadruplica as chances: até 4 giros, vale o melhor." },
    azarao:        { name: "Azarão",           rarity: "comum",      duelOnly: false, desc: "2% de chance de transformar a derrota em reembolso." },
    cometa:        { name: "Cometa",           rarity: "lendaria",   duelOnly: false, desc: "Se perder, o giro se repete grátis uma vez." },
    duplicador:    { name: "Duplicador",       rarity: "rara",       duelOnly: false, desc: "Prêmio em dobro — mas a derrota custa o dobro." },
    bloqueador:    { name: "Bloqueador",       rarity: "super_rara", duelOnly: true,  desc: "Duelo: bloqueia a vez do oponente; você gira de novo." },
    allwin:        { name: "ALL WIN",          rarity: "cromatica",  duelOnly: true,  desc: "Duelo: all-in — quem vencer o giro leva tudo." },
};

const RARITY_ORDER = ["comum", "rara", "super_rara", "epica", "lendaria", "cromatica"];
const RARITY_WEIGHTS = { comum: 45, rara: 25, super_rara: 15, epica: 8, lendaria: 5, cromatica: 2 };

function spinReels(lucky = false) {
    const weighted = SYMBOLS.map((s) => ({
        s,
        w: lucky && ["star", "diamond", "seven"].includes(s.key) ? s.weight * 4 : s.weight,
    }));
    const total = weighted.reduce((a, x) => a + x.w, 0);
    const pick = () => {
        let r = Math.random() * total;
        for (const { s, w } of weighted) {
            r -= w;
            if (r <= 0) return s;
        }
        return weighted[0].s;
    };
    return [pick(), pick(), pick()];
}

// Trinca = mult do símbolo; par = 1.5x; nada = derrota
function evaluate(reels) {
    const [a, b, c] = reels;
    if (a.key === b.key && b.key === c.key) {
        return { outcome: "win", mult: a.mult, jackpot: a.key === "seven" };
    }
    if (a.key === b.key || b.key === c.key || a.key === c.key) {
        return { outcome: "win", mult: 1.5, jackpot: false };
    }
    return { outcome: "loss", mult: 0, jackpot: false };
}

// Resolve um giro completo com trunfo opcional (server-authoritative)
function resolveSpin({ wager, trump = null }) {
    const notes = [];
    let reels = spinReels(trump === "sortudo");
    let ev = evaluate(reels);

    if (trump === "abencoado") {
        ev = { outcome: "win", mult: 100, jackpot: true };
        notes.push("🌟 O Abençoado: vitória garantida em 100x!");
    } else if (trump === "aumento_odds") {
        ev = { outcome: "win", mult: 3, jackpot: false };
        notes.push("📈 Aumento das Odds: lucro garantido de 2x!");
    } else if (trump === "superestimado") {
        let extra = 0;
        while (ev.outcome === "loss" && extra < 3) {
            reels = spinReels(false);
            ev = evaluate(reels);
            extra++;
        }
        notes.push("🚀 Superestimado: até 4 giros — valeu o melhor resultado.");
    } else if (trump === "cometa" && ev.outcome === "loss") {
        reels = spinReels(false);
        ev = evaluate(reels);
        notes.push("☄️ Cometa: o giro se repetiu grátis!");
    }

    let payout = Math.floor(wager * ev.mult);
    let lossMultiplier = 1;

    if (ev.outcome === "loss") {
        if (trump === "escudo") {
            payout = wager;
            notes.push("🛡️ Escudo: aposta devolvida!");
        } else if (trump === "azarao" && Math.random() < 0.02) {
            payout = wager;
            notes.push("🍀 Azarão: a derrota virou reembolso!");
        } else if (trump === "duplicador") {
            lossMultiplier = 2;
            notes.push("💥 Duplicador: a derrota custou o dobro...");
        }
    } else if (trump === "duplicador") {
        payout *= 2;
        notes.push("✨ Duplicador: prêmio em dobro!");
    }

    return {
        reels: reels.map((s) => s.emoji),
        outcome: ev.outcome,
        mult: ev.mult,
        jackpot: ev.jackpot,
        payout,
        lossMultiplier,
        notes,
    };
}

// Drop de carta: 50% por giro; raridade ponderada; duelOnly só no duelo
function rollCardDrop(duelMode = false) {
    if (Math.random() >= 0.5) return null;
    for (let attempt = 0; attempt < 6; attempt++) {
        let r = Math.random() * 100;
        let rarity = "comum";
        for (const key of RARITY_ORDER) {
            r -= RARITY_WEIGHTS[key];
            if (r <= 0) { rarity = key; break; }
        }
        const keys = Object.keys(TRUMPS).filter(
            (k) => TRUMPS[k].rarity === rarity && (duelMode || !TRUMPS[k].duelOnly)
        );
        if (keys.length) {
            const key = keys[Math.floor(Math.random() * keys.length)];
            return { key, rarity, name: TRUMPS[key].name, desc: TRUMPS[key].desc };
        }
        // raridade sem cartas elegíveis (ex.: super-rara no solo) → sorteia de novo
    }
    return null;
}

module.exports = { SYMBOLS, TRUMPS, RARITY_ORDER, spinReels, evaluate, resolveSpin, rollCardDrop };
