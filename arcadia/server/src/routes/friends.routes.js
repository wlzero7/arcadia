// ========================================
// ARCADIA - FRIENDS ROUTES (v0.5)
// ========================================

const express = require("express");
const pool = require("../config/database");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

// GET /api/friends — lista amigos + pedidos recebidos
router.get("/", authenticate, async (req, res) => {
    try {
        const accepted = await pool.query(
            `SELECT u.id, u.username,
                    CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END AS friend_id
             FROM friendships f
             INNER JOIN users u ON u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END
             WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted'`,
            [req.user.id, req.user.id, req.user.id, req.user.id]
        );

        const pending = await pool.query(
            `SELECT u.id, u.username, f.user_id AS from_id
             FROM friendships f
             INNER JOIN users u ON u.id = f.user_id
             WHERE f.friend_id = ? AND f.status = 'pending'`,
            [req.user.id]
        );

        return res.json({
            status: "success",
            friends: accepted.rows.map((r) => ({ id: r.friend_id, username: r.username })),
            requests: pending.rows,
        });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Erro ao listar amigos." });
    }
});

// POST /api/friends/request { username }
router.post("/request", authenticate, async (req, res) => {
    try {
        const target = await pool.get(
            `SELECT id FROM users WHERE LOWER(username) = LOWER(?)`,
            [String(req.body.username || "").trim()]
        );

        if (!target) {
            return res.status(404).json({ status: "error", message: "Jogador não encontrado." });
        }
        if (target.id === req.user.id) {
            return res.status(400).json({ status: "error", message: "Você não pode se adicionar." });
        }

        const existing = await pool.get(
            `SELECT * FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`,
            [req.user.id, target.id, target.id, req.user.id]
        );

        if (existing) {
            // Se o OUTRO já me pediu, aceita direto
            if (existing.status === "pending" && existing.friend_id === req.user.id) {
                await pool.run(`UPDATE friendships SET status = 'accepted' WHERE user_id = ? AND friend_id = ?`, [target.id, req.user.id]);
                return res.json({ status: "success", message: "Agora vocês são amigos!" });
            }
            return res.status(400).json({ status: "error", message: "Pedido já existe." });
        }

        await pool.run(
            `INSERT INTO friendships (user_id, friend_id, status) VALUES (?, ?, 'pending')`,
            [req.user.id, target.id]
        );

        return res.json({ status: "success", message: "Pedido de amizade enviado!" });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Erro no pedido de amizade." });
    }
});

// POST /api/friends/accept { requestId }
router.post("/accept", authenticate, async (req, res) => {
    try {
        const result = await pool.run(
            `UPDATE friendships SET status = 'accepted' WHERE user_id = ? AND friend_id = ? AND status = 'pending'`,
            [Number(req.body.requestId), req.user.id]
        );

        if (!result.changes) {
            return res.status(404).json({ status: "error", message: "Pedido não encontrado." });
        }

        return res.json({ status: "success", message: "Amizade aceita!" });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Erro ao aceitar." });
    }
});

// POST /api/friends/remove { friendId }
router.post("/remove", authenticate, async (req, res) => {
    try {
        await pool.run(
            `DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`,
            [req.user.id, Number(req.body.friendId), Number(req.body.friendId), req.user.id]
        );
        return res.json({ status: "success", message: "Amizade removida." });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Erro ao remover." });
    }
});

module.exports = router;
