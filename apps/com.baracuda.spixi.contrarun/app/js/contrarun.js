// Contra Run - Co-op Run & Gun Game
// Copyright (C) 2025 Baracuda

// Game Constants
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 480;
const PLAYER_WIDTH = 24;
const PLAYER_HEIGHT = 32;
const PLAYER_SPEED = 3;
const JUMP_POWER = 10;
const GRAVITY = 0.5;
const BULLET_SPEED = 8;
const ENEMY_SPEED = 1.5;
const ENEMY_SHOOT_CHANCE = 0.01;
const FPS = 60;
const NETWORK_UPDATE_RATE = 20; // Hz

// Game State
const gameState = {
    sessionId: null,
    localAddress: null,
    remoteAddress: null,
    connectionEstablished: false,
    isHost: false,
    
    gameStarted: false,
    wave: 1,
    
    localPlayer: null,
    remotePlayer: null,
    
    bullets: [],
    enemies: [],
    enemyBullets: [],
    
    keys: {},
    lastNetworkUpdate: 0,
    frameCount: 0
};

// Connection management
let connectionRetryInterval = null;
let keepaliveInterval = null;
let gameLoopInterval = null;
let networkUpdateInterval = null;

// Random number for determining host (like Pong's ball owner)
let myRandomNumber = Math.floor(Math.random() * 1000);
let remoteRandomNumber = null;

// UI Elements
const elements = {
    menuBtn: document.getElementById('menuBtn'),
    exitBtn: document.getElementById('exitBtn'),
    closeMenuBtn: document.getElementById('closeMenuBtn'),
    sideMenu: document.getElementById('sideMenu'),
    menuOverlay: document.getElementById('menuOverlay'),
    statusText: document.getElementById('statusText'),
    connectionStatus: document.getElementById('connectionStatus'),
    waitingScreen: document.getElementById('waitingScreen'),
    gameHud: document.getElementById('gameHud'),
    canvas: document.getElementById('gameCanvas'),
    gameOver: document.getElementById('gameOver'),
    gameOverTitle: document.getElementById('gameOverTitle'),
    gameOverText: document.getElementById('gameOverText'),
    restartBtn: document.getElementById('restartBtn'),
    p1Health: document.getElementById('p1Health'),
    p2Health: document.getElementById('p2Health'),
    p1Score: document.getElementById('p1Score'),
    p2Score: document.getElementById('p2Score'),
    finalP1Score: document.getElementById('finalP1Score'),
    finalP2Score: document.getElementById('finalP2Score'),
    waveText: document.getElementById('waveText')
};

const ctx = elements.canvas.getContext('2d');
elements.canvas.width = CANVAS_WIDTH;
elements.canvas.height = CANVAS_HEIGHT;

// Player class
class Player {
    constructor(x, y, color, isLocal = false) {
        this.x = x;
        this.y = y;
        this.width = PLAYER_WIDTH;
        this.height = PLAYER_HEIGHT;
        this.color = color;
        this.isLocal = isLocal;
        this.velocityY = 0;
        this.isJumping = false;
        this.health = 100;
        this.score = 0;
        this.lastShot = 0;
    }
    
    update(keys) {
        if (!this.isLocal) return;
        
        // Movement
        if (keys.left && this.x > 0) {
            this.x -= PLAYER_SPEED;
        }
        if (keys.right && this.x < CANVAS_WIDTH - this.width) {
            this.x += PLAYER_SPEED;
        }
        
        // Jump
        if (keys.jump && !this.isJumping) {
            this.velocityY = -JUMP_POWER;
            this.isJumping = true;
        }
        
        // Gravity
        this.velocityY += GRAVITY;
        this.y += this.velocityY;
        
        // Ground collision
        const ground = CANVAS_HEIGHT - 60;
        if (this.y >= ground - this.height) {
            this.y = ground - this.height;
            this.velocityY = 0;
            this.isJumping = false;
        }
        
        // Shooting
        if (keys.shoot && Date.now() - this.lastShot > 300) {
            this.shoot();
            this.lastShot = Date.now();
        }
    }
    
