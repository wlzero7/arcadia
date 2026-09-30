// ========================================
// ARCADIA BLACKJACK — cliente
// ========================================

(() => {

    const $ = (id) => document.getElementById(id);

    const dealerCards = $("dealerCards");
    const playerCards = $("playerCards");
    const dealerTotal = $("dealerTotal");
    const playerTotal = $("playerTotal");
    const msg = $("gameMessage");
    const betRow = $("betRow");
    const actionRow = $("actionRow");
    const newRoundBtn = $("newRoundBtn");
    const dealBtn = $("dealBtn");
    const hitBtn = $("hitBtn");
    const standBtn = $("standBtn");
    const doubleBtn = $("doubleBtn");

    function fmt(v) { return (Number(v) || 0).toLocaleString("pt-BR") + " AC"; }

    function setMessage(text, cls) {
        msg.textContent = text;
        msg.className = "bj-message" + (cls ? " " + cls : "");
    }

    function updateWallet(balance) {
        if (Number.isFinite(balance)) {
            ArcadiaWallet.setCached(balance);
            $("walletBalance").textContent = ArcadiaWallet.format(balance);
        }
    }

    function cardHtml(card, hidden) {
        if (hidden) return '<div class="card back"></div>';
        const red = ["♥", "♦"].includes(card.suit);
        return `<div class="card ${red ? "red" : ""}"><span>${card.rank}</span><span class="suit">${card.suit}</span></div>`;
    }

    function renderHand(el, cards, hideSecond) {
        Sfx.card();
        el.innerHTML = "";
        cards.forEach((c, i) => {
            const wrap = document.createElement("div");
            wrap.innerHTML = cardHtml(c, hideSecond && i === 1);
            el.appendChild(wrap.firstChild);
        });
    }

    function showActions(canDouble) {
        betRow.classList.add("hidden");
        newRoundBtn.classList.add("hidden");
        actionRow.classList.remove("hidden");
        doubleBtn.disabled = !canDouble;
    }

    function showNewRound() {
        actionRow.classList.add("hidden");
        betRow.classList.add("hidden");
        newRoundBtn.classList.remove("hidden");
    }

    // ---------- DEAL ----------
    dealBtn.addEventListener("click", async () => {
        try {
            dealBtn.disabled = true;
            const data = await ArcadiaAPI.request("/api/games/blackjack/start", {
                method: "POST",
                body: JSON.stringify({ wager: Number($("betAmount").value) }),
            });

            updateWallet(data.balance);

            if (data.finished) {
                renderHand(dealerCards, data.dealer, false);
                renderHand(playerCards, data.player, false);
                dealerTotal.textContent = "";
                playerTotal.textContent = "";
                if (data.outcome === "win") Sfx.win(); else if (data.outcome === "push") Sfx.push(); else Sfx.lose();
                setMessage(data.message, data.outcome === "win" ? "win" : data.outcome === "push" ? "" : "loss");
                showNewRound();
            } else {
                renderHand(dealerCards, data.dealer, true);
                renderHand(playerCards, data.player, false);
                dealerTotal.textContent = data.dealerTotal + "+?";
                playerTotal.textContent = data.playerTotal;
                setMessage("Comprar, parar ou dobrar?");
                showActions(data.canDouble);
            }
        } catch (err) {
            setMessage(err.message, "loss");
        } finally {
            dealBtn.disabled = false;
        }
    });

    // ---------- HIT ----------
    hitBtn.addEventListener("click", async () => {
        try {
            const data = await ArcadiaAPI.request("/api/games/blackjack/hit", { method: "POST" });
            if (data.finished) {
                renderHand(dealerCards, data.dealer, false);
                renderHand(playerCards, data.player, false);
                dealerTotal.textContent = "";
                playerTotal.textContent = "";
                updateWallet(data.balance);
                setMessage(data.message, "loss");
                showNewRound();
            } else {
                renderHand(playerCards, data.player, false);
                playerTotal.textContent = data.playerTotal;
                doubleBtn.disabled = true;
                if (data.playerTotal === 21) standBtn.click();
            }
        } catch (err) {
            setMessage(err.message, "loss");
        }
    });

    // ---------- STAND ----------
    standBtn.addEventListener("click", async () => {
        try {
            standBtn.disabled = true;
            const data = await ArcadiaAPI.request("/api/games/blackjack/stand", { method: "POST" });
            renderHand(dealerCards, data.dealer, false);
            dealerTotal.textContent = data.dealerTotal;
            playerTotal.textContent = data.playerTotal;
            updateWallet(data.balance);
            if (data.outcome === "win") Sfx.win(); else if (data.outcome === "push") Sfx.push(); else Sfx.lose();
            setMessage(data.message, data.outcome === "win" ? "win" : data.outcome === "push" ? "" : "loss");
            showNewRound();
        } catch (err) {
            setMessage(err.message, "loss");
        } finally {
            standBtn.disabled = false;
        }
    });

    // ---------- DOUBLE ----------
    doubleBtn.addEventListener("click", async () => {
        try {
            doubleBtn.disabled = true;
            const data = await ArcadiaAPI.request("/api/games/blackjack/double", { method: "POST" });
            renderHand(dealerCards, data.dealer, false);
            renderHand(playerCards, data.player, false);
            dealerTotal.textContent = data.dealerTotal;
            playerTotal.textContent = data.playerTotal;
            updateWallet(data.balance);
            setMessage(data.message, data.outcome === "win" ? "win" : data.outcome === "push" ? "" : "loss");
            showNewRound();
        } catch (err) {
            setMessage(err.message, "loss");
        }
    });

    // ---------- NEW ROUND ----------
    newRoundBtn.addEventListener("click", () => {
        dealerCards.innerHTML = "";
        playerCards.innerHTML = "";
        dealerTotal.textContent = "";
        playerTotal.textContent = "";
        setMessage("Faça sua aposta");
        newRoundBtn.classList.add("hidden");
        betRow.classList.remove("hidden");
    });

    // ---------- INIT ----------
    (async () => {
        if (ArcadiaAPI.isLoggedIn()) {
            await ArcadiaWallet.refresh();
            $("walletBalance").textContent = ArcadiaWallet.format(ArcadiaWallet.getCached());
        }
    })();
})();
