document.addEventListener('DOMContentLoaded', () => {
    const hippoBase = document.getElementById('hippo-base');
    const teethContainer = document.getElementById('teeth-container');
    const startScreen = document.getElementById('start-screen');
    const gameOverScreen = document.getElementById('game-over-screen');
    const startBtn = document.getElementById('start-btn');
    const restartBtn = document.getElementById('restart-btn');

    const TOTAL_TEETH = 5;
    let soreToothIndex = -1;
    let isGameOver = false;

    console.log("App initialized");

    // Initialize Spixi SDK
    try {
        if (typeof SpixiAppSdk !== 'undefined') {
            SpixiAppSdk.init();
            console.log("Spixi SDK initialized");
        } else {
            console.log("Spixi SDK not found");
        }
    } catch (e) {
        console.error("Error initializing Spixi SDK:", e);
    }

    function initGame() {
        console.log("Starting game...");
        isGameOver = false;
        soreToothIndex = Math.floor(Math.random() * TOTAL_TEETH);

        // Reset UI
        hippoBase.src = 'img/hippo_open.png';
        hippoBase.classList.remove('shake');
        teethContainer.innerHTML = '';
        gameOverScreen.classList.add('hidden');
        startScreen.classList.add('hidden');

        // Generate teeth
        for (let i = 0; i < TOTAL_TEETH; i++) {
            const tooth = document.createElement('div');
            tooth.classList.add('tooth');
            tooth.dataset.index = i;
            tooth.addEventListener('click', handleToothClick);
            teethContainer.appendChild(tooth);
        }
    }

    function handleToothClick(e) {
        if (isGameOver) return;

        const tooth = e.target;
        const index = parseInt(tooth.dataset.index);

        if (index === soreToothIndex) {
            // Game Over
            triggerGameOver(tooth);
        } else {
            // Safe tooth
            tooth.classList.add('pressed');
            // Optional: Play safe sound
        }
    }

    function triggerGameOver(tooth) {
        isGameOver = true;
        tooth.classList.add('sore');

        // Shake effect
        hippoBase.classList.add('shake');

        // Delay for dramatic effect
        setTimeout(() => {
            hippoBase.src = 'img/hippo_chomp.png';
            teethContainer.innerHTML = ''; // Hide teeth on chomp

            // Show Game Over screen
            setTimeout(() => {
                gameOverScreen.classList.remove('hidden');
            }, 1000);
        }, 500);
    }

    startBtn.addEventListener('click', initGame);
    restartBtn.addEventListener('click', initGame);
});
