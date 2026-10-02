// ========================================
// ARCADIA - WALLET ROUTES
// v1.0.2: getWallet("solo") em TODAS as rotas — a query crua sem kind
// podia devolver a carteira coop/duel (0 AC) → cache travado em 0 no navegador
// ========================================

const express = require("express");
const pool = require("../config/database");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

// ========================================
// GET /api/wallet — saldo
// ========================================

router.get("/", authenticate, async (req, res) => {
    try {
        // v1.0.2: getWallet garante a carteira SOLO correta (cria com 1M se não existir)
        const wallet = await pool.getWallet(req.user.id, "solo");

        return res.status(200).json({ status: "success", balance: wallet.balance });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Erro ao buscar carteira." });
    }
});

// ========================================
// GET /api/wallet/transactions — extrato
// ========================================

router.get("/transactions", authenticate, async (req, res) => {
    try {
        const rows = await pool.query(
            `SELECT t.kind, t.amount, t.balance_after, t.ref_type, t.ref_id, t.created_at
             FROM transactions t
             INNER JOIN wallets w ON w.id = t.wallet_id
             WHERE w.user_id = ?
             ORDER BY t.id DESC LIMIT 100`,
            [req.user.id]
        );

        return res.status(200).json({ status: "success", transactions: rows.rows });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Erro ao buscar extrato." });
    }
});

// ========================================
// POST /api/wallet/daily — bônus diário (anti-broke)
// ========================================

const DAILY_BASE = 1000;
const DAILY_STREAK_MAX = 7;

router.post("/daily", authenticate, async (req, res) => {
    try {
        const today = new Date().toISOString().slice(0, 10);

        const bonus = await pool.get(`SELECT * FROM daily_bonus WHERE user_id = ?`, [req.user.id]);

        if (bonus && bonus.last_claim === today) {
            return res.status(400).json({
                status: "error",
                message: "Você já resgatou o bônus de hoje. Volte amanhã!",
            });
        }

        // Streak: ontem resgatou? continua. Senão, recomeça.
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        const streak = bonus && bonus.last_claim === yesterday
            ? Math.min(bonus.streak + 1, DAILY_STREAK_MAX)
            : 1;
        const amount = DAILY_BASE * streak;

        // v1.0.2: getWallet garante a carteira SOLO correta
        const wallet = await pool.getWallet(req.user.id, "solo");

        await pool.run(
            `INSERT INTO daily_bonus (user_id, last_claim, streak) VALUES (?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET last_claim = excluded.last_claim, streak = excluded.streak`,
            [req.user.id, today, streak]
        );

        const balance = await pool.adjustBalance(wallet.id, amount, "daily_bonus", "daily", today);

        return res.status(200).json({
            status: "success",
            message: `Bônus diário: +${amount} AC (streak ${streak}x).`,
            amount,
            streak,
            balance,
        });
    } catch (error) {
        console.error("Daily bonus error:", error.message);
        return res.status(500).json({ status: "error", message: "Erro ao resgatar bônus." });
    }
});

// ========================================
// POST /api/wallet/transfer — enviar AC para outro jogador
// ========================================

router.post("/transfer", authenticate, async (req, res) => {
    const { toUsername, amount } = req.body;
    const value = Math.floor(Number(amount));

    if (!toUsername || !Number.isFinite(value) || value <= 0) {
        return res.status(400).json({ status: "error", message: "Dados inválidos." });
    }

    try {
        // destino: usuário + carteira SOLO dele
        const target = await pool.get(
            `SELECT u.id, u.username, w.id AS wallet_id
             FROM users u
             INNER JOIN wallets w ON w.user_id = u.id AND w.kind = 'solo'
             WHERE LOWER(u.username) = LOWER(?)
             LIMIT 1`,
            [String(toUsername).trim()]
        );

        if (!target) {
            return res.status(404).json({ status: "error", message: "Jogador não encontrado." });
        }
        if (target.id === req.user.id) {
            return res.status(400).json({ status: "error", message: "Você não pode transferir para si mesmo." });
        }

        // origem: v1.0.2 — getWallet garante a MINHA carteira SOLO correta
        const me = await pool.getWallet(req.user.id, "solo");

        // Débito e crédito — se o débito falhar (saldo), o crédito não roda
        const myBalance = await pool.adjustBalance(me.id, -value, "transfer_out", "user", String(target.id));

        if (myBalance < 0) {
            return res.status(400).json({ status: "error", message: "Saldo insuficiente." });
        }

        await pool.adjustBalance(target.wallet_id, value, "transfer_in", "user", String(req.user.id));

        return res.status(200).json({
            status: "success",
            message: `Enviado ${value} AC para ${target.username}.`,
            balance: myBalance,
        });
    } catch (error) {
        if (error.message === "Saldo insuficiente.") {
            return res.status(400).json({ status: "error", message: error.message });
        }
        console.error("Transfer error:", error.message);
        return res.status(500).json({ status: "error", message: "Erro na transferência." });
    }
});

module.exports = router;
