// Copyright (C) 2025 IXI Labs
// Coin Flip - Spixi Mini App

// Game State
const gameState = {
    sessionId: null,
    localAddress: null,
    remoteAddress: null,
    connectionEstablished: false,
    
    localBet: null,
    localChoice: null,
    remoteBet: null,
    remoteChoice: null,
    
    agreedBet: null,
    isFlipper: false,
    
    coinResult: null,
    winner: null,
    
    phase: 'betting' // betting, waiting, ready, flipping, result
};

// Connection management
let connectionRetryInterval = null;
let keepaliveInterval = null;

// UI Elements
const elements = {
    menuBtn: document.getElementById('menuBtn'),
    exitBtn: document.getElementById('exitBtn'),
    closeMenuBtn: document.getElementById('closeMenuBtn'),
    sideMenu: document.getElementById('sideMenu'),
    menuOverlay: document.getElementById('menuOverlay'),
    statusText: document.getElementById('statusText'),
    connectionStatus: document.getElementById('connectionStatus'),
    
    betAmount: document.getElementById('betAmount'),
    placeBetBtn: document.getElementById('placeBetBtn'),
    choiceBtns: document.querySelectorAll('.choice-btn'),
    
    phases: {
        betting: document.getElementById('bettingPhase'),
        waiting: document.getElementById('waitingPhase'),
        ready: document.getElementById('readyPhase'),
        flipping: document.getElementById('flippingPhase'),
        result: document.getElementById('resultPhase')
    },
    
    yourBetDisplay: document.getElementById('yourBetDisplay'),
    yourChoiceDisplay: document.getElementById('yourChoiceDisplay'),
    
    yourBetFinal: document.getElementById('yourBetFinal'),
    yourChoiceFinal: document.getElementById('yourChoiceFinal'),
    opponentBetFinal: document.getElementById('opponentBetFinal'),
    opponentChoiceFinal: document.getElementById('opponentChoiceFinal'),
    agreedBetAmount: document.getElementById('agreedBetAmount'),
    flipperInfo: document.getElementById('flipperInfo'),
    
    flipCoinBtn: document.getElementById('flipCoinBtn'),
    waitingFlip: document.getElementById('waitingFlip'),
    
    resultTitle: document.getElementById('resultTitle'),
    resultCoinIcon: document.getElementById('resultCoinIcon'),
    resultCoinText: document.getElementById('resultCoinText'),
    winnerInfo: document.getElementById('winnerInfo'),
    transactionSection: document.getElementById('transactionSection'),
    transactionAmount: document.getElementById('transactionAmount'),
    winnerAddress: document.getElementById('winnerAddress'),
    sendPaymentBtn: document.getElementById('sendPaymentBtn'),
    playAgainBtn: document.getElementById('playAgainBtn')
};

// Initialize app
SpixiAppSdk.onInit = function(sessionId, userAddresses) {
    gameState.sessionId = sessionId;
    
    const addresses = userAddresses.split(',');
    if (addresses.length === 2) {
        gameState.localAddress = addresses[0].trim();
        gameState.remoteAddress = addresses[1].trim();
        
        console.log('Initialized with addresses:', gameState.localAddress, gameState.remoteAddress);
        startConnectionHandshake();
    }
};

// Start connection handshake
function startConnectionHandshake() {
    updateStatus('Connecting to opponent...');
    
    // Send connection request every 500ms until established
    connectionRetryInterval = setInterval(() => {
        if (!gameState.connectionEstablished) {
            sendNetworkMessage({
                action: 'connect',
                sessionId: gameState.sessionId
            });
        } else {
            clearInterval(connectionRetryInterval);
            connectionRetryInterval = null;
        }
    }, 500);
}

// Handle connection established
function handleConnectionEstablished() {
    gameState.connectionEstablished = true;
    updateStatus('Connected', true);
    elements.connectionStatus.classList.add('connected');
    
    // Start keepalive
    keepaliveInterval = setInterval(() => {
        sendNetworkMessage({ action: 'ping' });
    }, 3000);
    
    console.log('Connection established');
}

// Network message handling
SpixiAppSdk.onNetworkData = function(senderAddress, data) {
    console.log('Received from', senderAddress, ':', data);
    
    try {
        const message = JSON.parse(data);
        
        switch(message.action) {
            case 'connect':
                // Always reply to connection requests
                sendNetworkMessage({
                    action: 'connect',
                    sessionId: gameState.sessionId
                });
                
                if (!gameState.connectionEstablished) {
                    handleConnectionEstablished();
                }
                break;
                
            case 'ping':
                // Keepalive received
                break;
                
            case 'bet':
                handleRemoteBet(message.amount, message.choice);
                break;
                
            case 'flip':
                handleRemoteFlip(message.result);
                break;
                
            case 'reset':
                handleRemoteReset();
                break;
        }
    } catch (e) {
        console.error('Error parsing network data:', e);
    }
};

