// ========================================
// ARCADIA ROOMS — cliente multiplayer (Socket.IO)
// ========================================

const Rooms = (() => {

    let socket = null;
    let currentRoom = null;
    let selectedDice = null;
    let selectedSide = null;

    // ---------- ELEMENTOS ----------
    const $ = (id) => document.getElementById(id);

    const createRoomBtn = $("createRoomBtn");
    const joinRoomBtn = $("joinRoomBtn");
    const joinCodeInput = $("joinCode");
    const roomsList = $("roomsList");
    const roomModal = $("roomModal");

    const toast = $("toast");
    function toastMsg(msg) {
        toast.textContent = msg;
        toast.classList.add("show");
        setTimeout(() => toast.classList.remove("show"), 2600);
    }

    function requireLogin() {
        if (ArcadiaAPI.isLoggedIn()) return true;
        toastMsg("Entre na sua conta primeiro (página inicial).");
        setTimeout(() => (window.location.href = "index.html"), 1200);
        return false;
    }

    function connect() {
        return new Promise((resolve, reject) => {
            if (socket && socket.connected) return resolve(socket);
            socket = io(API_URL, { auth: { token: ArcadiaAPI.getToken() } });

            socket.on("connect", () => resolve(socket));
            socket.on("connect_error", (e) => {
                toastMsg("Erro de conexão: " + e.message);
                reject(e);
            });

            socket.on("room:update", (room) => {
                currentRoom = room;
                renderRoom(room);
            });

            socket.on("room:round", (round) => {
                renderRound(round);
                renderGameResult(round);
            });

            socket.on("room:chat", (msg) => {
                const log = $("chatLog");
                const div = document.createElement("div");
                if (msg.system) {
                    div.className = "sys";
                    div.textContent = msg.message;
                } else {
                    div.innerHTML = `<b>${msg.username}:</b> ${escapeHtml(msg.message)}`;
                }
                log.appendChild(div);
                log.scrollTop = log.scrollHeight;
            });
        });
    }

    function colorName(c) {
        return c === "green" ? "verde" : c === "red" ? "vermelho" : "preto";
    }

    function escapeHtml(s) {
        const d = document.createElement("div");
        d.textContent = s;
        return d.innerHTML;
    }

    // ---------- RENDER ----------
    function renderRoom(room) {
        $("mRoomName").textContent = room.name;
        $("mRoomCode").textContent = room.code;
        $("mPot").textContent = ArcadiaWallet.format(room.pot);

        const me = ArcadiaAPI.getUser();
        const list = $("mPlayers");
        list.innerHTML = "";
        room.players.forEach((p) => {
            const li = document.createElement("li");
            if (!p.online) li.className = "offline";
            const isMe = me && p.id === me.id;
            li.innerHTML = `
                <span>${isMe ? "Você" : p.username} ${p.id === room.hostId ? '<span class="host-tag">👑 host</span>' : ""}</span>
                <span class="muted">stake: ${ArcadiaWallet.format(p.stake)}</span>
            `;
            list.appendChild(li);
        });

        renderGameControls(room);
        renderRoundHistory(room);

        // painel de apostas da roleta
        if (room.game === "roulette") {
            const betsEl = document.getElementById("mpRlBets");
            if (betsEl) {
                betsEl.innerHTML = (room.rBets || []).length === 0
                    ? '<span class="muted">Nenhuma aposta no giro.</span>'
                    : (room.rBets || []).map((b) =>
                        `<span class="bet-entry">${b.username}: ${b.type}${b.value != null ? " " + b.value : ""} — ${b.amount} AC</span>`
                    ).join("");
            }
            const lastEl = document.getElementById("mpRlLast");
            if (lastEl && room.rLast) {
                lastEl.textContent = `Último giro: ${room.rLast.number} (${colorName(room.rLast.color)}) — pagou ${ArcadiaWallet.format(room.rLast.totalPayout)}`;
            }
        }
    }

    function renderGameControls(room) {
        const area = $("gameArea");
        if (area.dataset.rendered === room.game) return;
        area.dataset.rendered = room.game;

        if (room.game === "dice") {
            area.innerHTML = `
                <div class="dice-big" id="mpDice">🎲</div>
                <div class="number-pick" id="mpNumbers"></div>
                <div class="bet-row">
                    <input type="number" id="mpBet" placeholder="Aposta (${room.minBet}-${room.maxBet})" min="${room.minBet}" max="${room.maxBet}">
                    <button class="btn btn-primary" id="mpPlay">Jogar</button>
                </div>
                <div class="game-result" id="mpResult"></div>
            `;
            const nums = $("mpNumbers");
            for (let i = 1; i <= 6; i++) {
                const b = document.createElement("button");
                b.textContent = i;
                b.addEventListener("click", () => {
                    selectedDice = i;
                    nums.querySelectorAll("button").forEach((x) => x.classList.remove("selected"));
                    b.classList.add("selected");
                });
                nums.appendChild(b);
            }
            $("mpPlay").addEventListener("click", () => {
                if (!selectedDice) return toastMsg("Escolha um número!");
                socket.emit("room:play", { wager: Number($("mpBet").value), choice: { number: selectedDice } }, (r) => {
                    if (!r.ok) toastMsg(r.error);
                });
            });
        } else if (room.game === "coinflip") {
            area.innerHTML = `
                <div class="dice-big" id="mpCoin">🪙</div>
                <div class="side-pick">
                    <button data-side="heads">👑 Cara</button>
                    <button data-side="tails">🦅 Coroa</button>
                </div>
                <div class="bet-row">
                    <input type="number" id="mpBet" placeholder="Aposta (${room.minBet}-${room.maxBet})" min="${room.minBet}" max="${room.maxBet}">
                    <button class="btn btn-primary" id="mpPlay">Jogar</button>
                </div>
                <div class="game-result" id="mpResult"></div>
            `;
            area.querySelectorAll(".side-pick button").forEach((b) => {
                b.addEventListener("click", () => {
                    selectedSide = b.dataset.side;
                    area.querySelectorAll(".side-pick button").forEach((x) => x.classList.remove("selected"));
                    b.classList.add("selected");
                });
            });
            $("mpPlay").addEventListener("click", () => {
                if (!selectedSide) return toastMsg("Escolha um lado!");
                socket.emit("room:play", { wager: Number($("mpBet").value), choice: { side: selectedSide } }, (r) => {
                    if (!r.ok) toastMsg(r.error);
                });
            });
        } else if (room.game === "roulette") {
            area.innerHTML = `
                <div class="rlm-last" id="mpRlLast">Façam suas apostas! 🎡</div>
                <div class="rlm-out">
                    <button data-rt="red" class="red">Vermelho 2x</button>
                    <button data-rt="black">Preto 2x</button>
                    <button data-rt="even">Par</button>
                    <button data-rt="odd">Ímpar</button>
                    <button data-rt="low">1-18</button>
                    <button data-rt="high">19-36</button>
                    <button data-rt="dozen1">1ª dz 3x</button>
                    <button data-rt="dozen2">2ª dz 3x</button>
                    <button data-rt="dozen3">3ª dz 3x</button>
                </div>
                <div class="rlm-nums" id="mpRlNums"></div>
                <div class="bet-row">
                    <input type="number" id="mpBet" value="100" min="${room.minBet}" max="${room.maxBet}">
                    <button class="btn btn-primary" id="mpSpin">🎰 Girar</button>
                </div>
                <div id="mpRlBets" class="rlm-bets"></div>
                <div class="game-result" id="mpResult"></div>
            `;
            const nums = area.querySelector("#mpRlNums");
            const REDSET = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
            for (let n = 0; n <= 36; n++) {
                const b = document.createElement("button");
                b.className = n === 0 ? "green" : REDSET.has(n) ? "red" : "black";
                b.textContent = n;
                b.dataset.rt = "straight";
                b.dataset.rv = n;
                nums.appendChild(b);
            }
            area.querySelectorAll("[data-rt]").forEach((b) => {
                b.addEventListener("click", () => {
                    socket.emit("room:rbet", {
                        type: b.dataset.rt,
                        value: b.dataset.rv != null ? Number(b.dataset.rv) : null,
                        amount: Number($("mpBet").value),
                    }, (r) => { if (!r.ok) toastMsg(r.error); });
                });
            });
            $("mpSpin").addEventListener("click", () => {
                socket.emit("room:rspin", {}, (r) => { if (!r.ok) toastMsg(r.error); });
            });
        } else if (room.game === "crash") {
            area.innerHTML = `
                <div class="dice-big" id="mpCrash">🚀</div>
                <div class="bet-row">
                    <input type="number" id="mpTarget" placeholder="Auto-cashout (ex: 2)" step="0.1" min="1.1">
                    <input type="number" id="mpBet" placeholder="Aposta" min="${room.minBet}" max="${room.maxBet}">
                    <button class="btn btn-primary" id="mpPlay">Decolar</button>
                </div>
                <div class="game-result" id="mpResult"></div>
            `;
            $("mpPlay").addEventListener("click", () => {
                socket.emit("room:play", {
                    wager: Number($("mpBet").value),
                    choice: { autoCashout: Number($("mpTarget").value) || 2 },
                }, (r) => {
                    if (!r.ok) toastMsg(r.error);
                });
            });
        }
    }

    function renderGameResult(round) {
        const el = $("mpResult");
        if (!el) return;
        el.className = "game-result " + round.outcome;
        if (round.type === "dice") {
            el.textContent = round.outcome === "win"
                ? `🎲 Caiu ${round.roll} — ${round.playerName} ganhou ${ArcadiaWallet.format(round.payout)}!`
                : `🎲 Caiu ${round.roll} — ${round.playerName} perdeu ${ArcadiaWallet.format(round.wager)}`;
            $("mpDice").textContent = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"][round.roll];
        } else if (round.type === "coinflip") {
            el.textContent = round.outcome === "win"
                ? `🪙 ${round.flip === "heads" ? "Cara" : "Coroa"} — ${round.playerName} ganhou ${ArcadiaWallet.format(round.payout)}!`
                : `🪙 ${round.flip === "heads" ? "Cara" : "Coroa"} — ${round.playerName} perdeu ${ArcadiaWallet.format(round.wager)}`;
            $("mpCoin").textContent = round.flip === "heads" ? "👑" : "🦅";
        } else if (round.type === "roulette") {
            el.textContent = round.payout > 0
                ? `🎡 Saiu ${round.number} (${colorName(round.color)}) — mesa pagou ${ArcadiaWallet.format(round.payout)}!`
                : `🎡 Saiu ${round.number} (${colorName(round.color)}) — sem prêmios dessa vez.`;
        } else if (round.type === "crash") {
            el.textContent = round.outcome === "win"
                ? `🚀 Cashout em ${round.multiplier}x — ${round.playerName} ganhou ${ArcadiaWallet.format(round.payout)}!`
                : `💥 Crash em ${round.crashPoint}x — ${round.playerName} perdeu ${ArcadiaWallet.format(round.wager)}`;
            $("mpCrash").textContent = round.outcome === "win" ? "🚀" : "💥";
        }
    }

    function renderRound(round) {
        const h = $("roundHistory");
        const div = document.createElement("div");
        div.className = "round-item " + round.outcome;
        const delta = round.outcome === "win" ? `+${ArcadiaWallet.format(round.payout - round.wager)}` : `-${ArcadiaWallet.format(round.wager)}`;
        div.innerHTML = `<span>${round.playerName}</span><span>${delta}</span>`;
        h.prepend(div);
    }

    function renderRoundHistory(room) {
        const h = $("roundHistory");
        h.innerHTML = "";
        [...room.history].reverse().forEach((r) => {
            const div = document.createElement("div");
            div.className = "round-item " + r.outcome;
            const delta = r.outcome === "win" ? `+${ArcadiaWallet.format(r.payout - r.wager)}` : `-${ArcadiaWallet.format(r.wager)}`;
            div.innerHTML = `<span>${r.playerName}</span><span>${delta}</span>`;
            h.appendChild(div);
        });
    }

    // ---------- AÇÕES ----------
    createRoomBtn.addEventListener("click", async () => {
        if (!requireLogin()) return;
        await connect();
        socket.emit("room:create", {
            name: $("roomName").value || undefined,
            game: $("roomGame").value,
            maxPlayers: Number($("roomMax").value),
            minBet: Number($("roomMin").value),
            maxBet: Number($("roomMaxBet").value),
        }, (r) => {
            if (r.ok) openRoom(r.room);
            else toastMsg(r.error);
        });
    });

    joinRoomBtn.addEventListener("click", async () => {
        if (!requireLogin()) return;
        await connect();
        socket.emit("room:join", { code: joinCodeInput.value }, (r) => {
            if (r.ok) openRoom(r.room);
            else toastMsg(r.error);
        });
    });

    function openRoom(room) {
        currentRoom = room;
        renderRoom(room);
        $("chatLog").innerHTML = "";
        roomModal.classList.add("active");
        refreshRoomsList();
    }

    $("leaveRoomBtn").addEventListener("click", () => {
        socket.emit("room:leave");
        roomModal.classList.remove("active");
        refreshRoomsList();
    });

    $("stakeBtn").addEventListener("click", () => {
        socket.emit("room:stake", { amount: Number($("stakeAmount").value) }, (r) => {
            if (r.ok) { toastMsg("Depositado no pote! 🎰"); $("stakeAmount").value = ""; ArcadiaWallet.refresh(); }
            else toastMsg(r.error);
        });
    });

    $("withdrawBtn").addEventListener("click", () => {
        socket.emit("room:withdraw", {}, (r) => {
            if (r.ok) { toastMsg("Stake sacado! 💸"); ArcadiaWallet.refresh(); }
            else toastMsg(r.error);
        });
    });

    $("chatSend").addEventListener("click", sendChat);
    $("chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
    function sendChat() {
        const input = $("chatInput");
        if (input.value.trim()) {
            socket.emit("room:chat", { message: input.value });
            input.value = "";
        }
    }

    $("copyCode").addEventListener("click", () => {
        if (currentRoom) {
            navigator.clipboard.writeText(currentRoom.code);
            toastMsg("Código copiado! 📋");
        }
    });

    // ---------- LISTA DE SALAS ----------
    function refreshRoomsList() {
        if (!socket || !socket.connected) return;
        socket.emit("rooms:list", (r) => {
            if (!r.ok) return;
            if (r.rooms.length === 0) {
                roomsList.innerHTML = '<p class="muted">Nenhuma sala aberta ainda.</p>';
                return;
            }
            roomsList.innerHTML = "";
            r.rooms.forEach((room) => {
                const div = document.createElement("div");
                div.className = "room-list-item";
                div.innerHTML = `<span>${room.name}</span><span class="muted">${room.players.length}/${room.maxPlayers} · ${ArcadiaWallet.format(room.pot)}</span>`;
                div.addEventListener("click", async () => {
                    await connect();
                    socket.emit("room:join", { code: room.code }, (rj) => {
                        if (rj.ok) openRoom(rj.room);
                        else toastMsg(rj.error);
                    });
                });
                roomsList.appendChild(div);
            });
        });
    }

    // ---------- INIT ----------
    async function init() {
        if (ArcadiaAPI.isLoggedIn()) {
            await ArcadiaWallet.refresh();
            $("walletBalance").textContent = ArcadiaWallet.format(ArcadiaWallet.getCached());
            await connect();
            refreshRoomsList();
        }
        document.addEventListener("arcadia:balance", (e) => {
            $("walletBalance").textContent = ArcadiaWallet.format(e.detail.balance);
        });
    }

    init();

    return { socket: () => socket, currentRoom: () => currentRoom };
})();
