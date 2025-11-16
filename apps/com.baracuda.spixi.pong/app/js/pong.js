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
        vx: BALL_SPEED_INITIAL,
        vy: BALL_SPEED_INITIAL * 0.5
    },
    isHost: false,
    gameStarted: false,
    gameEnded: false,
    waitingForStart: true,
    lastUpdate: 0
};

let canvas, ctx;
let remotePlayerAddress = '';
let playerLastSeen = 0;
let lastDataSent = 0;
let keysPressed = {};
let touchControlActive = null;
let helloReceived = false;
let helloPingInterval = null;
let bothUsersPresent = false;
let localPlayerReady = false;
let remotePlayerReady = false;
let countdownActive = false;
let countdownValue = 3;
let ballActive = false;
let waitingForShoot = false;

// Network ping interval
let pingInterval = null;
let gameLoopInterval = null;

function startHelloPing() {
    // Clear any existing interval
    if (helloPingInterval) {
        clearInterval(helloPingInterval);
    }
    
    // Send hello immediately
    SpixiAppSdk.sendNetworkData(JSON.stringify({a:"h"}));
    lastDataSent = SpixiTools.getTimestamp();
    
    // Ping every second until we get a response
    helloPingInterval = setInterval(() => {
        if (!bothUsersPresent) {
            SpixiAppSdk.sendNetworkData(JSON.stringify({a:"h"}));
            lastDataSent = SpixiTools.getTimestamp();
        } else {
            clearInterval(helloPingInterval);
            helloPingInterval = null;
            // Start regular ping interval
            if (!pingInterval) {
                pingInterval = setInterval(regularPing, 2000);
            }
        }
    }, 1000);
}