    shoot() {
        gameState.bullets.push({
            x: this.x + this.width,
            y: this.y + this.height / 2,
            speed: BULLET_SPEED,
            owner: this.isLocal ? 'local' : 'remote'
        });
    }
    
    takeDamage(amount) {
        this.health = Math.max(0, this.health - amount);
        return this.health <= 0;
    }
    
    draw() {
        // Player body
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.width, this.height);
        
        // Player head
        ctx.fillStyle = '#ffcc99';
        ctx.fillRect(this.x + 6, this.y + 2, 12, 10);
        
        // Gun
        ctx.fillStyle = '#666666';
        ctx.fillRect(this.x + this.width, this.y + this.height / 2 - 2, 8, 4);
    }
}

// Initialize Spixi SDK
SpixiAppSdk.onInit = function(sessionId, userAddresses) {
    gameState.sessionId = sessionId;
    
    const addresses = userAddresses.split(',');
    if (addresses.length === 2) {
        gameState.localAddress = addresses[0].trim();
        gameState.remoteAddress = addresses[1].trim();
        
        console.log('Initialized - Starting connection handshake');
        startConnectionHandshake();
    }
};

// Connection handshake
function startConnectionHandshake() {
    updateStatus('Connecting...');
    
    connectionRetryInterval = setInterval(() => {
        if (!gameState.connectionEstablished) {
            sendNetworkMessage({
                action: 'connect',
                sessionId: gameState.sessionId,
                rand: myRandomNumber
            });
        } else {
            clearInterval(connectionRetryInterval);
            connectionRetryInterval = null;
        }
    }, 500);
}

function handleConnectionEstablished() {
    gameState.connectionEstablished = true;
    
    // Determine host using random numbers (like Pong's ball owner)
    gameState.isHost = myRandomNumber > remoteRandomNumber;
    console.log('Connection established - Host:', gameState.isHost, 'Random:', myRandomNumber, 'vs', remoteRandomNumber);
    
    updateStatus('Connected', true);
    elements.connectionStatus.classList.add('connected');
    
    // Hide waiting screen
    elements.waitingScreen.style.display = 'none';
    elements.gameHud.style.display = 'flex';
    
    // Start keepalive
    keepaliveInterval = setInterval(() => {
        sendNetworkMessage({ action: 'ping' });
    }, 3000);
    
    // Initialize game
    initGame();
}

// Network handling
SpixiAppSdk.onNetworkData = function(senderAddress, data) {
    try {
        const message = JSON.parse(data);
        
        switch(message.action) {
            case 'connect':
                // Store remote random number
                if (message.rand !== undefined) {
                    remoteRandomNumber = message.rand;
                }
                
                // Always reply with our connection packet (fire-and-forget)
                sendNetworkMessage({
                    action: 'connect',
                    sessionId: gameState.sessionId,
                    rand: myRandomNumber
                });
                
                // Only establish connection if we have both random numbers and not already connected
                if (!gameState.connectionEstablished && remoteRandomNumber !== null) {
                    handleConnectionEstablished();
                }
                break;
                
            case 'ping':
                break;
                
            case 'playerState':
                if (gameState.remotePlayer) {
                    gameState.remotePlayer.x = message.x;
                    gameState.remotePlayer.y = message.y;
                    gameState.remotePlayer.health = message.health;
                    gameState.remotePlayer.score = message.score;
                }
                break;
                
            case 'shoot':
                if (gameState.remotePlayer) {
                    gameState.remotePlayer.shoot();
                }
                break;
                
            case 'enemyHit':
                handleRemoteEnemyHit(message.enemyIndex);
                break;
                
            case 'restart':
                restartGame();
                break;
        }
    } catch (e) {
        console.error('Error parsing network data:', e);
    }
};

function sendNetworkMessage(message) {
    try {
        SpixiAppSdk.sendNetworkData(JSON.stringify(message));
    } catch (e) {
        console.error('Error sending network message:', e);
    }
}

function updateStatus(text, connected = false) {
    elements.statusText.textContent = text;
    if (connected) {
        elements.connectionStatus.classList.add('connected');
    }
}

