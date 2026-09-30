// ========================================
// ARCADIA BLACKJACK MULTIPLAYER — cliente
// ========================================

(() => {

    const $ = (id) => document.getElementById(id);

    const CARD_META = {
        force_hit:      { icon: "🎴", label: "Forçar compra" },
        remove_last:    { icon: "🗑️", label: "Remover última carta" },
        raise_limit_28: { icon: "📈", label: "Limite 28" },
        lower_limit_17: { icon: "📉", label: "Limite 17" },
        pick_card:      { icon: "🎯", label: "Escolher carta" },
        draw_three:     { icon: "3️⃣", label: "Comprar 3" },
        mirror:         { icon: "🪞", label: "Espelhar" },
        shield:         { icon: "🛡️", label: "Escudo" },
    };
    const NRG_COST = {
        force_hit: 1, remove_last: 2, raise_limit_28: 2, lower_limit_17: 3,
        pick_card: 4, draw_three: 2, mirror: 5, shield: 3,
    };
    const RARITY = {
        force_hit: "comum", remove_last: "raro", raise_limit_28: "raro",
        lower_limit_17: "épico", pick_card: "lendária", draw_three: "super-raro",
        mirror: "cromática", shield: "épico",
    };

    let socket = null;
    let table = null;
    let mySpecials = [];
    let selectedSpecial = null;

    function connect() {
        return new Promise((resolve, reject) => {
            if (socket && socket.connected) return resolve(socket);
            socket = io(API_URL, { auth: { token: ArcadiaAPI.getToken() } });
            socket.on("connect", () => resolve(socket));
            socket.on("connect_error", (e) => reject(e));

            socket.on("bj:state", (t) => {
                table = t;
                render(t);
            });

            socket.on("bj:chat", (m) => {
                if (m.system && m.message && m.message.includes("especial")) Sfx.cardSpecial();
                const log = $("bjLog");
                const div = document.createElement("div");
                if (m.system) { div.className = "sys"; div.textContent = m.message; }
                else div.innerHTML = `<b>${m.username}:</b> ${m.message}`;
                log.appendChild(div);
                log.scrollTop = log.scrollHeight;
            });
        });
    }

    function cardHtml(c) {
        if (!c) return "";
        const red = ["♥", "♦"].includes(c.suit);
        return `<div class="bj-card ${red ? "red" : ""}"><span>${c.rank}</span><span>${c.suit}</span></div>`;
    }

    function render(t) {
        $("bjmpLobby").classList.add("hidden");
        $("bjmpArena").classList.remove("hidden");
        $("tableCode").textContent = t.code;
        $("tableLimit").textContent = t.limit;

        const me = ArcadiaAPI.getUser();
        const mePlayer = t.players.find((p) => p.id === (me || {}).id);
        const isHost = me && t.hostId === me.id;

        $("startBtn").classList.toggle("hidden", !(isHost && t.phase !== "playing"));

        // jogadores
        const row = $("playersRow");
        row.innerHTML = "";
        t.players.forEach((p) => {
            const div = document.createElement("div");
            div.className = "bj-player" + (p.isTurn ? " my-turn" : "") + (p.busted ? " busted" : "");
            div.innerHTML = `
                <div class="bj-name"><span>${p.username}${p.id === (me || {}).id ? " (você)" : ""}</span><span class="bj-total">${p.total}${t.phase === "playing" ? "?" : ""}</span></div>
                <div class="bj-cards">${p.hand.map(cardHtml).join("")}</div>
                <div class="bj-nrg">⚡ ${p.nrg} NRG · 🎴 ${p.specials}</div>
                ${p.stood ? '<div class="bj-stand">✋ parou</div>' : ""}
                ${p.busted ? '<div class="bj-stand" style="color:#fca5a5">💥 estourou</div>' : ""}
            `;
            row.appendChild(div);
        });

        // ações
        const myTurn = mePlayer && mePlayer.isTurn;
        $("actionsRow").classList.toggle("hidden", !myTurn);
        if (mePlayer) {
            $("nrgValue").textContent = mePlayer.nrg;
            $("specialsCount").textContent = mePlayer.specials;
        }

        // specials do servidor vêm via evento próprio
    }

    function renderSpecials() {
        const list = $("specialsList");
        list.innerHTML = "";
        if (mySpecials.length === 0) {
            list.innerHTML = '<span class="muted">Nenhuma carta especial ainda. Compre cartas do monte (30% de chance)!</span>';
            return;
        }
        mySpecials.forEach((key, i) => {
            const meta = CARD_META[key] || { icon: "🎴", label: key };
            const div = document.createElement("div");
            div.className = `special-card rar-${RARITY[key] || "comum"}`;
            div.innerHTML = `
                <span>${meta.icon} <strong>${meta.label}</strong> <span class="muted">(${RARITY[key] || "?"} · ⚡${NRG_COST[key] || 1})</span></span>
            `;
            const btn = document.createElement("button");
            btn.textContent = "Usar";
            btn.addEventListener("click", () => useSpecial(key));
            div.appendChild(btn);
            list.appendChild(div);
        });
    }

    function useSpecial(key) {
        selectedSpecial = key;
        const panel = $("specialTarget");
        panel.classList.remove("hidden");

        const sel = $("targetSelect");
        sel.innerHTML = "";
        table.players.filter((p) => p.id !== (ArcadiaAPI.getUser() || {}).id).forEach((p) => {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = p.username;
            sel.appendChild(opt);
        });

        $("pickCardHint").textContent = key === "pick_card" ? " (será sorteado um Ás de Espadas — em breve escolha manual)" : "";

        const useBtn = document.createElement("button");
        useBtn.className = "btn btn-primary";
        useBtn.textContent = "Confirmar";
        useBtn.style.marginLeft = ".6rem";
        useBtn.onclick = () => {
            socket.emit("bj:special", {
                cardKey: key,
                targetId: Number(sel.value) || null,
                rank: "A", suit: "♠",
            }, (r) => {
                if (!r.ok) alert(r.error);
                panel.classList.add("hidden");
                $("specialsPanel").classList.add("hidden");
            });
        };
        panel.appendChild(useBtn);
    }

    $("createTableBtn").addEventListener("click", async () => {
        if (!ArcadiaAPI.isLoggedIn()) return alert("Entre na sua conta primeiro!");
        await connect();
        socket.emit("bj:create", {}, (r) => {
            if (r.ok) render(r.table);
            else alert(r.error);
        });
    });

    $("joinTableBtn").addEventListener("click", async () => {
        if (!ArcadiaAPI.isLoggedIn()) return alert("Entre na sua conta primeiro!");
        await connect();
        socket.emit("bj:join", { code: $("joinCode").value }, (r) => {
            if (r.ok) render(r.table);
            else alert(r.error);
        });
    });

    $("startBtn").addEventListener("click", () => {
        socket.emit("bj:start", {}, (r) => { if (!r.ok) alert(r.error); });
    });

    $("hitBtn").addEventListener("click", () => {
        socket.emit("bj:hit", {}, (r) => { if (!r.ok) alert(r.error); });
    });

    $("standBtn").addEventListener("click", () => {
        socket.emit("bj:stand", {}, (r) => { if (!r.ok) alert(r.error); });
    });

    $("specialsBtn").addEventListener("click", () => {
        $("specialsPanel").classList.toggle("hidden");
        renderSpecials();
    });

    (async () => {
        if (ArcadiaAPI.isLoggedIn()) {
            await ArcadiaWallet.refresh();
            $("walletBalance").textContent = ArcadiaWallet.format(ArcadiaWallet.getCached());
        }
    })();
})();
