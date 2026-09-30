// ========================================
// ARCADIA - ACHIEVEMENTS + MISSIONS (v0.9)
// Chaves genéricas: William define nomes/descrições na v1.0
// ========================================

const pool = require("../config/database");
const { grantXP } = require("./progression");

// ========================================
// CONQUISTAS — catálogo por chave (nome/editável depois)
// ========================================

const ACHIEVEMENTS = {
    first_bet: { xp: 50 },
    first_win: { xp: 100 },
    hot_streak: { xp: 250 },       // 5 vitórias seguidas
    high_roller: { xp: 300 },      // aposta >= 1000 AC
    mines_master: { xp: 400 },     // cashout mines >= 5x
    crash_100: { xp: 500 },        // cashout crash >= 10x
    blackjack_natural: { xp: 300 },// blackjack natural
    roulette_lucky: { xp: 350 },   // pleno vencedor na roleta
    social_butterfly: { xp: 200 }, // 5 amigos
    room_host: { xp: 150 },        // criou uma sala
    duel_winner: { xp: 400 },      // venceu um duelo
    horse_backer: { xp: 150 },     // apostou numa corrida
    level_10: { xp: 0 },
    level_50: { xp: 0 },
    level_100: { xp: 0 },
};

// ========================================
// MISSÕES — diárias e semanais (chaves genéricas)
// ========================================

const MISSIONS = {
    // diárias
    daily_play_10: { period: "daily", target: 10, xp: 150, desc: "Jogue 10 rodadas" },
    daily_win_3: { period: "daily", target: 3, xp: 200, desc: "Vença 3 rodadas" },
    daily_bet_500: { period: "daily", target: 500, xp: 150, desc: "Aposte 500 AC no total" },
    daily_mines_1: { period: "daily", target: 1, xp: 100, desc: "Complete 1 partida de Mines" },
    // semanais
    weekly_play_100: { period: "weekly", target: 100, xp: 800, desc: "Jogue 100 rodadas" },
    weekly_win_30: { period: "weekly", target: 30, xp: 1000, desc: "Vença 30 rodadas" },
    weekly_rooms_5: { period: "weekly", target: 5, xp: 600, desc: "Jogue em 5 salas diferentes" },
    weekly_duel_1: { period: "weekly", target: 1, xp: 700, desc: "Complete 1 duelo x1" },
};

// ========================================
// CONQUISTAS
// ========================================

function unlockAchievement(userId, key) {
    if (!ACHIEVEMENTS[key]) return null;
    try {
        const res = pool.db.get("SELECT 1 FROM user_achievements WHERE user_id = ? AND achievement_key = ?", [userId, key]);
        if (res) return null;
        pool.db.run("INSERT INTO user_achievements (user_id, achievement_key) VALUES (?, ?)", [userId, key]);
        const xp = ACHIEVEMENTS[key].xp || 0;
        let levelInfo = null;
        if (xp > 0) levelInfo = grantXP(userId, xp);
        return { key, xp, levelInfo };
    } catch (err) {
        console.warn("Achievement:", err.message);
        return null;
    }
}

// Checagens automáticas após eventos de jogo
function checkGameAchievements(userId, { game, outcome, multiplier, wager, detail }) {
    const unlocked = [];

    const a = (k) => {
        const r = unlockAchievement(userId, k);
        if (r) unlocked.push(r);
    };

    a("first_bet");
    if (outcome === "win") a("first_win");
    if (wager >= 1000) a("high_roller");
    if (game === "mines" && outcome === "win" && multiplier >= 5) a("mines_master");
    if (game === "blackjack" && outcome === "win" && multiplier >= 2.5) a("blackjack_natural");
    if (game === "roulette" && detail && detail.results && detail.results.some((r) => r.type === "straight" && r.won)) a("roulette_lucky");

    // level milestones
    const user = pool.db.get("SELECT level FROM users WHERE id = ?", [userId]);
    if (user) {
        if (user.level >= 10) a("level_10");
        if (user.level >= 50) a("level_50");
        if (user.level >= 100) a("level_100");
    }

    return unlocked;
}

// ========================================
// MISSÕES
// ========================================

function weekKey() {
    const d = new Date();
    const start = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil(((d - start) / 86400000 + start.getDay() + 1) / 7);
    return `${d.getFullYear()}-W${week}`;
}

function todayKey() {
    return new Date().toISOString().slice(0, 10);
}

