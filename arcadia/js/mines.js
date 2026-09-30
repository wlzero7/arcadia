// ========================================
// ARCADIA MINES — cliente (estado no servidor)
// ========================================

(() => {

    const $ = (id) => document.getElementById(id);

    const board = $("minesBoard");
    const startBtn = $("startBtn");
    const cashoutBtn = $("cashoutBtn");
    const betInput = $("betAmount");
    const minesInput = $("minesCount");
    const msg = $("gameMessage");
    const currentMult = $("currentMult");
    const nextMult = $("nextMult");
    const potential = $("potential");

    let playing = false;

    // ---------- GRID ----------
    for (let i = 0; i < 25; i++) {
        const cell = document.createElement("button");
        cell.className = "mine-cell";
        cell.dataset.index = i;
        cell.disabled = true;
        cell.addEventListener("click", () => pick(i));
        board.appendChild(cell);
    }

    const cells = board.querySelectorAll(".mine-cell");

    function resetBoard() {
        cells.forEach((c) => {
            c.textContent = "";
            c.className = "mine-cell";
            c.disabled = !playing;
        });
    }

    function setMessage(text, cls) {
        msg.textContent = text;
        msg.className = "game-result" + (cls ? " " + cls : "");
    }

    function fmt(v) {
        return (Number(v) || 0).toLocaleString("pt-BR") + " AC";
    }

    function updateWallet(balance) {
        if (Number.isFinite(balance)) {
            ArcadiaWallet.setCached(balance);
            const el = document.getElementById("walletBalance");
            if (el) el.textContent = ArcadiaWallet.format(balance);
        }
    }

    // ---------- START ----------
    startBtn.addEventListener("click", async () => {
        if (!ArcadiaAPI.isLoggedIn()) {
            setMessage("Entre na sua conta para jogar (página inicial).", "loss");
            return;
        }

        try {
            startBtn.disabled = true;
            const data = await ArcadiaAPI.request("/api/games/mines/start", {
                method: "POST",
                body: JSON.stringify({
                    wager: Number(betInput.value),
                    mines: Number(minesInput.value),
                }),
            });

            playing = true;
            resetBoard();
            cells.forEach((c) => (c.disabled = false));
            startBtn.classList.add("hidden");
            cashoutBtn.classList.remove("hidden");
            cashoutBtn.disabled = true; // precisa abrir 1 célula
            setMessage("Escolha uma célula. Boa sorte! 💣");
            updateWallet(data.balance);
        } catch (err) {
            setMessage(err.message, "loss");
        } finally {
            startBtn.disabled = false;
        }
    });

    // ---------- PICK ----------
    async function pick(index) {
        if (!playing) return;
        const cell = cells[index];
        cell.disabled = true;

        try {
            const data = await ArcadiaAPI.request("/api/games/mines/pick", {
                method: "POST",
                body: JSON.stringify({ cell: index }),
            });

            if (data.boom) {
                // explodiu
                Sfx.boom();
                cell.textContent = "💥";
                cell.classList.add("boom");
                revealMines(data.mines);
                endRound(`💥 BOOM! Você perdeu ${fmt(Number(betInput.value))}.`, "loss");
                updateWallet(data.balance);
            } else {
                Sfx.gem();
                cell.textContent = "💎";
                cell.classList.add("gem");
                currentMult.textContent = data.multiplier.toFixed(2) + "x";
                potential.textContent = fmt(data.potentialPayout);
                cashoutBtn.disabled = false;
                cashoutBtn.textContent = `💰 Sacar ${fmt(data.potentialPayout)}`;
                setMessage(`${data.picks} célula(s) segura(s). Continuar ou sacar?`);
            }
        } catch (err) {
            setMessage(err.message, "loss");
        }
    }

    // ---------- CASHOUT ----------
    cashoutBtn.addEventListener("click", async () => {
        try {
            cashoutBtn.disabled = true;
            const data = await ArcadiaAPI.request("/api/games/mines/cashout", { method: "POST" });

            Sfx.cashout();
            revealMines(data.mines);
            endRound(`🎉 Sacou ${fmt(data.payout)} (${data.multiplier.toFixed(2)}x)!`, "win");
            updateWallet(data.balance);
        } catch (err) {
            setMessage(err.message, "loss");
        }
    });

    // ---------- HELPERS ----------
    function revealMines(mines) {
        cells.forEach((c, i) => {
            c.disabled = true;
            if (mines.includes(i) && !c.classList.contains("boom")) {
                c.textContent = "💣";
                c.classList.add("dim");
            }
        });
    }

    function endRound(text, cls) {
        playing = false;
        setMessage(text, cls);
        cashoutBtn.classList.add("hidden");
        startBtn.classList.remove("hidden");
        currentMult.textContent = "—";
        nextMult.textContent = "—";
        potential.textContent = "—";
        ArcadiaWallet.refresh();
    }

    // ---------- INIT ----------
    async function init() {
        if (ArcadiaAPI.isLoggedIn()) {
            await ArcadiaWallet.refresh();
            document.getElementById("walletBalance").textContent =
                ArcadiaWallet.format(ArcadiaWallet.getCached());
        }
    }

    init();
})();
