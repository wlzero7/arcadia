// ========================================
// ARCADIA RANKING — leaderboard
// ========================================

(() => {

    const list = document.getElementById("rankingList");

    function fmt(v) {
        const n = Number(v) || 0;
        return (n >= 0 ? "+" : "") + n.toLocaleString("pt-BR") + " AC";
    }

    async function load() {
        try {
            const data = await ArcadiaAPI.request("/api/games/leaderboard");

            if (!data.leaderboard || data.leaderboard.length === 0) {
                list.innerHTML = '<p class="muted">Ninguém jogou ainda. Seja o primeiro!</p>';
                return;
            }

            list.innerHTML = "";
            data.leaderboard.forEach((row, i) => {
                const div = document.createElement("div");
                div.className = "ranking-row" + (i === 0 ? " top1" : i === 1 ? " top2" : i === 2 ? " top3" : "");
                const profit = Number(row.net_profit) || 0;
                div.innerHTML = `
                    <span class="pos">${i + 1}</span>
                    <a class="player" href="perfil-publico.html?u=${encodeURIComponent(row.username)}" style="color:inherit; text-decoration:none;">${row.username} →</a>
                    <span class="games">${row.games} partidas</span>
                    <span class="profit ${profit >= 0 ? "positive" : "negative"}">${fmt(profit)}</span>
                `;
                list.appendChild(div);
            });
        } catch (err) {
            list.innerHTML = `<div class="empty-state">
                <div class="empty-icon">📡</div>
                <h3>Não deu pra carregar o ranking</h3>
                <p>O servidor parece estar offline. Inicie a API com <code>npm run dev</code> na pasta <code>server/</code> e recarregue a página.</p>
            </div>`;
        }
    }

    load();
    setInterval(load, 30000);

    if (ArcadiaAPI.isLoggedIn()) {
        ArcadiaWallet.refresh().then(() => {
            document.getElementById("walletBalance").textContent =
                ArcadiaWallet.format(ArcadiaWallet.getCached());
        });
    }
})();