// Send network message
function sendNetworkMessage(message) {
    try {
        const data = JSON.stringify(message);
        SpixiAppSdk.sendNetworkData(data);
    } catch (e) {
        console.error('Error sending network message:', e);
    }
}

// Update status
function updateStatus(text, connected = false) {
    elements.statusText.textContent = text;
    if (connected) {
        elements.connectionStatus.classList.add('connected');
    }
}

// Switch phase
function switchPhase(newPhase) {
    gameState.phase = newPhase;
    
    // Hide all phases
    Object.values(elements.phases).forEach(phase => {
        phase.classList.remove('active');
    });
    
    // Show new phase
    if (elements.phases[newPhase]) {
        elements.phases[newPhase].classList.add('active');
    }
}

// Choice button handling
elements.choiceBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        elements.choiceBtns.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        gameState.localChoice = btn.dataset.choice;
        updatePlaceBetButton();
    });
});

// Bet amount input handling
elements.betAmount.addEventListener('input', () => {
    updatePlaceBetButton();
});

function updatePlaceBetButton() {
    const amount = parseFloat(elements.betAmount.value);
    const hasChoice = gameState.localChoice !== null;
    const validAmount = !isNaN(amount) && amount >= 1;
    
    elements.placeBetBtn.disabled = !(hasChoice && validAmount);
}

// Place bet button
elements.placeBetBtn.addEventListener('click', () => {
    const amount = parseFloat(elements.betAmount.value);
    
    if (isNaN(amount) || amount < 1) {
        alert('Please enter a valid bet amount (minimum 1 IXI)');
        return;
    }
    
    if (!gameState.localChoice) {
        alert('Please choose heads or tails');
        return;
    }
    
    gameState.localBet = amount;
    
    // Send bet to opponent
    sendNetworkMessage({
        action: 'bet',
        amount: amount,
        choice: gameState.localChoice
    });
    
    // Update UI
    elements.yourBetDisplay.textContent = `${amount} IXI`;
    elements.yourChoiceDisplay.textContent = gameState.localChoice.toUpperCase();
    
    switchPhase('waiting');
    
    // Check if opponent already bet
    if (gameState.remoteBet !== null) {
        prepareFlip();
    }
});

// Handle remote bet
function handleRemoteBet(amount, choice) {
    gameState.remoteBet = amount;
    gameState.remoteChoice = choice;
    
    console.log('Opponent bet:', amount, choice);
    
    // If we already bet, prepare flip
    if (gameState.localBet !== null) {
        prepareFlip();
    }
}

// Prepare flip phase
function prepareFlip() {
    // Determine agreed bet (lower amount)
    gameState.agreedBet = Math.min(gameState.localBet, gameState.remoteBet);
    
    // Determine who flips (lower bet amount)
    gameState.isFlipper = gameState.localBet <= gameState.remoteBet;
    
    // Update UI
    elements.yourBetFinal.textContent = `${gameState.localBet} IXI`;
    elements.yourChoiceFinal.textContent = gameState.localChoice.toUpperCase();
    elements.opponentBetFinal.textContent = `${gameState.remoteBet} IXI`;
    elements.opponentChoiceFinal.textContent = gameState.remoteChoice.toUpperCase();
    elements.agreedBetAmount.textContent = `${gameState.agreedBet} IXI`;
    
    if (gameState.isFlipper) {
        elements.flipperInfo.textContent = '🎲 You will flip the coin!';
        elements.flipCoinBtn.style.display = 'block';
        elements.waitingFlip.style.display = 'none';
    } else {
        elements.flipperInfo.textContent = '⏳ Your opponent will flip the coin';
        elements.flipCoinBtn.style.display = 'none';
        elements.waitingFlip.style.display = 'block';
    }
    
    switchPhase('ready');
}

// Flip coin button
elements.flipCoinBtn.addEventListener('click', () => {
    flipCoin();
});

// Flip coin
function flipCoin() {
    switchPhase('flipping');
    
    // Random result
    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    gameState.coinResult = result;
    
    // Send result to opponent
    sendNetworkMessage({
        action: 'flip',
        result: result
    });
    
    // Show result after animation
    setTimeout(() => {
        showResult(result);
    }, 2000);
}

