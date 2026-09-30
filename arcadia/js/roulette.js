// ========================================
// ARCADIA ROULETTE — cliente
// ========================================

(() => {

    const $ = (id) => document.getElementById(id);

    const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

    const bets = []; // { type, value, amount }
    const TYPE_LABEL = {
        straight: "Pleno",
        red: "Vermelho", black: "Preto",
        even: "Par", odd: "Ímpar",
        low: "1-18", high: "19-36",
        dozen1: "1ª dúzia", dozen2: "2ª dúzia", dozen3: "3ª dúzia",
    };

    // ---------- MESA ----------
    const numbersEl = $("rlNumbers");
    for (let n = 1; n <= 36; n++) {
        const b = document.createElement("button");
        b.className = RED.has(n) ? "red" : "black";
        b.textContent = n;
        b.dataset.type = "straight";
        b.dataset.value = n;
        numbersEl.appendChild(b);
    }

    function addBet(type, value) {
        // aposta padrão 50 AC por clique (simples e rápido)
        const existing = bets.find((b) => b.type === type && b.value === value);
        if (existing) existing.amount += 50;
        else bets.push({ type, value, amount: 50 });
        renderBets();
    }

    function renderBets() {
        const box = $("betChips");
        if (bets.length === 0) {
            box.innerHTML = '<p class="muted">Nenhuma aposta. Clique na mesa.</p>';
        } else {
            box.innerHTML = "";
            bets.forEach((b, i) => {
                const div = document.createElement("div");
                div.className = "bet-chip";
                const label = b.type === "straight" ? `${TYPE_LABEL[b.type]} ${b.value}` : TYPE_LABEL[b.type];
                div.innerHTML = `<span>${label}</span><span>${b.amount} AC <span class="remove" data-i="${i}">✕</span></span>`;
                box.appendChild(div);
            });
            box.querySelectorAll(".remove").forEach((x) => {
                x.addEventListener("click", () => {
                    bets.splice(Number(x.dataset.index ?? x.dataset.i), 1);
                    renderBets();
                });
            });
        }
        $("totalBet").textContent = bets.reduce((s, b) => s + b.amount, 0).toLocaleString("pt-BR") + " AC";
    }

    // clique na mesa
    document.querySelector(".rl-table").addEventListener("click", (e) => {
        const t = e.target.closest("[data-type]");
        if (!t) return;
        addBet(t.dataset.type, t.dataset.value || null);
    });

    $("clearBets").addEventListener("click", () => {
        bets.length = 0;
        renderBets();
    });

    // ---------- SPIN ----------
    $("spinBtn").addEventListener("click", async () => {
        if (bets.length === 0) {
            setMessage("Faça pelo menos uma aposta!", "loss");
            return;
        }
        try {
            Sfx.spin();
            $("spinBtn").disabled = true;
            $("rlResult").classList.add("spin");
            setMessage("Girando... 🎡", "");

            const data = await ArcadiaAPI.request("/api/games/roulette/spin", {
                method: "POST",
                body: JSON.stringify({ bets }),
            });

            // suspense
            await new Promise((r) => setTimeout(r, 1200));

            $("rlResult").classList.remove("spin");
            const res = $("rlResult");
            res.classList.remove("spin");
            res.classList.remove("green", "red", "black");
            res.classList.add(data.color);
            $("rlNumber").textContent = data.number;
            $("rlColor").textContent = data.color === "green" ? "ZERO" : data.color === "red" ? "VERMELHO" : "PRETO";

            // histórico
            const chip = document.createElement("span");
            chip.className = "rl-chip " + data.color;
            chip.textContent = data.number;
            $("rlHistory").prepend(chip);
            while ($("rlHistory").children.length > 10) $("rlHistory").lastChild.remove();

            // resultado
            if (data.outcome === "win") {
                Sfx.win();
                const profit = data.totalPayout - data.totalWager;
                setMessage(`🎉 Saiu ${data.number} ${data.color === "green" ? "verde" : data.color === "red" ? "vermelho" : "preto"} — lucro de ${profit.toLocaleString("pt-BR")} AC!`, "win");
            } else if (data.outcome === "push") {
                Sfx.push();
                setMessage(`🤝 Saiu ${data.number} — apostas devolvidas.`, "");
            } else {
                Sfx.lose();
                setMessage(`😢 Saiu ${data.number} — você perdeu ${data.totalWager.toLocaleString("pt-BR")} AC.`, "loss");
            }

            updateWallet(data.balance);
            bets.length = 0;
            renderBets();
        } catch (err) {
            setMessage(err.message, "loss");
        } finally {
            $("rlResult").classList.remove("spin");
            $("spinBtn").disabled = false;
        }
    });

    function setMessage(text, cls) {
        const el = $("gameMessage");
        el.textContent = text;
        el.className = "game-result" + (cls ? " " + cls : "");
    }

    function updateWallet(balance) {
        if (Number.isFinite(balance)) {
            ArcadiaWallet.setCached(balance);
            $("walletBalance").textContent = ArcadiaWallet.format(balance);
        }
    }

    // ---------- INIT ----------
    (async () => {
        if (ArcadiaAPI.isLoggedIn()) {
            await ArcadiaWallet.refresh();
            $("walletBalance").textContent = ArcadiaWallet.format(ArcadiaWallet.getCached());
        }
    })();
})();
