// ========================================
// ARCADIA - ROLETA EUROPEIA (v0.8)
// 37 casas (0-36), pagamentos clássicos, RTP justo
// ========================================

const express = require("express");
const pool = require("../config/database");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

// POST /api/games/roulette/spin
// bets: [{ type, value, amount }]
//   type: "straight" (value = 0-36) — paga 36x
//         "red" | "black" | "even" | "odd" | "low" (1-18) | "high" (19-36) — pagam 2x
//         "dozen1|2|3" — pagam 3x
router.post("/roulette/spin", authenticate, async (req, res) => {
    try {
        const bets = Array.isArray(req.body.bets) ? req.body.bets.slice(0, 10) : [];
        if (bets.length === 0) {
            return res.status(400).json({ status: "error", message: "Faça pelo menos uma aposta." });
        }

        let totalWager = 0;
        for (const b of bets) {
            const amount = Math.floor(Number(b.amount));
            if (!Number.isFinite(amount) || amount < 10) {
                return res.status(400).json({ status: "error", message: "Cada aposta mínima: 10 AC." });
            }
            b.amount = amount;
            totalWager += amount;
        }

        const wallet = await pool.get("SELECT id, balance FROM wallets WHERE user_id = ?", [req.user.id]);
        if (!wallet || wallet.balance < totalWager) {
            return res.status(400).json({ status: "error", message: "Saldo insuficiente para o total apostado." });
        }

        const number = Math.floor(Math.random() * 37); // 0-36
        const color = number === 0 ? "green" : RED.has(number) ? "red" : "black";

        let totalPayout = 0;
        const results = [];

        for (const b of bets) {
            let mult = 0;
            let won = false;

            switch (b.type) {
                case "straight":
                    if (Number(b.value) === number) mult = 36;
                    break;
                case "red":
                    if (color === "red") mult = 2;
                    break;
                case "black":
                    if (color === "black") mult = 2;
                    break;
                case "even":
                    if (number !== 0 && number % 2 === 0) mult = 2;
                    break;
                case "odd":
                    if (number % 2 === 1) mult = 2;
                    break;
                case "low":
                    if (number >= 1 && number <= 18) mult = 2;
                    break;
                case "high":
                    if (number >= 19 && number <= 36) mult = 2;
                    break;
                case "dozen1":
                    if (number >= 1 && number <= 12) mult = 3;
                    break;
                case "dozen2":
                    if (number >= 13 && number <= 24) mult = 3;
                    break;
                case "dozen3":
                    if (number >= 25 && number <= 36) mult = 3;
                    break;
                default:
                    break;
            }

            const payout = b.amount * mult;
            totalPayout += payout;
            results.push({ type: b.type, value: b.value, amount: b.amount, won: mult > 0, payout });
        }

        const walletId = wallet.id;
        let balance = await pool.adjustBalance(walletId, -totalWager, "bet", "game", "roulette");
        if (totalPayout > 0) {
            balance = await pool.adjustBalance(walletId, totalPayout, "payout", "game", "roulette");
        }

        const outcome = totalPayout > totalWager ? "win" : totalPayout === totalWager ? "push" : "loss";

        await pool.run(
            `INSERT INTO bets (user_id, game, wager, multiplier, payout, outcome, detail)
             VALUES (?, 'roulette', ?, ?, ?, ?, ?)`,
            [req.user.id, totalWager, totalWager > 0 ? Number((totalPayout / totalWager).toFixed(2)) : 0, totalPayout, outcome, JSON.stringify({ number, color, results })]
        );

        return res.json({
            status: "success",
            number,
            color,
            totalWager,
            totalPayout,
            outcome,
            results,
            balance,
        });
    } catch (error) {
        console.error("Roulette error:", error.message);
        return res.status(500).json({ status: "error", message: "Erro na roleta." });
    }
});

module.exports = router;