// Game initialization
function initGame() {
    // Create players
    gameState.localPlayer = new Player(100, CANVAS_HEIGHT - 60 - PLAYER_HEIGHT, '#ff3030', true);
    gameState.remotePlayer = new Player(150, CANVAS_HEIGHT - 60 - PLAYER_HEIGHT, '#3030ff', false);
    
    gameState.wave = 1;
    gameState.gameStarted = true;
    
    spawnWave();
    
    // Start game loop
    gameLoopInterval = setInterval(gameLoop, 1000 / FPS);
    networkUpdateInterval = setInterval(sendPlayerState, 1000 / NETWORK_UPDATE_RATE);
    
    console.log('Game started');
}

function gameLoop() {
    if (!gameState.gameStarted) return;
    
    gameState.frameCount++;
    
    // Update local player
    gameState.localPlayer.update(gameState.keys);
    
    // Update bullets
    updateBullets();
    
    // Update enemies (host only)
    if (gameState.isHost) {
        updateEnemies();
    }
    
    // Check collisions
    checkCollisions();
    
    // Render
    render();
    
    // Update HUD
    updateHUD();
    
    // Check game over
    checkGameOver();
}

function updateBullets() {
    gameState.bullets = gameState.bullets.filter(bullet => {
        bullet.x += bullet.speed;
        return bullet.x < CANVAS_WIDTH;
    });
    
    gameState.enemyBullets = gameState.enemyBullets.filter(bullet => {
        bullet.x -= bullet.speed;
        return bullet.x > 0;
    });
}

function updateEnemies() {
    // Move enemies
    gameState.enemies.forEach(enemy => {
        enemy.x -= ENEMY_SPEED;
        
        // Random shooting
        if (Math.random() < ENEMY_SHOOT_CHANCE) {
            gameState.enemyBullets.push({
                x: enemy.x,
                y: enemy.y + enemy.height / 2,
                speed: 5
            });
        }
    });
    
    // Remove off-screen enemies
    gameState.enemies = gameState.enemies.filter(enemy => enemy.x > -enemy.width);
    
    // Spawn new enemies
    if (gameState.enemies.length < 3 + gameState.wave && Math.random() < 0.02) {
        spawnEnemy();
    }
    
    // Check wave completion
    if (gameState.enemies.length === 0 && gameState.frameCount > 300) {
        nextWave();
    }
}

function spawnEnemy() {
    gameState.enemies.push({
        x: CANVAS_WIDTH,
        y: Math.random() * (CANVAS_HEIGHT - 120) + 30,
        width: 28,
        height: 32,
        health: 1
    });
}

function spawnWave() {
    gameState.enemies = [];
    const enemyCount = 3 + gameState.wave;
    for (let i = 0; i < enemyCount; i++) {
        setTimeout(() => spawnEnemy(), i * 1000);
    }
}

function nextWave() {
    gameState.wave++;
    gameState.frameCount = 0;
    
    // Bonus points
    gameState.localPlayer.score += 500;
    
    elements.waveText.textContent = `WAVE ${gameState.wave}`;
    
    spawnWave();
}

function checkCollisions() {
    // Player bullets vs enemies
    gameState.bullets.forEach((bullet, bIndex) => {
        gameState.enemies.forEach((enemy, eIndex) => {
            if (bullet.x < enemy.x + enemy.width &&
                bullet.x + 4 > enemy.x &&
                bullet.y < enemy.y + enemy.height &&
                bullet.y + 2 > enemy.y) {
                
                enemy.health--;
                gameState.bullets.splice(bIndex, 1);
                
                if (enemy.health <= 0) {
                    gameState.enemies.splice(eIndex, 1);
                    
                    if (bullet.owner === 'local') {
                        gameState.localPlayer.score += 100;
                        
                        // Notify remote
                        sendNetworkMessage({
                            action: 'enemyHit',
                            enemyIndex: eIndex
                        });
                    }
                }
            }
        });
    });
    
    // Enemy bullets vs players
    gameState.enemyBullets.forEach((bullet, bIndex) => {
        if (checkPlayerHit(gameState.localPlayer, bullet)) {
            gameState.localPlayer.takeDamage(10);
            gameState.enemyBullets.splice(bIndex, 1);
        }
        
        if (gameState.remotePlayer && checkPlayerHit(gameState.remotePlayer, bullet)) {
            gameState.enemyBullets.splice(bIndex, 1);
        }
    });
    
    // Enemies vs players
    gameState.enemies.forEach(enemy => {
        if (checkPlayerCollision(gameState.localPlayer, enemy)) {
            gameState.localPlayer.takeDamage(5);
        }
    });
}

