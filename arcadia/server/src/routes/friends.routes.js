// ========================================
// ARCADIA - FRIENDS ROUTES (v0.9.5 — favoritos + convites)
// ========================================

const express = require("express");
const pool = require("../config/database");
const { authenticate } = require("../middleware/auth");
const { sendInvite } = require("../realtime/invites");

const router = express.Router();

// Migração leve: tabela de favoritos (roda no boot, ignora se já existe)
(async () => {
    try {
        await pool.run(
            `CREATE TABLE IF NOT EXISTS friend_favorites (
                user_id INTEGER NOT NULL,
                friend_id INTEGER NOT NULL,
                PRIMARY KEY (user_id, friend_id)
            )`
        );
    } catch (_) { /* já existe */ }
})();

// GET /api/friends — lista amigos (+favorito) e pedidos recebidos
router.get("/", authenticate, async (req, res) => {
    try {
        const accepted = await pool.query(
            `SELECT u.id, u.username,
                    CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END AS friend_id,
                    CASE WHEN ff.user_id IS NOT NULL THEN 1 ELSE 0 END AS favorite
             FROM friendships f
             INNER JOIN users u ON u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END
             LEFT JOIN friend_favorites ff
                    ON ff.user_id = ?
                   AND ff.friend_id = (CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END)
             WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted'
             ORDER BY favorite DESC, u.username ASC`,
            [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id]
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
            friends: accepted.rows.map((r) => ({ id: r.friend_id, username: r.username, favorite: r.favorite })),
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

// POST /api/friends/favorite { friendId } — liga/desliga favorito
router.post("/favorite", authenticate, async (req, res) => {
    try {
        const friendId = Number(req.body.friendId);
        if (!Number.isInteger(friendId)) {
            return res.status(400).json({ status: "error", message: "Amigo inválido." });
        }

        const friendship = await pool.get(
            `SELECT 1 AS ok FROM friendships
             WHERE status = 'accepted' AND ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))`,
            [req.user.id, friendId, friendId, req.user.id]
        );
        if (!friendship) {
            return res.status(404).json({ status: "error", message: "Amizade não encontrada." });
        }

        const existing = await pool.get(
            `SELECT 1 AS ok FROM friend_favorites WHERE user_id = ? AND friend_id = ?`,
            [req.user.id, friendId]
        );

        if (existing) {
            await pool.run(`DELETE FROM friend_favorites WHERE user_id = ? AND friend_id = ?`, [req.user.id, friendId]);
            return res.json({ status: "success", favorite: false, message: "Removido dos favoritos." });
        }

        await pool.run(`INSERT INTO friend_favorites (user_id, friend_id) VALUES (?, ?)`, [req.user.id, friendId]);
        return res.json({ status: "success", favorite: true, message: "Adicionado aos favoritos!" });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Erro ao favoritar." });
    }
});

// POST /api/friends/remove { friendId }
router.post("/remove", authenticate, async (req, res) => {
    try {
        const friendId = Number(req.body.friendId);
        await pool.run(
            `DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`,
            [req.user.id, friendId, friendId, req.user.id]
        );
        // limpa favoritos nas duas direções
        await pool.run(
            `DELETE FROM friend_favorites WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`,
            [req.user.id, friendId, friendId, req.user.id]
        );
        return res.json({ status: "success", message: "Amizade removida." });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Erro ao remover." });
    }
});

// POST /api/friends/invite { username, kind: 'duel' | 'coop' }
router.post("/invite", authenticate, async (req, res) => {
    try {
        const result = await sendInvite({
            fromUserId: req.user.id,
            toUsername: String(req.body.username || ""),
            kind: String(req.body.kind || ""),
        });
        if (!result.ok) {
            return res.status(400).json({ status: "error", message: result.error });
        }
        return res.json({ status: "success", code: result.code, kind: result.kind, message: "Convite enviado!" });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Erro ao enviar convite." });
    }
});

module.exports = router;
