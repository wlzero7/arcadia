// ========================================
// ARCADIA PLINKO — cliente com animação da bola
// ========================================

(() => {

    const $ = (id) => document.getElementById(id);

    const ROWS = 16;
    const TABLES = {
        low:    [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
        medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
        high:   [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
    };

    let risk = "medium";
    let dropping = false;

    // ---------- PINOS ----------
    const pins = $("plinkoPins");
    for (let r = 2; r <= ROWS; r++) {
        const row = document.createElement("div");
        row.className = "pin-row";
        for (let i = 0; i < r; i++) {
            const pin = document.createElement("div");
            pin.className = "pin";
            row.appendChild(pin);
        }
        pins.appendChild(row);
    }

    // ---------- SLOTS ----------
    function renderSlots(risk) {
        const slots = $("plinkoSlots");
        slots.innerHTML = "";
        TABLES[risk].forEach((m) => {
            const div = document.createElement("div");
            div.className = "plinko-slot";
            div.textContent = m + "x";
            if (m >= 10) div.style.background = "linear-gradient(180deg,#dc2626,#991b1b)";
            else if (m >= 2) div.style.background = "linear-gradient(180deg,#f59e0b,#b45309)";
            slots.appendChild(div);
        });
    }
    renderSlots("medium");

    document.querySelectorAll(".risk-row button").forEach((b) => {
        b.addEventListener("click", () => {
            document.querySelectorAll(".risk-row button").forEach((x) => x.classList.remove("selected"));
            b.classList.add("selected");
            risk = b.dataset.risk;
            renderSlots(risk);
            Sfx.click();
        });
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

    // ---------- ANIMAÇÃO ----------
    function animateBall(path, slot, mult, done) {
        const ball = $("plinkoBall");
        const board = $("plinkoBoard");
        ball.classList.remove("hidden");

        const boardW = board.clientWidth;
        const rowH = 26;
        const gap = 28;
        let x = boardW / 2;
        let y = 6;

        let i = 0;
        const step = () => {
            if (i >= path.length) {
                // cai no slot
                const slots = document.querySelectorAll(".plinko-slot");
                slots.forEach((s) => s.classList.remove("hit"));
                if (slots[slot]) {
                    slots[slot].classList.add("hit");
                    slots[slot].scrollIntoViewIfNeeded?.();
                }
                ball.classList.add("hidden");
                done();
                return;
            }

            const dir = path[i] === 0 ? -1 : 1;
            x += (dir * gap) / 2;
            y += rowH;
            ball.style.left = x + "px";
            ball.style.top = y + "px";

            Sfx.click();
            i++;
            setTimeout(step, 90);
        };
        setTimeout(step, 60);
    }

    // ---------- DROP ----------
    $("dropBtn").addEventListener("click", async () => {
        if (dropping) return;
        if (!ArcadiaAPI.isLoggedIn()) {
            setMessage("Entre na sua conta para jogar (página inicial).", "loss");
            return;
        }

        dropping = true;
        $("dropBtn").disabled = true;
        setMessage("Bola solta! 🎯", "");

        try {
            const data = await ArcadiaAPI.request("/api/games/plinko/drop", {
                method: "POST",
                body: JSON.stringify({ wager: Number($("betAmount").value), risk }),
            });

            animateBall(data.path, data.slot, data.multiplier, () => {
                updateWallet(data.balance);

                const chip = document.createElement("span");
                chip.className = "plinko-chip" + (data.multiplier >= 10 ? " big" : "");
                chip.textContent = data.multiplier + "x";
                $("plinkoHistory").prepend(chip);
                while ($("plinkoHistory").children.length > 10) $("plinkoHistory").lastChild.remove();

                if (data.payout > Number($("betAmount").value)) {
                    Sfx.win();
                    setMessage(`🎉 Caiu no ${data.multiplier}x — +${data.payout.toLocaleString("pt-BR")} AC!`, "win");
                } else if (data.payout > 0) {
                    Sfx.push();
                    setMessage(`${data.multiplier}x — ${data.payout.toLocaleString("pt-BR")} AC de volta.`, "");
                } else {
                    Sfx.lose();
                    setMessage(`0.2x... só o pó. 💨`, "loss");
                }

                if (data.levelInfo && data.levelInfo.leveledUp) Sfx.levelUp();
                dropping = false;
                $("dropBtn").disabled = false;
            });
        } catch (err) {
            setMessage(err.message, "loss");
            dropping = false;
            $("dropBtn").disabled = false;
        }
    });

    // ---------- INIT ----------
    (async () => {
        if (ArcadiaAPI.isLoggedIn()) {
            await ArcadiaWallet.refresh();
            $("walletBalance").textContent = ArcadiaWallet.format(ArcadiaWallet.getCached());
        }
    })();
})();
