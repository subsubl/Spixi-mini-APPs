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
const FRAME_RATE = 60; // Render at 60fps
const NETWORK_SEND_RATE = 100; // Send network updates at 10fps (100ms)

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
let lastBallUpdate = Date.now();

// Paddle interpolation for smooth remote paddle (60fps rendering from 10fps network data)
let remotePaddleTarget = CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2;
const PADDLE_LERP_FACTOR = 0.25; // Slower lerp for smooth 60fps interpolation from 10fps data

let canvas, ctx;
let remotePlayerAddress = '';
let sessionId = '';
let playerLastSeen = 0;
let lastDataSent = 0;
let lastSyncTime = 0;
let frameCounter = 0;
let lastSentPaddleY = 0;
let keysPressed = {};
let touchControlActive = null;
let connectionEstablished = false;

// Random number exchange for ball owner determination
let myRandomNumber = Math.floor(Math.random() * 1000);
let remoteRandomNumber = null;

// Connection quality monitoring
let packetReceiveCount = 0;
let lastPacketRateCheck = Date.now();
let currentPacketRate = 0;
let connectionQuality = 'good'; // 'good', 'fair', 'poor'
let autoStartTimer = null;
let gameStartTime = 0;

// Network ping interval
let pingInterval = null;
let gameLoopInterval = null;

// Simplified connection handshake
function establishConnection() {
    // Send connection request with session ID and random number for ball owner determination
    const msg = { a: "connect", sid: sessionId, rand: myRandomNumber };
    SpixiAppSdk.sendNetworkData(JSON.stringify(msg));
    lastDataSent = SpixiTools.getTimestamp();
}

function handleConnectionEstablished() {
    connectionEstablished = true;
    
    // Update connection status
    const statusLabel = document.querySelector('.status-label');
    if (statusLabel) {
        statusLabel.textContent = 'Connected';
    }
    
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
    
    // Transition to game screen
    document.getElementById('waiting-screen').classList.replace('screen-active', 'screen-hidden');
    document.getElementById('game-screen').classList.replace('screen-hidden', 'screen-active');
    
    // Auto-start after brief delay
    autoStartTimer = setTimeout(() => startGame(), 500);
}

