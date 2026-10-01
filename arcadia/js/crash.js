// ========================================
// ARCADIA CRASH — cliente (polling no servidor)
// ========================================

(() => {

    const $ = (id) => document.getElementById(id);

    const stage = $("crashStage");
    const multEl = $("crashMult");
    const rocket = $("crashRocket");
    const stars = $("crashStars");
    const startBtn = $("startBtn");
    const cashoutBtn = $("cashoutBtn");
    const betInput = $("betAmount");
    const msg = $("gameMessage");
    const history = $("crashHistory");

    let playing = false;
    let roundOver = true; // trava de rodada: evita corrida entre polling e cashout
    let pollTimer = null;
    let animTimer = null;

    // ---------- ESTRELAS (decoração) ----------
    for (let i = 0; i < 40; i++) {
        const s = document.createElement("span");
        s.textContent = "✦";
        s.style.left = Math.random() * 100 + "%";
        s.style.top = Math.random() * 100 + "%";
        s.style.opacity = 0.2 + Math.random() * 0.5;
        stars.appendChild(s);
    }

    function fmt(v) {
        return (Number(v) || 0).toLocaleString("pt-BR") + " AC";
    }

    function setMessage(text, cls) {
        msg.textContent = text;
        msg.className = "game-result" + (cls ? " " + cls : "");
    }

    function updateWallet(balance) {
        if (Number.isFinite(balance)) {
            ArcadiaWallet.setCached(balance);
            const el = document.getElementById("walletBalance");
            if (el) el.textContent = ArcadiaWallet.format(balance);
        }
    }

    function addHistoryChip(point) {
        const chip = document.createElement("span");
        chip.className = "crash-chip " + (point < 2 ? "low" : point < 5 ? "mid" : "high");
        chip.textContent = point.toFixed(2) + "x";
        history.prepend(chip);
        while (history.children.length > 12) history.lastChild.remove();
    }

    // ---------- LOOP ----------
    function startPolling() {
        clearInterval(pollTimer); // segurança: nunca dois pollings rodando
        pollTimer = setInterval(async () => {
            if (roundOver) return;
            try {
                const data = await ArcadiaAPI.request("/api/games/crash/state");

                // resposta tardia chegando depois do cashout — ignora
                if (roundOver) return;

                if (!data.active) {
                    if (data.crashed) {
                        crash(data.crashPoint, data.balance);
                    } else if (playing) {
                        // sessão sumiu (restart do server) — encerra
                        endRound("Sessão encerrada.", "loss");
                    }
                    return;
                }

                render(data.multiplier, data.potentialPayout);
            } catch (_) {}
        }, 100);
    }

    function render(mult, potentialPayout) {
        multEl.textContent = mult.toFixed(2) + "x";
        cashoutBtn.textContent = `💰 Sacar ${fmt(potentialPayout)}`;

        // foguete sobe em diagonal conforme multiplicador
        const t = Math.min((mult - 1) / 4, 1); // 0→1 até 5x
        const x = 20 + t * (stage.clientWidth - 120);
        const y = stage.clientHeight - 60 - t * (stage.clientHeight - 140);
        rocket.style.left = x + "px";
        rocket.style.bottom = (stage.clientHeight - y) + "px";
        rocket.style.transform = `rotate(${-t * 40}deg)`;
    }

    function crash(point, balance) {
        roundOver = true;
        clearInterval(pollTimer);
        clearInterval(animTimer);
        playing = false;
        Sfx.boom();
        stage.classList.add("crashed");
        multEl.textContent = point.toFixed(2) + "x";
        rocket.textContent = "💥";
        rocket.style.transform = "scale(1.6)";
        addHistoryChip(point);
        setMessage(`💥 Crashou em ${point.toFixed(2)}x! Você perdeu ${fmt(Number(betInput.value))}.`, "loss");
        updateWallet(balance);
        endRoundUI();
    }

    function endRoundUI() {
        roundOver = true;
        cashoutBtn.disabled = false; // FIX: reabilita o botão para a próxima rodada
        cashoutBtn.classList.add("hidden");
        startBtn.classList.remove("hidden");
        setTimeout(() => {
            stage.classList.remove("crashed", "won");
            rocket.textContent = "🚀";
            rocket.style.transform = "none";
            rocket.style.left = "20px";
            rocket.style.bottom = "20px";
            multEl.textContent = "1.00x";
        }, 1800);
    }

    function endRound(text, cls) {
        playing = false;
        roundOver = true;
        clearInterval(pollTimer);
        clearInterval(animTimer);
        setMessage(text, cls);
        endRoundUI();
        ArcadiaWallet.refresh();
    }

    // ---------- START ----------
    startBtn.addEventListener("click", async () => {
        if (!ArcadiaAPI.isLoggedIn()) {
            setMessage("Entre na sua conta para jogar (página inicial).", "loss");
            return;
        }

        try {
            startBtn.disabled = true;
            const data = await ArcadiaAPI.request("/api/games/crash/start", {
                method: "POST",
                body: JSON.stringify({ wager: Number(betInput.value) }),
            });

            Sfx.rocket();
            playing = true;
            roundOver = false;
            stage.classList.remove("crashed", "won");
            startBtn.classList.add("hidden");
            cashoutBtn.disabled = false; // FIX: garante botão ativo a cada rodada
            cashoutBtn.classList.remove("hidden");
            setMessage("Subindo... saque antes do crash!", "");
            updateWallet(data.balance);
            startPolling();
        } catch (err) {
            setMessage(err.message, "loss");
        } finally {
            startBtn.disabled = false;
        }
    });

    // ---------- CASHOUT ----------
    cashoutBtn.addEventListener("click", async () => {
        if (roundOver) return;
        roundOver = true; // trava já: segundo clique é ignorado
        clearInterval(pollTimer);

        try {
            cashoutBtn.disabled = true;

            const data = await ArcadiaAPI.request("/api/games/crash/cashout", { method: "POST" });

            if (data.crashed) {
                stage.classList.add("crashed");
                multEl.textContent = data.crashPoint.toFixed(2) + "x";
                rocket.textContent = "💥";
                addHistoryChip(data.crashPoint);
                setMessage(`💥 Tarde demais! Crashou em ${data.crashPoint.toFixed(2)}x.`, "loss");
                updateWallet(data.balance);
            } else {
                Sfx.cashout();
                stage.classList.add("won");
                multEl.textContent = data.multiplier.toFixed(2) + "x";
                addHistoryChip(data.multiplier);
                setMessage(`🎉 Sacou ${fmt(data.payout)} em ${data.multiplier.toFixed(2)}x!`, "win");
                updateWallet(data.balance);
            }
            endRoundUI();
        } catch (err) {
            // FIX: a rodada pode ainda estar viva no servidor — destrava e volta a acompanhar
            roundOver = false;
            cashoutBtn.disabled = false;
            startPolling();
            setMessage(err.message, "loss");
        }
    });

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
