// ========================================
// ARCADIA - PROGRESSION (v0.9) — XP, level 1→999
// ========================================

const pool = require("../config/database");

// XP necessário para o próximo nível: 100 * level^1.5 (curva suave no começo)
function xpForNextLevel(level) {
    return Math.floor(100 * Math.pow(level, 1.5));
}

// Concede XP e processa level-ups (vários de uma vez se preciso)
function grantXP(userId, amount) {
    return pool.transaction(() => {
        const user = pool.db.get("SELECT id, xp, level FROM users WHERE id = ?", [userId]);
        if (!user) throw new Error("Usuário não encontrado.");

        let { xp, level } = user;
        xp += Math.max(0, Math.floor(Number(amount) || 0));

        let leveledUp = false;
        while (level < 999 && xp >= xpForNextLevel(level)) {
            xp -= xpForNextLevel(level);
            level++;
            leveledUp = true;
        }
        if (level >= 999) {
            level = 999;
            xp = 0;
        }

        pool.db.run("UPDATE users SET xp = ?, level = ? WHERE id = ?", [xp, level, user.id]);

        return { level, xp, xpNext: xpForNextLevel(level), leveledUp };
    });
}

module.exports = { grantXP, xpForNextLevel };