function initGame() {
    canvas = document.getElementById('pongCanvas');
    ctx = canvas.getContext('2d');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    
    setupControls();
    
    // Show waiting screen initially with modern classes
    const waitingScreen = document.getElementById('waiting-screen');
    waitingScreen.classList.add('screen-active');
    waitingScreen.classList.remove('screen-hidden');
    
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
    // Start button - removed, game auto-starts on connection
    
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

function startGame() {
    gameStartTime = Date.now();
    gameState.gameStarted = true;
    
    // Determine ball owner based on random number comparison
    // Higher number wins. If equal (rare), compare session IDs
    if (myRandomNumber === remoteRandomNumber) {
        gameState.isBallOwner = sessionId > remotePlayerAddress;
    } else {
        gameState.isBallOwner = myRandomNumber > remoteRandomNumber;
    }
    
    // Update UI
    document.getElementById('startBtn').style.display = 'none';
    const shootBtn = document.getElementById('shootBtn');
    shootBtn.style.display = 'inline-flex';
    shootBtn.disabled = !gameState.isBallOwner;
    document.getElementById('status-text').textContent = gameState.isBallOwner ? 'Launch Ball!' : 'Opponent Serves...';
    
    // Reset game state
    resetBallPosition();
    frameCounter = 0;
    lastSyncTime = Date.now();
    
    // Start game loop
    if (!gameLoopInterval) {
        gameLoopInterval = setInterval(gameLoop, 1000 / FRAME_RATE);
    }
}

function resetBallPosition() {
    gameState.ball.x = CANVAS_WIDTH / 2;
    gameState.ball.y = CANVAS_HEIGHT / 2;
    gameState.ball.vx = 0;
    gameState.ball.vy = 0;
    
    ballTarget.x = CANVAS_WIDTH / 2;
    ballTarget.y = CANVAS_HEIGHT / 2;
    ballTarget.vx = 0;
    ballTarget.vy = 0;
}

function launchBall() {
    if (gameState.ball.vx === 0 && gameState.isBallOwner) {
        document.getElementById('shootBtn').style.display = 'none';
        document.getElementById('status-text').textContent = 'Game On!';
        
        // Initialize ball velocity
        const angle = (Math.random() * Math.PI / 3) - Math.PI / 6;
        const direction = Math.random() < 0.5 ? 1 : -1;
        gameState.ball.vx = Math.cos(angle) * BALL_SPEED_INITIAL * direction;
        gameState.ball.vy = Math.sin(angle) * BALL_SPEED_INITIAL;
        
        // Sync target with actual
        ballTarget.x = gameState.ball.x;
        ballTarget.y = gameState.ball.y;
        ballTarget.vx = gameState.ball.vx;
        ballTarget.vy = gameState.ball.vy;
        
        // Notify other player and sync immediately
        SpixiAppSdk.sendNetworkData(JSON.stringify({ a: "launch" }));
        lastDataSent = SpixiTools.getTimestamp();
        lastSyncTime = 0;
        sendGameState();
    }
}

function gameLoop() {
    if (!gameState.gameStarted || gameState.gameEnded) {
        return;
    }
    
    frameCounter++;
    updatePaddle();
    
    // Smooth interpolate remote paddle position
    gameState.remotePaddle.y += (remotePaddleTarget - gameState.remotePaddle.y) * PADDLE_LERP_FACTOR;
    
    // Both players simulate ball movement using current velocity
    const ballHasVelocity = Math.abs(gameState.ball.vx) > 0.1 || Math.abs(gameState.ball.vy) > 0.1;
    
    if (ballHasVelocity) {
        updateBall();
        
        // Only ball owner checks collisions and score
        if (gameState.isBallOwner) {
            checkCollisions();
            checkScore();
        }
    }
    
    render();
    
    // Send unified game state at 10fps (every 100ms)
    const currentTime = Date.now();
    const timeSinceLastSync = currentTime - lastSyncTime;
    
    if (timeSinceLastSync >= NETWORK_SEND_RATE) {
        sendGameState();
        lastSyncTime = currentTime;
    }
}

function updatePaddle() {
    const moveUp = keysPressed['up'] || touchControlActive === 'up';
    const moveDown = keysPressed['down'] || touchControlActive === 'down';
    
    // Always control your own paddle
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



function checkCollisions() {
    // Ball owner always on right side
    const rightPaddleX = CANVAS_WIDTH - 20 - PADDLE_WIDTH;
    const leftPaddleX = 20;
    
    let rightPaddleY, leftPaddleY;
    if (gameState.isBallOwner) {
        rightPaddleY = gameState.localPaddle.y;
        leftPaddleY = gameState.remotePaddle.y;
    } else {
        rightPaddleY = gameState.remotePaddle.y;
        leftPaddleY = gameState.localPaddle.y;
    }
    
    // Right paddle collision (ball owner)
    if (gameState.ball.x + BALL_SIZE / 2 >= rightPaddleX &&
        gameState.ball.x - BALL_SIZE / 2 <= rightPaddleX + PADDLE_WIDTH &&
        gameState.ball.y >= rightPaddleY &&
        gameState.ball.y <= rightPaddleY + PADDLE_HEIGHT) {
        
        gameState.ball.vx = -Math.abs(gameState.ball.vx); // Bounce left
        gameState.ball.vx += gameState.ball.vx > 0 ? BALL_SPEED_INCREMENT : -BALL_SPEED_INCREMENT;
        
        const relativeIntersectY = (rightPaddleY + PADDLE_HEIGHT / 2) - gameState.ball.y;
        gameState.ball.vy = -relativeIntersectY * 0.15;
        
        gameState.ball.x = rightPaddleX - BALL_SIZE / 2;
        sendBallState(); // Send ball state on collision
    }
    
    // Left paddle collision (non-owner)
    if (gameState.ball.x - BALL_SIZE / 2 <= leftPaddleX + PADDLE_WIDTH &&
        gameState.ball.x + BALL_SIZE / 2 >= leftPaddleX &&
        gameState.ball.y >= leftPaddleY &&
        gameState.ball.y <= leftPaddleY + PADDLE_HEIGHT) {
        
        gameState.ball.vx = Math.abs(gameState.ball.vx); // Bounce right
        gameState.ball.vx += gameState.ball.vx > 0 ? BALL_SPEED_INCREMENT : -BALL_SPEED_INCREMENT;
        
        const relativeIntersectY = (leftPaddleY + PADDLE_HEIGHT / 2) - gameState.ball.y;
        gameState.ball.vy = -relativeIntersectY * 0.15;
        
        gameState.ball.x = leftPaddleX + PADDLE_WIDTH + BALL_SIZE / 2;
        sendBallState(); // Send ball state on collision
    }
}

function checkScore() {
    if (gameState.ball.x < 0) {
        // Left side (non-owner) missed
        if (gameState.isBallOwner) {
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
    } else if (gameState.ball.x > CANVAS_WIDTH) {
        // Right side (ball owner) missed
        if (gameState.isBallOwner) {
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
    }
}

function resetBall() {
    // Reset to center
    resetBallPosition();
    
    // Launch ball with random velocity
    const angle = (Math.random() * Math.PI / 3) - Math.PI / 6;
    const direction = Math.random() < 0.5 ? 1 : -1;
    gameState.ball.vx = Math.cos(angle) * BALL_SPEED_INITIAL * direction;
    gameState.ball.vy = Math.sin(angle) * BALL_SPEED_INITIAL;
    
    // Sync target
    ballTarget.vx = gameState.ball.vx;
    ballTarget.vy = gameState.ball.vy;
    
    // Send immediately
    lastSyncTime = 0;
    sendGameState();
}

function updateLivesDisplay() {
    document.getElementById('local-score').textContent = gameState.localPaddle.lives;
    document.getElementById('remote-score').textContent = gameState.remotePaddle.lives;
    
    // Update life dots
    const playerDots = document.querySelectorAll('.player-score .life-dot');
    const opponentDots = document.querySelectorAll('.opponent-score .life-dot');
    
    playerDots.forEach((dot, index) => {
        if (index < gameState.localPaddle.lives) {
            dot.classList.add('active');
        } else {
            dot.classList.remove('active');
        }
    });
    
    opponentDots.forEach((dot, index) => {
        if (index < gameState.remotePaddle.lives) {
            dot.classList.add('active');
        } else {
            dot.classList.remove('active');
        }
    });
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
    
    // Draw connection quality indicator (top right)
    if (connectionEstablished && gameState.gameStarted) {
        ctx.save();
        ctx.font = '12px Arial';
        ctx.textAlign = 'right';
        
        // Color based on quality
        if (connectionQuality === 'good') {
            ctx.fillStyle = '#48bb78'; // green
        } else if (connectionQuality === 'fair') {
            ctx.fillStyle = '#ed8936'; // orange
        } else {
            ctx.fillStyle = '#f56565'; // red
        }
        
        // Draw indicator dot and text
        ctx.fillRect(CANVAS_WIDTH - 15, 10, 8, 8);
        ctx.fillText(`${currentPacketRate} pps`, CANVAS_WIDTH - 25, 16);
        ctx.restore();
    }
    
    // Draw paddles - ball owner always on right side
    // If I own ball: I'm on right (red), opponent on left (blue)
    // If opponent owns ball: opponent on right (red), I'm on left (blue)
    
    let rightPaddleY, leftPaddleY, rightPaddleColor, leftPaddleColor;
    
    if (gameState.isBallOwner) {
        // I own ball - I'm on right (red)
        rightPaddleY = gameState.localPaddle.y;
        leftPaddleY = gameState.remotePaddle.y;
        rightPaddleColor = '#f56565'; // Red for ball owner
        leftPaddleColor = '#4299e1';  // Blue for non-owner
    } else {
        // Opponent owns ball - opponent on right (red)
        rightPaddleY = gameState.remotePaddle.y;
        leftPaddleY = gameState.localPaddle.y;
        rightPaddleColor = '#f56565'; // Red for ball owner
        leftPaddleColor = '#4299e1';  // Blue for non-owner
    }
    
    const rightPaddleX = CANVAS_WIDTH - 20 - PADDLE_WIDTH;
    const leftPaddleX = 20;
    
    // Draw right paddle (ball owner)
    ctx.fillStyle = rightPaddleColor;
    ctx.fillRect(rightPaddleX, rightPaddleY, PADDLE_WIDTH, PADDLE_HEIGHT);
    
    // Draw left paddle (non-owner)
    ctx.fillStyle = leftPaddleColor;
    ctx.fillRect(leftPaddleX, leftPaddleY, PADDLE_WIDTH, PADDLE_HEIGHT);
    
    // Draw ball - always white
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
    
    // Calculate game duration
    const duration = Math.floor((Date.now() - gameStartTime) / 1000);
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    const durationText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    // Smooth transition to game over screen
    const gameScreen = document.getElementById('game-screen');
    const gameOverScreen = document.getElementById('game-over-screen');
    
    gameScreen.classList.remove('screen-active');
    gameScreen.classList.add('screen-hidden');
    gameOverScreen.classList.remove('screen-hidden');
    gameOverScreen.classList.add('screen-active');
    
    // Update result UI
    const resultText = document.getElementById('result-text');
    const resultIcon = document.getElementById('resultIcon');
    
    if (won) {
        resultText.textContent = 'Victory!';
        resultText.classList.add('victory');
        resultText.classList.remove('defeat');
        resultIcon.classList.add('victory');
        resultIcon.classList.remove('defeat');
        // Update icon to checkmark (already in HTML)
    } else {
        resultText.textContent = 'Defeat';
        resultText.classList.add('defeat');
        resultText.classList.remove('victory');
        resultIcon.classList.add('defeat');
        resultIcon.classList.remove('victory');
        // Update icon to X
        resultIcon.innerHTML = `
            <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" stroke-width="4"/>
                <path d="M35 35 L65 65 M65 35 L35 65" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>
            </svg>
        `;
    }
    
    document.getElementById('final-score').textContent = 
        `Final Score: ${gameState.localPaddle.lives} - ${gameState.remotePaddle.lives}`;
    document.getElementById('gameDuration').textContent = durationText;
    
    saveGameState();
    sendEndGame();
}

function restartGame() {
    // Reset game state
    gameState.localPaddle.y = CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2;
    gameState.localPaddle.lives = MAX_LIVES;
    gameState.remotePaddle.y = CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2;
    gameState.remotePaddle.lives = MAX_LIVES;
    gameState.gameStarted = false;
    gameState.gameEnded = false;
    
    resetBallPosition();
    updateLivesDisplay();
    
    // Transition screens
    document.getElementById('game-over-screen').classList.replace('screen-active', 'screen-hidden');
    document.getElementById('game-screen').classList.replace('screen-hidden', 'screen-active');
    
    // Notify remote player and auto-start
    SpixiAppSdk.sendNetworkData(JSON.stringify({ a: "restart" }));
    lastDataSent = SpixiTools.getTimestamp();
    setTimeout(() => startGame(), 500);
}

function exitGame() {
    // Cleanup intervals
    if (gameLoopInterval) clearInterval(gameLoopInterval);
    if (pingInterval) clearInterval(pingInterval);
    if (autoStartTimer) clearTimeout(autoStartTimer);
    
    // Close app
    SpixiAppSdk.spixiAction("close");
}

// Network functions - Unified game state sync at 10fps (100ms intervals)
function sendGameState() {
    if (!gameState.gameStarted || gameState.gameEnded) {
        return; // Don't send if game not active
    }
    
    const currentTime = SpixiTools.getTimestamp();
    lastDataSent = currentTime;
    
    const paddleY = Math.round(gameState.localPaddle.y);
    
    // Build unified state packet with paddle (always)
    const state = {
        a: "state",
        f: frameCounter, // Frame number for sync
        p: paddleY // Paddle position (always included)
    };
    
    // Include ball data if this player owns the ball and it's active
    const ballActive = Math.abs(gameState.ball.vx) > 0.1 || Math.abs(gameState.ball.vy) > 0.1;
    if (gameState.isBallOwner && ballActive) {
        const b = gameState.ball;
        // Mirror X coordinates for opponent's view (they see from opposite side)
        state.b = {
            x: Math.round(CANVAS_WIDTH - b.x),
            y: Math.round(b.y),
            vx: Number((-b.vx).toFixed(2)),
            vy: Number(b.vy.toFixed(2))
        };
    }
    
    SpixiAppSdk.sendNetworkData(JSON.stringify(state));
}

function sendLifeUpdate() {
    // Send life updates sporadically (only when score changes, not on timer)
    const currentTime = SpixiTools.getTimestamp();
    lastDataSent = currentTime;
    SpixiAppSdk.sendNetworkData(JSON.stringify({
        a: "lives",
        local: gameState.localPaddle.lives,
        remote: gameState.remotePaddle.lives
    }));
}

function sendEndGame() {
    const currentTime = SpixiTools.getTimestamp();
    lastDataSent = currentTime;
    SpixiAppSdk.sendNetworkData(JSON.stringify({
        a: "end",
        local: gameState.localPaddle.lives,
        remote: gameState.remotePaddle.lives
    }));
}

function saveGameState() {
    // Save final game state for statistics/history (optional)
    if (remotePlayerAddress !== '') {
        setTimeout(() => {
            SpixiAppSdk.setStorageData(remotePlayerAddress, btoa(JSON.stringify(gameState)));
        }, 50);
    }
}

// Spixi SDK callbacks
SpixiAppSdk.onInit = function(sid, userAddresses) {
    sessionId = sid;
    const addresses = userAddresses.split(",");
    remotePlayerAddress = addresses[0];
    
    // Local player is always on the right side
    
    // Initialize game UI and start connection
    initGame();
    establishConnection();
    
    // Show waiting screen - always start with fresh game
    const waitingScreen = document.getElementById('waiting-screen');
    const gameScreen = document.getElementById('game-screen');
    waitingScreen.style.display = 'flex';
    gameScreen.style.display = 'none';
    
    const waitingText = document.querySelector('.waiting-text');
    if (waitingText) {
        waitingText.textContent = 'Connecting to opponent...';
    }
};

SpixiAppSdk.onNetworkData = function(senderAddress, data) {
    playerLastSeen = SpixiTools.getTimestamp();
    
    // Track packet rate for connection quality
    packetReceiveCount++;
    const now = Date.now();
    if (now - lastPacketRateCheck >= 1000) {
        currentPacketRate = packetReceiveCount;
        packetReceiveCount = 0;
        lastPacketRateCheck = now;
        
        // Update connection quality
        if (currentPacketRate >= 60) {
            connectionQuality = 'good';
        } else if (currentPacketRate >= 30) {
            connectionQuality = 'fair';
        } else {
            connectionQuality = 'poor';
        }
    }
    
    try {
        const msg = JSON.parse(data);
        
        switch(msg.a) {
            case "connect":
                // Received connection request, reply back with our random number
                if (msg.rand !== undefined) {
                    remoteRandomNumber = msg.rand;
                }
                if (!connectionEstablished) {
                    SpixiAppSdk.sendNetworkData(JSON.stringify({ a: "connect", sid: sessionId, rand: myRandomNumber }));
                    lastDataSent = SpixiTools.getTimestamp();
                    
                    // Only establish connection if we have both random numbers
                    if (remoteRandomNumber !== null) {
                        handleConnectionEstablished();
                    }
                }
                break;
                
            case "ping":
                // Connection keepalive
                break;
                
            case "launch":
                // Ball owner has launched - hide shoot button and update status
                if (!gameState.isBallOwner) {
                    document.getElementById('shootBtn').style.display = 'none';
                    document.getElementById('status-text').textContent = 'Game On!';
                }
                break;
                
            case "state": // Unified game state update
                // Update remote paddle target for smooth interpolation
                if (msg.p !== undefined) {
                    remotePaddleTarget = msg.p;
                }
                
                // Non-owner readjusts ball when velocity changes (bounce detected)
                if (msg.b && !gameState.isBallOwner) {
                    // Convert from sender's coordinate system to ours (mirror X)
                    const mirroredX = CANVAS_WIDTH - msg.b.x;
                    const mirroredVx = -msg.b.vx;
                    
                    const velocityChanged = 
                        Math.abs(gameState.ball.vx - mirroredVx) > 0.5 || 
                        Math.abs(gameState.ball.vy - msg.b.vy) > 0.5;
                    
                    if (velocityChanged) {
                        // Bounce detected - resync position and velocity
                        gameState.ball.x = mirroredX;
                        gameState.ball.y = msg.b.y;
                        gameState.ball.vx = mirroredVx;
                        gameState.ball.vy = msg.b.vy;
                    } else {
                        // No bounce - just check for drift
                        const distance = Math.sqrt(
                            Math.pow(gameState.ball.x - mirroredX, 2) + 
                            Math.pow(gameState.ball.y - msg.b.y, 2)
                        );
                        
                        // Only correct if significantly off (late data)
                        if (distance > 100) {
                            gameState.ball.x = mirroredX;
                            gameState.ball.y = msg.b.y;
                        }
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
    // Storage is only used to save final game state
    // Don't restore old game state on startup - always start fresh
    if (value !== 'null') {
        try {
            const savedState = JSON.parse(atob(value));
            // Ignore saved state - we always want to start a new game
            console.log("Previous game state found but ignored - starting fresh");
        } catch (e) {
            console.error("Error parsing saved state:", e);
        }
    }
};

// Start the app on load
window.onload = SpixiAppSdk.fireOnLoad;
