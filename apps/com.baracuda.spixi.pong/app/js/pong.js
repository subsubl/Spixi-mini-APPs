// Copyright (C) 2025 Baracuda
// Pong - A fast-paced multiplayer game for Spixi Mini Apps

// Game constants
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const PADDLE_WIDTH = 15;
const PADDLE_HEIGHT = 100;
const BALL_SIZE = 12;
const PADDLE_SPEED = 8;
const BALL_SPEED_INITIAL = 6;
const BALL_SPEED_INCREMENT = 0.3;
const MAX_LIVES = 3;
const FRAME_RATE = 60;
const PADDLE_UPDATE_RATE = 16; // Send paddle updates ~60fps

// Game state
let gameState = {
    localPaddle: { y: CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2, lives: MAX_LIVES },
    remotePaddle: { y: CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2, lives: MAX_LIVES },
    ball: {
        x: CANVAS_WIDTH / 2,
        y: CANVAS_HEIGHT / 2,
        vx: 0,
        vy: 0
    },
    isBallOwner: false, // Who controls the ball (randomly assigned)
    isLeftPlayer: false, // Which side we're on (for rendering)
    gameStarted: false,
    gameEnded: false,
    lastUpdate: 0
};

// Ball interpolation state for smooth sync
let ballTarget = {
    x: CANVAS_WIDTH / 2,
    y: CANVAS_HEIGHT / 2,
    vx: 0,
    vy: 0
};
let ballInterpolationSpeed = 0.3; // Higher = faster catch-up (0.1 to 0.5)

let canvas, ctx;
let remotePlayerAddress = '';
let sessionId = '';
let playerLastSeen = 0;
let lastDataSent = 0;
let keysPressed = {};
let touchControlActive = null;
let connectionEstablished = false;
let localPlayerReady = false;
let remotePlayerReady = false;
let countdownActive = false;
let countdownValue = 3;

// Network ping interval
let pingInterval = null;
let gameLoopInterval = null;

// Simplified connection handshake
function establishConnection() {
    // Send connection request with our session ID
    const msg = { a: "connect", sid: sessionId };
    SpixiAppSdk.sendNetworkData(JSON.stringify(msg));
    lastDataSent = SpixiTools.getTimestamp();
}

function handleConnectionEstablished() {
    connectionEstablished = true;
    
    // Start regular ping
    if (!pingInterval) {
        pingInterval = setInterval(() => {
            const currentTime = SpixiTools.getTimestamp();
            if (currentTime - lastDataSent >= 2) {
                lastDataSent = currentTime;
                SpixiAppSdk.sendNetworkData(JSON.stringify({ a: "ping" }));
            }
        }, 2000);
    }
    
    // Show ready screen
    document.getElementById('waiting-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'block';
    document.getElementById('status-text').textContent = 'Press START when ready!';
    document.getElementById('startBtn').style.display = 'inline-block';
    document.getElementById('startBtn').disabled = false;
}

function initGame() {
    canvas = document.getElementById('pongCanvas');
    ctx = canvas.getContext('2d');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    
    setupControls();
    
    // Show waiting screen initially
    document.getElementById('waiting-screen').style.display = 'flex';
    updateLivesDisplay();
}

function setupControls() {
    // Keyboard controls
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
            keysPressed['up'] = true;
            e.preventDefault();
        }
        if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
            keysPressed['down'] = true;
            e.preventDefault();
        }
    });
    
    document.addEventListener('keyup', (e) => {
        if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
            keysPressed['up'] = false;
        }
        if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
            keysPressed['down'] = false;
        }
    });
    
    // Touch controls
    const upBtn = document.getElementById('upBtn');
    const downBtn = document.getElementById('downBtn');
    
    upBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        touchControlActive = 'up';
    });
    
    upBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        touchControlActive = null;
    });
    
    downBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        touchControlActive = 'down';
    });
    
    downBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        touchControlActive = null;
    });
    
    // Mouse controls for buttons
    upBtn.addEventListener('mousedown', () => { keysPressed['up'] = true; });
    upBtn.addEventListener('mouseup', () => { keysPressed['up'] = false; });
    downBtn.addEventListener('mousedown', () => { keysPressed['down'] = true; });
    downBtn.addEventListener('mouseup', () => { keysPressed['down'] = false; });
    
    // Start button - mark player as ready
    const startBtn = document.getElementById('startBtn');
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            if (connectionEstablished && !localPlayerReady) {
                localPlayerReady = true;
                startBtn.disabled = true;
                startBtn.textContent = 'Waiting for opponent...';
                
                // Send ready message
                SpixiAppSdk.sendNetworkData(JSON.stringify({ a: "ready" }));
                lastDataSent = SpixiTools.getTimestamp();
                
                checkBothPlayersReady();
            }
        });
    }
    
    // Shoot button
    const shootBtn = document.getElementById('shootBtn');
    if (shootBtn) {
        shootBtn.addEventListener('click', () => {
            if (gameState.isBallOwner && gameState.ball.vx === 0) {
                launchBall();
            }
        });
    }
    
    // Restart button
    document.getElementById('restartBtn').addEventListener('click', restartGame);
    
    // Exit button
    const exitBtn = document.getElementById('exitBtn');
    if (exitBtn) {
        exitBtn.addEventListener('click', exitGame);
    }
}

