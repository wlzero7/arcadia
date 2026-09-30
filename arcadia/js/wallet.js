// ========================================
// ARCADIA WALLET — server-backed (API) com cache local
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

    return { format, getCached, setCached, refresh, daily };
})();
