// ========================================
// ARCADIA DICE
// Client-side prototype - v0.1
// ========================================


// ========================================
// GAME STATE
// ========================================

let balance =
    ArcadiaWallet.getCached();

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
    document.getElementById("balance");

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


    if (bet > balance) {

        return "Saldo insuficiente.";

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

        balance = data.balance;
        ArcadiaWallet.setCached(balance);
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

    balanceElement.textContent =
        formatArcCoins(balance);

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


    // Limita o histórico visual

    if (gameHistory.length > 10) {

        gameHistory.pop();

    }


    renderHistory();

}


function renderHistory() {

    historyList.innerHTML = "";


    if (gameHistory.length === 0) {

        historyList.innerHTML =
            `
                <p class="empty-history">
                    Nenhuma partida realizada.
                </p>
            `;

        return;
    }


    gameHistory.forEach((game) => {

        const historyItem =
            document.createElement("div");


        historyItem.className =
            `history-item ${
                game.won
                    ? "win"
                    : "loss"
            }`;


        historyItem.innerHTML =
            `
                <div>

                    <span>
                        Escolha / Resultado
                    </span>

                    <strong>
                        ${game.selectedNumber}
                        →
                        ${game.result}
                    </strong>

                </div>


                <div>

                    <span>
                        Aposta
                    </span>

                    <strong>
                        ${formatArcCoins(game.bet)}
                    </strong>

                </div>


                <div>

                    <span>
                        Resultado
                    </span>

                    <strong>
                        ${
                            game.balanceChange > 0
                                ? "+"
                                : ""
                        }
                        ${formatArcCoins(
                            game.balanceChange
                        )}
                    </strong>

                </div>
            `;


        historyList.appendChild(
            historyItem
        );

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

        renderHistory();

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

updateInterface();