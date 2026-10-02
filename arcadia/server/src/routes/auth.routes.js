// ========================================
// ARCADIA - AUTH ROUTES
// v1.0.1: register cria as 3 carteiras (solo/coop/duel) com 1.000.000 AC
// ========================================

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/database");
const { authenticate, JWT_SECRET } = require("../middleware/auth");
const router = express.Router();

// ========================================
// REGISTER
// ========================================

router.post("/register", async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ status: "error", message: "Preencha todos os campos." });
    }

    const normalizedUsername = String(username).trim();
    const normalizedEmail = String(email).trim().toLowerCase();

    if (normalizedUsername.length < 3 || normalizedUsername.length > 30) {
        return res.status(400).json({ status: "error", message: "O nome de usuário deve possuir entre 3 e 30 caracteres." });
    }

    if (password.length < 8) {
        return res.status(400).json({ status: "error", message: "A senha deve possuir pelo menos 8 caracteres." });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
        return res.status(400).json({ status: "error", message: "Digite um e-mail válido." });
    }

    try {
        const existing = await pool.get(
            `SELECT id FROM users WHERE LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?) LIMIT 1`,
            [normalizedEmail, normalizedUsername]
        );
        if (existing) {
            return res.status(409).json({ status: "error", message: "E-mail ou nome de usuário já cadastrado." });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const result = await pool.run(
            `INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)`,
            [normalizedUsername, normalizedEmail, passwordHash]
        );

        const userId = result.lastInsertRowid;

        // Contas novas nascem com 1.000.000 AC em TODAS as carteiras (config do William)
        await pool.run(`INSERT INTO wallets (user_id, kind, balance) VALUES (?, 'solo', 1000000)`, [userId]);
        await pool.run(`INSERT INTO wallets (user_id, kind, balance) VALUES (?, 'coop', 1000000)`, [userId]);
        await pool.run(`INSERT INTO wallets (user_id, kind, balance) VALUES (?, 'duel', 1000000)`, [userId]);

        const token = jwt.sign(
            { id: userId, username: normalizedUsername },
            JWT_SECRET,
            { expiresIn: "7d" }
        );

        return res.status(201).json({
            status: "success",
            message: "Conta criada com sucesso.",
            token,
            user: { id: userId, username: normalizedUsername, email: normalizedEmail },
            wallet: { balance: 1000000 },
        });
    } catch (error) {
        console.error("Register error:", error.message);
        return res.status(500).json({ status: "error", message: "Não foi possível criar a conta." });
    }
});

// ========================================
// LOGIN
// ========================================

router.post("/login", async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ status: "error", message: "Preencha e-mail e senha." });
    }

    try {
        const user = await pool.get(
            `SELECT u.id, u.username, u.email, u.password_hash, w.balance
             FROM users AS u
             INNER JOIN wallets AS w ON w.user_id = u.id AND w.kind = 'solo'
             WHERE LOWER(u.email) = LOWER(?)
             LIMIT 1`,
            [String(email).trim().toLowerCase()]
        );

        if (!user) {
            return res.status(401).json({ status: "error", message: "E-mail ou senha incorretos." });
        }

        const ok = await bcrypt.compare(String(password), user.password_hash);
        if (!ok) {
            return res.status(401).json({ status: "error", message: "E-mail ou senha incorretos." });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username },
            JWT_SECRET,
            { expiresIn: "7d" }
        );

        return res.status(200).json({
            status: "success",
            message: "Login realizado com sucesso.",
            token,
            user: { id: user.id, username: user.username, email: user.email },
            wallet: { balance: user.balance },
        });
    } catch (error) {
        console.error("Login error:", error.message);
        return res.status(500).json({ status: "error", message: "Não foi possível entrar." });
    }
});

// ========================================
// ME (sessão atual)
// ========================================

router.get("/me", authenticate, async (req, res) => {
    try {
        const user = await pool.get(
            `SELECT id, username, email, created_at, display_name, avatar, xp, level FROM users WHERE id = ?`,
            [req.user.id]
        );

        if (!user) {
            return res.status(404).json({ status: "error", message: "Usuário não encontrado." });
        }

        const wallets = await pool.query(
            `SELECT kind, balance FROM wallets WHERE user_id = ?`,
            [req.user.id]
        );

        return res.status(200).json({
            status: "success",
            user: {
                id: user.id,
                username: user.username,
                displayName: user.display_name || user.username,
                email: user.email,
                avatar: user.avatar || "🎰",
                createdAt: user.created_at,
                xp: user.xp || 0,
                level: user.level || 1,
            },
            wallet: { balance: (wallets.rows.find((w) => w.kind === "solo") || {}).balance || 0 },
            wallets: Object.fromEntries(wallets.rows.map((w) => [w.kind, w.balance])),
        });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Erro ao buscar sessão." });
    }
});