function checkPlayerHit(player, bullet) {
    return bullet.x < player.x + player.width &&
           bullet.x + 4 > player.x &&
           bullet.y < player.y + player.height &&
           bullet.y + 2 > player.y;
}

function checkPlayerCollision(player, enemy) {
    return player.x < enemy.x + enemy.width &&
           player.x + player.width > enemy.x &&
           player.y < enemy.y + enemy.height &&
           player.y + player.height > enemy.y;
}

function handleRemoteEnemyHit(enemyIndex) {
    if (enemyIndex < gameState.enemies.length) {
        gameState.enemies.splice(enemyIndex, 1);
    }
}

function render() {
    // Clear canvas
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    // Draw ground
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, CANVAS_HEIGHT - 60, CANVAS_WIDTH, 60);
    
    // Grid pattern on ground
    ctx.strokeStyle = '#1a1a1a';
    for (let i = 0; i < CANVAS_WIDTH; i += 20) {
        ctx.beginPath();
        ctx.moveTo(i, CANVAS_HEIGHT - 60);
        ctx.lineTo(i, CANVAS_HEIGHT);
        ctx.stroke();
    }
    
    // Draw players
    if (gameState.localPlayer) gameState.localPlayer.draw();
    if (gameState.remotePlayer) gameState.remotePlayer.draw();
    
    // Draw bullets
    ctx.fillStyle = '#ffff00';
    gameState.bullets.forEach(bullet => {
        ctx.fillRect(bullet.x, bullet.y, 8, 2);
    });
    
    // Draw enemy bullets
    ctx.fillStyle = '#ff0000';
    gameState.enemyBullets.forEach(bullet => {
        ctx.fillRect(bullet.x, bullet.y, 8, 2);
    });
    
    // Draw enemies
    gameState.enemies.forEach(enemy => {
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);
        
        // Enemy eyes
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(enemy.x + 6, enemy.y + 8, 6, 6);
        ctx.fillRect(enemy.x + 16, enemy.y + 8, 6, 6);
    });
}

function updateHUD() {
    if (gameState.localPlayer) {
        const healthPercent = (gameState.localPlayer.health / 100) * 100;
        elements.p1Health.style.width = healthPercent + '%';
        
        if (healthPercent <= 25) {
            elements.p1Health.classList.add('critical');
        } else if (healthPercent <= 50) {
            elements.p1Health.classList.add('low');
        } else {
            elements.p1Health.classList.remove('low', 'critical');
        }
        
        elements.p1Score.textContent = gameState.localPlayer.score;
    }
    
    if (gameState.remotePlayer) {
        const healthPercent = (gameState.remotePlayer.health / 100) * 100;
        elements.p2Health.style.width = healthPercent + '%';
        
        if (healthPercent <= 25) {
            elements.p2Health.classList.add('critical');
        } else if (healthPercent <= 50) {
            elements.p2Health.classList.add('low');
        } else {
            elements.p2Health.classList.remove('low', 'critical');
        }
        
        elements.p2Score.textContent = gameState.remotePlayer.score;
    }
}

function checkGameOver() {
    if (gameState.localPlayer && gameState.remotePlayer) {
        if (gameState.localPlayer.health <= 0 && gameState.remotePlayer.health <= 0) {
            gameOver();
        }
    }
}