function checkBothPlayersReady() {
    if (localPlayerReady && remotePlayerReady && !countdownActive) {
        startCountdown();
    }
}

function startCountdown() {
    countdownActive = true;
    countdownValue = 3;
    document.getElementById('status-text').textContent = countdownValue;
    
    const countdownInterval = setInterval(() => {
        countdownValue--;
        if (countdownValue > 0) {
            document.getElementById('status-text').textContent = countdownValue;
        } else {
            clearInterval(countdownInterval);
            countdownActive = false;
            startGame();
        }
    }, 1000);
}

function startGame() {
    document.getElementById('startBtn').style.display = 'none';
    
    // Randomly determine who controls the ball
    // Use both session IDs for deterministic randomness
    const combinedId = sessionId + remotePlayerAddress;
    const hash = Array.from(combinedId).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    gameState.isBallOwner = hash % 2 === (sessionId < remotePlayerAddress ? 0 : 1);
    
    if (gameState.isBallOwner) {
        document.getElementById('status-text').textContent = 'Click SHOOT to start!';
        document.getElementById('shootBtn').style.display = 'inline-block';
    } else {
        document.getElementById('status-text').textContent = 'Opponent will shoot...';
        document.getElementById('shootBtn').style.display = 'none';
    }
    
    gameState.gameStarted = true;
    gameState.lastUpdate = SpixiTools.getTimestamp();
    
    // Ball stays centered until shot
    gameState.ball.x = CANVAS_WIDTH / 2;
    gameState.ball.y = CANVAS_HEIGHT / 2;
    gameState.ball.vx = 0;
    gameState.ball.vy = 0;
    
    // Start game loop
    if (!gameLoopInterval) {
        gameLoopInterval = setInterval(gameLoop, 1000 / FRAME_RATE);
    }
}

function launchBall() {
    if (gameState.ball.vx === 0 && gameState.isBallOwner) {
        document.getElementById('shootBtn').style.display = 'none';
        document.getElementById('status-text').textContent = 'Game On!';
        
        // Initialize ball velocity - random angle and direction
        const angle = (Math.random() * Math.PI / 3) - Math.PI / 6; // -30° to +30°
        const direction = Math.random() < 0.5 ? 1 : -1;
        gameState.ball.vx = Math.cos(angle) * BALL_SPEED_INITIAL * direction;
        gameState.ball.vy = Math.sin(angle) * BALL_SPEED_INITIAL;
        
        // Initialize target for smooth interpolation
        ballTarget.x = gameState.ball.x;
        ballTarget.y = gameState.ball.y;
        ballTarget.vx = gameState.ball.vx;
        ballTarget.vy = gameState.ball.vy;
        
        // Notify other player and send state
        SpixiAppSdk.sendNetworkData(JSON.stringify({ a: "launch" }));
        lastDataSent = SpixiTools.getTimestamp();
        setTimeout(() => sendBallState(), 50);
    }
}