function regularPing() {
    const currentTime = SpixiTools.getTimestamp();
    if (currentTime - lastDataSent < 2) {
        return;
    }
    lastDataSent = currentTime;
    SpixiAppSdk.sendNetworkData(JSON.stringify({a:"p"}));
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
            if (bothUsersPresent && !localPlayerReady) {
                localPlayerReady = true;
                startBtn.disabled = true;
                startBtn.textContent = 'Waiting for opponent...';
                sendPlayerReady();
                checkBothPlayersReady();
            }
        });
    }
    
    // Shoot button
    const shootBtn = document.getElementById('shootBtn');
    if (shootBtn) {
        shootBtn.addEventListener('click', () => {
            if (waitingForShoot && gameState.isHost) {
                shootBall();
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
    document.getElementById('waiting-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'block';
    document.getElementById('startBtn').style.display = 'none';
    
    if (gameState.isHost) {
        document.getElementById('status-text').textContent = 'Click SHOOT to start!';
        document.getElementById('shootBtn').style.display = 'inline-block';
        waitingForShoot = true;
    } else {
        document.getElementById('status-text').textContent = 'Waiting for opponent to shoot...';
        document.getElementById('shootBtn').style.display = 'none';
    }
    
    gameState.gameStarted = true;
    gameState.waitingForStart = false;
    gameState.lastUpdate = SpixiTools.getTimestamp();
    
    // Ball stays centered until shot
    gameState.ball.x = CANVAS_WIDTH / 2;
    gameState.ball.y = CANVAS_HEIGHT / 2;
    gameState.ball.vx = 0;
    gameState.ball.vy = 0;
    ballActive = false;
    
    // Start game loop
    if (!gameLoopInterval) {
        gameLoopInterval = setInterval(gameLoop, 1000 / FRAME_RATE);
    }
}

function shootBall() {
    if (!ballActive && gameState.isHost) {
        waitingForShoot = false;
        ballActive = true;
        document.getElementById('shootBtn').style.display = 'none';
        document.getElementById('status-text').textContent = 'Game On!';
        
        // Initialize ball velocity
        const angle = (Math.random() * Math.PI / 3) - Math.PI / 6;
        const direction = Math.random() < 0.5 ? 1 : -1;
        gameState.ball.vx = Math.cos(angle) * BALL_SPEED_INITIAL * direction;
        gameState.ball.vy = Math.sin(angle) * BALL_SPEED_INITIAL;
        
        // Notify other player
        sendShootNotification();
        setTimeout(() => sendGameState(), 50);
    }
}

function gameLoop() {
    if (!gameState.gameStarted || gameState.gameEnded) {
        return;
    }
    
    updatePaddle();
    
    if (gameState.isHost && ballActive) {
        updateBall();
        checkCollisions();
        checkScore();
    }
    
    render();
    
    // Send paddle position frequently for real-time updates
    const currentTime = Date.now();
    if (currentTime - lastDataSent >= PADDLE_UPDATE_RATE) {
        sendPaddlePosition();
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

function checkCollisions() {
    const localPaddleX = gameState.isHost ? 20 : CANVAS_WIDTH - 20 - PADDLE_WIDTH;
    const remotePaddleX = gameState.isHost ? CANVAS_WIDTH - 20 - PADDLE_WIDTH : 20;
    
    // Local paddle collision
    if (gameState.ball.x - BALL_SIZE / 2 <= localPaddleX + PADDLE_WIDTH &&
        gameState.ball.x + BALL_SIZE / 2 >= localPaddleX &&
        gameState.ball.y >= gameState.localPaddle.y &&
        gameState.ball.y <= gameState.localPaddle.y + PADDLE_HEIGHT) {
        
        gameState.ball.vx = Math.abs(gameState.ball.vx) * (gameState.isHost ? 1 : -1);
        gameState.ball.vx += gameState.ball.vx > 0 ? BALL_SPEED_INCREMENT : -BALL_SPEED_INCREMENT;
        
        const relativeIntersectY = (gameState.localPaddle.y + PADDLE_HEIGHT / 2) - gameState.ball.y;
        gameState.ball.vy = -relativeIntersectY * 0.15;
        
        gameState.ball.x = localPaddleX + (gameState.isHost ? PADDLE_WIDTH + BALL_SIZE / 2 : -BALL_SIZE / 2);
    }
    
    // Remote paddle collision
    if (gameState.ball.x - BALL_SIZE / 2 <= remotePaddleX + PADDLE_WIDTH &&
        gameState.ball.x + BALL_SIZE / 2 >= remotePaddleX &&
        gameState.ball.y >= gameState.remotePaddle.y &&
        gameState.ball.y <= gameState.remotePaddle.y + PADDLE_HEIGHT) {
        
        gameState.ball.vx = Math.abs(gameState.ball.vx) * (gameState.isHost ? -1 : 1);
        gameState.ball.vx += gameState.ball.vx > 0 ? BALL_SPEED_INCREMENT : -BALL_SPEED_INCREMENT;
        
        const relativeIntersectY = (gameState.remotePaddle.y + PADDLE_HEIGHT / 2) - gameState.ball.y;
        gameState.ball.vy = -relativeIntersectY * 0.15;
        
        gameState.ball.x = remotePaddleX + (gameState.isHost ? -BALL_SIZE / 2 : PADDLE_WIDTH + BALL_SIZE / 2);
    }
}

function checkScore() {
    if (gameState.ball.x < 0) {
        // Local player missed - loses a life
        gameState.localPaddle.lives--;
        updateLivesDisplay();
        if (gameState.localPaddle.lives <= 0) {
            endGame(false);
        } else {
            resetBall();
            sendGameState();
        }
    } else if (gameState.ball.x > CANVAS_WIDTH) {
        // Remote player missed - loses a life
        gameState.remotePaddle.lives--;
        updateLivesDisplay();
        if (gameState.remotePaddle.lives <= 0) {
            endGame(true);
        } else {
            resetBall();
            sendGameState();
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
    const localPaddleX = gameState.isHost ? 20 : CANVAS_WIDTH - 20 - PADDLE_WIDTH;
    ctx.fillRect(localPaddleX, gameState.localPaddle.y, PADDLE_WIDTH, PADDLE_HEIGHT);
    
    ctx.fillStyle = '#f56565';
    const remotePaddleX = gameState.isHost ? CANVAS_WIDTH - 20 - PADDLE_WIDTH : 20;
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
        isHost: gameState.isHost,
        gameStarted: false,
        gameEnded: false,
        waitingForStart: false,
        lastUpdate: 0
    };
    
    localPlayerReady = false;
    remotePlayerReady = false;
    countdownActive = false;
    ballActive = false;
    waitingForShoot = false;
    
    document.getElementById('game-over-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'block';
    document.getElementById('startBtn').style.display = 'inline-block';
    document.getElementById('startBtn').disabled = false;
    document.getElementById('startBtn').textContent = 'Start Game';
    document.getElementById('shootBtn').style.display = 'none';
    document.getElementById('status-text').textContent = 'Press START when ready!';
    
    updateLivesDisplay();
    
    if (remotePlayerAddress !== '') {
        sendRestartRequest();
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
    // Optimized: a=action, y=position (rounded to int)
    SpixiAppSdk.sendNetworkData(JSON.stringify({a:"m",y:Math.round(gameState.localPaddle.y)}));
}

function sendStartGame() {
    lastDataSent = SpixiTools.getTimestamp();
    SpixiAppSdk.sendNetworkData(JSON.stringify({a:"s"}));
}

function sendGameState() {
    lastDataSent = SpixiTools.getTimestamp();
    // Optimized: a=action, b=ball(x,y,vx,vy rounded), l=local lives, r=remote lives
    const b = gameState.ball;
    SpixiAppSdk.sendNetworkData(JSON.stringify({
        a:"g",
        b:{x:Math.round(b.x),y:Math.round(b.y),vx:b.vx.toFixed(2),vy:b.vy.toFixed(2)},
        l:gameState.localPaddle.lives,
        r:gameState.remotePaddle.lives
    }));
}

function sendEndGame() {
    lastDataSent = SpixiTools.getTimestamp();
    SpixiAppSdk.sendNetworkData(JSON.stringify({
        a:"e",
        l:gameState.localPaddle.lives,
        r:gameState.remotePaddle.lives
    }));
}

function sendRestartRequest() {
    lastDataSent = SpixiTools.getTimestamp();
    SpixiAppSdk.sendNetworkData(JSON.stringify({a:"r"}));
}

function sendPlayerReady() {
    lastDataSent = SpixiTools.getTimestamp();
    SpixiAppSdk.sendNetworkData(JSON.stringify({a:"ready"}));
}

function sendShootNotification() {
    lastDataSent = SpixiTools.getTimestamp();
    SpixiAppSdk.sendNetworkData(JSON.stringify({a:"shoot"}));
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
SpixiAppSdk.onInit = function(sessionId, userAddresses) {
    const addresses = userAddresses.split(",");
    remotePlayerAddress = addresses[0];
    
    // Determine host by comparing addresses
    gameState.isHost = sessionId < remotePlayerAddress;
    
    initGame();
    loadGameState(remotePlayerAddress);
    
    // Start hello ping sequence
    startHelloPing();
    
    // Show waiting screen
    document.getElementById('waiting-screen').style.display = 'flex';
    document.getElementById('game-screen').style.display = 'none';
    document.querySelector('#waiting-screen p').textContent = 'Connecting to opponent...';
};

SpixiAppSdk.onNetworkData = function(senderAddress, data) {
    playerLastSeen = SpixiTools.getTimestamp();
    
    try {
        const d = JSON.parse(data);
        
        switch(d.a) {
            case "h": // hello
                // Reply to hello
                if (!helloReceived) {
                    helloReceived = true;
                    SpixiAppSdk.sendNetworkData(JSON.stringify({a:"h"}));
                }
                
                if (!bothUsersPresent) {
                    bothUsersPresent = true;
                    // Both users present, show game screen with start button
                    document.getElementById('waiting-screen').style.display = 'none';
                    document.getElementById('game-screen').style.display = 'block';
                    document.getElementById('status-text').textContent = 'Press START when ready!';
                    document.getElementById('startBtn').style.display = 'inline-block';
                    document.getElementById('startBtn').disabled = false;
                    document.getElementById('shootBtn').style.display = 'none';
                }
                break;
                
            case "ready": // player ready
                remotePlayerReady = true;
                checkBothPlayersReady();
                break;
                
            case "shoot": // ball shot
                ballActive = true;
                document.getElementById('status-text').textContent = 'Game On!';
                break;
                
            case "p": // ping
                // Connection alive
                break;
                
            case "m": // paddle move
                gameState.remotePaddle.y = d.y;
                break;
                
            case "s": // start game
                if (gameState.waitingForStart) {
                    gameState.waitingForStart = false;
                    startGame();
                }
                break;
                
            case "g": // game state
                if (!gameState.isHost) {
                    const b = d.b;
                    gameState.ball.x = b.x;
                    gameState.ball.y = b.y;
                    gameState.ball.vx = parseFloat(b.vx);
                    gameState.ball.vy = parseFloat(b.vy);
                    gameState.localPaddle.lives = d.r;
                    gameState.remotePaddle.lives = d.l;
                    updateLivesDisplay();
                    
                    // Activate ball if it has velocity
                    if ((gameState.ball.vx !== 0 || gameState.ball.vy !== 0) && !ballActive) {
                        ballActive = true;
                    }
                    
                    if (gameState.localPaddle.lives <= 0) {
                        endGame(false);
                    } else if (gameState.remotePaddle.lives <= 0) {
                        endGame(true);
                    }
                }
                break;
                
            case "e": // end game
                if (!gameState.gameEnded) {
                    gameState.localPaddle.lives = d.r;
                    gameState.remotePaddle.lives = d.l;
                    endGame(gameState.localPaddle.lives > gameState.remotePaddle.lives);
                }
                break;
                
            case "r": // restart
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
