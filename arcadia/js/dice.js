// ========================================
// ARCADIA DICE
// Client-side - v1.0.2
// Fix: validação de saldo removida do cliente — o SERVIDOR é a fonte
// da verdade e rejeita com a mensagem certa. O cache local podia estar
// travado em 0 e bloquear apostas com "Saldo insuficiente" fantasma.
// ========================================


// ========================================
// GAME STATE
// ========================================

let selectedNumber = null;

let totalGames = 0;
let totalWins = 0;
let totalLosses = 0;

let gameHistory = [];

let isRolling = false;


// ========================================
// DOM
// ========================================

const balanceElement =
    document.getElementById("balance") ||
    document.getElementById("walletBalance");

const diceElement =
    document.getElementById("dice");

const gameResult =
    document.getElementById("gameResult");

const gameMessage =
    document.getElementById("gameMessage");

const betInput =
    document.getElementById("betAmount");

const rollButton =
    document.getElementById("rollButton");

const numberButtons =
    document.querySelectorAll(".number-button");
const quickBetButtons =
    document.querySelectorAll(".quick-bets button");

const historyList =
    document.getElementById("historyList");

const totalGamesElement =
    document.getElementById("totalGames");

const totalWinsElement =
    document.getElementById("totalWins");

const totalLossesElement =
    document.getElementById("totalLosses");

const clearHistoryButton =
    document.getElementById("clearHistory");


// ========================================
// FORMAT
// ========================================

function formatArcCoins(value) {
    return ArcadiaWallet.format(value);
}


// ========================================
// SELECT NUMBER
// ========================================

numberButtons.forEach((button) => {
    button.addEventListener("click", () => {
        selectedNumber =
            Number(button.dataset.number);

        numberButtons.forEach((item) => {
            item.classList.remove("selected");
        });

        button.classList.add("selected");
        gameMessage.textContent =
            `Número ${selectedNumber} selecionado.`;

        gameMessage.style.color =
            "var(--text-secondary)";
    });
});


// ========================================
// QUICK BETS
// ========================================

quickBetButtons.forEach((button) => {
    button.addEventListener("click", () => {
        betInput.value =
            Number(button.dataset.bet);
    });
});


// ========================================
// RANDOM NUMBER
// ========================================

function generateDiceResult() {
    return Math.floor(
        Math.random() * 6
    ) + 1;
}


// ========================================
// VALIDATION
// (v1.0.2: sem check de saldo — o servidor valida contra o banco real)
// ========================================

function validateBet(bet) {
    if (selectedNumber === null) {
        return "Escolha um número entre 1 e 6.";
    }

    if (!Number.isFinite(bet)) {
        return "Digite um valor válido.";
    }

    if (!Number.isInteger(bet)) {
        return "A aposta deve utilizar ArcCoins inteiros.";
    }

    if (bet < 10) {
        return "A aposta mínima é 10 AC.";
    }

    return null;
}