function gameLoop() {
    if (!gameState.gameStarted || gameState.gameEnded) {
        return;
    }
    
    updatePaddle();
    
    // Only ball owner updates ball physics
    if (gameState.isBallOwner && gameState.ball.vx !== 0) {
        updateBall();
        checkCollisions();
        checkScore();
    } else if (!gameState.isBallOwner && gameState.ball.vx !== 0) {
        // Non-owner: smoothly interpolate ball position towards target
        interpolateBall();
    }
    
    render();
    
    // Send paddle position frequently for real-time updates
    const currentTime = Date.now();
    if (currentTime - lastDataSent >= PADDLE_UPDATE_RATE) {
        sendPaddlePosition();
    }
    
    // Ball owner sends ball state periodically for smooth sync
    if (gameState.isBallOwner && gameState.ball.vx !== 0 && currentTime - lastDataSent >= PADDLE_UPDATE_RATE * 2) {
        sendBallState();
    }
}

function updatePaddle() {
    const moveUp = keysPressed['up'] || touchControlActive === 'up';
    const moveDown = keysPressed['down'] || touchControlActive === 'down';
    
    if (moveUp) {
        gameState.localPaddle.y = Math.max(0, gameState.localPaddle.y - PADDLE_SPEED);
    }
    if (moveDown) {
        gameState.localPaddle.y = Math.min(CANVAS_HEIGHT - PADDLE_HEIGHT, gameState.localPaddle.y + PADDLE_SPEED);
    }
}

function updateBall() {
    gameState.ball.x += gameState.ball.vx;
    gameState.ball.y += gameState.ball.vy;
    
    // Top and bottom wall collision
    if (gameState.ball.y <= BALL_SIZE / 2 || gameState.ball.y >= CANVAS_HEIGHT - BALL_SIZE / 2) {
        gameState.ball.vy = -gameState.ball.vy;
        gameState.ball.y = Math.max(BALL_SIZE / 2, Math.min(CANVAS_HEIGHT - BALL_SIZE / 2, gameState.ball.y));
    }
}

function interpolateBall() {
    // Smooth interpolation (lerp) towards target position
    gameState.ball.x += (ballTarget.x - gameState.ball.x) * ballInterpolationSpeed;
    gameState.ball.y += (ballTarget.y - gameState.ball.y) * ballInterpolationSpeed;
    
    // Also interpolate velocity for predictive motion between updates
    gameState.ball.vx += (ballTarget.vx - gameState.ball.vx) * ballInterpolationSpeed;
    gameState.ball.vy += (ballTarget.vy - gameState.ball.vy) * ballInterpolationSpeed;
    
    // Add small predictive movement based on current velocity
    gameState.ball.x += gameState.ball.vx * 0.5;
    gameState.ball.y += gameState.ball.vy * 0.5;
    
    // Keep ball in bounds
    gameState.ball.x = Math.max(0, Math.min(CANVAS_WIDTH, gameState.ball.x));
    gameState.ball.y = Math.max(BALL_SIZE / 2, Math.min(CANVAS_HEIGHT - BALL_SIZE / 2, gameState.ball.y));
}

