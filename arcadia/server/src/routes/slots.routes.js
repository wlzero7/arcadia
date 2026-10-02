// ========================================
// ARCADIA - SLOTS ROUTES (v1.0)
// POST /api/games/slots/play  { wager, trump? }
// GET  /api/games/slots/cards — inventário de trunfos
// ========================================

const express = require("express");
const pool = require("../config/database");
const { authenticate } = require("../middleware/auth");
const { TRUMPS, resolveSpin, rollCardDrop } = require("../services/slotsEngine");

const router = express.Router();

// ---------- GIRAR ----------
router.post("/play", authenticate, async (req, res) => {
    try {
        const wager = Math.floor(Number(req.body.wager));
        if (!Number.isFinite(wager) || wager < 10) {
            return res.status(400).json({ status: "error", message: "Aposta mínima: 10 AC." });
        }

        const wallet = await pool.getWallet(req.user.id, "solo");
        if (wager > wallet.balance) {
            return res.status(400).json({ status: "error", message: "Saldo insuficiente." });
        }

        // trunfo opcional — valida posse e CONSUME a carta
        let trump = null;
        const requested = String(req.body.trump || "").trim();
        if (requested) {
            if (!TRUMPS[requested]) {
                return res.status(400).json({ status: "error", message: "Trunfo inválido." });
            }
            if (TRUMPS[requested].duelOnly) {
                return res.status(400).json({ status: "error", message: "Esse trunfo é exclusivo do modo Duelo." });
            }
            const owned = await pool.get(
                `SELECT id FROM slots_cards WHERE user_id = ? AND card_key = ? LIMIT 1`,
                [req.user.id, requested]
            );
            if (!owned) {
                return res.status(400).json({ status: "error", message: "Você não possui esse trunfo." });
            }
            await pool.run(`DELETE FROM slots_cards WHERE id = ?`, [owned.id]);
            trump = requested;
        }

        const result = resolveSpin({ wager, trump });
        const delta = result.outcome === "win"
            ? result.payout - wager
            : -wager * (result.lossMultiplier || 1);

        const balance = await pool.adjustBalance(
            wallet.id,
            delta,
            result.outcome === "win" ? "payout" : "bet",
            "slots",
            null
        );

        // drop de trunfo: 50% por giro
        const card = rollCardDrop(false);
        if (card) {
            await pool.run(
                `INSERT INTO slots_cards (user_id, card_key, rarity) VALUES (?, ?, ?)`,
                [req.user.id, card.key, card.rarity]
            );
        }

        return res.json({
            status: "success",
            reels: result.reels,
            outcome: result.outcome,
            jackpot: result.jackpot,
            payout: result.payout,
            delta,
            balance,
            notes: result.notes,
            card,
        });
    } catch (error) {
        console.error("Slots play error:", error.message);
        return res.status(500).json({ status: "error", message: "Erro ao girar a máquina." });
    }
});

// ---------- INVENTÁRIO ----------
router.get("/cards", authenticate, async (req, res) => {
    try {
        const rows = await pool.query(
            `SELECT card_key, rarity, COUNT(*) AS qty
             FROM slots_cards WHERE user_id = ?
             GROUP BY card_key, rarity`,
            [req.user.id]
        );
        const inventory = rows.rows.map((r) => ({
            key: r.card_key,
            rarity: r.rarity,
            qty: r.qty,
            ...(TRUMPS[r.card_key] || {}),
        }));
        return res.json({ status: "success", inventory, catalog: TRUMPS });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Erro ao buscar inventário." });
    }
});

module.exports = router;
