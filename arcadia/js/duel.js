// ========================================
// ARCADIA DUEL — cliente x1
// ========================================

(() => {

    const $ = (id) => document.getElementById(id);

    let socket = null;
    let duel = null;
    let game = "dice";
    let selectedAuctionSlot = null;

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
                res.classList.remove("hidden");
                res.textContent = `🏆 ${f.winner} venceu o duelo!`;
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

        // botão pronto
        const iAmReady = d[myKey] && d[myKey].ready;
        $("readyBtn").classList.toggle("hidden", !(d.phase === "ready" && !iAmReady(d, myKey)));

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

    // ---------- LEILÃO ----------
    const GAME_ICON = { dice: "🎲", coinflip: "🪙", crash: "🚀", mines: "💣", roulette: "🎡" };

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
                $("bidAmount").value = base;
                selectedAuctionSlot = idx;
                slots.querySelectorAll(".auction-slot").forEach((x) => x.classList.remove("selected"));
                div.classList.add("selected");
                $("chooseBtn").classList.toggle("hidden", !leading);
                Sfx.chip();
            });
            div.querySelector(".as-bid-btn").appendChild(bidBtn);
            div.addEventListener("click", () => {
                selectedAuctionSlot = idx;
                slots.querySelectorAll(".auction-slot").forEach((x) => x.classList.remove("selected"));
                div.classList.add("selected");
                $("chooseBtn").classList.toggle("hidden", !leading);
            });
            slots.appendChild(div);
        });
    }

    $("bidBtn").addEventListener("click", () => {
        if (selectedAuctionSlot === null) return setAuctionMsg("Selecione um modo!", "loss");
        socket.emit("duel:bid", { gameIdx: selectedAuctionSlot, amount: Number($("bidAmount").value) }, (r) => {
            if (!r.ok) setAuctionMsg(r.error, "loss");
            else { setAuctionMsg("Lance registrado! 🔨", "win"); Sfx.chip(); }
        });
    });

    $("chooseBtn").addEventListener("click", () => {
        if (selectedAuctionSlot === null) return setAuctionMsg("Selecione um modo que você venceu!", "loss");
        socket.emit("duel:choose", { gameIdx: selectedAuctionSlot }, (r) => {
            if (!r.ok) setAuctionMsg(r.error, "loss");
            else Sfx.achievement();
        });
    });

    function setAuctionMsg(text, cls) {
        const el = $("auctionMsg");
        el.textContent = text;
        el.className = "game-result" + (cls ? " " + cls : "");
    }

    // seleção de jogo
    document.querySelectorAll(".duel-game-pick button").forEach((b) => {
        b.addEventListener("click", () => {
            document.querySelectorAll(".duel-game-pick button").forEach((x) => x.classList.remove("selected"));
            b.classList.add("selected");
            game = b.dataset.game;
            $("crashTarget").classList.toggle("hidden", game !== "crash");
        });
    });

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

    $("playBtn").addEventListener("click", () => {
        const choice = {};
        if (game === "crash") choice.autoCashout = Number($("target").value) || 2;
        socket.emit("duel:play", { game, wager: Number($("wager").value), choice }, (r) => {
            if (!r.ok) alert(r.error);
        });
    });

    (async () => {
        if (ArcadiaAPI.isLoggedIn()) {
            await ArcadiaWallet.refresh();
            $("walletBalance").textContent = ArcadiaWallet.format(ArcadiaWallet.getCached());
        }
    })();
})();