// ========================================
// PATCH /api/auth/profile — avatar + nome de exibição (v0.9)
// ========================================

router.patch("/profile", authenticate, async (req, res) => {
    try {
        const displayName = req.body.displayName ? String(req.body.displayName).trim().slice(0, 30) : null;
        const avatar = req.body.avatar ? String(req.body.avatar).slice(0, 8) : null;

        if (displayName) {
            await pool.run("UPDATE users SET display_name = ? WHERE id = ?", [displayName, req.user.id]);
        }
        if (avatar) {
            await pool.run("UPDATE users SET avatar = ? WHERE id = ?", [avatar, req.user.id]);
        }

        const user = await pool.get("SELECT id, username, display_name, avatar, level, xp FROM users WHERE id = ?", [req.user.id]);
        return res.json({
            status: "success",
            message: "Perfil atualizado!",
            user: { id: user.id, username: user.username, displayName: user.display_name || user.username, avatar: user.avatar, level: user.level, xp: user.xp },
        });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Erro ao atualizar perfil." });
    }
});

// ========================================
// PATCH /api/auth/password — trocar senha (v0.9.6)
// ========================================
router.patch("/password", authenticate, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ status: "error", message: "Preencha a senha atual e a nova." });
        }
        if (String(newPassword).length < 8) {
            return res.status(400).json({ status: "error", message: "A nova senha deve ter pelo menos 8 caracteres." });
        }

        const user = await pool.get(`SELECT id, password_hash FROM users WHERE id = ?`, [req.user.id]);
        if (!user) {
            return res.status(404).json({ status: "error", message: "Usuário não encontrado." });
        }

        const ok = await bcrypt.compare(String(currentPassword), user.password_hash);
        if (!ok) {
            return res.status(401).json({ status: "error", message: "Senha atual incorreta." });
        }

        const hash = await bcrypt.hash(String(newPassword), 10);
        await pool.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [hash, user.id]);

        return res.json({ status: "success", message: "Senha alterada com sucesso!" });
    } catch (error) {
        console.error("Change password error:", error.message);
        return res.status(500).json({ status: "error", message: "Não foi possível alterar a senha." });
    }
});

// ========================================
// DELETE /api/auth/account — deletar conta (v0.9.6)
// Exige a senha. friend_favorites e rooms(host) não têm cascade —
// limpa manualmente; todo o resto cai por ON DELETE CASCADE a partir de users.
// ========================================
router.delete("/account", authenticate, async (req, res) => {
    try {
        const user = await pool.get(`SELECT id, password_hash FROM users WHERE id = ?`, [req.user.id]);
        if (!user) {
            return res.status(404).json({ status: "error", message: "Usuário não encontrado." });
        }

        const ok = await bcrypt.compare(String(req.body.password || ""), user.password_hash);
        if (!ok) {
            return res.status(401).json({ status: "error", message: "Senha incorreta. A conta não foi deletada." });
        }

        // favoritos não têm FK cascade — limpa nas duas direções
        await pool.run(`DELETE FROM friend_favorites WHERE user_id = ? OR friend_id = ?`, [user.id, user.id]);

        // salas onde é host: host_id não tem cascade — apaga as salas
        // (room_members e room_pot caem por cascade a partir de rooms)
        await pool.run(`DELETE FROM rooms WHERE host_id = ?`, [user.id]);

        // cascade: wallets(+transactions), bets, friendships, daily_bonus,
        // user_achievements, user_missions, duel_stats, room_members, slots_cards
        await pool.run(`DELETE FROM users WHERE id = ?`, [user.id]);

        return res.json({ status: "success", message: "Conta deletada permanentemente." });
    } catch (error) {
        console.error("Delete account error:", error.message);
        return res.status(500).json({ status: "error", message: "Não foi possível deletar a conta." });
    }
});

module.exports = router;
