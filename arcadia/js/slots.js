// ========================================
// ARCADIA SLOTS — cliente (v1.1)
// Máquina com animação, trunfos, inventário e sons v2.0
// ========================================

(() => {

    const $ = (id) => document.getElementById(id);

    const reels = [$("reel1"), $("reel2"), $("reel3")];
    const spinBtn = $("spinBtn");
    const betInput = $("betAmount");
    const trumpSelect = $("trumpSelect");

    let spinning = false;
    let inventory = [];

    const RARITY_LABEL = {
        comum: "Comum", rara: "Rara", super_rara: "Super-Rara",
        epica: "Épica", lendaria: "Lendária", cromatica: "Cromática",
    };

    function fmt(v) {
        return (Number(v) || 0).toLocaleString("pt-BR") + " AC";
    }

    function setMessage(text, cls) {
        const m = $("gameMessage");
        m.textContent = text;
        m.className = "game-result" + (cls ? " " + cls : "");
    }

    function addNote(text) {
        const box = $("slotsNotes");
        const div = document.createElement("div");
        div.className = "note";
        div.textContent = text;
        box.prepend(div);
        while (box.children.length > 5) box.lastChild.remove();
    }

    // ---------- INVENTÁRIO ----------
    async function loadInventory() {
        try {
            const data = await ArcadiaAPI.request("/api/games/slots/cards");
            inventory = data.inventory || [];
            renderTrumpSelect();
            renderInventory();
        } catch (_) {}
    }

    function renderTrumpSelect() {
        trumpSelect.innerHTML = '<option value="">— Nenhum —</option>';
        inventory.forEach((c) => {
            const opt = document.createElement("option");
            opt.value = c.key;
            opt.textContent = `${c.name} · ${RARITY_LABEL[c.rarity] || c.rarity} (x${c.qty})`;
            trumpSelect.appendChild(opt);
        });
        $("cardCount").textContent = inventory.reduce((a, c) => a + c.qty, 0);
    }

    function renderInventory() {
        const list = $("cardsList");
        list.innerHTML = "";
        if (!inventory.length) {
            list.innerHTML = '<p class="empty-history">Nenhuma carta ainda. Gire a máquina!</p>';
            return;
        }
        inventory.forEach((c) => {
            const div = document.createElement("div");
            div.className = `slot-card rarity-${c.rarity}`;
            div.innerHTML = `
                <div class="sc-name">
                    <span>${c.name}</span>
                    <span class="sc-qty">x${c.qty}</span>
                </div>
                <div class="sc-rarity">${RARITY_LABEL[c.rarity] || c.rarity}</div>
                <div class="sc-desc">${c.desc || ""}</div>
            `;
            list.appendChild(div);
        });
    }

    // ---------- ANIMAÇÃO + SONS ----------
    function animateSpin(finalReels) {
        reels.forEach((r) => r.classList.add("spinning"));
        Sfx.spinSlots();
        finalReels.forEach((emoji, i) => {
            setTimeout(() => {
                reels[i].classList.remove("spinning");
                reels[i].textContent = emoji;
                Sfx.reelStop(i);
            }, 700 + i * 350);
        });
        return 700 + finalReels.length * 350;
    }

    // ---------- GIRAR ----------
    spinBtn.addEventListener("click", async () => {
        if (spinning) return;
        if (!ArcadiaAPI.isLoggedIn()) {
            setMessage("Entre na sua conta para jogar.", "loss");
            Sfx.error();
            return;
        }

        spinning = true;
        spinBtn.disabled = true;
        setMessage("Girando...", "");
        reels.forEach((r) => { r.classList.add("spinning"); r.textContent = "❔"; });

        try {
            const data = await ArcadiaAPI.request("/api/games/slots/play", {
                method: "POST",
                body: JSON.stringify({
                    wager: Number(betInput.value),
                    trump: trumpSelect.value || undefined,
                }),
            });

            const wait = animateSpin(data.reels);
            await new Promise((r) => setTimeout(r, wait));

            const machine = $("slotsMachine");
            if (data.jackpot) {
                machine.classList.add("jackpot");
                Sfx.jackpot();
            } else if (data.outcome === "win") {
                machine.classList.add("won");
                if (data.payout >= Number(betInput.value) * 8) Sfx.coinRain();
                else Sfx.win();
            } else {
                machine.classList.add("lost");
                Sfx.lose();
            }
            setTimeout(() => machine.classList.remove("jackpot", "won", "lost"), 1800);

            if (data.outcome === "win") {
                setMessage(`${data.jackpot ? "💥 PRÊMIO MÁXIMO! " : "🎉 "}+${fmt(data.payout)}`, "win");
                $("lastPayout").textContent = "+" + fmt(data.payout);
            } else {
                setMessage(`Perdeu ${fmt(Math.abs(data.delta))}.`, "loss");
                $("lastPayout").textContent = "—";
            }

            (data.notes || []).forEach((n) => addNote(n));
            if (data.card) {
                addNote(`🎁 Nova carta: ${data.card.name} (${RARITY_LABEL[data.card.rarity]})!`);
                Sfx.cardDrop(data.card.rarity);
            }

            ArcadiaWallet.setCached(data.balance);
            const el = document.getElementById("walletBalance");
            if (el) el.textContent = ArcadiaWallet.format(data.balance);

            trumpSelect.value = "";
            await loadInventory();
        } catch (err) {
            setMessage(err.message, "loss");
            Sfx.error();
            reels.forEach((r) => r.classList.remove("spinning"));
        } finally {
            spinning = false;
            spinBtn.disabled = false;
        }
    });

    // som de seleção ao escolher trunfo
    trumpSelect.addEventListener("change", () => Sfx.click());

    // ---------- INIT ----------
    (async function init() {
        if (ArcadiaAPI.isLoggedIn()) {
            await ArcadiaWallet.refresh();
            const el = document.getElementById("walletBalance");
            if (el) el.textContent = ArcadiaWallet.format(ArcadiaWallet.getCached());
            await loadInventory();
        }
    })();
})();