function checkCollisions() {
    const localPaddleX = gameState.isLeftPlayer ? 20 : CANVAS_WIDTH - 20 - PADDLE_WIDTH;
    const remotePaddleX = gameState.isLeftPlayer ? CANVAS_WIDTH - 20 - PADDLE_WIDTH : 20;
    
    // Local paddle collision
    if (gameState.ball.x - BALL_SIZE / 2 <= localPaddleX + PADDLE_WIDTH &&
        gameState.ball.x + BALL_SIZE / 2 >= localPaddleX &&
        gameState.ball.y >= gameState.localPaddle.y &&
        gameState.ball.y <= gameState.localPaddle.y + PADDLE_HEIGHT) {
        
        gameState.ball.vx = Math.abs(gameState.ball.vx) * (gameState.isLeftPlayer ? 1 : -1);
        gameState.ball.vx += gameState.ball.vx > 0 ? BALL_SPEED_INCREMENT : -BALL_SPEED_INCREMENT;
        
        const relativeIntersectY = (gameState.localPaddle.y + PADDLE_HEIGHT / 2) - gameState.ball.y;
        gameState.ball.vy = -relativeIntersectY * 0.15;
        
        gameState.ball.x = localPaddleX + (gameState.isLeftPlayer ? PADDLE_WIDTH + BALL_SIZE / 2 : -BALL_SIZE / 2);
        sendBallState(); // Send ball state on collision
    }
    
    // Remote paddle collision
    if (gameState.ball.x - BALL_SIZE / 2 <= remotePaddleX + PADDLE_WIDTH &&
        gameState.ball.x + BALL_SIZE / 2 >= remotePaddleX &&
        gameState.ball.y >= gameState.remotePaddle.y &&
        gameState.ball.y <= gameState.remotePaddle.y + PADDLE_HEIGHT) {
        
        gameState.ball.vx = Math.abs(gameState.ball.vx) * (gameState.isLeftPlayer ? -1 : 1);
        gameState.ball.vx += gameState.ball.vx > 0 ? BALL_SPEED_INCREMENT : -BALL_SPEED_INCREMENT;
        
        const relativeIntersectY = (gameState.remotePaddle.y + PADDLE_HEIGHT / 2) - gameState.ball.y;
        gameState.ball.vy = -relativeIntersectY * 0.15;
        
        gameState.ball.x = remotePaddleX + (gameState.isLeftPlayer ? -BALL_SIZE / 2 : PADDLE_WIDTH + BALL_SIZE / 2);
        sendBallState(); // Send ball state on collision
    }
}

function checkScore() {
    if (gameState.ball.x < 0) {
        // Left player missed
        if (gameState.isLeftPlayer) {
            gameState.localPaddle.lives--;
        } else {
            gameState.remotePaddle.lives--;
        }
        updateLivesDisplay();
        
        if (gameState.localPaddle.lives <= 0 || gameState.remotePaddle.lives <= 0) {
            endGame(gameState.localPaddle.lives > 0);
        } else {
            resetBall();
            sendLifeUpdate();
        }
    } else if (gameState.ball.x > CANVAS_WIDTH) {
        // Right player missed
        if (gameState.isLeftPlayer) {
            gameState.remotePaddle.lives--;
        } else {
            gameState.localPaddle.lives--;
        }
        updateLivesDisplay();
        
        if (gameState.localPaddle.lives <= 0 || gameState.remotePaddle.lives <= 0) {
            endGame(gameState.localPaddle.lives > 0);
        } else {
            resetBall();
            sendLifeUpdate();
        }
    }
}

function resetBall() {
    gameState.ball.x = CANVAS_WIDTH / 2;
    gameState.ball.y = CANVAS_HEIGHT / 2;
    
    const angle = (Math.random() * Math.PI / 3) - Math.PI / 6;
    const direction = Math.random() < 0.5 ? 1 : -1;
    
    gameState.ball.vx = Math.cos(angle) * BALL_SPEED_INITIAL * direction;
    gameState.ball.vy = Math.sin(angle) * BALL_SPEED_INITIAL;
    
    // Reset target for smooth interpolation
    ballTarget.x = gameState.ball.x;
    ballTarget.y = gameState.ball.y;
    ballTarget.vx = gameState.ball.vx;
    ballTarget.vy = gameState.ball.vy;
    
    sendBallState();
}

function updateLivesDisplay() {
    document.getElementById('local-score').textContent = gameState.localPaddle.lives;
    document.getElementById('remote-score').textContent = gameState.remotePaddle.lives;
}

function render() {
    // Clear canvas
    ctx.fillStyle = '#1a202c';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    // Draw center line
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(CANVAS_WIDTH / 2, 0);
    ctx.lineTo(CANVAS_WIDTH / 2, CANVAS_HEIGHT);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Draw paddles
    ctx.fillStyle = '#4299e1';
    const localPaddleX = gameState.isLeftPlayer ? 20 : CANVAS_WIDTH - 20 - PADDLE_WIDTH;
    ctx.fillRect(localPaddleX, gameState.localPaddle.y, PADDLE_WIDTH, PADDLE_HEIGHT);
    
    ctx.fillStyle = '#f56565';
    const remotePaddleX = gameState.isLeftPlayer ? CANVAS_WIDTH - 20 - PADDLE_WIDTH : 20;
    ctx.fillRect(remotePaddleX, gameState.remotePaddle.y, PADDLE_WIDTH, PADDLE_HEIGHT);
    
    // Draw ball
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(gameState.ball.x, gameState.ball.y, BALL_SIZE / 2, 0, Math.PI * 2);
    ctx.fill();
}

