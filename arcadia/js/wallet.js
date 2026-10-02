// ========================================
// ARCADIA WALLET — server-backed (API) com cache local
// v0.9.7: listener global balanceUpdate — atualiza TODOS os elementos
// .wallet-balance / [data-wallet] com animação, roteando por kind
// (solo/coop/duel independentes). Carrega em todas as páginas via wallet.js.
// ========================================

const ArcadiaWallet = (() => {

    const CACHE_KEY = "arcadia_wallet_balance";

    function format(value) {
        const n = Number(value) || 0;
        return n.toLocaleString("pt-BR") + " AC";
    }

    function getCached() {
        const v = Number(localStorage.getItem(CACHE_KEY));
        return Number.isFinite(v) && v >= 0 ? v : 10000;
    }

    function setCached(value) {
        if (Number.isFinite(value) && value >= 0) {
            localStorage.setItem(CACHE_KEY, String(value));
        }
        document.dispatchEvent(
            new CustomEvent("arcadia:balance", { detail: { balance: value } })
        );
        return value;
    }

    // Busca o saldo real do servidor (requer login)
    async function refresh() {
        if (!window.ArcadiaAPI || !ArcadiaAPI.isLoggedIn()) return getCached();
        try {
            const data = await ArcadiaAPI.wallet();
            return setCached(data.balance);
        } catch (err) {
            console.warn("Wallet refresh:", err.message);
            return getCached();
        }
    }

    async function daily() {
        const data = await ArcadiaAPI.daily();
        await refresh();
        return data;
    }

    // ========================================
    // LISTENER GLOBAL balanceUpdate (v0.9.7)
    // ========================================

    // IDs legados mapeados por kind — páginas antigas continuam funcionando
    const LEGACY_IDS = {
        solo: ["walletBalance", "walletSolo"],
        coop: ["walletCoop"],
        duel: ["walletDuel"],
    };

    // CSS da animação (injetado uma vez)
    function injectStyles() {
        if (document.getElementById("arcadia-wallet-fx")) return;
        const style = document.createElement("style");
        style.id = "arcadia-wallet-fx";
        style.textContent = `
            .wallet-flash-up { animation: walletUp .7s ease; }
            .wallet-flash-down { animation: walletDown .7s ease; }
            @keyframes walletUp {
                0% { transform: scale(1); }
                35% { transform: scale(1.12); color: var(--success, #3ddc84); }
                100% { transform: scale(1); }
            }
            @keyframes walletDown {
                0% { transform: scale(1); }
                35% { transform: scale(1.08); color: var(--danger, #ff5c7c); }
                100% { transform: scale(1); }
            }
            @media (prefers-reduced-motion: reduce) {
                .wallet-flash-up, .wallet-flash-down { animation: none; }
            }
        `;
        document.head.appendChild(style);
    }

    // Encontra todos os elementos de UI de um kind
    function elementsFor(kind) {
        const found = new Set();
        document.querySelectorAll(`.wallet-balance[data-wallet="${kind}"]`).forEach((el) => found.add(el));
        document.querySelectorAll(`[data-wallet="${kind}"]`).forEach((el) => found.add(el));
        (LEGACY_IDS[kind] || []).forEach((id) => {
            const el = document.getElementById(id);
            if (el) found.add(el);
        });
        return [...found];
    }

    // Conta de valor antigo → novo com easing (respeita reduced-motion)
    function animateValue(el, from, to) {
        const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduced || from === to) {
            el.textContent = format(to);
            return;
        }
        const duration = 650;
        const start = performance.now();
        function frame(now) {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
            const current = Math.round(from + (to - from) * eased);
            el.textContent = format(current);
            if (t < 1) requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    function updateWalletUI(kind, balance, delta) {
        const els = elementsFor(kind);
        els.forEach((el) => {
            const parsed = Number(String(el.textContent).replace(/\./g, "").replace(/[^\d-]/g, ""));
            const from = Number.isFinite(parsed) ? parsed : balance;
            animateValue(el, from, balance);
            el.classList.remove("wallet-flash-up", "wallet-flash-down");
            void el.offsetWidth; // força reflow pra reiniciar a animação
            el.classList.add(delta >= 0 ? "wallet-flash-up" : "wallet-flash-down");
            setTimeout(() => el.classList.remove("wallet-flash-up", "wallet-flash-down"), 750);
        });
    }

    function setupBalanceSocket() {
        injectStyles();
        if (!window.ArcadiaAPI || !ArcadiaAPI.isLoggedIn()) return;
        if (window.__arcadiaBalanceSocket) return; // nunca dois listeners

        const start = () => {
            try {
                const socket = io(window.API_URL, {
                    auth: { token: ArcadiaAPI.getToken() },
                    transports: ["websocket", "polling"],
                });
                window.__arcadiaBalanceSocket = socket;

                socket.on("balanceUpdate", ({ kind, balance, delta }) => {
                    if (!Number.isFinite(balance)) return;
                    // solo sincroniza o cache global + evento legado
                    if (kind === "solo") setCached(balance);
                    updateWalletUI(kind, balance, delta);
                });
            } catch (err) {
                console.warn("Balance socket:", err.message);
            }
        };

        if (typeof io !== "undefined") {
            start();
        } else {
            // injeta o cliente Socket.IO se a página não tiver
            const s = document.createElement("script");
            s.src = "https://cdn.socket.io/4.7.5/socket.io.min.js";
            s.onload = start;
            document.head.appendChild(s);
        }
    }

    return { format, getCached, setCached, refresh, daily, setupBalanceSocket };
})();

// ativa o listener global em todas as páginas que carregam wallet.js
ArcadiaWallet.setupBalanceSocket();
