// ========================================
// ARCADIA API CLIENT — auth + wallet + games
// ========================================

// URL global da API (usada por todos os clientes socket)
// O Express serve frontend + API na mesma origem — local E online (Render) sem configuração.
window.API_URL = window.location.origin;

const ArcadiaAPI = (() => {

    const API_URL = window.location.origin;

    const TOKEN_KEY = "arcadia_token";
    const USER_KEY = "arcadia_user";

    function getToken() {
        return localStorage.getItem(TOKEN_KEY);
    }

    function setSession(data) {
        localStorage.setItem(TOKEN_KEY, data.token);
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    }

    function getUser() {
        try {
            return JSON.parse(localStorage.getItem(USER_KEY));
        } catch (_) {
            return null;
        }
    }

    function isLoggedIn() {
        return !!getToken();
    }

    function logout() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem("arcadia_wallet_balance");
    }

    async function request(path, options = {}) {
        const headers = {
            "Content-Type": "application/json",
            ...(options.headers || {}),
        };
        const token = getToken();
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }
        const response = await fetch(`${API_URL}${path}`, {
            ...options,
            headers,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.message || `Erro ${response.status}`);
        }
        return data;
    }

    return {
        getToken,
        getUser,
        isLoggedIn,
        setSession,
        logout,
        request,

        register: (username, email, password) =>
            request("/api/auth/register", { method: "POST", body: JSON.stringify({ username, email, password }) })
                .then(setSession),

        login: (email, password) =>
            request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) })
                .then(setSession),

        me: () => request("/api/auth/me"),

        play: (game, wager, choice) =>
            request(`/api/games/${game}/play`, { method: "POST", body: JSON.stringify({ wager, choice }) }),

        wallet: () => request("/api/wallet"),

        transactions: () => request("/api/wallet/transactions"),

        daily: () => request("/api/wallet/daily", { method: "POST" }),

        transfer: (toUsername, amount) =>
            request("/api/wallet/transfer", { method: "POST", body: JSON.stringify({ toUsername, amount }) }),

        history: () => request("/api/games/history"),

        stats: () => request("/api/games/stats"),
    };
})();
