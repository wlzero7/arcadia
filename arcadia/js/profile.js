// ========================================
// ARCADIA - PERFIL v0.9.5 — level, avatar, carteiras, conquistas, missões
// Amigos v0.9.5: favoritos + convites para duelo/coop em tempo real
// ========================================
(() => {
    const $ = (id) => document.getElementById(id);
    const AVATARS = ["🎰", "🎲", "🃏", "💣", "🚀", "🎡", "🐎", "👑", "🦊", "🐺", "🦁", "🐸", "🦅", "🐉", "🤖", "👽"];
    const KIND_LABEL = {
        bet: "Aposta", payout: "Prêmio", daily_bonus: "Bônus diário",
        room_stake: "Depósito em sala", room_payout: "Saque de sala", room_refund: "Reembolso",
        transfer_in: "Transferência recebida", transfer_out: "Transferência enviada",
    };
    function fmt(v) { return (Number(v) || 0).toLocaleString("pt-BR") + " AC"; }
    // ---------- SESSÃO / LEVEL ----------
    async function loadMe() {
        const data = await ArcadiaAPI.request("/api/auth/me");
        const u = data.user;
        $("profileAvatar").textContent = u.avatar;
        $("profileName").textContent = u.displayName;
        $("profileUsername").textContent = "@" + u.username;
        $("profileLevel").textContent = "Lv " + u.level;
        const xpNext = Math.floor(100 * Math.pow(u.level, 1.5));
        const pct = Math.min(100, Math.round((u.xp / xpNext) * 100));
        $("xpBar").style.width = pct + "%";
        $("xpText").textContent = `${u.xp} / ${xpNext} XP`;
        $("walletSolo").textContent = ArcadiaWallet.format(data.wallets.solo || 0);
        $("walletCoop").textContent = ArcadiaWallet.format(data.wallets.coop || 0);
        $("walletDuel").textContent = ArcadiaWallet.format(data.wallets.duel || 0);
        $("walletBalance").textContent = ArcadiaWallet.format(data.wallets.solo || 0);
        return u;
    }
    // ---------- EDITAR AVATAR ----------
    function renderAvatarPicker() {
        const picker = $("avatarPicker");
        AVATARS.forEach((a) => {
            const b = document.createElement("button");
            b.className = "avatar-option";
            b.textContent = a;
            b.addEventListener("click", async () => {
                await ArcadiaAPI.request("/api/auth/profile", { method: "PATCH", body: JSON.stringify({ avatar: a }) });
                $("profileAvatar").textContent = a;
                picker.classList.add("hidden");
            });
            picker.appendChild(b);
        });
        $("editAvatarBtn").addEventListener("click", () => picker.classList.toggle("hidden"));
    }
    // ---------- CONQUISTAS ----------
    async function loadAchievements() {
        const data = await ArcadiaAPI.request("/api/progression/achievements");
        const list = $("achievementsList");
        list.innerHTML = "";
        data.achievements.forEach((a) => {
            const div = document.createElement("div");
            div.className = "achieve " + (a.unlocked ? "unlocked" : "locked");
            div.innerHTML = `<span class="achieve-icon">${a.unlocked ? "🏆" : "🔒"}</span><span>${a.key}</span><span class="achieve-xp">+${a.xp} XP</span>`;
            list.appendChild(div);
        });
    }
    // ---------- MISSÕES ----------
    async function loadMissions() {
        const data = await ArcadiaAPI.request("/api/progression/missions");
        const daily = $("missionsDaily");
        const weekly = $("missionsWeekly");
        daily.innerHTML = "";
        weekly.innerHTML = "";
        data.missions.forEach((m) => {
            const div = document.createElement("div");
            div.className = "mission" + (m.completed ? " done" : "");
            const pct = Math.min(100, Math.round((m.progress / m.target) * 100));
            div.innerHTML = `
                <div class="mission-head">
                    <span>${m.desc}</span>
                    <span class="mission-xp">+${m.xp} XP</span>
                </div>
                <div class="mission-bar"><div style="width:${pct}%"></div></div>
                <div class="mission-foot">
                    <span class="muted">${m.progress}/${m.target}</span>
                    <button class="btn btn-primary claim-btn" ${m.completed && !m.claimed ? "" : "disabled"}>Resgatar</button>
                </div>
            `;
            div.querySelector(".claim-btn").addEventListener("click", async () => {
                await ArcadiaAPI.request("/api/progression/missions/claim", { method: "POST", body: JSON.stringify({ missionKey: m.key }) });
                loadMissions();
                loadMe();
            });
            (m.period === "weekly" ? weekly : daily).appendChild(div);
        });
    }
    // ---------- ESTATÍSTICAS COMPLETAS (v0.9.3) ----------
    const GAME_ICON = {
        dice: "🎲", coinflip: "🪙", mines: "💣", crash: "🚀",
        blackjack: "🃏", roulette: "🎡", racing: "🐎",
    };
    function fmt(v) { return (Number(v) || 0).toLocaleString("pt-BR") + " AC"; }
    function signed(v) { const n = Number(v) || 0; return (n >= 0 ? "+" : "") + fmt(n); }
    async function loadFullStats() {
        try {
            const data = await ArcadiaAPI.request("/api/games/stats/full");
            const s = data.stats;
            // herói
            const netEl = $("stNetBig");
            netEl.textContent = signed(s.net);
            netEl.className = "stat-big " + (s.net >= 0 ? "pos" : "neg");
            // grid
            $("stCoins").textContent = fmt((s.wallets.solo || 0) + (s.wallets.coop || 0) + (s.wallets.duel || 0));
            $("stWinsBig").textContent = s.wins;
            $("stLossesBig").textContent = s.losses;
            $("stWagered").textContent = fmt(s.totalWagered);
            $("stBestRound").textContent = s.bestRound ? signed(s.bestRound.profit) : "—";
            $("stWorstRound").textContent = s.worstRound ? signed(s.worstRound.profit) : "—";
            $("stBestGame").textContent = s.bestGame ? `${GAME_ICON[s.bestGame.game] || "🎮"} ${s.bestGame.game} (${signed(s.bestGame.net)})` : "—";
            $("stMostPlayed").textContent = s.mostPlayed ? `${GAME_ICON[s.mostPlayed.game] || "🎮"} ${s.mostPlayed.game} (${s.mostPlayed.games}x)` : "—";
            $("stLeastPlayed").textContent = s.leastPlayed ? `${GAME_ICON[s.leastPlayed.game] || "🎮"} ${s.leastPlayed.game} (${s.leastPlayed.games}x)` : "—";
            $("stAch").textContent = s.achievementsUnlocked;
            $("stDuelWins").textContent = s.duel.wins;
            $("stMpWins").textContent = s.multiplayer.rouletteWins;
            // por jogo com barras
            const bg = $("statsByGame");
            bg.innerHTML = "";
            if (!s.byGame.length) {
                bg.innerHTML = '<span class="muted">Jogue sua primeira partida para ver estatísticas por jogo!</span>';
                return;
            }
            const maxGames = Math.max(...s.byGame.map((g) => g.games));
            s.byGame.forEach((g) => {
                const div = document.createElement("div");
                div.className = "bygame-row";
                div.innerHTML = `
                    <span class="bg-name">${GAME_ICON[g.game] || "🎮"} ${g.game}</span>
                    <div class="bg-bar"><div style="width:${Math.round((g.games / maxGames) * 100)}%"></div></div>
                    <span>${g.games} rodadas</span>
                    <span class="bg-net ${g.net >= 0 ? "pos" : "neg"}">${signed(g.net)}</span>
                `;
                bg.appendChild(div);
            });
        } catch (err) {
            console.warn("stats:", err.message);
        }
    }
    // ---------- STATS + EXTRATO ----------
    async function loadStats() {
        const data = await ArcadiaAPI.request("/api/games/stats");
        $("stGames").textContent = data.stats.total_games || 0;
        $("stWins").textContent = data.stats.total_wins || 0;
        const net = Number(data.stats.net) || 0;
        $("stNet").textContent = (net >= 0 ? "+" : "") + fmt(net);
        $("stNet").style.color = net >= 0 ? "var(--success)" : "var(--danger)";
    }
    async function loadTx() {
        const data = await ArcadiaAPI.request("/api/wallet/transactions");
        const list = $("txList");
        list.innerHTML = "";
        data.transactions.slice(0, 30).forEach((tx) => {
            const div = document.createElement("div");
            div.className = "tx-item";
            const positive = tx.amount >= 0;
            div.innerHTML = `
                <span class="when">${tx.created_at}</span>
                <span class="kind">${KIND_LABEL[tx.kind] || tx.kind}</span>
                <span class="amount ${positive ? "positive" : "negative"}">${positive ? "+" : ""}${fmt(tx.amount)}</span>
            `;
            list.appendChild(div);
        });
    }
    // ---------- AMIGOS (v0.9.5: favoritos + convites) ----------
    async function loadFriends() {
        const data = await ArcadiaAPI.request("/api/friends");
        const reqBox = $("friendRequests");
        reqBox.innerHTML = "";
        data.requests.forEach((r) => {
            const div = document.createElement("div");
            div.className = "friend-request";
            div.innerHTML = `<span>${r.username} quer ser seu amigo</span>`;
            const btn = document.createElement("button");
            btn.className = "btn btn-primary";
            btn.textContent = "Aceitar";
            btn.style.padding = ".3rem .8rem";
            btn.addEventListener("click", async () => {
                await ArcadiaAPI.request("/api/friends/accept", { method: "POST", body: JSON.stringify({ requestId: r.from_id }) });
                loadFriends();
            });
            div.appendChild(btn);
            reqBox.appendChild(div);
        });

        const list = $("friendsList");
        list.innerHTML = "";
        if (data.friends.length === 0) {
            list.innerHTML = '<li class="muted">Nenhum amigo ainda.</li>';
            return;
        }

        // favoritos primeiro, depois alfabético
        const sorted = data.friends.slice()
            .sort((a, b) => (b.favorite - a.favorite) || a.username.localeCompare(b.username));

        sorted.forEach((f) => {
            const li = document.createElement("li");
            li.style.display = "flex";
            li.style.alignItems = "center";
            li.style.gap = ".4rem";
            li.style.flexWrap = "wrap";

            const name = document.createElement("span");
            name.textContent = (f.favorite ? "⭐ " : "") + "👤 " + f.username;
            name.style.flex = "1";
            name.style.cursor = "pointer";
            name.title = "Ver perfil público";
            name.addEventListener("click", () => {
                window.location.href = "perfil-publico.html?u=" + encodeURIComponent(f.username);
            });
            li.appendChild(name);

            const favBtn = document.createElement("button");
            favBtn.className = "remove-btn";
            favBtn.textContent = "⭐";
            favBtn.title = f.favorite ? "Remover dos favoritos" : "Favoritar";
            favBtn.addEventListener("click", async () => {
                await ArcadiaAPI.request("/api/friends/favorite", { method: "POST", body: JSON.stringify({ friendId: f.id }) });
                loadFriends();
            });
            li.appendChild(favBtn);

            const duelBtn = document.createElement("button");
            duelBtn.className = "remove-btn";
            duelBtn.textContent = "⚔️";
            duelBtn.title = "Convidar para duelo x1";
            duelBtn.addEventListener("click", async () => {
                try {
                    const inv = await ArcadiaAPI.request("/api/friends/invite", { method: "POST", body: JSON.stringify({ username: f.username, kind: "duel" }) });
                    alert(`Convite de DUELO enviado! Código: ${inv.code}`);
                } catch (err) { alert(err.message); }
            });
            li.appendChild(duelBtn);

            const coopBtn = document.createElement("button");
            coopBtn.className = "remove-btn";
            coopBtn.textContent = "🤝";
            coopBtn.title = "Convidar para sala coop";
            coopBtn.addEventListener("click", async () => {
                try {
                    const inv = await ArcadiaAPI.request("/api/friends/invite", { method: "POST", body: JSON.stringify({ username: f.username, kind: "coop" }) });
                    alert(`Convite de SALA enviado! Código: ${inv.code}`);
                } catch (err) { alert(err.message); }
            });
            li.appendChild(coopBtn);

            const btn = document.createElement("button");
            btn.className = "remove-btn";
            btn.textContent = "remover";
            btn.addEventListener("click", async () => {
                await ArcadiaAPI.request("/api/friends/remove", { method: "POST", body: JSON.stringify({ friendId: f.id }) });
                loadFriends();
            });
            li.appendChild(btn);

            list.appendChild(li);
        });
    }
    $("addFriendBtn").addEventListener("click", async () => {
        try {
            await ArcadiaAPI.request("/api/friends/request", { method: "POST", body: JSON.stringify({ username: $("friendUsername").value }) });
            $("friendUsername").value = "";
            loadFriends();
        } catch (err) { alert(err.message); }
    });
    // ---------- CONVITES EM TEMPO REAL (Socket.IO) ----------
    (function setupInvites() {
        const s = document.createElement("script");
        s.src = "https://cdn.socket.io/4.7.5/socket.io.min.js";
        s.onload = () => {
            const socket = io(window.API_URL, {
                auth: { token: ArcadiaAPI.getToken() },
                transports: ["websocket", "polling"],
            });
            socket.on("friend:invite", (inv) => {
                const kind = inv.kind === "duel" ? "Duelo x1" : "Sala coop";
                if (confirm(`🎮 ${inv.from} convidou você para ${kind}!\nCódigo: ${inv.code}\n\nAceitar agora?`)) {
                    try { navigator.clipboard.writeText(inv.code); } catch (_) {}
                    const page = inv.kind === "duel" ? "duel.html" : "rooms.html";
                    window.location.href = page + "?code=" + encodeURIComponent(inv.code);
                }
            });
        };
        document.head.appendChild(s);
    })();
    $("logoutBtn").addEventListener("click", () => {
        ArcadiaAPI.logout();
        window.location.href = "index.html";
    });
    // ---------- GATE: precisa estar logado ----------
    function renderLoginGate() {
        document.querySelector(".profile-main").innerHTML = `
            <div class="auth-required">
                <div class="auth-required-icon">🔒</div>
                <h2>Ops! Essa área é só para membros</h2>
                <p>Crie sua conta grátis ou faça login para ver seu perfil, estatísticas, conquistas e missões.</p>
                <div class="auth-required-actions">
                    <a href="index.html" class="btn btn-primary">Entrar / Criar conta</a>
                </div>
                <p class="muted">É rápido — e você já começa com <strong>10.000 AC</strong> de bônus. 🎁</p>
            </div>
        `;
    }
    // ---------- INIT ----------
    (async function init() {
        if (!ArcadiaAPI.isLoggedIn()) {
            renderLoginGate();
            return;
        }
        try {
            renderAvatarPicker();
            await loadMe();
            loadAchievements();
            loadMissions();
            loadStats();
            loadFullStats();
            loadTx();
            loadFriends();
        } catch (err) {
            // token inválido/expirado
            ArcadiaAPI.logout();
            renderLoginGate();
        }
    })();
})();
