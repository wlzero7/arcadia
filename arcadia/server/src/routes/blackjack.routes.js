// ========================================
// ARCADIA - BLACKJACK (v0.8) — estado no servidor
// Baralho de 52 cartas, dealer para no 17, blackjack paga 3:2
// v1.0.2: getWallet("solo") no start (query crua podia pegar a carteira errada)
// ========================================

const express = require("express");
const pool = require("../config/database");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

// ========================================
// BARALHO
// ========================================

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function newDeck() {
    const deck = [];
    for (const s of SUITS) {
        for (const r of RANKS) {
            deck.push({ rank: r, suit: s });
        }
    }
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function handValue(cards) {
    let total = 0;
    let aces = 0;
    for (const c of cards) {
        if (c.rank === "A") {
            aces++;
            total += 11;
        } else if (["J", "Q", "K"].includes(c.rank)) {
            total += 10;
        } else {
            total += Number(c.rank);
        }
    }
    while (total > 21 && aces > 0) {
        total -= 10;
        aces--;
    }
    return total;
}

function isBlackjack(cards) {
    return cards.length === 2 && handValue(cards) === 21;
}

// ========================================
// SESSÕES
// ========================================

// bjSessions[userId] = { deck, player, dealer, wager, walletId, status }
const bjSessions = new Map();

function publicState(session, hideDealer) {
    return {
        player: session.player,
        dealer: hideDealer ? [session.dealer[0]] : session.dealer,
        playerTotal: handValue(session.player),
        dealerTotal: hideDealer ? handValue([session.dealer[0]]) : handValue(session.dealer),
        canDouble: session.player.length === 2 && !session.doubled,
    };
}

// POST /api/games/blackjack/start { wager }
router.post("/blackjack/start", authenticate, async (req, res) => {
    try {
        if (bjSessions.has(req.user.id)) {
            return res.status(400).json({ status: "error", message: "Mão em andamento. Termine-a primeiro." });
        }

        const wager = Math.floor(Number(req.body.wager));
        if (!Number.isFinite(wager) || wager < 10) {
            return res.status(400).json({ status: "error", message: "Aposta mínima: 10 AC." });
        }

        // v1.0.2: getWallet garante a carteira SOLO correta (cria com 1M se não existir)
        const wallet = await pool.getWallet(req.user.id, "solo");
        if (wallet.balance < wager) {
            return res.status(400).json({ status: "error", message: "Saldo insuficiente." });
        }

        await pool.adjustBalance(wallet.id, -wager, "bet", "game", "blackjack");

        const deck = newDeck();
        const session = {
            deck,
            player: [deck.pop(), deck.pop()],
            dealer: [deck.pop(), deck.pop()],
            wager,
            walletId: wallet.id,
            doubled: false,
        };

        const playerBJ = isBlackjack(session.player);
        const dealerBJ = isBlackjack(session.dealer);

        let finished = false;
        let outcome, payout, message;

        if (playerBJ && dealerBJ) {
            outcome = "push"; payout = wager; message = "🤝 Ambos com Blackjack — empate, aposta devolvida.";
            finished = true;
        } else if (playerBJ) {
            outcome = "win"; payout = Math.floor(wager * 2.5); message = "🎉 BLACKJACK! Pagou 3:2.";
            finished = true;
        } else if (dealerBJ) {
            outcome = "loss"; payout = 0; message = "😢 Dealer fez Blackjack.";
            finished = true;
        }

        if (finished) {
            bjSessions.delete(req.user.id);
            let balance = null;
            if (payout > 0) {
                balance = await pool.adjustBalance(session.walletId, payout, "payout", "game", "blackjack");
            } else {
                const w = await pool.get("SELECT balance FROM wallets WHERE id = ?", [session.walletId]);
                balance = w.balance;
            }
            await pool.run(
                `INSERT INTO bets (user_id, game, wager, multiplier, payout, outcome, detail)
                 VALUES (?, 'blackjack', ?, ?, ?, ?, ?)`,
                [req.user.id, wager, wager > 0 ? Number((payout / wager).toFixed(2)) : 0, payout, outcome, JSON.stringify({ player: session.player, dealer: session.dealer })]
            );
            return res.json({ status: "success", finished: true, outcome, message, balance, player: session.player, dealer: session.dealer });
        }

        bjSessions.set(req.user.id, session);

        return res.json({
            status: "success",
            finished: false,
            ...publicState(session, true),
        });
    } catch (error) {
        console.error("BJ start:", error.message);
        return res.status(500).json({ status: "error", message: "Erro ao iniciar blackjack." });
    }
});

// POST /api/games/blackjack/hit
router.post("/blackjack/hit", authenticate, async (req, res) => {
    try {
        const session = bjSessions.get(req.user.id);
        if (!session) return res.status(400).json({ status: "error", message: "Nenhuma mão em andamento." });

        session.player.push(session.deck.pop());

        const total = handValue(session.player);

        if (total > 21) {
            // bust
            bjSessions.delete(req.user.id);
            const w = await pool.get("SELECT balance FROM wallets WHERE id = ?", [session.walletId]);
            await pool.run(
                `INSERT INTO bets (user_id, game, wager, multiplier, payout, outcome, detail)
                 VALUES (?, 'blackjack', ?, 0, 0, 'loss', ?)`,
                [req.user.id, session.wager, JSON.stringify({ player: session.player, dealer: session.dealer, bust: true })]
            );
            return res.json({
                status: "success", finished: true, outcome: "loss",
                message: `💥 Estourou com ${total}!`,
                balance: w.balance, player: session.player, dealer: session.dealer,
            });
        }

        return res.json({ status: "success", finished: false, ...publicState(session, true) });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Erro no hit." });
    }
});

// POST /api/games/blackjack/stand
router.post("/blackjack/stand", authenticate, async (req, res) => {
    try {
        const session = bjSessions.get(req.user.id);
        if (!session) return res.status(400).json({ status: "error", message: "Nenhuma mão em andamento." });

        // Dealer compra até 17 (stand em soft 17)
        while (handValue(session.dealer) < 17) {
            session.dealer.push(session.deck.pop());
        }

        const playerTotal = handValue(session.player);
        const dealerTotal = handValue(session.dealer);

        let outcome, payout, message;
        if (dealerTotal > 21) {
            outcome = "win"; payout = session.wager * 2; message = `🎉 Dealer estourou com ${dealerTotal}! Você ganhou.`;
        } else if (playerTotal > dealerTotal) {
            outcome = "win"; payout = session.wager * 2; message = `🎉 ${playerTotal} contra ${dealerTotal} — você ganhou!`;
        } else if (playerTotal === dealerTotal) {
            outcome = "push"; payout = session.wager; message = `🤝 Empate em ${playerTotal} — aposta devolvida.`;
        } else {
            outcome = "loss"; payout = 0; message = `😢 ${playerTotal} contra ${dealerTotal} — dealer ganhou.`;
        }

        bjSessions.delete(req.user.id);

        let balance = null;
        if (payout > 0) {
            balance = await pool.adjustBalance(session.walletId, payout, "payout", "game", "blackjack");
        } else {
            const w = await pool.get("SELECT balance FROM wallets WHERE id = ?", [session.walletId]);
            balance = w.balance;
        }

        await pool.run(
            `INSERT INTO bets (user_id, game, wager, multiplier, payout, outcome, detail)
             VALUES (?, 'blackjack', ?, ?, ?, ?, ?)`,
            [req.user.id, session.wager, session.wager > 0 ? Number((payout / session.wager).toFixed(2)) : 0, payout, outcome, JSON.stringify({ player: session.player, dealer: session.dealer })]
        );

        return res.json({
            status: "success", finished: true, outcome, message, balance,
            player: session.player, dealer: session.dealer, dealerTotal, playerTotal,
        });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Erro no stand." });
    }
});

// POST /api/games/blackjack/double — dobra a aposta e compra 1 carta
router.post("/blackjack/double", authenticate, async (req, res) => {
    try {
        const session = bjSessions.get(req.user.id);
        if (!session) return res.status(400).json({ status: "error", message: "Nenhuma mão em andamento." });
        if (session.player.length !== 2) {
            return res.status(400).json({ status: "error", message: "Dobrar só com 2 cartas." });
        }

        const extra = session.wager;
        const wallet = await pool.get("SELECT balance FROM wallets WHERE id = ?", [session.walletId]);
        if (!wallet || wallet.balance < extra) {
            return res.status(400).json({ status: "error", message: "Saldo insuficiente para dobrar." });
        }

        await pool.adjustBalance(session.walletId, -extra, "bet", "game", "blackjack");
        session.wager += extra;
        session.doubled = true;

        session.player.push(session.deck.pop());
        const total = handValue(session.player);

        if (total > 21) {
            bjSessions.delete(req.user.id);
            const w = await pool.get("SELECT balance FROM wallets WHERE id = ?", [session.walletId]);
            await pool.run(
                `INSERT INTO bets (user_id, game, wager, multiplier, payout, outcome, detail)
                 VALUES (?, 'blackjack', ?, 0, 0, 'loss', ?)`,
                [req.user.id, session.wager, JSON.stringify({ player: session.player, dealer: session.dealer, bust: true, doubled: true })]
            );
            return res.json({
                status: "success", finished: true, outcome: "loss",
                message: `💥 Estourou com ${total}! Perdeu ${session.wager} AC.`,
                balance: w.balance, player: session.player, dealer: session.dealer,
            });
        }

        // dobra → dealer joga
        while (handValue(session.dealer) < 17) {
            session.dealer.push(session.deck.pop());
        }

        const dealerTotal = handValue(session.dealer);
        let outcome, payout, message;
        if (dealerTotal > 21) {
            outcome = "win"; payout = session.wager * 2; message = `🎉 Dealer estourou com ${dealerTotal}! Dobrou e ganhou.`;
        } else if (total > dealerTotal) {
            outcome = "win"; payout = session.wager * 2; message = `🎉 ${total} contra ${dealerTotal} — dobro e ganhei!`;
        } else if (total === dealerTotal) {
            outcome = "push"; payout = session.wager; message = `🤝 Empate em ${total} — devolve o dobro.`;
        } else {
            outcome = "loss"; payout = 0; message = `😢 ${total} contra ${dealerTotal} — dealer ganhou.`;
        }

        bjSessions.delete(req.user.id);

        let balance = null;
        if (payout > 0) {
            balance = await pool.adjustBalance(session.walletId, payout, "payout", "game", "blackjack");
        } else {
            const w = await pool.get("SELECT balance FROM wallets WHERE id = ?", [session.walletId]);
            balance = w.balance;
        }

        await pool.run(
            `INSERT INTO bets (user_id, game, wager, multiplier, payout, outcome, detail)
             VALUES (?, 'blackjack', ?, ?, ?, ?, ?)`,
            [req.user.id, session.wager, session.wager > 0 ? Number((payout / session.wager).toFixed(2)) : 0, payout, outcome, JSON.stringify({ player: session.player, dealer: session.dealer, doubled: true })]
        );

        return res.json({
            status: "success", finished: true, outcome, message, balance,
            player: session.player, dealer: session.dealer, dealerTotal, playerTotal: total,
        });
    } catch (error) {
        return res.status(500).json({ status: "error", message: "Erro no double." });
    }
});

module.exports = router;