function endGame(won) {
    gameState.gameEnded = true;
    
    if (gameLoopInterval) {
        clearInterval(gameLoopInterval);
        gameLoopInterval = null;
    }
    
    document.getElementById('game-screen').style.display = 'none';
    document.getElementById('game-over-screen').style.display = 'flex';
    
    document.getElementById('result-text').textContent = won ? 'You Win!' : 'You Lose!';
    document.getElementById('result-text').style.color = won ? '#48bb78' : '#f56565';
    document.getElementById('final-score').textContent = 
        `Final Lives: You ${gameState.localPaddle.lives} - ${gameState.remotePaddle.lives} Opponent`;
    
    saveGameState();
    sendEndGame();
}

function restartGame() {
    gameState = {
        localPaddle: { y: CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2, lives: MAX_LIVES },
        remotePaddle: { y: CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2, lives: MAX_LIVES },
        ball: {
            x: CANVAS_WIDTH / 2,
            y: CANVAS_HEIGHT / 2,
            vx: 0,
            vy: 0
        },
        isBallOwner: gameState.isBallOwner,
        isLeftPlayer: gameState.isLeftPlayer,
        gameStarted: false,
        gameEnded: false,
        lastUpdate: 0
    };
    
    // Reset ball interpolation target
    ballTarget = {
        x: CANVAS_WIDTH / 2,
        y: CANVAS_HEIGHT / 2,
        vx: 0,
        vy: 0
    };
    
    localPlayerReady = false;
    remotePlayerReady = false;
    countdownActive = false;
    
    document.getElementById('game-over-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'block';
    document.getElementById('startBtn').style.display = 'inline-block';
    document.getElementById('startBtn').disabled = false;
    document.getElementById('startBtn').textContent = 'Start Game';
    document.getElementById('shootBtn').style.display = 'none';
    document.getElementById('status-text').textContent = 'Press START when ready!';
    
    updateLivesDisplay();
    
    if (remotePlayerAddress !== '') {
        SpixiAppSdk.sendNetworkData(JSON.stringify({ a: "restart" }));
        lastDataSent = SpixiTools.getTimestamp();
    }
}

function exitGame() {
    if (gameLoopInterval) {
        clearInterval(gameLoopInterval);
        gameLoopInterval = null;
    }
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }
    if (helloPingInterval) {
        clearInterval(helloPingInterval);
        helloPingInterval = null;
    }
    // Use spixiAction with "close" to properly exit webview
    SpixiAppSdk.spixiAction("close");
}

// Network functions
function sendPaddlePosition() {
    lastDataSent = Date.now();
    SpixiAppSdk.sendNetworkData(JSON.stringify({ a: "paddle", y: Math.round(gameState.localPaddle.y) }));
}

function sendBallState() {
    lastDataSent = SpixiTools.getTimestamp();
    const b = gameState.ball;
    SpixiAppSdk.sendNetworkData(JSON.stringify({
        a: "ball",
        x: Math.round(b.x),
        y: Math.round(b.y),
        vx: parseFloat(b.vx.toFixed(2)),
        vy: parseFloat(b.vy.toFixed(2))
    }));
}

function sendLifeUpdate() {
    lastDataSent = SpixiTools.getTimestamp();
    SpixiAppSdk.sendNetworkData(JSON.stringify({
        a: "lives",
        local: gameState.localPaddle.lives,
        remote: gameState.remotePaddle.lives
    }));
}

function sendEndGame() {
    lastDataSent = SpixiTools.getTimestamp();
    SpixiAppSdk.sendNetworkData(JSON.stringify({
        a: "end",
        local: gameState.localPaddle.lives,
        remote: gameState.remotePaddle.lives
    }));
}