// ========================================
// PLAY
// ========================================
async function playDice() {
    if (isRolling) {
        return;
    }

    if (!ArcadiaAPI.isLoggedIn()) {
        gameMessage.textContent = "Entre na sua conta para apostar (botão Entrar no topo).";
        gameMessage.style.color = "var(--danger)";
        return;
    }

    const bet = Number(betInput.value);
    const validationError = validateBet(bet);
    if (validationError) {
        gameMessage.textContent = validationError;
        gameMessage.style.color = "var(--danger)";
        return;
    }

    isRolling = true;
    rollButton.disabled = true;
    gameMessage.textContent = "Lançando dado...";
    gameMessage.style.color = "var(--text-secondary)";

    diceElement.classList.add("rolling");
    const animationInterval = setInterval(() => {
        diceElement.textContent = generateDiceResult();
    }, 80);

    try {
        // Toda a aleatoriedade acontece NO SERVIDOR
        const data = await ArcadiaAPI.play("dice", bet, { number: selectedNumber });
        await new Promise((r) => setTimeout(r, 900));
        clearInterval(animationInterval);
        diceElement.classList.remove("rolling");

        const result = String(data.detail.roll);
        diceElement.textContent = result;

        const won = data.outcome === "win";
        const balanceChange = won ? data.payout - bet : -bet;

        if (won) {
            Sfx.win();
            gameMessage.textContent = `🎉 Você acertou! O dado caiu em ${result}. +${formatArcCoins(data.payout)}`;
            gameMessage.style.color = "var(--success)";
        } else {
            Sfx.lose();
            gameMessage.textContent = `O dado caiu em ${result}. Você escolheu ${selectedNumber}. -${formatArcCoins(bet)}`;
            gameMessage.style.color = "var(--danger)";
        }

        ArcadiaWallet.setCached(data.balance);
        updateBalance();
        addHistory({ won, bet, balanceChange, selectedNumber, result });
    } catch (err) {
        clearInterval(animationInterval);
        diceElement.classList.remove("rolling");
        gameMessage.textContent = err.message;
        gameMessage.style.color = "var(--danger)";
    } finally {
        isRolling = false;
        rollButton.disabled = false;
    }
}


function updateBalance() {
    // v1.0.2: sempre lê o cache VIVO (o wallet.js v1.0.4 sincroniza sozinho)
    const current = ArcadiaWallet.getCached();

    // nunca quebra se o elemento não existir na página
    if (balanceElement) {
        balanceElement.textContent = formatArcCoins(current);
    }

    // mantém o saldo do header sincronizado também
    const headerWallet = document.getElementById("walletBalance");
    if (headerWallet) {
        headerWallet.textContent = formatArcCoins(current);
    }
}


// ========================================
// UPDATE STATISTICS
// ========================================

function updateStatistics() {
    totalGamesElement.textContent =
        totalGames;

    totalWinsElement.textContent =
        totalWins;

    totalLossesElement.textContent =
        totalLosses;
}


// ========================================
// HISTORY
// ========================================

function addHistory(game) {
    gameHistory.unshift(game);
    if (gameHistory.length > 50) gameHistory.pop();

    if (game.won) totalWins++;
    else totalLosses++;
    totalGames++;

    updateStatistics();
    renderHistory();
}


function renderHistory() {
    if (!historyList) return;

    historyList.innerHTML = "";

    if (gameHistory.length === 0) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "Nenhuma partida realizada.";
        historyList.appendChild(empty);
        return;
    }

    gameHistory.forEach((game) => {
        const historyItem = document.createElement("div");
        historyItem.className = "history-item " + (game.won ? "win" : "loss");
        historyItem.innerHTML = `
            <div>
                <span class="history-dice">🎲 ${game.result}</span>
                <span class="muted">escolheu ${game.selectedNumber}</span>
            </div>
            <strong class="${game.won ? "text-success" : "text-danger"}">
                ${game.balanceChange > 0 ? "+" : ""}${formatArcCoins(game.balanceChange)}
            </strong>
        `;
        historyList.appendChild(historyItem);
    });
}


// ========================================
// UPDATE INTERFACE
// ========================================

function updateInterface() {
    updateBalance();
    updateStatistics();
}


// ========================================
// CLEAR HISTORY
// ========================================
clearHistoryButton.addEventListener(
    "click",
    () => {
        gameHistory = [];
        totalGames = 0;
        totalWins = 0;
        totalLosses = 0;
        renderHistory();
        updateStatistics();
    }
);


// ========================================
// PLAY EVENT
// ========================================

rollButton.addEventListener(
    "click",
    playDice
);


// ========================================
// INITIALIZE
// ========================================

(async function init() {
    if (ArcadiaAPI.isLoggedIn()) {
        try {
            await ArcadiaWallet.refresh();
        } catch (_) {}
    }
    updateInterface();
    renderHistory();
})();
