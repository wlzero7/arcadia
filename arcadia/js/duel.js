// ========================================
// ARCADIA DUEL — cliente x1 (v1.1)
// v1.1: fix do crash no load (elementos opcionais com guarda),
// seleção de jogo funcional, escolha por jogo (dado/moeda/crash/
// mines/roleta/slots) e trunfos do inventário
// ========================================

(() => {

    const $ = (id) => document.getElementById(id);

    let socket = null;
    let duel = null;
    let selectedDice = null;
    let selectedSide = null;
    let selectedAuctionSlot = null;
    let inventory = [];

    function connect() {
        return new Promise((resolve, reject) => {
            if (socket && socket.connected) return resolve(socket);
            socket = io(API_URL, { auth: { token: ArcadiaAPI.getToken() } });
            socket.on("connect", () => resolve(socket));
            socket.on("connect_error", (e) => reject(e));

            socket.on("duel:state", (d) => {
                duel = d;
                render(d);
            });

            socket.on("duel:finished", (f) => {
                Sfx.raceWin();
                const res = $("duelResult");
                if (res) {
                    res.classList.remove("hidden");
                    res.textContent = `🏆 ${f.winner} venceu o duelo!`;
                }
            });
        });
    }

    function render(d) {
        $("duelLobby").classList.add("hidden");
        $("duelArena").classList.remove("hidden");
        $("duelCode").textContent = d.code;

        const me = ArcadiaAPI.getUser();
        const myKey = me && d.p1.userId === me.id ? "p1" : "p2";

        $("p1Name").textContent = d.p1.username;
        $("p1Balance").textContent = (d.p1.balance || 0).toLocaleString("pt-BR") + " AC";
        $("p2Name").textContent = d.p2 ? d.p2.username : "Aguardando...";
        $("p2Balance").textContent = d.p2 ? (d.p2.balance || 0).toLocaleString("pt-BR") + " AC" : "—";

        $("p1Box").classList.toggle("my-turn", d.turn === "p1" && d.phase === "playing");
        $("p2Box").classList.toggle("my-turn", d.turn === "p2" && d.phase === "playing");

        updateDuelButtons(d, myKey);

        // LEILÃO
        const auctionPanel = $("auctionPanel");
        auctionPanel.classList.toggle("hidden", d.phase !== "auction");
        if (d.phase === "auction" && d.auction) {
            renderAuction(d, myKey);
        }

        // área de jogo
        const myTurn = d.phase === "playing" && d.turn === myKey;
        $("duelPlay").classList.toggle("hidden", !myTurn);
        $("duelTurn").textContent =
            d.phase === "waiting" ? "Aguardando oponente entrar..." :
            d.phase === "ready" ? "Ambos prontos para iniciar!" :
            d.phase === "playing" ? (myTurn ? "🎯 Sua vez!" : `⏳ Vez de ${d[d.turn === "p1" ? "p2" : "p1"].username}`) :
            "Duelo encerrado.";

        // log
        const log = $("duelLog");
        log.innerHTML = "";
        (d.log || []).forEach((l) => {
            const div = document.createElement("div");
            if (l.system) { div.className = "sys"; div.textContent = l.message; }
            else div.innerHTML = `<b>${l.username}:</b> ${l.message}`;
            log.appendChild(div);
        });
        log.scrollTop = log.scrollHeight;
    }

    function iAmReady(d, myKey) {
        return d[myKey] && d[myKey].ready;
    }

    // ---------- PRONTO / INICIAR ----------
    function updateDuelButtons(d, myKey) {
        const readyBtn = $("readyBtn");
        const startBtn = $("startBtn");
        const me = ArcadiaAPI.getUser();
        const isHost = me && d.p1.userId === me.id;
        const amReady = iAmReady(d, myKey);

        const showReady = (d.phase === "waiting" || d.phase === "ready") && !amReady;
        readyBtn.classList.toggle("hidden", !showReady);

        const showStart = isHost && d.phase === "ready" && d.p2 && d.p1.ready && d.p2.ready;
        if (startBtn) startBtn.classList.toggle("hidden", !showStart);

        const st = $("readyStatus");
        if (st) {
            const p1r = d.p1.ready ? "✓" : "…";
            const p2r = d.p2 && d.p2.ready ? "✓" : "…";
            st.textContent = `Prontos: P1 ${p1r} · P2 ${p2r}`;
        }
    }

    // ---------- LEILÃO ----------
    const GAME_ICON = { dice: "🎲", coinflip: "🪙", crash: "🚀", mines: "💣", roulette: "🎡", slots: "🎰" };

    function renderAuction(d, myKey) {
        const slots = $("auctionSlots");
        slots.innerHTML = "";
        const oppKey = myKey === "p1" ? "p2" : "p1";

        d.auction.forEach((slot, idx) => {
            const myBid = slot.bids[myKey] || 0;
            const oppBid = slot.bids[oppKey] || 0;
            const leading = myBid > oppBid && myBid > 0;

            const div = document.createElement("div");
            div.className = "auction-slot" + (selectedAuctionSlot === idx ? " selected" : "");
            div.innerHTML = `
                <span class="as-game">${GAME_ICON[slot.game] || "🎮"} ${slot.game}</span>
                <span class="as-bids">${myBid ? `você: ${myBid} AC` : ""}${oppBid ? ` · oponente: ${oppBid} AC` : ""}</span>
                <span class="as-lead ${leading ? "me" : oppBid > 0 ? "opp" : ""}">${leading ? "👑 na frente" : oppBid > 0 ? "perdendo" : "sem lances"}</span>
                <span class="as-bid-btn"></span>
            `;
            const bidBtn = document.createElement("button");
            bidBtn.className = "btn btn-outline";
            bidBtn.style.padding = ".3rem .8rem";
            bidBtn.textContent = "+10 lance";
            bidBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                const base = Math.max(myBid, oppBid) + 10;
                const input = $("bidAmount");
                if (input) input.value = base;
                selectedAuctionSlot = idx;
                slots.querySelectorAll(".auction-slot").forEach((x) => x.classList.remove("selected"));
                div.classList.add("selected");
                const choose = $("chooseBtn");
                if (choose) choose.classList.toggle("hidden", !leading);
                Sfx.chip();
            });
            div.querySelector(".as-bid-btn").appendChild(bidBtn);
            div.addEventListener("click", () => {
                selectedAuctionSlot = idx;
                slots.querySelectorAll(".auction-slot").forEach((x) => x.classList.remove("selected"));
                div.classList.add("selected");
                const choose = $("chooseBtn");
                if (choose) choose.classList.toggle("hidden", !leading);
            });
            slots.appendChild(div);
        });
    }

    // controles do leilão (com guarda — só liga se existirem no HTML)
    const bidBtn = $("bidBtn");
    if (bidBtn) {
        bidBtn.addEventListener("click", () => {
            if (selectedAuctionSlot === null) return setAuctionMsg("Selecione um modo!", "loss");
            socket.emit("duel:bid", { gameIdx: selectedAuctionSlot, amount: Number($("bidAmount").value) }, (r) => {
                if (!r.ok) setAuctionMsg(r.error, "loss");
                else { setAuctionMsg("Lance registrado! 🔨", "win"); Sfx.chip(); }
            });
        });
    }

    const chooseBtn = $("chooseBtn");
    if (chooseBtn) {
        chooseBtn.addEventListener("click", () => {
            if (selectedAuctionSlot === null) return setAuctionMsg("Selecione um modo que você venceu!", "loss");
            socket.emit("duel:choose", { gameIdx: selectedAuctionSlot }, (r) => {
                if (!r.ok) setAuctionMsg(r.error, "loss");
                else Sfx.achievement();
            });
        });
    }

    function setAuctionMsg(text, cls) {
        const el = $("auctionMsg");
        if (!el) return;
        el.textContent = text;
        el.className = "game-result" + (cls ? " " + cls : "");
    }

    // ---------- ESCOLHA POR JOGO ----------
    const gameSelect = $("gameSelect");
    function renderGameChoice() {
        const g = gameSelect ? gameSelect.value : "dice";
        const crashTarget = $("crashTarget");
        if (crashTarget) crashTarget.classList.toggle("hidden", g !== "crash");

        const dicePick = $("dicePick");
        if (dicePick) {
            dicePick.classList.toggle("hidden", g !== "dice");
            if (g === "dice" && dicePick.dataset.built !== "1") {
                dicePick.dataset.built = "1";
                for (let i = 1; i <= 6; i++) {
                    const b = document.createElement("button");
                    b.textContent = i;
                    b.addEventListener("click", () => {
                        selectedDice = i;
                        dicePick.querySelectorAll("button").forEach((x) => x.classList.remove("selected"));
                        b.classList.add("selected");
                        Sfx.click();
                    });
                    dicePick.appendChild(b);
                }
            }
        }

        const sidePick = $("sidePick");
        if (sidePick) sidePick.classList.toggle("hidden", g !== "coinflip");

        const minesPick = $("minesPick");
        if (minesPick) minesPick.classList.toggle("hidden", g !== "mines");

        const roulettePick = $("roulettePick");
        if (roulettePick) roulettePick.classList.toggle("hidden", g !== "roulette");

        const trumpRow = $("trumpRow");
        if (trumpRow) trumpRow.classList.toggle("hidden", g !== "slots");
    }

    if (gameSelect) {
        gameSelect.addEventListener("change", () => {
            renderGameChoice();
            Sfx.click();
        });
    }

    // moeda: cara/coroa
    const sidePick = $("sidePick");
    if (sidePick) {
        sidePick.querySelectorAll("button").forEach((b) => {
            b.addEventListener("click", () => {
                selectedSide = b.dataset.side;
                sidePick.querySelectorAll("button").forEach((x) => x.classList.remove("selected"));
                b.classList.add("selected");
                Sfx.click();
            });
        });
    }

    // ---------- TRUNFOS (inventário) ----------
    async function loadTrumps() {
        const sel = $("trumpSelect");
        if (!sel || !ArcadiaAPI.isLoggedIn()) return;
        try {
            const data = await ArcadiaAPI.request("/api/games/slots/cards");
            inventory = data.inventory || [];
            sel.innerHTML = '<option value="">— Nenhum —</option>';
            inventory.forEach((c) => {
                const opt = document.createElement("option");
                opt.value = c.key;
                opt.textContent = `${c.name} (x${c.qty})`;
                sel.appendChild(opt);
            });
        } catch (_) {}
    }

    // ---------- AÇÕES ----------
    $("createDuelBtn").addEventListener("click", async () => {
        if (!ArcadiaAPI.isLoggedIn()) return alert("Entre na sua conta primeiro!");
        await connect();
        socket.emit("duel:create", {}, (r) => {
            if (r.ok) { duel = r.duel; render(duel); }
            else alert(r.error);
        });
    });

    $("joinDuelBtn").addEventListener("click", async () => {
        if (!ArcadiaAPI.isLoggedIn()) return alert("Entre na sua conta primeiro!");
        await connect();
        socket.emit("duel:join", { code: $("joinCode").value }, (r) => {
            if (r.ok) { duel = r.duel; render(duel); }
            else alert(r.error);
        });
    });

    $("readyBtn").addEventListener("click", () => {
        socket.emit("duel:ready", {}, (r) => { if (!r.ok) alert(r.error); });
    });

    // Iniciar: host confirma o início quando ambos estão prontos (mesmo evento ready)
    const startBtn = $("startBtn");
    if (startBtn) {
        startBtn.addEventListener("click", () => {
            socket.emit("duel:ready", {}, (r) => { if (!r.ok) alert(r.error); });
        });
    }

    $("playBtn").addEventListener("click", () => {
        const g = gameSelect ? gameSelect.value : "dice";
        const choice = {};

        if (g === "dice") {
            if (!selectedDice) return alert("Escolha um número!");
            choice.number = selectedDice;
        } else if (g === "coinflip") {
            if (!selectedSide) return alert("Escolha um lado!");
            choice.side = selectedSide;
        } else if (g === "crash") {
            choice.autoCashout = Number($("crashTarget").value) || 2;
        } else if (g === "mines") {
            choice.picks = Number($("minesPicks") && $("minesPicks").value) || 3;
        } else if (g === "roulette") {
            choice.bet = $("rouletteBet") ? $("rouletteBet").value : "red";
        } else if (g === "slots") {
            const trump = $("trumpSelect") ? $("trumpSelect").value : "";
            if (trump) choice.trump = trump;
        }

        socket.emit("duel:play", { game: g, wager: Number($("wager").value), choice }, (r) => {
            if (!r.ok) alert(r.error);
        });
    });

    // ---------- INIT ----------
    (async () => {
        renderGameChoice();
        await loadTrumps();
        if (ArcadiaAPI.isLoggedIn()) {
            await ArcadiaWallet.refresh();
            $("walletBalance").textContent = ArcadiaWallet.format(ArcadiaWallet.getCached());
        }
    })();
})();
