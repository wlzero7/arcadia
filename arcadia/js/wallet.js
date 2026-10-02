// ========================================
// ARCADIA WALLET — server-backed (API) com cache local
// v1.0.4: fix do Number(null) — chave ausente no localStorage era
// lida como 0 AC (Number(null) = 0 passa no teste isFinite/>=0),
// fazendo o site mostrar "0 AC" e bloquear apostas com saldo fantasma.
// Agora: sem cache = dispara sincronização silenciosa com o servidor.
// ========================================

const ArcadiaWallet = (() => {

    const CACHE_KEY = "arcadia_wallet_balance";
    const DEMO_BALANCE = 50000; // saldo demo (não logado)

    function format(value) {
        const n = Number(value) || 0;
        return n.toLocaleString("pt-BR") + " AC";
    }

    function isLoggedIn() {
        return window.ArcadiaAPI && ArcadiaAPI.isLoggedIn();
    }

    function getCached() {
        const raw = localStorage.getItem(CACHE_KEY);

        // v1.0.4: null ou vazio = NUNCA houve cache — não é 0 AC!
        if (raw === null || raw === "") {
            if (isLoggedIn()) setTimeout(() => refresh(), 0);
            return DEMO_BALANCE;
        }

        const v = Number(raw);
        if (!Number.isFinite(v) || v < 0) return DEMO_BALANCE;

        // cache zerado com login ativo = suspeito (resposta antiga bugada)
        if (v === 0 && isLoggedIn()) {
            setTimeout(() => refresh(), 0);
        }
        return v;
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

    // Busca o saldo real do servidor (requer login) — fonte da verdade
    async function refresh() {
        if (!isLoggedIn()) return getCached();
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
