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
let ballInterpolationSpeed = 0.5; // Higher = faster catch-up
let lastBallUpdate = 0;
const BALL_UPDATE_RATE = 16; // Send every 16ms (60fps) for smooth sync

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
let autoStartTimer = null;

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
    
    // Show ready screen and auto-start immediately
    document.getElementById('waiting-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'block';
    document.getElementById('status-text').textContent = 'CONNECTING...';
    document.getElementById('startBtn').style.display = 'none';
    
    // Auto-start game immediately
    autoStartTimer = setTimeout(() => {
        localPlayerReady = true;
        remotePlayerReady = true;
        startCountdown();
    }, 500);
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
    
    // Restart button
    document.getElementById('restartBtn').addEventListener('click', restartGame);
    
    // Restart button during game
    const restartGameBtn = document.getElementById('restartGameBtn');
    if (restartGameBtn) {
        restartGameBtn.addEventListener('click', () => {
            if (gameState.gameStarted) {
                restartGame();
            }
        });
    }
    
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
    document.getElementById('status-text').textContent = 'READY?';
    
    setTimeout(() => {
        countdownActive = false;
        startGame();
    }, 1000);
}

function startGame() {
    document.getElementById('startBtn').style.display = 'none';
    document.getElementById('status-text').textContent = 'GET READY!';
    
    // Randomly determine who controls the ball
    const combinedId = sessionId + remotePlayerAddress;
    const hash = Array.from(combinedId).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    gameState.isBallOwner = hash % 2 === (sessionId < remotePlayerAddress ? 0 : 1);
    
    gameState.gameStarted = true;
    gameState.lastUpdate = SpixiTools.getTimestamp();
    
    // Reset ball position and target
    gameState.ball.x = CANVAS_WIDTH / 2;
    gameState.ball.y = CANVAS_HEIGHT / 2;
    gameState.ball.vx = 0;
    gameState.ball.vy = 0;
    
    ballTarget.x = CANVAS_WIDTH / 2;
    ballTarget.y = CANVAS_HEIGHT / 2;
    ballTarget.vx = 0;
    ballTarget.vy = 0;
    
    // Start game loop
    if (!gameLoopInterval) {
        gameLoopInterval = setInterval(gameLoop, 1000 / FRAME_RATE);
    }
    
    // Auto-launch ball after 1 second
    setTimeout(() => {
        if (gameState.isBallOwner) {
            launchBall();
        }
    }, 1000);
}

function launchBall() {
    if (gameState.ball.vx === 0 && gameState.isBallOwner) {
        document.getElementById('status-text').textContent = 'PONG!';
        
        // Initialize ball velocity
        const angle = (Math.random() * Math.PI / 3) - Math.PI / 6;
        const direction = Math.random() < 0.5 ? 1 : -1;
        gameState.ball.vx = Math.cos(angle) * BALL_SPEED_INITIAL * direction;
        gameState.ball.vy = Math.sin(angle) * BALL_SPEED_INITIAL;
        
        // Initialize target for smooth interpolation
        ballTarget.x = gameState.ball.x;
        ballTarget.y = gameState.ball.y;
        ballTarget.vx = gameState.ball.vx;
        ballTarget.vy = gameState.ball.vy;
        
        // Notify other player
        SpixiAppSdk.sendNetworkData(JSON.stringify({ a: "launch" }));
        lastDataSent = SpixiTools.getTimestamp();
        setTimeout(() => sendBallState(), 16);
    }
}

function gameLoop() {
    if (!gameState.gameStarted || gameState.gameEnded) {
        return;
    }
    
    updatePaddle();
    
    // Ball owner updates ball physics
    if (gameState.isBallOwner) {
        if (gameState.ball.vx !== 0) {
            updateBall();
            checkCollisions();
            checkScore();
        }
    } else {
        // Non-owner: always interpolate (even when ball is stationary)
        if (gameState.ball.vx !== 0 || ballTarget.vx !== 0) {
            interpolateBall();
        } else {
            // Keep ball centered if not moving
            gameState.ball.x = ballTarget.x;
            gameState.ball.y = ballTarget.y;
        }
    }
    
    render();
    
    // Send paddle position frequently for real-time updates
    const currentTime = Date.now();
    if (currentTime - lastDataSent >= PADDLE_UPDATE_RATE) {
        sendPaddlePosition();
    }
    
    // Ball owner sends ball state at 60fps when active
    if (gameState.isBallOwner && gameState.ball.vx !== 0) {
        const timeSinceLastBallUpdate = currentTime - lastBallUpdate;
        if (timeSinceLastBallUpdate >= BALL_UPDATE_RATE) {
            sendBallState();
            lastBallUpdate = currentTime;
        }
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
    const lerpFactor = ballInterpolationSpeed;
    gameState.ball.x += (ballTarget.x - gameState.ball.x) * lerpFactor;
    gameState.ball.y += (ballTarget.y - gameState.ball.y) * lerpFactor;
    
    // Interpolate velocity
    gameState.ball.vx += (ballTarget.vx - gameState.ball.vx) * lerpFactor;
    gameState.ball.vy += (ballTarget.vy - gameState.ball.vy) * lerpFactor;
    
    // Add predictive movement
    gameState.ball.x += gameState.ball.vx * 0.6;
    gameState.ball.y += gameState.ball.vy * 0.6;
    
    // Keep ball visible and in bounds
    gameState.ball.x = Math.max(BALL_SIZE, Math.min(CANVAS_WIDTH - BALL_SIZE, gameState.ball.x));
    gameState.ball.y = Math.max(BALL_SIZE, Math.min(CANVAS_HEIGHT - BALL_SIZE, gameState.ball.y));
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
    document.getElementById('startBtn').textContent = 'START';
    document.getElementById('status-text').textContent = 'PRESS START!';
    
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
    // Use compact packet: shortened keys and minimal precision
    SpixiAppSdk.sendNetworkData(JSON.stringify({
        a: "b",
        x: Math.round(b.x),
        y: Math.round(b.y),
        vx: Number(b.vx.toFixed(1)),
        vy: Number(b.vy.toFixed(1))
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
                
            case "b": // Optimized ball update
                if (!gameState.isBallOwner) {
                    // Update target for smooth interpolation
                    ballTarget.x = msg.x;
                    ballTarget.y = msg.y;
                    ballTarget.vx = msg.vx;
                    ballTarget.vy = msg.vy;
                    
                    // Snap if ball just started or is very far away
                    const distance = Math.sqrt(
                        Math.pow(gameState.ball.x - msg.x, 2) + 
                        Math.pow(gameState.ball.y - msg.y, 2)
                    );
                    if (gameState.ball.vx === 0 || distance > 200) {
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