// Incrementa progresso de missões; marca completas
function progressMission(userId, key, amount = 1) {
    const m = MISSIONS[key];
    if (!m) return;
    const period = m.period === "weekly" ? weekKey() : todayKey();

    pool.db.run(
        `INSERT INTO user_missions (user_id, mission_key, period, progress, completed)
         VALUES (?, ?, ?, 0, 0)
         ON CONFLICT(user_id, mission_key, period) DO NOTHING`,
        [userId, key, period]
    );

    const row = pool.db.get(
        "SELECT progress, completed FROM user_missions WHERE user_id = ? AND mission_key = ? AND period = ?",
        [userId, key, period]
    );
    if (!row || row.completed) return;

    const progress = row.progress + amount;
    const completed = progress >= m.target ? 1 : 0;

    pool.db.run(
        "UPDATE user_missions SET progress = ?, completed = ? WHERE user_id = ? AND mission_key = ? AND period = ?",
        [Math.min(progress, m.target), completed, userId, key, period]
    );
}

// Hooks de jogo
function trackGameActivity(userId, { game, outcome, wager }) {
    progressMission(userId, "daily_play_10");
    progressMission(userId, "weekly_play_100");
    if (outcome === "win") {
        progressMission(userId, "daily_win_3");
        progressMission(userId, "weekly_win_30");
    }
    progressMission(userId, "daily_bet_500", Math.max(1, Math.floor((wager || 0) / 100)));
    if (game === "mines") progressMission(userId, "daily_mines_1");
}

function trackRoomActivity(userId) {
    progressMission(userId, "weekly_rooms_5");
}

function trackDuelActivity(userId) {
    progressMission(userId, "weekly_duel_1");
}

// ========================================
// ROTAS
// ========================================

const express = require("express");
const { authenticate } = require("../middleware/auth");
const router = express.Router();

// GET /api/progression/achievements
router.get("/achievements", authenticate, (req, res) => {
    const unlocked = pool.db.all(
        "SELECT achievement_key, unlocked_at FROM user_achievements WHERE user_id = ?",
        [req.user.id]
    );
    const map = Object.fromEntries(unlocked.map((r) => [r.achievement_key, r.unlocked_at]));
    res.json({
        status: "success",
        achievements: Object.entries(ACHIEVEMENTS).map(([key, meta]) => ({
            key,
            ...meta,
            unlocked: !!map[key],
            unlockedAt: map[key] || null,
        })),
    });
});

// GET /api/progression/missions
router.get("/missions", authenticate, (req, res) => {
    const today = todayKey();
    const week = weekKey();
    const rows = pool.db.all(
        "SELECT mission_key, period, progress, completed, claimed FROM user_missions WHERE user_id = ? AND period IN (?, ?)",
        [req.user.id, today, week]
    );
    const map = Object.fromEntries(rows.map((r) => [`${r.mission_key}|${r.period}`, r]));

    const missions = Object.entries(MISSIONS).map(([key, m]) => {
        const period = m.period === "weekly" ? week : today;
        const row = map[`${key}|${period}`] || { progress: 0, completed: 0, claimed: 0 };
        return { key, ...m, period, progress: row.progress, completed: !!row.completed, claimed: !!row.claimed };
    });
    res.json({ status: "success", missions });
});

// POST /api/progression/missions/claim { key }
router.post("/missions/claim", authenticate, (req, res) => {
    const key = String(req.body.missionKey || "");
    const m = MISSIONS[key];
    if (!m) return res.status(404).json({ status: "error", message: "Missão não existe." });

    const period = m.period === "weekly" ? weekKey() : todayKey();
    const row = pool.db.get(
        "SELECT * FROM user_missions WHERE user_id = ? AND mission_key = ? AND period = ?",
        [req.user.id, key, period]
    );

    if (!row || !row.completed) return res.status(400).json({ status: "error", message: "Missão ainda não completa." });
    if (row.claimed) return res.status(400).json({ status: "error", message: "Recompensa já resgatada." });

    pool.db.run("UPDATE user_missions SET claimed = 1 WHERE user_id = ? AND mission_key = ? AND period = ?", [req.user.id, key, period]);
    const levelInfo = grantXP(req.user.id, m.xp);

    res.json({ status: "success", message: `+${m.xp} XP!`, levelInfo });
});

module.exports = { router, unlockAchievement, checkGameAchievements, trackGameActivity, trackRoomActivity, trackDuelActivity };
