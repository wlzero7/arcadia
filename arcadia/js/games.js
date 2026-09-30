// ========================================
// ARCADIA - GAME HUB
// ========================================


const filterButtons =
    document.querySelectorAll(".filter-button");

const gameCards =
    document.querySelectorAll(".game-card");

const playDiceButton =
    document.getElementById("playDice");

const walletBalance =
    document.getElementById(
        "walletBalance"
    );
updateWalletPreview();

// ========================================
// FILTER GAMES
// ========================================

filterButtons.forEach((button) => {

    button.addEventListener("click", () => {

        const selectedFilter =
            button.dataset.filter;


        // Atualiza botão selecionado

        filterButtons.forEach((item) => {
            item.classList.remove("active");
        });

        button.classList.add("active");


        // Filtra os jogos

        gameCards.forEach((card) => {

            const gameStatus =
                card.dataset.status;


            if (
                selectedFilter === "all" ||
                selectedFilter === gameStatus
            ) {

                card.classList.remove("hidden");

            } else {

                card.classList.add("hidden");

            }

        });

    });

});


// ========================================
// DICE
// ========================================

playDiceButton.addEventListener(
    "click",
    () => {

        window.location.href =
            "dice.html";

    }
);
function updateWalletPreview() {

    const balance =
        ArcadiaWallet.getCached();


    walletBalance.textContent =
        ArcadiaWallet.format(balance);

}

// ========================================
// MINES
// ========================================

const playMinesButton =
    document.getElementById("playMines");

if (playMinesButton) {

    playMinesButton.addEventListener(
        "click",
        () => {

            window.location.href =
                "mines.html";

        }
    );

}


// ========================================
// CRASH
// ========================================

const playCrashButton =
    document.getElementById("playCrash");

if (playCrashButton) {

    playCrashButton.addEventListener(
        "click",
        () => {

            window.location.href =
                "crash.html";

        }
    );

}


// ========================================
// BLACKJACK + ROLETA
// ========================================

const playBlackjackButton =
    document.getElementById("playBlackjack");

if (playBlackjackButton) {

    playBlackjackButton.addEventListener(
        "click",
        () => {

            window.location.href =
                "blackjack.html";

        }
    );

}

const playRouletteButton =
    document.getElementById("playRoulette");

if (playRouletteButton) {

    playRouletteButton.addEventListener(
        "click",
        () => {

            window.location.href =
                "roulette.html";

        }
    );

}


// ========================================
// RACING + DUEL + BJ MULTIPLAYER (v0.9)
// ========================================

const playRacingButton =
    document.getElementById("playRacing");

if (playRacingButton) {

    playRacingButton.addEventListener(
        "click",
        () => {

            window.location.href =
                "racing.html";

        }
    );

}

const playDuelButton =
    document.getElementById("playDuel");

if (playDuelButton) {

    playDuelButton.addEventListener(
        "click",
        () => {

            window.location.href =
                "duel.html";

        }
    );

}

const playBjMpButton =
    document.getElementById("playBjMp");

if (playBjMpButton) {

    playBjMpButton.addEventListener(
        "click",
        () => {

            window.location.href =
                "blackjack-mp.html";

        }
    );

}


// ========================================
// PLINKO (v0.9.4)
// ========================================

const playPlinkoButton =
    document.getElementById("playPlinko");

if (playPlinkoButton) {

    playPlinkoButton.addEventListener(
        "click",
        () => {

            window.location.href =
                "plinko.html";

        }
    );

}


updateWalletPreview();
document.addEventListener("arcadia:balance", updateWalletPreview);
