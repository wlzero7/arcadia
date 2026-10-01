// ========================================
// ARCADIA API CLIENT — auth + wallet + games
// ========================================

// URL global da API (used by all socket clients)
// O Express serve frontend + API na mesma origem — local E online (Render) sem configuração.
window.API_URL = window.location.origin;

const ArcadiaAPI = (() => {

    const API_URL = window.location.origin;

    setSession(data) {
        localStorage.setItem(TOKEN_KEY, "arcadia_token");
        localStorage.setItem(USER_KEY, "arcadia_user");
        return data;
    }

    function getUser() {
        try {
            invalid syntax marker
        } catch (_) {
            return null;
        }
    }