function gameOver() {
    gameState.gameStarted = false;
    
    clearInterval(gameLoopInterval);
    clearInterval(networkUpdateInterval);
    
    elements.gameOver.style.display = 'block';
    elements.gameOverTitle.textContent = 'MISSION FAILED';
    elements.gameOverText.textContent = 'Both soldiers eliminated';
    elements.finalP1Score.textContent = gameState.localPlayer.score;
    elements.finalP2Score.textContent = gameState.remotePlayer.score;
}

function restartGame() {
    elements.gameOver.style.display = 'none';
    
    gameState.bullets = [];
    gameState.enemies = [];
    gameState.enemyBullets = [];
    gameState.wave = 1;
    gameState.frameCount = 0;
    
    if (gameState.localPlayer) {
        gameState.localPlayer.health = 100;
        gameState.localPlayer.score = 0;
        gameState.localPlayer.x = 100;
        gameState.localPlayer.y = CANVAS_HEIGHT - 60 - PLAYER_HEIGHT;
    }
    
    if (gameState.remotePlayer) {
        gameState.remotePlayer.health = 100;
        gameState.remotePlayer.score = 0;
        gameState.remotePlayer.x = 150;
        gameState.remotePlayer.y = CANVAS_HEIGHT - 60 - PLAYER_HEIGHT;
    }
    
    elements.waveText.textContent = 'WAVE 1';
    
    gameState.gameStarted = true;
    spawnWave();
    
    gameLoopInterval = setInterval(gameLoop, 1000 / FPS);
    networkUpdateInterval = setInterval(sendPlayerState, 1000 / NETWORK_UPDATE_RATE);
}

function sendPlayerState() {
    if (!gameState.gameStarted || !gameState.localPlayer) return;
    
    sendNetworkMessage({
        action: 'playerState',
        x: Math.round(gameState.localPlayer.x),
        y: Math.round(gameState.localPlayer.y),
        health: gameState.localPlayer.health,
        score: gameState.localPlayer.score
    });
}

// Controls
const controlBtns = document.querySelectorAll('.dpad-btn, .action-btn');
controlBtns.forEach(btn => {
    const key = btn.dataset.key;
    
    btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        gameState.keys[key] = true;
    });
    
    btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        gameState.keys[key] = false;
    });
    
    btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        gameState.keys[key] = true;
    });
    
    btn.addEventListener('mouseup', (e) => {
        e.preventDefault();
        gameState.keys[key] = false;
    });
});

// Keyboard controls
window.addEventListener('keydown', (e) => {
    switch(e.key) {
        case 'ArrowLeft': gameState.keys.left = true; break;
        case 'ArrowRight': gameState.keys.right = true; break;
        case 'ArrowUp': gameState.keys.up = true; break;
        case 'ArrowDown': gameState.keys.down = true; break;
        case 'z': case 'Z': gameState.keys.shoot = true; break;
        case 'x': case 'X': gameState.keys.jump = true; break;
    }
});

window.addEventListener('keyup', (e) => {
    switch(e.key) {
        case 'ArrowLeft': gameState.keys.left = false; break;
        case 'ArrowRight': gameState.keys.right = false; break;
        case 'ArrowUp': gameState.keys.up = false; break;
        case 'ArrowDown': gameState.keys.down = false; break;
        case 'z': case 'Z': gameState.keys.shoot = false; break;
        case 'x': case 'X': gameState.keys.jump = false; break;
    }
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

// Restart button
elements.restartBtn.addEventListener('click', () => {
    sendNetworkMessage({ action: 'restart' });
    restartGame();
});

// Exit button
elements.exitBtn.addEventListener('click', () => {
    SpixiAppSdk.back();
});

// Cleanup
SpixiAppSdk.onAppEndSession = function(data) {
    if (connectionRetryInterval) clearInterval(connectionRetryInterval);
    if (keepaliveInterval) clearInterval(keepaliveInterval);
    if (gameLoopInterval) clearInterval(gameLoopInterval);
    if (networkUpdateInterval) clearInterval(networkUpdateInterval);
};

// Initialize on load
window.onload = function() {
    console.log('Contra Run loaded');
    SpixiAppSdk.fireOnLoad();
};