// Handle remote flip
function handleRemoteFlip(result) {
    gameState.coinResult = result;
    switchPhase('flipping');
    
    // Show result after animation
    setTimeout(() => {
        showResult(result);
    }, 2000);
}

// Show result
function showResult(result) {
    const resultIcon = result === 'heads' ? '👑' : '🦅';
    const resultText = result.toUpperCase();
    
    elements.resultCoinIcon.textContent = resultIcon;
    elements.resultCoinText.textContent = resultText;
    
    // Determine winner
    const localWon = gameState.localChoice === result;
    gameState.winner = localWon ? gameState.localAddress : gameState.remoteAddress;
    
    if (localWon) {
        elements.resultTitle.textContent = '🎉 YOU WON!';
        elements.winnerInfo.textContent = `You won ${gameState.agreedBet} IXI!`;
        elements.winnerInfo.classList.add('won');
        elements.winnerInfo.classList.remove('lost');
        elements.transactionSection.style.display = 'none';
    } else {
        elements.resultTitle.textContent = '😔 YOU LOST';
        elements.winnerInfo.textContent = `You lost ${gameState.agreedBet} IXI`;
        elements.winnerInfo.classList.add('lost');
        elements.winnerInfo.classList.remove('won');
        
        // Show transaction section for loser
        elements.transactionAmount.textContent = `${gameState.agreedBet} IXI`;
        elements.winnerAddress.textContent = gameState.remoteAddress;
        elements.transactionSection.style.display = 'block';
    }
    
    switchPhase('result');
}

// Send payment button
elements.sendPaymentBtn.addEventListener('click', () => {
    const amount = gameState.agreedBet;
    const recipient = gameState.remoteAddress;
    
    // Build transaction action JSON for Spixi
    // This opens Spixi's wallet send page pre-filled with recipient and amount
    const transactionData = {
        command: "sendPayment",
        to: recipient,
        amount: amount.toString(),
        requestId: Date.now().toString()
    };
    
    console.log('Initiating payment:', transactionData);
    
    // Use spixiAction to trigger transaction flow
    // Note: Spixi will handle the actual transaction creation and signing
    SpixiAppSdk.spixiAction(JSON.stringify(transactionData));
    
    // Disable button after initiating
    elements.sendPaymentBtn.disabled = true;
    elements.sendPaymentBtn.textContent = 'Opening Wallet...';
});

// Play again button
elements.playAgainBtn.addEventListener('click', () => {
    resetGame();
    sendNetworkMessage({ action: 'reset' });
});

// Handle remote reset
function handleRemoteReset() {
    resetGame();
}

// Reset game
function resetGame() {
    gameState.localBet = null;
    gameState.localChoice = null;
    gameState.remoteBet = null;
    gameState.remoteChoice = null;
    gameState.agreedBet = null;
    gameState.isFlipper = false;
    gameState.coinResult = null;
    gameState.winner = null;
    
    elements.betAmount.value = '';
    elements.choiceBtns.forEach(btn => btn.classList.remove('selected'));
    elements.placeBetBtn.disabled = true;
    elements.sendPaymentBtn.disabled = false;
    elements.sendPaymentBtn.textContent = 'Send Payment';
    
    switchPhase('betting');
}

// Exit button
elements.exitBtn.addEventListener('click', () => {
    SpixiAppSdk.back();
});

// Menu handlers
elements.menuBtn.addEventListener('click', () => {
    elements.sideMenu.classList.add('open');
    elements.menuOverlay.classList.add('active');
});

elements.closeMenuBtn.addEventListener('click', () => {
    elements.sideMenu.classList.remove('open');
    elements.menuOverlay.classList.remove('active');
});

elements.menuOverlay.addEventListener('click', () => {
    elements.sideMenu.classList.remove('open');
    elements.menuOverlay.classList.remove('active');
});

// Storage handling (for game persistence)
SpixiAppSdk.onStorageData = function(key, value) {
    // Could implement game state persistence here
    console.log('Storage data:', key, value);
};

// Handle app end session
SpixiAppSdk.onAppEndSession = function(data) {
    console.log('App session ended:', data);
    
    if (connectionRetryInterval) {
        clearInterval(connectionRetryInterval);
    }
    if (keepaliveInterval) {
        clearInterval(keepaliveInterval);
    }
};

// Initialize on load
window.onload = function() {
    console.log('Coin Flip app loaded');
    SpixiAppSdk.fireOnLoad();
};