function saveGameState() {
    if (remotePlayerAddress !== '') {
        setTimeout(() => {
            SpixiAppSdk.setStorageData(remotePlayerAddress, btoa(JSON.stringify(gameState)));
        }, 50);
    }
}

function loadGameState(playerAddress) {
    setTimeout(() => {
        SpixiAppSdk.getStorageData(playerAddress);
    }, 50);
}

// Spixi SDK callbacks
SpixiAppSdk.onInit = function(sid, userAddresses) {
    sessionId = sid;
    const addresses = userAddresses.split(",");
    remotePlayerAddress = addresses[0];
    
    // Determine which side we're on (left or right)
    gameState.isLeftPlayer = sessionId < remotePlayerAddress;
    
    initGame();
    loadGameState(remotePlayerAddress);
    
    // Start connection handshake
    establishConnection();
    
    // Show waiting screen
    document.getElementById('waiting-screen').style.display = 'flex';
    document.getElementById('game-screen').style.display = 'none';
    document.querySelector('#waiting-screen p').textContent = 'Connecting to opponent...';
};

SpixiAppSdk.onNetworkData = function(senderAddress, data) {
    playerLastSeen = SpixiTools.getTimestamp();
    
    try {
        const msg = JSON.parse(data);
        
        switch(msg.a) {
            case "connect":
                // Received connection request, reply back
                if (!connectionEstablished) {
                    SpixiAppSdk.sendNetworkData(JSON.stringify({ a: "connect", sid: sessionId }));
                    lastDataSent = SpixiTools.getTimestamp();
                    handleConnectionEstablished();
                }
                break;
                
            case "ping":
                // Connection keepalive
                break;
                
            case "ready":
                remotePlayerReady = true;
                checkBothPlayersReady();
                break;
                
            case "launch":
                // Other player launched the ball
                document.getElementById('status-text').textContent = 'Game On!';
                break;
                
            case "paddle":
                // Update remote paddle position
                gameState.remotePaddle.y = msg.y;
                break;
                
            case "ball":
                // Receive ball state from ball owner
                if (!gameState.isBallOwner) {
                    // Update target for smooth interpolation
                    ballTarget.x = msg.x;
                    ballTarget.y = msg.y;
                    ballTarget.vx = msg.vx;
                    ballTarget.vy = msg.vy;
                    
                    // If ball just started or is far away, snap to position
                    const distance = Math.sqrt(
                        Math.pow(gameState.ball.x - msg.x, 2) + 
                        Math.pow(gameState.ball.y - msg.y, 2)
                    );
                    if (gameState.ball.vx === 0 || distance > 100) {
                        gameState.ball.x = msg.x;
                        gameState.ball.y = msg.y;
                        gameState.ball.vx = msg.vx;
                        gameState.ball.vy = msg.vy;
                    }
                }
                break;
                
            case "lives":
                // Update lives from ball owner
                if (!gameState.isBallOwner) {
                    gameState.localPaddle.lives = msg.remote;
                    gameState.remotePaddle.lives = msg.local;
                    updateLivesDisplay();
                }
                break;
                
            case "end":
                // Game ended
                if (!gameState.gameEnded) {
                    gameState.localPaddle.lives = msg.remote;
                    gameState.remotePaddle.lives = msg.local;
                    endGame(gameState.localPaddle.lives > 0);
                }
                break;
                
            case "restart":
                // Restart request
                if (gameState.gameEnded) {
                    restartGame();
                }
                break;
        }
    } catch (e) {
        console.error("Error parsing network data:", e);
    }
};

SpixiAppSdk.onStorageData = function(key, value) {
    if (value !== 'null') {
        try {
            const savedState = JSON.parse(atob(value));
            if (savedState.gameEnded) {
                gameState = savedState;
                updateLivesDisplay();
                endGame(gameState.localPaddle.lives > gameState.remotePaddle.lives);
            }
        } catch (e) {
            console.error("Error loading saved state:", e);
        }
    }
};

// Start the app on load
window.onload = SpixiAppSdk.fireOnLoad;
