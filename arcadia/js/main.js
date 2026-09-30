// ========================================
// ARCADIA - MAIN JAVASCRIPT
// ========================================


// ========================================
// CONFIG
// ========================================

const API_URL =
    window.API_URL || window.location.origin;


// ========================================
// ELEMENTOS
// ========================================

// ELEMENTOS

const authModal = document.getElementById("authModal");

const loginButton =
    document.getElementById("loginButton");

const registerButton =
    document.getElementById("registerButton");

const closeModalButton =
    document.getElementById("closeModal");

const authForm =
    document.getElementById("authForm");

const authTitle =
    document.getElementById("authTitle");

const authDescription =
    document.getElementById("authDescription");

const authSubmit =
    document.getElementById("authSubmit");

const usernameGroup =
    document.getElementById("usernameGroup");

const confirmPasswordGroup =
    document.getElementById("confirmPasswordGroup");

const usernameInput =
    document.getElementById("username");

const emailInput =
    document.getElementById("email");

const passwordInput =
    document.getElementById("password");

const confirmPasswordInput =
    document.getElementById("confirmPassword");

const switchText =
    document.getElementById("switchText");

const switchMode =
    document.getElementById("switchMode");

const formMessage =
    document.getElementById("formMessage");


// ========================================
// STATE
// ========================================

let authMode = "login";


// ========================================
// MODAL
// ========================================

function openModal(mode) {

    authMode = mode;

    updateAuthInterface();

    authModal.classList.add("active");

    document.body.style.overflow = "hidden";

    emailInput.focus();
}


function closeModal() {

    authModal.classList.remove("active");

    document.body.style.overflow = "";

    authForm.reset();

    formMessage.textContent = "";
}


// ========================================
// LOGIN / REGISTER INTERFACE
// ========================================

function updateAuthInterface() {

    formMessage.textContent = "";

    if (authMode === "login") {

        authTitle.textContent =
            "Bem-vindo de volta";

        authDescription.textContent =
            "Entre na sua conta para continuar.";

        authSubmit.textContent =
            "Entrar";

        usernameGroup.hidden = true;

        confirmPasswordGroup.hidden = true;

        usernameInput.required = false;

        confirmPasswordInput.required = false;

        passwordInput.autocomplete =
            "current-password";

        switchText.textContent =
            "Ainda não possui uma conta?";

        switchMode.textContent =
            "Criar conta";

    } else {

        authTitle.textContent =
            "Crie sua conta";

        authDescription.textContent =
            "Entre para o universo do Arcadia.";

        authSubmit.textContent =
            "Criar conta";

        usernameGroup.hidden = false;

        confirmPasswordGroup.hidden = false;

        usernameInput.required = true;

        confirmPasswordInput.required = true;

        passwordInput.autocomplete =
            "new-password";

        switchText.textContent =
            "Já possui uma conta?";

        switchMode.textContent =
            "Entrar";
    }
}


// ========================================
// EVENTS
// ========================================

loginButton.addEventListener(
    "click",
    () => openModal("login")
);


registerButton.addEventListener(
    "click",
    () => openModal("register")
);


closeModalButton.addEventListener(
    "click",
    closeModal
);


switchMode.addEventListener(
    "click",
    () => {

        authMode =
            authMode === "login"
                ? "register"
                : "login";

        authForm.reset();

        updateAuthInterface();
    }
);


// Clicar fora fecha o modal

authModal.addEventListener(
    "click",
    (event) => {

        if (event.target === authModal) {
            closeModal();
        }

    }
);


// ESC fecha o modal

document.addEventListener(
    "keydown",
    (event) => {

        if (
            event.key === "Escape" &&
            authModal.classList.contains("active")
        ) {

            closeModal();

        }

    }
);


// ========================================
// AUTH FORM
// ========================================

authForm.addEventListener("submit", async (event) => {

    event.preventDefault();
    formMessage.textContent = "";

    try {
        authSubmit.disabled = true;
        authSubmit.textContent = authMode === "login" ? "Entrando..." : "Criando...";

        let data;
        if (authMode === "login") {
            data = await ArcadiaAPI.login(emailInput.value, passwordInput.value);
        } else {
            data = await ArcadiaAPI.register(usernameInput.value, emailInput.value, passwordInput.value);
        }

        formMessage.style.color = "var(--success)";
        formMessage.textContent = data.message || "Sucesso!";

        setTimeout(() => {
            closeModal();
            window.location.reload();
        }, 600);

    } catch (error) {
        formMessage.style.color = "var(--danger)";
        formMessage.textContent = error.message;
    } finally {
        authSubmit.disabled = false;
        authSubmit.textContent = authMode === "login" ? "Entrar" : "Criar conta";
    }
});

// ========================================
// WALLET PREVIEW
// ========================================

const homeWalletBalance =
    document.getElementById("homeWalletBalance");

function updateHomeWallet() {

    if (!homeWalletBalance) {
        return;
    }

    const balance =
        ArcadiaWallet.getCached();

    homeWalletBalance.textContent =
        ArcadiaWallet.format(balance);
}

updateHomeWallet();
// ========================================
// ARCADIA API
// ========================================

const apiStatusDot =
    document.getElementById("apiStatusDot");

const apiStatusText =
    document.getElementById("apiStatusText");


async function checkApiStatus() {

    try {

        const response =
            await fetch(
                `${API_URL}/api/health`
            );


        if (!response.ok) {

            throw new Error(
                `HTTP ${response.status}`
            );

        }


        const data =
            await response.json();


        apiStatusDot.classList.add(
            "online"
        );

        apiStatusDot.classList.remove(
            "offline"
        );


        apiStatusText.textContent =
            `${data.application} online • ${data.version}`;


        console.log(
            "Resposta da API:",
            data
        );


    } catch (error) {

        apiStatusDot.classList.add(
            "offline"
        );

        apiStatusDot.classList.remove(
            "online"
        );


        apiStatusText.textContent =
            "Arcadia API offline";


        console.error(
            "Erro ao conectar com a API:",
            error
        );

    }

}



// ========================================
// SESSÃO — UI do header
// ========================================

function renderSessionUI() {
    const navActions = document.querySelector(".nav-actions");
    if (!navActions) return;

    if (ArcadiaAPI.isLoggedIn()) {
        const user = ArcadiaAPI.getUser();
        navActions.innerHTML = `
            <div class="home-wallet">
                <strong id="homeWalletBalance">...</strong>
            </div>
            <span style="color:var(--text-secondary);font-size:0.9rem;">👤 ${user ? user.username : ""}</span>
            <button class="btn btn-outline" id="logoutButton">Sair</button>
        `;
        const lb = document.getElementById("logoutButton");
        if (lb) lb.addEventListener("click", () => { ArcadiaAPI.logout(); window.location.reload(); });
        ArcadiaWallet.refresh().then(updateHomeWallet);
    }
}

document.addEventListener("arcadia:balance", (e) => {
    const el = document.getElementById("homeWalletBalance");
    if (el) el.textContent = ArcadiaWallet.format(e.detail.balance);
});

renderSessionUI();

checkApiStatus();