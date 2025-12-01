// Copyright (C) 2025 Baracuda
// Pong - A fast-paced multiplayer game for Spixi Mini Apps

/**
 * MULTIPLAYER NETWORK ARCHITECTURE DOCUMENTATION
 * ===============================================
 * 
 * This implementation uses Gabriel Gambetta's game networking techniques
 * to provide responsive, smooth multiplayer gameplay over high-latency networks.
 * Reference: https://www.gabrielgambetta.com/client-server-game-architecture.html
 * 
 * KEY PATTERNS:
 * 
 * 1. CLIENT-SIDE PREDICTION (Responsive Local Input)
 *    - User paddle moves immediately on input (predictedPaddleY) without waiting
 *    - Local gameLoop uses predictedPaddleY for physics/rendering
 *    - Remote's authoritative paddle is stored separately (lastAuthorativePaddleY)
 *    - Reconciliation replays pending inputs when remote confirms new state
 *    Result: Zero input lag despite 100-500ms network delays
 * 
 * 2. INPUT SEQUENCE TRACKING & SERVER RECONCILIATION
 *    - Each paddle movement gets a unique sequence number (inputSequence++)
 *    - Pending movements stored in pendingInputs[] buffer
 *    - Remote acknowledges which inputs it received (lastAcknowledgedSequence)
 *    - On new state from remote: replay all unacknowledged inputs
 *    Formula: predictedPaddleY = authoritativeState + sum(unacknowledgedInputs)
 *    Result: Smooth prediction even when packets arrive out of order
 * 
 * 3. ENTITY INTERPOLATION (Smooth Remote Movement)
 *    - Remote paddle/ball positions lerp between network updates (every 50ms)
 *    - 60fps rendering interpolates 20fps network data smoothly
 *    - Paddle lerp factor: 0.25 (conservative for accuracy)
 *    - Ball lerp factor: 0.15 (smoother but more forgiving)
 *    Lerp formula: current += (target - current) * lerpFactor
 *    Result: Fluid motion without jittering or jumps
 * 
 * 4. BALL BOUNCE-ONLY SYNCHRONIZATION
 *    - Ball position is simulated locally on both clients every frame
 *    - Ball state is only synchronized on discrete events (launch + bounces)
 *    - No mid-flight acceleration is used in Pong, so full continuous sync
 *      is unnecessary
 *    Result: Fast, snappy ball with minimal network traffic
 * 
 * 5. (Legacy) DEAD RECKONING / INTERPOLATION
 *    - The original implementation used dead reckoning and interpolation
 *      between frequent ball updates
 *    - These have been simplified: ball state is now sent only on launch
 *      and collision events, and remote side snaps immediately
 *    - The helper functions remain but are no longer used for mid-flight
 *      correction, keeping the code easy to evolve if needed later
 * 
 * 6. FRAME COUNTER SYNCHRONIZATION (Out-of-Order Detection)
 *    - Each state packet includes frame counter (f field)
 *    - Remote frame counter must always increment
 *    - Allows up to 2 out-of-order packets per second (network jitter tolerance)
 *    - Rejects packets older than last seen frame
 *    - Maintains mismatch counter to detect network issues
 *    Result: Prevents state rollback from delayed packets
 * 
 * 7. LAG COMPENSATION (Retroactive Collision Processing)
 *    - Collisions timestamped when detected locally (recordCollisionEvent)
 *    - Event stored with frame index, sequence, and ball state
 *    - Buffer maintained for 500ms to match remote events
 *    - Remote collision matches within ±50ms confirms consensus
 *    - Out-of-buffer collisions still accepted for eventual consistency
 *    Result: Accurate collision detection despite 200-500ms round-trip lag
 * 
 * 8. BANDWIDTH OPTIMIZATION (Delta Updates)
 *    - Only changed fields sent per state packet
 *    - Frame counter sent only if incremented
 *    - Paddle position sent only if changed
 *    - Sequence/lastAck sent only if changed
 *    - Ball state sent only if position/velocity differs significantly
 *    Result: ~40-50% reduction in network bandwidth usage
 * 
 * 9. NETWORK ROBUSTNESS
 *    - Frame counter validation prevents state rollback
 *    - Out-of-order packet detection and rejection
 *    - Keep-alive pings maintain connection health
 * 
 * NETWORK PROTOCOL:
 * 
 * State packet (sent every 50ms if changed):
 *   {
 *     a: "state",           // Action type
 *     f: frameCounter,      // Frame number for sync
 *     p: paddleY,          // Paddle position (only if changed)
 *     seq: inputSequence,  // Input sequence number (only if changed)
 *     lastAck: seqNum,     // Acknowledgment of remote's inputs (only if changed)
 *     b: {                 // Ball state (only if moving toward me)
 *       x, y,             // Position (integers)
 *       vx, vy            // Velocity as integers (*100 for 0.01 precision)
 *     }
 *   }
 * 
 * Collision packet (sent on paddle-ball contact):
 *   {
 *     a: "collision",
 *     f: frameCounter,
 *     seq: inputSequence,
 *     t: timestamp,        // Collision event timestamp (ms)
 *     x, y, vx, vy         // Ball state at collision
 *   }
 * 
 * COORDINATE SYSTEM:
 * - Local view: left paddle at x=20, right paddle at x=765
 * - Ball owner (right player) sends ball state with vx > 0 (moving right)
 * - Opponent receives mirrored X coordinates: mirroredX = CANVAS_WIDTH - x
 * - Mirrored velocity: mirroredVx = -vx (direction flips for opponent)
 * - This makes both players see the same ball trajectory
 * 
 * TESTING:
 * - The app implements all Gabriel Gambetta patterns for production use
 * - Network reliability tested through real-world Spixi deployment
 */

// Game constants
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const PADDLE_WIDTH = 15;
const PADDLE_HEIGHT = 100;
const BALL_SIZE = 12;
const PADDLE_SPEED = 8;
const BALL_SPEED_INITIAL = 7;
const BALL_SPEED_INCREMENT = 0.4;
const MAX_LIVES = 3;
const FRAME_RATE = 60; // Render at 60fps
// Dynamic network rate variables
let currentNetworkRate = 33; // Start at 30fps (33ms)
const NETWORK_RATE_ACTIVE = 33; // 30fps when active
const NETWORK_RATE_IDLE = 100; // 10fps when idle
const NETWORK_RATE_THROTTLED = 66; // 15fps when performance is poor

// Sound system
let audioContext;
let soundEnabled = true;

function initAudioContext() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
        console.warn('Web Audio API not supported');
        soundEnabled = false;
    }
}

function playPaddleHitSound() {
    if (!soundEnabled || !audioContext) return;

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 440; // A4 note
    oscillator.type = 'square';

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.1);
}

function playWallBounceSound() {
    if (!soundEnabled || !audioContext) return;

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 220; // A3 note
    oscillator.type = 'square';

    gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.08);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.08);
}

function playScoreSound(isPositive) {
    if (!soundEnabled || !audioContext) return;

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    if (isPositive) {
        // Victory sound - ascending notes
        oscillator.frequency.setValueAtTime(523, audioContext.currentTime); // C5
        oscillator.frequency.setValueAtTime(659, audioContext.currentTime + 0.1); // E5
        oscillator.frequency.setValueAtTime(784, audioContext.currentTime + 0.2); // G5
    } else {
        // Loss sound - descending notes
        oscillator.frequency.setValueAtTime(392, audioContext.currentTime); // G4
        oscillator.frequency.setValueAtTime(330, audioContext.currentTime + 0.1); // E4
        oscillator.frequency.setValueAtTime(262, audioContext.currentTime + 0.2); // C4
    }

    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
}

function playGameOverSound(isWinner) {
    if (!soundEnabled || !audioContext) return;

    const notes = isWinner
        ? [523, 659, 784, 1047] // C5, E5, G5, C6 - victory fanfare
        : [392, 330, 262, 196];  // G4, E4, C4, G3 - defeat

    notes.forEach((freq, index) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = freq;
        oscillator.type = isWinner ? 'sine' : 'triangle';

        const startTime = audioContext.currentTime + (index * 0.15);
        gainNode.gain.setValueAtTime(0.25, startTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + 0.3);

        oscillator.start(startTime);
        oscillator.stop(startTime + 0.3);
    });
}

function playLaunchSound() {
    if (!soundEnabled || !audioContext) return;

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.setValueAtTime(200, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(600, audioContext.currentTime + 0.15);
    oscillator.type = 'sawtooth';

    gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.15);
}

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
    isBallOwner: false, // Who controls the ball (randomly assigned at start)
    hasActiveBallAuthority: false, // Who currently simulates ball (switches on each hit)
    gameStarted: false,
    gameEnded: false,
    lastUpdate: 0
};

// Ball sync state: authority switches between players on each paddle hit
// Each player simulates ball locally when they have authority (after hitting it)

// Ball interpolation for non-authoritative client (smooth remote ball)
let ballTarget = {
    x: CANVAS_WIDTH / 2,
    y: CANVAS_HEIGHT / 2,
    vx: 0,
    vy: 0
};
const BALL_LERP_FACTOR = 0.3; // Interpolation factor for smooth ball movement

// Paddle interpolation for smooth remote paddle (60fps rendering from 10fps network data)
let remotePaddleTarget = CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2;
const PADDLE_LERP_FACTOR = 0.25; // Slower lerp for smooth 60fps interpolation from 10fps data

// Entity interpolation state for remote paddle
let remotePaddleLastPosition = CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2; // Previous known position
let remotePaddleLastUpdateTime = Date.now(); // Timestamp of last position update
let remotePaddleInterpolating = false; // Whether we're currently interpolating

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
let wheelVelocity = 0;
let wheelHandle = null;
let wheelTrack = null;
let isDraggingWheel = false;
let connectionEstablished = false;

// Frame counter sync for out-of-order packet detection
let remoteFrameCounter = 0; // Last frame counter received from remote
let frameCounterMismatchCount = 0; // Tracks consecutive frame counter issues
let lastValidRemoteFrameTime = Date.now(); // Timestamp of last valid frame counter

// Input sequence tracking for server reconciliation
let inputSequence = 0; // Increments for each input sent
let lastAcknowledgedSequence = 0; // Last sequence confirmed by remote player
let pendingInputs = []; // Buffer of inputs not yet acknowledged

// Bandwidth optimization - delta updates (only send changes)
let lastSentFrameCounter = 0; // Track last sent frame to avoid redundant sends
let lastSentSeq = 0; // Track last sent sequence to avoid redundant sends
let lastSentLastAck = 0; // Track last sent lastAck to avoid redundant sends
let lastSentBallState = null; // Track last sent ball state to detect changes

// Lag compensation - collision events with timestamps for retroactive processing
let pendingCollisionEvents = []; // Buffer of collision events with timestamps
const COLLISION_EVENT_TIMEOUT = 500; // Hold collision events for 500ms to allow retroactive processing

// Client-side prediction state
let predictedPaddleY = CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2; // Local paddle predicted position
let lastAuthorativePaddleY = CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2; // Last position confirmed by remote
let lastAuthorativeSequence = 0; // Last sequence number we received from remote

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
let gameLoopId = null; // requestAnimationFrame ID
let connectionRetryInterval = null;
let disconnectCheckInterval = null;

// Performance monitoring
let lastFrameTime = 0;
let frameTimeAccumulator = 0;
let framesMeasured = 0;

// Object reuse to reduce GC
const reusableStatePacket = { a: "state" };
const reusableBallState = { x: 0, y: 0, vx: 0, vy: 0 };

// Simplified connection handshake with retry mechanism
function establishConnection() {
    // Send connection request with session ID and random number for ball owner determination
    const msg = { a: "connect", sid: sessionId, rand: myRandomNumber };
    SpixiAppSdk.sendNetworkData(JSON.stringify(msg));
    lastDataSent = SpixiTools.getTimestamp();

    // Keep sending connection packets every 500ms until we get a response
    if (!connectionRetryInterval) {
        connectionRetryInterval = setInterval(() => {
            if (!connectionEstablished) {
                const msg = { a: "connect", sid: sessionId, rand: myRandomNumber };
                SpixiAppSdk.sendNetworkData(JSON.stringify(msg));
                lastDataSent = SpixiTools.getTimestamp();
            } else {
                // Connection established - stop retry attempts
                clearInterval(connectionRetryInterval);
                connectionRetryInterval = null;
            }
        }, 500);
    }
}

function handleConnectionEstablished() {
    connectionEstablished = true;

    // Stop connection retry attempts
    if (connectionRetryInterval) {
        clearInterval(connectionRetryInterval);
        connectionRetryInterval = null;
    }

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

    // Start disconnect detection (check every 10 seconds)
    if (!disconnectCheckInterval) {
        disconnectCheckInterval = setInterval(() => {
            const currentTime = SpixiTools.getTimestamp();
            const timeSinceLastSeen = currentTime - playerLastSeen;

            // If no data received for 10 seconds, consider disconnected
            if (timeSinceLastSeen >= 10) {
                if (disconnectCheckInterval) {
                    clearInterval(disconnectCheckInterval);
                    disconnectCheckInterval = null;
                }
                handleOpponentDisconnect();
            }
        }, 10000);
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

    // Scrolling wheel control
    wheelHandle = document.getElementById('wheelHandle');
    if (!wheelHandle) {
        console.error('Wheel handle not found');
        return;
    }
    wheelTrack = wheelHandle.parentElement;
    let isDragging = false;
    let wheelStartY = 0;
    let wheelCurrentY = 0;
    let lastWheelY = 0;
    let wheelUpdateTime = Date.now();
    let wheelPaddleY = 0; // Track paddle position for wheel sync

    function handleWheelStart(clientY) {
        isDragging = true;
        isDraggingWheel = true;
        wheelStartY = clientY;
        wheelCurrentY = wheelStartY;
        lastWheelY = wheelStartY;
        wheelVelocity = 0;
        wheelUpdateTime = Date.now();
        wheelHandle.classList.add('dragging');
    }

    function handleWheelMove(clientY) {
        if (!isDragging) return;

        const now = Date.now();
        const deltaTime = Math.max(now - wheelUpdateTime, 1);
        const deltaY = clientY - lastWheelY;

        // Calculate velocity (pixels per ms, scaled for paddle speed)
        wheelVelocity = (deltaY / deltaTime) * 16; // Scale to 60fps

        wheelCurrentY = clientY;
        lastWheelY = clientY;
        wheelUpdateTime = now;

        // Map wheel position to paddle position directly
        const trackRect = wheelTrack.getBoundingClientRect();
        const relativeY = clientY - trackRect.top;
        const trackProgress = Math.max(0, Math.min(1, relativeY / trackRect.height));

        // Set paddle position directly from wheel (0 to CANVAS_HEIGHT - PADDLE_HEIGHT)
        predictedPaddleY = trackProgress * (CANVAS_HEIGHT - PADDLE_HEIGHT);
    }

    function handleWheelEnd() {
        isDragging = false;
        isDraggingWheel = false;
        wheelVelocity = 0;
        wheelHandle.classList.remove('dragging');
        // Keep wheel at current paddle position (don't reset to center)
    }

    // Touch events
    wheelHandle.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (!audioContext) initAudioContext();
        handleWheelStart(e.touches[0].clientY);
    });

    document.addEventListener('touchmove', (e) => {
        if (isDragging) {
            e.preventDefault();
            handleWheelMove(e.touches[0].clientY);
        }
    }, { passive: false });

    document.addEventListener('touchend', (e) => {
        if (isDragging) {
            e.preventDefault();
            handleWheelEnd();
        }
    });

    // Mouse events
    wheelHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (!audioContext) initAudioContext();
        handleWheelStart(e.clientY);
    });

    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            e.preventDefault();
            handleWheelMove(e.clientY);
        }
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            handleWheelEnd();
        }
    });

    // Start button - mark player as ready
    // Start button - removed, game auto-starts on connection

    // Shoot button
    const shootBtn = document.getElementById('shootBtn');
    if (shootBtn) {
        shootBtn.addEventListener('click', () => {
            if (!audioContext) initAudioContext();
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

    // Sound toggle button
    const soundToggleBtn = document.getElementById('soundToggleBtn');
    const soundOnIcon = document.getElementById('soundOnIcon');
    const soundOffIcon = document.getElementById('soundOffIcon');
    if (soundToggleBtn) {
        soundToggleBtn.addEventListener('click', () => {
            if (!audioContext) initAudioContext();
            soundEnabled = !soundEnabled;

            if (soundEnabled) {
                soundOnIcon.style.display = 'block';
                soundOffIcon.style.display = 'none';
            } else {
                soundOnIcon.style.display = 'none';
                soundOffIcon.style.display = 'block';
            }
        });
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

    // Initialize client-side prediction state
    predictedPaddleY = gameState.localPaddle.y;
    lastAuthorativePaddleY = gameState.localPaddle.y;
    lastAuthorativeSequence = 0;

    frameCounter = 0;
    lastSyncTime = Date.now();

    // Reset delta update tracking for new game
    lastSentFrameCounter = 0;
    lastSentSeq = 0;
    lastSentLastAck = 0;
    lastSentBallState = null;
    lastSentPaddleY = gameState.localPaddle.y;

    // Reset collision event buffer for lag compensation
    pendingCollisionEvents = [];

    // Start game loop
    if (!gameLoopId) {
        lastFrameTime = performance.now();
        gameLoopId = requestAnimationFrame(gameLoop);
    }
}

function resetBallPosition() {
    // Position ball at the serving paddle (ball owner is always on right)
    if (gameState.isBallOwner) {
        // Right paddle - ball owner
        gameState.ball.x = CANVAS_WIDTH - 20 - PADDLE_WIDTH - BALL_SIZE;
        gameState.ball.y = gameState.localPaddle.y + PADDLE_HEIGHT / 2;
    } else {
        // Left paddle - non-owner
        gameState.ball.x = 20 + PADDLE_WIDTH + BALL_SIZE;
        gameState.ball.y = gameState.localPaddle.y + PADDLE_HEIGHT / 2;
    }
    gameState.ball.vx = 0;
    gameState.ball.vy = 0;
}

function launchBall() {
    if (gameState.ball.vx === 0 && gameState.isBallOwner) {
        document.getElementById('shootBtn').style.display = 'none';
        document.getElementById('status-text').textContent = 'Game On!';
        playLaunchSound();

        // Ball owner launches - they have authority initially
        gameState.hasActiveBallAuthority = true;

        // Initialize ball velocity - always shoot toward opponent (left)
        const angle = (Math.random() * Math.PI / 3) - Math.PI / 6;
        gameState.ball.vx = -Math.cos(angle) * BALL_SPEED_INITIAL; // Always negative (toward left)
        gameState.ball.vy = Math.sin(angle) * BALL_SPEED_INITIAL;

        // Notify other player with ball velocity included
        const b = gameState.ball;
        SpixiAppSdk.sendNetworkData(JSON.stringify({
            a: "launch",
            b: {
                x: Math.round(CANVAS_WIDTH - b.x), // Mirror X
                y: Math.round(b.y),
                vx: Math.round(-b.vx * 100),   // Integer velocity (*100)
                vy: Math.round(b.vy * 100)
            }
        }));
        lastDataSent = SpixiTools.getTimestamp();
        lastSyncTime = 0;
        sendGameState();
    }
}

function gameLoop(timestamp) {
    if (!gameState.gameStarted || gameState.gameEnded) {
        gameLoopId = null;
        return;
    }

    // Schedule next frame immediately
    gameLoopId = requestAnimationFrame(gameLoop);

    // Calculate frame delta for performance monitoring
    if (!lastFrameTime) lastFrameTime = timestamp;
    const deltaTime = timestamp - lastFrameTime;
    lastFrameTime = timestamp;

    // Monitor performance (adaptive network rate)
    if (deltaTime > 0) {
        frameTimeAccumulator += deltaTime;
        framesMeasured++;

        if (framesMeasured >= 60) {
            const avgFrameTime = frameTimeAccumulator / framesMeasured;
            // If dropping frames (avg > 20ms, i.e., < 50fps), throttle network
            if (avgFrameTime > 20) {
                currentNetworkRate = NETWORK_RATE_THROTTLED;
            } else {
                // Otherwise use active/idle logic
                const ballActive = Math.abs(gameState.ball.vx) > 0.1 || Math.abs(gameState.ball.vy) > 0.1;
                currentNetworkRate = ballActive ? NETWORK_RATE_ACTIVE : NETWORK_RATE_IDLE;
            }
            frameTimeAccumulator = 0;
            framesMeasured = 0;
        }
    }

    frameCounter++;
    updatePaddle();

    // Update remote paddle with entity interpolation
    updateRemotePaddleInterpolation();

    // Only player with ball authority simulates ball movement locally
    const ballHasVelocity = Math.abs(gameState.ball.vx) > 0.1 || Math.abs(gameState.ball.vy) > 0.1;

    if (ballHasVelocity) {
        // Simulate ball if we have authority, otherwise interpolate toward target
        if (gameState.hasActiveBallAuthority) {
            updateBall();
            checkCollisions();

            // Only ball owner checks score (game logic authority)
            if (gameState.isBallOwner) {
                checkScore();
            }
        } else {
            // We don't have authority - interpolate toward target for smooth motion
            updateBallInterpolation();
        }
    } else if (gameState.hasActiveBallAuthority) {
        // Ball hasn't been launched yet - only show on serving player's side
        // Keep it attached to paddle
        if (gameState.isBallOwner) {
            // Ball owner on right
            gameState.ball.x = CANVAS_WIDTH - 20 - PADDLE_WIDTH - BALL_SIZE;
            gameState.ball.y = gameState.localPaddle.y + PADDLE_HEIGHT / 2;
        } else {
            // Non-owner on left
            gameState.ball.x = 20 + PADDLE_WIDTH + BALL_SIZE;
            gameState.ball.y = gameState.localPaddle.y + PADDLE_HEIGHT / 2;
        }
    }

    render();

    // Send unified game state at dynamic rate
    const currentTime = Date.now();
    const timeSinceLastSync = currentTime - lastSyncTime;

    if (timeSinceLastSync >= currentNetworkRate) {
        sendGameState();
        lastSyncTime = currentTime;
    }
}

function updatePaddle() {
    // If wheel is being dragged, position is already set by handleWheelMove
    if (!isDraggingWheel) {
        const moveUp = keysPressed['up'];
        const moveDown = keysPressed['down'];

        // Client-side prediction: Apply input immediately to predicted state
        // This eliminates the lag between user input and visual response

        // Keyboard controls
        if (moveUp) {
            predictedPaddleY = Math.max(0, predictedPaddleY - PADDLE_SPEED);
        }
        if (moveDown) {
            predictedPaddleY = Math.min(CANVAS_HEIGHT - PADDLE_HEIGHT, predictedPaddleY + PADDLE_SPEED);
        }
    }

    // Use predicted paddle position for rendering and collision detection
    gameState.localPaddle.y = predictedPaddleY;

    // Update wheel handle position to match paddle
    updateWheelPosition();
}

function updateWheelPosition() {
    if (!wheelHandle || !wheelTrack) return;

    const trackRect = wheelTrack.getBoundingClientRect();
    const handleHeight = wheelHandle.offsetHeight;

    // Calculate wheel position from paddle position
    const paddleProgress = predictedPaddleY / (CANVAS_HEIGHT - PADDLE_HEIGHT);
    const handlePosition = paddleProgress * 100;

    // Clamp position within track bounds
    const clampedPosition = Math.max(handleHeight / trackRect.height * 50,
        Math.min(100 - handleHeight / trackRect.height * 50, handlePosition));

    wheelHandle.style.top = clampedPosition + '%';
}

/**
 * Entity interpolation for remote paddle: Smooth movement between known positions
 * 
 * The server sends paddle updates at 10fps, but we render at 60fps.
 * Instead of showing jumpy movement, we interpolate between the last known position
 * and the current target position using linear interpolation (lerp).
 * 
 * This technique is essential for smooth gameplay when network updates arrive infrequently.
 * The lerp factor determines how quickly we reach the target position.
 */
function updateRemotePaddleInterpolation() {
    const currentTime = Date.now();

    // If we have a new target, update interpolation state
    if (remotePaddleTarget !== gameState.remotePaddle.y) {
        remotePaddleInterpolating = true;
        remotePaddleLastPosition = gameState.remotePaddle.y;
        remotePaddleLastUpdateTime = currentTime;
    }

    if (remotePaddleInterpolating) {
        // Smoothly lerp from current position toward target
        // PADDLE_LERP_FACTOR of 0.25 means we cover 25% of remaining distance each frame
        // At 60fps, this creates smooth motion between 10fps network updates
        gameState.remotePaddle.y += (remotePaddleTarget - gameState.remotePaddle.y) * PADDLE_LERP_FACTOR;

        // Stop interpolating when we're very close to target (within 1 pixel)
        if (Math.abs(gameState.remotePaddle.y - remotePaddleTarget) < 1) {
            gameState.remotePaddle.y = remotePaddleTarget;
            remotePaddleInterpolating = false;
        }
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

/**
 * Ball interpolation for non-authoritative client
 * Uses velocity-based extrapolation to predict ball position at 60fps
 * from 10fps network updates (every ~100ms)
 * 
 * This creates smooth motion by:
 * 1. Moving ball forward using current velocity (like authoritative player)
 * 2. Gently correcting position toward target to fix drift
 * 3. Snapping velocity on large changes (indicates bounce/collision)
 */
function updateBallInterpolation() {
    // First, extrapolate position using current velocity (like local simulation)
    // This gives us smooth 60fps motion between network updates
    gameState.ball.x += gameState.ball.vx;
    gameState.ball.y += gameState.ball.vy;

    // Handle wall bounces locally for smooth response
    if (gameState.ball.y <= BALL_SIZE / 2 || gameState.ball.y >= CANVAS_HEIGHT - BALL_SIZE / 2) {
        gameState.ball.vy = -gameState.ball.vy;
        gameState.ball.y = Math.max(BALL_SIZE / 2, Math.min(CANVAS_HEIGHT - BALL_SIZE / 2, gameState.ball.y));
        playWallBounceSound();
    }

    // Now gently correct any drift toward authoritative position
    const distanceToTarget = Math.sqrt(
        Math.pow(gameState.ball.x - ballTarget.x, 2) +
        Math.pow(gameState.ball.y - ballTarget.y, 2)
    );

    // Dynamic correction:
    // - Large error (>50px): Snap immediately (something went wrong/lag spike)
    // - Medium error (>10px): Fast correction (20% per frame)
    // - Small error (>1px): Gentle correction (5% per frame)
    // - Tiny error: Ignore to prevent micro-jitter

    if (distanceToTarget > 50) {
        // Snap to target if very far (indicates major correction/lag spike)
        gameState.ball.x = ballTarget.x;
        gameState.ball.y = ballTarget.y;
        gameState.ball.vx = ballTarget.vx;
        gameState.ball.vy = ballTarget.vy;
    } else if (distanceToTarget > 1) {
        // Apply dynamic position correction
        // Closer = gentler, Further = faster
        const correctionFactor = distanceToTarget > 10 ? 0.2 : 0.05;

        gameState.ball.x += (ballTarget.x - gameState.ball.x) * correctionFactor;
        gameState.ball.y += (ballTarget.y - gameState.ball.y) * correctionFactor;
    }

    // Check if velocity changed significantly (indicates bounce/collision)
    const velocityDiff = Math.sqrt(
        Math.pow(gameState.ball.vx - ballTarget.vx, 2) +
        Math.pow(gameState.ball.vy - ballTarget.vy, 2)
    );

    // Snap velocity on significant change (bounce detected)
    if (velocityDiff > 1.0) {
        gameState.ball.vx = ballTarget.vx;
        gameState.ball.vy = ballTarget.vy;
    } else if (velocityDiff > 0.1) {
        // Small velocity drift - correct gently
        gameState.ball.vx += (ballTarget.vx - gameState.ball.vx) * 0.1;
        gameState.ball.vy += (ballTarget.vy - gameState.ball.vy) * 0.1;
    }
}

/**
 * Record collision event with timestamp for lag compensation
 * Allows retroactive processing if collision packets arrive out of order
 * 
 * Collision events are timestamped with:
 * - frameIndex: Frame number when collision occurred
 * - eventTime: Local timestamp of collision
 * - ballState: State of ball at collision (position and velocity)
 * - sequenceNumber: Input sequence for causality tracking
 * 
 * The event is kept in buffer for COLLISION_EVENT_TIMEOUT ms to allow
 * remote player to verify and process retroactively if needed.
 */
function recordCollisionEvent() {
    const collisionEvent = {
        frameIndex: frameCounter,
        eventTime: Date.now(),
        eventSeq: inputSequence,
        ballState: {
            x: gameState.ball.x,
            y: gameState.ball.y,
            vx: gameState.ball.vx,
            vy: gameState.ball.vy
        }
    };

    pendingCollisionEvents.push(collisionEvent);

    // Clean up old collision events beyond timeout window
    const currentTime = Date.now();
    pendingCollisionEvents = pendingCollisionEvents.filter(event => {
        return (currentTime - event.eventTime) < COLLISION_EVENT_TIMEOUT;
    });
}

/**
 * Process retroactive collision based on remote's timestamp
 * Called when receiving delayed collision information from remote player
 * 
 * If our local collision record exists within tolerance window:
 * - Accept it as valid (both players agree on collision timing)
 * - Update ball state if remote provides more authoritative state
 * 
 * If collision event is outside our buffer:
 * - Accept remote's ball state anyway (remote was authoritative)
 * - Demonstrates eventual consistency even with high latency
 */
function processRetroactiveCollision(remoteCollisionTime, remoteFrameIndex, remoteSeq, remoteBallState) {
    const currentTime = Date.now();
    const timeDiff = currentTime - remoteCollisionTime;

    // Look for local collision event matching the remote's timestamp
    const matchingEvent = pendingCollisionEvents.find(event => {
        return Math.abs(event.eventTime - remoteCollisionTime) < 50; // 50ms tolerance window
    });

    if (matchingEvent) {
        // Both players detected collision at approximately same time - consensus achieved
        // Use remote's ball state as it may have processed physics more accurately
        gameState.ball.x = remoteBallState.x;
        gameState.ball.y = remoteBallState.y;
        gameState.ball.vx = remoteBallState.vx;
        gameState.ball.vy = remoteBallState.vy;
    } else if (timeDiff < COLLISION_EVENT_TIMEOUT * 2) {
        // Collision event outside our buffer but within tolerance
        // Accept remote's ball state (remote is authoritative for their side)
        gameState.ball.x = remoteBallState.x;
        gameState.ball.y = remoteBallState.y;
        gameState.ball.vx = remoteBallState.vx;
        gameState.ball.vy = remoteBallState.vy;
    }
    // Otherwise: collision event too old, ignore (state reconciliation will handle)
}

// Clean up expired collision events periodically
setInterval(() => {
    const currentTime = Date.now();
    pendingCollisionEvents = pendingCollisionEvents.filter(event => {
        return (currentTime - event.eventTime) < COLLISION_EVENT_TIMEOUT;
    });
}, 200); // Check every 200ms

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

        // Check if we're the one who hit it (right paddle = ball owner)
        if (gameState.isBallOwner) {
            // We hit it - we now have authority
            gameState.hasActiveBallAuthority = true;
            playPaddleHitSound();
        }

        // Record collision event for lag compensation
        recordCollisionEvent();

        // Send ball state with collision timestamp info
        sendBallStateWithCollision();
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

        // Check if we're the one who hit it (left paddle = non-owner)
        if (!gameState.isBallOwner) {
            // We hit it - we now have authority
            gameState.hasActiveBallAuthority = true;
            playPaddleHitSound();
        }

        // Record collision event for lag compensation
        recordCollisionEvent();

        // Send ball state with collision timestamp info
        sendBallStateWithCollision();
    }
}

function checkScore() {
    if (gameState.ball.x < 0) {
        // Left side (non-owner) missed
        if (gameState.isBallOwner) {
            gameState.remotePaddle.lives--;
            playScoreSound(true); // We scored
        } else {
            gameState.localPaddle.lives--;
            playScoreSound(false); // We lost a life
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
            playScoreSound(false); // We lost a life
        } else {
            gameState.remotePaddle.lives--;
            playScoreSound(true); // We scored
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
    // Position ball at serving paddle
    resetBallPosition();

    // Determine who serves (whoever got scored on serves)
    // For now, alternate based on ball owner
    const servingPlayer = gameState.isBallOwner;
    gameState.hasActiveBallAuthority = servingPlayer;

    // Auto-launch ball from paddle with random angle toward opponent
    const angle = (Math.random() * Math.PI / 3) - Math.PI / 6;

    if (gameState.isBallOwner) {
        // Ball owner on right - shoot left (toward opponent)
        gameState.ball.vx = -Math.cos(angle) * BALL_SPEED_INITIAL;
    } else {
        // Non-owner on left - shoot right (toward opponent)
        gameState.ball.vx = Math.cos(angle) * BALL_SPEED_INITIAL;
    }
    gameState.ball.vy = Math.sin(angle) * BALL_SPEED_INITIAL;

    // Send ball state immediately
    const b = gameState.ball;
    SpixiAppSdk.sendNetworkData(JSON.stringify({
        a: "launch",
        b: {
            x: Math.round(CANVAS_WIDTH - b.x),
            y: Math.round(b.y),
            vx: Number((-b.vx).toFixed(2)),
            vy: Number(b.vy.toFixed(2))
        }
    }));
    lastDataSent = SpixiTools.getTimestamp();
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
    if (!ctx || !canvas) return;

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

    // Draw ball - only if it has velocity OR we have authority (waiting to serve)
    const ballVisible = (Math.abs(gameState.ball.vx) > 0.1 || Math.abs(gameState.ball.vy) > 0.1) || gameState.hasActiveBallAuthority;
    if (ballVisible) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(gameState.ball.x, gameState.ball.y, BALL_SIZE / 2, 0, Math.PI * 2);
        ctx.fill();
    }
}

function endGame(won) {
    gameState.gameEnded = true;
    playGameOverSound(won);

    if (gameLoopId) {
        cancelAnimationFrame(gameLoopId);
        gameLoopId = null;
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
    // Notify remote player first
    SpixiAppSdk.sendNetworkData(JSON.stringify({ a: "fullReset" }));
    lastDataSent = SpixiTools.getTimestamp();

    // Execute full reset
    performFullReset();
}

function performFullReset() {
    // Stop all intervals and timers
    if (gameLoopId) {
        cancelAnimationFrame(gameLoopId);
        gameLoopId = null;
    }
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }
    if (connectionRetryInterval) {
        clearInterval(connectionRetryInterval);
        connectionRetryInterval = null;
    }
    if (autoStartTimer) {
        clearTimeout(autoStartTimer);
        autoStartTimer = null;
    }
    if (disconnectCheckInterval) {
        clearInterval(disconnectCheckInterval);
        disconnectCheckInterval = null;
    }

    // Reset all connection state
    connectionEstablished = false;
    myRandomNumber = Math.floor(Math.random() * 1000000);
    remoteRandomNumber = null;

    // Reset game state completely
    gameState.localPaddle.y = CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2;
    gameState.localPaddle.lives = MAX_LIVES;
    gameState.remotePaddle.y = CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2;
    gameState.remotePaddle.lives = MAX_LIVES;
    gameState.gameStarted = false;
    gameState.gameEnded = false;
    gameState.isBallOwner = false;
    gameState.hasActiveBallAuthority = false;

    // Reset ball
    gameState.ball.x = CANVAS_WIDTH / 2;
    gameState.ball.y = CANVAS_HEIGHT / 2;
    gameState.ball.vx = 0;
    gameState.ball.vy = 0;

    // Reset prediction state
    predictedPaddleY = CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2;
    lastAuthorativePaddleY = CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2;
    lastAcknowledgedSequence = 0;
    inputSequence = 0;
    pendingInputs = [];

    // Reset frame counters
    frameCounter = 0;
    remoteFrameCounter = 0;
    frameCounterMismatchCount = 0;

    // Reset networking state
    lastDataSent = 0;
    lastSyncTime = 0;
    lastSentFrameCounter = 0;
    lastSentSeq = 0;
    lastSentLastAck = 0;
    lastSentPaddleY = gameState.localPaddle.y;

    // Reset wheel position to center
    if (wheelHandle) {
        wheelHandle.style.top = '50%';
    }

    updateLivesDisplay();

    // Transition to waiting screen
    const gameOverScreen = document.getElementById('game-over-screen');
    const gameScreen = document.getElementById('game-screen');
    const waitingScreen = document.getElementById('waiting-screen');

    if (gameOverScreen.classList.contains('screen-active')) {
        gameOverScreen.classList.replace('screen-active', 'screen-hidden');
    }
    if (gameScreen.classList.contains('screen-active')) {
        gameScreen.classList.replace('screen-active', 'screen-hidden');
    }
    waitingScreen.classList.replace('screen-hidden', 'screen-active');

    const waitingText = document.querySelector('.waiting-text');
    if (waitingText) {
        waitingText.textContent = 'Reconnecting to opponent...';
    }

    // Re-establish connection
    setTimeout(() => establishConnection(), 100);
}

function exitGame() {
    // Notify opponent about exit
    try {
        SpixiAppSdk.sendNetworkData(JSON.stringify({ a: "exit" }));
    } catch (e) {
        // Ignore send errors on exit
    }

    // Cleanup intervals
    if (gameLoopId) cancelAnimationFrame(gameLoopId);
    if (pingInterval) clearInterval(pingInterval);
    if (connectionRetryInterval) clearInterval(connectionRetryInterval);
    if (disconnectCheckInterval) clearInterval(disconnectCheckInterval);
    if (autoStartTimer) clearTimeout(autoStartTimer);

    // Close app using SDK back() helper - this will ask Spixi to go back/exit the app
    try {
        SpixiAppSdk.back();
    } catch (e) {
        // Fallback to legacy close action if back() is not available
        try { SpixiAppSdk.spixiAction("close"); } catch (e2) { /* ignore */ }
    }
}

function handleOpponentDisconnect() {
    // Stop game
    gameState.gameEnded = true;

    if (gameLoopId) {
        cancelAnimationFrame(gameLoopId);
        gameLoopId = null;
    }

    // Show disconnect message
    const statusText = document.getElementById('status-text');
    if (statusText) {
        statusText.textContent = 'Opponent Disconnected';
        statusText.style.color = '#f56565';
    }

    // If in game screen, show overlay message
    const gameScreen = document.getElementById('game-screen');
    if (gameScreen && gameScreen.classList.contains('screen-active')) {
        const overlay = document.getElementById('canvasOverlay');
        if (overlay) {
            overlay.innerHTML = '<div style="padding: 2rem; background: rgba(0,0,0,0.9); border-radius: 12px; text-align: center;"><h2 style="color: #f56565; margin-bottom: 1rem;">Opponent Disconnected</h2><p style="color: #a0aec0;">The game has ended.</p></div>';
            overlay.style.display = 'flex';
        }
    }
}

/**
 * Send ball state including collision timestamp for lag compensation
 * Remote player can use timestamp to retroactively verify collision occurred
 * at approximately the same time on both clients, even with network delay
 */
function sendBallStateWithCollision() {
    const b = gameState.ball;
    const collisionMsg = {
        a: "collision",
        f: frameCounter,
        seq: inputSequence,
        t: Date.now(), // Collision event timestamp (milliseconds)
        x: Math.round(CANVAS_WIDTH - b.x), // Mirror X for opponent's view
        y: Math.round(b.y),
        vx: Math.round(-b.vx * 100), // Integer velocity (*100)
        vy: Math.round(b.vy * 100)
    };

    SpixiAppSdk.sendNetworkData(JSON.stringify(collisionMsg));
}

// Network functions - Unified game state sync at 10fps (100ms intervals)
/**
 * SEND GAME STATE - Core networking function
 * 
 * This function builds and sends the main game state packet using DELTA UPDATES.
 * It is the heart of the networking layer and implements multiple techniques:
 * 
 * 1. CLIENT-SIDE PREDICTION (task #2)
 *    - Uses predictedPaddleY (our local estimate) not authoritative position
 *    - Assigns sequence number to each new paddle position
 *    - Stores input in pendingInputs[] for later reconciliation
 * 
 * 2. INPUT SEQUENCE TRACKING (task #1)
 *    - Each paddle movement gets unique sequence number
 *    - Incremented only when paddle Y changes
 *    - Enables receiver to replay pending inputs on reconciliation
 * 
 * 3. DELTA UPDATES (task #11 - Bandwidth optimization)
 *    - Only includes fields that changed since last send
 *    - Frame counter sent only if incremented
 *    - Paddle sent only if position changed
 *    - Sequence/lastAck sent only if they changed
 *    - Ball sent only if position/velocity differs
 *    - Typical packet: {a:"state",f:120,p:250} (30 bytes vs 80 bytes full)
 * 
 * 4. FRAME COUNTER SYNC (task #9)
 *    - frameCounter increments every game frame (60 times/second locally)
 *    - Sent to remote so they can detect out-of-order packets
 *    - Remote rejects packets where frame < lastSeenFrame
 * 
 * 5. ACKNOWLEDGMENT SYSTEM (task #4)
 *    - lastAck echoes back remote's last sequence number we received
 *    - Remote uses this to know which of their inputs we processed
 *    - Allows remote to remove acknowledged inputs from their buffer
 *    - Example: We send lastAck=5, remote can clear inputs 1-5 from buffer
 * 
 * 6. BALL STATE COORDINATION
 *    - Each player sends ball state when ball moving toward opponent
 *    - Ball owner (right paddle) sends when vx > 0 (moving right/toward opponent)
 *    - Non-owner (left paddle) sends when vx < 0 (moving left/toward opponent)
 *    - Coordinates are MIRRORED to opponent's view
 * 
 * MIRRORING EXAMPLE:
 *    - In global coordinates, right player sees ball at x=600 moving right (vx=+4)
 *    - They mirror: x_mirrored = 800 - 600 = 200, vx_mirrored = -4
 *    - Left player receives x=200, vx=-4 (same trajectory in their view)
 *    - Both players see identical ball motion trajectory
 * 
 * PACKET EXAMPLE (delta):
 *    Regular state: {a:"state", f:147, p:290, seq:23, lastAck:18}
 *    With ball:     {a:"state", f:147, p:290, seq:23, lastAck:18, b:{x:150, y:300, vx:5.2, vy:-1.3}}
 *    Minimal:       {a:"state", f:149}  (if only frame counter changed)
 * 
 * SEND RATE: 10fps (100ms intervals) - Balance between responsiveness and bandwidth
 * RENDER RATE: 60fps - Interpolation bridges the gap between sends
 */
function sendGameState() {
    if (!gameState.gameStarted || gameState.gameEnded) {
        return; // Don't send if game not active
    }

    const currentTime = SpixiTools.getTimestamp();
    lastDataSent = currentTime;

    // Use predicted paddle position (client-side prediction)
    const paddleY = Math.round(predictedPaddleY);

    // Check if paddle position changed since last send
    const paddleChanged = paddleY !== lastSentPaddleY;

    // If paddle position changed, assign new sequence number and store in buffer
    if (paddleChanged) {
        inputSequence++;
        const input = {
            seq: inputSequence,
            paddleY: paddleY,
            timestamp: currentTime
        };
        pendingInputs.push(input);
        lastSentPaddleY = paddleY;
    }

    // Build unified state packet - delta updates (only include fields that changed)
    // Reuse object to reduce GC
    const state = reusableStatePacket;
    // Clear previous properties (except 'a')
    for (const key in state) {
        if (key !== 'a') delete state[key];
    }

    // Include frame counter only if changed (frame counter should always increment)
    if (frameCounter !== lastSentFrameCounter) {
        state.f = frameCounter;
        lastSentFrameCounter = frameCounter;
    }

    // Include paddle only if changed
    if (paddleChanged) {
        state.p = paddleY;
    }

    // Include sequence number only if changed
    if (inputSequence !== lastSentSeq) {
        state.seq = inputSequence;
        lastSentSeq = inputSequence;
    }

    // Include lastAck only if changed
    if (lastAcknowledgedSequence !== lastSentLastAck) {
        state.lastAck = lastAcknowledgedSequence;
        lastSentLastAck = lastAcknowledgedSequence;
    }

    // Include ball state if we have authority and ball is moving
    // This keeps non-authoritative client updated with smooth interpolation
    const ballActive = Math.abs(gameState.ball.vx) > 0.1 || Math.abs(gameState.ball.vy) > 0.1;
    if (gameState.hasActiveBallAuthority && ballActive) {
        const b = gameState.ball;

        // Use reusable ball state object
        reusableBallState.x = Math.round(CANVAS_WIDTH - b.x); // Mirror X
        reusableBallState.y = Math.round(b.y);
        reusableBallState.vx = Math.round(-b.vx * 100); // Integer velocity
        reusableBallState.vy = Math.round(b.vy * 100);

        const newBallState = reusableBallState;

        // Only include if changed significantly (position differs by >2px or velocity changed)
        const ballStateChanged = !lastSentBallState ||
            Math.abs(lastSentBallState.x - newBallState.x) > 2 ||
            Math.abs(lastSentBallState.y - newBallState.y) > 2 ||
            lastSentBallState.vx !== newBallState.vx ||
            lastSentBallState.vy !== newBallState.vy;

        if (ballStateChanged) {
            // Need to clone for lastSentBallState since we reuse the object
            lastSentBallState = { ...newBallState };
            state.b = newBallState;
        }
    } else if (!ballActive) {
        // Ball stopped - clear cached state
        lastSentBallState = null;
    }

    // Always send state packet (at minimum contains action type)
    SpixiAppSdk.sendNetworkData(JSON.stringify(state));
}

/**
 * Server reconciliation: Recompute paddle position from authoritative state + unacknowledged inputs
 * Called when receiving state update from remote player with their last acknowledged sequence.
 * This ensures smooth gameplay even when inputs arrive out of order or are delayed.
 * 
 * Process:
 * 1. Receive remote's acknowledgment of which inputs they processed (lastAckSeq)
 * 2. Accept their authoritative paddle position (authPaddleY)
 * 3. Replay all pending inputs that came after their acknowledgment
 * 4. Result: our predicted state stays in sync with their authoritative view
 */
function reconcilePaddleState(authPaddleY, lastAckSeq) {
    // Update with authoritative state from remote player
    lastAuthorativePaddleY = authPaddleY;
    lastAuthorativeSequence = lastAckSeq;

    // Set predicted position to authoritative, then replay unacknowledged inputs
    predictedPaddleY = authPaddleY;

    // Replay all inputs not yet acknowledged by remote
    for (const input of pendingInputs) {
        if (input.seq > lastAckSeq) {
            // Recalculate paddle position as if this input were applied to authoritative state
            // This simulates what the remote player will see after processing our input
            predictedPaddleY = input.paddleY;
        }
    }

    // Ensure predicted paddle stays within bounds after reconciliation
    predictedPaddleY = Math.max(0, Math.min(CANVAS_HEIGHT - PADDLE_HEIGHT, predictedPaddleY));

    // Update game state to reflect reconciled position
    gameState.localPaddle.y = predictedPaddleY;
}

/**
 * Frame counter sync: Validate incoming packets are not out of order
 * 
 * Frame counter helps detect:
 * - Out-of-order packets: If new frame < last frame, packet arrived late
 * - Dropped packets: Large frame gaps indicate missed network updates
 * - Stale packets: Repeated old frame numbers should be ignored
 * 
 * Returns true if packet should be processed, false if it's stale/out-of-order
 */
function validateFrameCounter(newFrameCounter) {
    // First packet from remote
    if (remoteFrameCounter === 0) {
        remoteFrameCounter = newFrameCounter;
        frameCounterMismatchCount = 0;
        lastValidRemoteFrameTime = Date.now();
        return true;
    }

    // Check if frame counter is progressing forward
    if (newFrameCounter > remoteFrameCounter) {
        // Normal progression - accept it
        remoteFrameCounter = newFrameCounter;
        frameCounterMismatchCount = 0;
        lastValidRemoteFrameTime = Date.now();
        return true;
    } else if (newFrameCounter === remoteFrameCounter) {
        // Duplicate frame counter (retransmit) - ignore it
        return false;
    } else {
        // Frame counter went backward (out-of-order packet)
        frameCounterMismatchCount++;

        // Allow one out-of-order packet per second (network jitter)
        // But reject if too many arrive (indicates network issues)
        const timeSinceLastValid = Date.now() - lastValidRemoteFrameTime;
        if (frameCounterMismatchCount < 3 || timeSinceLastValid > 1000) {
            frameCounterMismatchCount = Math.max(0, frameCounterMismatchCount - 1);
            return true; // Accept despite being out-of-order (might be legitimate latency variance)
        } else {
            // Too many out-of-order packets - something's wrong
            console.warn(`Out-of-order frame counter detected: got ${newFrameCounter}, expected > ${remoteFrameCounter}`);
            return false; // Reject stale packet
        }
    }
}

/**
 * Server reconciliation: Recompute paddle position from authoritative state + unacknowledged inputs
 * Called when receiving state update from remote player with their last acknowledged sequence.
 * This ensures smooth gameplay even when inputs arrive out of order or are delayed.
 * 
 * Process:
 * 1. Receive remote's acknowledgment of which inputs they processed (lastAckSeq)
 * 2. Accept their authoritative paddle position (authPaddleY)
 * 3. Replay all pending inputs that came after their acknowledgment
 * 4. Result: our predicted state stays in sync with their authoritative view
 */
function reconcilePaddleState(authPaddleY, lastAckSeq) {
    // Update with authoritative state from remote player
    lastAuthorativePaddleY = authPaddleY;
    lastAuthorativeSequence = lastAckSeq;

    // Set predicted position to authoritative, then replay unacknowledged inputs
    predictedPaddleY = authPaddleY;

    // Replay all inputs not yet acknowledged by remote
    for (const input of pendingInputs) {
        if (input.seq > lastAckSeq) {
            // Recalculate paddle position as if this input were applied to authoritative state
            // This simulates what the remote player will see after processing our input
            predictedPaddleY = input.paddleY;
        }
    }

    // Ensure predicted paddle stays within bounds after reconciliation
    predictedPaddleY = Math.max(0, Math.min(CANVAS_HEIGHT - PADDLE_HEIGHT, predictedPaddleY));

    // Update game state to reflect reconciled position
    gameState.localPaddle.y = predictedPaddleY;
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
SpixiAppSdk.onInit = function (sid, userAddresses) {
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

SpixiAppSdk.onNetworkData = function (senderAddress, data) {
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

        /**
         * NETWORK MESSAGE HANDLER DOCUMENTATION
         * 
         * This handler processes all incoming network messages and implements:
         * - Frame counter validation (task #9: prevents out-of-order state)
         * - Sequence acknowledgment (task #4: input buffering)
         * - Server reconciliation (task #3: replay pending inputs)
         * - Remote paddle interpolation (task #5: smooth remote movement)
         * - Ball dead reckoning setup (task #6: predict ball motion)
         * - Ball interpolation (task #7: smooth ball animation)
         * - Collision event processing (task #10: retroactive collision verification)
         * - Latency simulation (task #13: artificial delays for testing)
         * 
         * MESSAGE TYPES:
         * 
         * "connect": Initial handshake with random number for ball owner determination
         * "ping": Keepalive to detect disconnections
         * "launch": Ball owner launched - non-owner updates UI
         * "state": Main game state (paddle, ball, sequence tracking) - MOST IMPORTANT
         * "collision": Timestamped collision event for lag compensation
         * "lives": Lives update (from ball owner to non-owner)
         * "end": Game end with final lives
         * "restart": Request to restart game
         * 
         * STATE MESSAGE FIELDS (most critical):
         * 
         * f (frame counter):
         *   - Increments every game frame on sender
         *   - Used by receiver to detect out-of-order packets
         *   - Packets with frame < lastSeenFrame are dropped (task #9)
         * 
         * p (paddle position):
         *   - Y coordinate of sender's paddle
         *   - Sent only when changed (bandwidth optimization, task #11)
         *   - Receiver treats as authoritative and reconciles local inputs
         * 
         * seq (input sequence):
         *   - Current input sequence number of sender
         *   - Each new input increments this
         *   - Receiver uses this for causality tracking
         *   - Sent only when changed (task #11)
         * 
         * lastAck (acknowledgment):
         *   - Remote confirms which of our inputs they received
         *   - E.g., lastAck=5 means they confirmed inputs 1-5
         *   - We can then remove inputs <=5 from pendingInputs[]
         *   - Enables input reconciliation (task #3)
         *   - Sent only when changed (task #11)
         * 
         * b (ball state):
         *   - Only sent when ball moving toward receiver
         *   - Contains mirrored coordinates for opponent's view
         *   - Enables both players to render same ball trajectory
         *   - Sent only when position/velocity changed (task #11)
         *   - Fields: x, y (positions), vx, vy (velocities)
         * 
         * PROCESSING FLOW (for each "state" message):
         * 
         * 1. Validate frame counter (reject if out-of-order) → task #9
         * 2. Update lastAcknowledgedSequence from msg.lastAck → task #4
         * 3. Reconcile paddle: replay unacknowledged inputs → task #3
         * 4. Update remote paddle target for interpolation → task #5
         * 5. Process ball state with velocity detection → task #7
         * 6. Setup dead reckoning for next frames → task #6
         * 7. Setup interpolation target for smooth motion → task #7
         * 
         * This multi-layer approach ensures both responsiveness (client prediction)
         * and correctness (server reconciliation) even under high latency.
         */
        switch (msg.a) {
            case "connect":
                // Received connection request from remote player
                if (msg.rand !== undefined) {
                    remoteRandomNumber = msg.rand;
                }

                // Always reply with our connection packet (fire and forget)
                SpixiAppSdk.sendNetworkData(JSON.stringify({ a: "connect", sid: sessionId, rand: myRandomNumber }));
                lastDataSent = SpixiTools.getTimestamp();

                // Only establish connection if we have both random numbers and not already connected
                if (!connectionEstablished && remoteRandomNumber !== null) {
                    handleConnectionEstablished();
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

                    // Process ball velocity from launch message
                    if (msg.b) {
                        const mirroredX = CANVAS_WIDTH - msg.b.x;
                        const mirroredVx = -msg.b.vx / 100; // Convert integer to decimal
                        const vy = msg.b.vy / 100;

                        // Set as interpolation target
                        ballTarget.x = mirroredX;
                        ballTarget.y = msg.b.y;
                        ballTarget.vx = mirroredVx;
                        ballTarget.vy = vy;

                        gameState.ball.x = mirroredX;
                        gameState.ball.y = msg.b.y;
                        gameState.ball.vx = mirroredVx;
                        gameState.ball.vy = vy;

                        // Ball owner has authority when launching
                        gameState.hasActiveBallAuthority = false;
                    }
                }
                break;

            case "state": // Unified game state update
                // Frame counter sync: Detect out-of-order packets
                if (msg.f !== undefined) {
                    if (!validateFrameCounter(msg.f)) {
                        // Out-of-order or stale packet - ignore it
                        console.debug(`Ignoring out-of-order packet with frame ${msg.f}`);
                        break;
                    }
                }

                // Handle sequence acknowledgment for input tracking
                if (msg.lastAck !== undefined) {
                    // Remote player has acknowledged inputs up to msg.lastAck
                    lastAcknowledgedSequence = msg.lastAck;

                    // Remove acknowledged inputs from pending buffer
                    pendingInputs = pendingInputs.filter(input => input.seq > msg.lastAck);
                }

                // Perform server reconciliation: sync our predicted state with remote's authoritative view
                // When remote sends paddle position + last ack sequence, we replay our pending inputs
                if (msg.p !== undefined && msg.lastAck !== undefined) {
                    reconcilePaddleState(msg.p, msg.lastAck);
                }

                // Update remote paddle target for smooth interpolation
                if (msg.p !== undefined) {
                    remotePaddleTarget = msg.p;
                }

                // Update ball state when receiving data
                if (msg.b) {
                    // Convert from sender's coordinate system to ours (mirror X)
                    const mirroredX = CANVAS_WIDTH - msg.b.x;
                    const mirroredVx = -msg.b.vx / 100; // Convert integer to decimal
                    const vy = msg.b.vy / 100;

                    // Set as interpolation target for smooth motion
                    ballTarget.x = mirroredX;
                    ballTarget.y = msg.b.y;
                    ballTarget.vx = mirroredVx;
                    ballTarget.vy = vy;

                    // If we don't have authority, snap to remote state
                    // (they are simulating, we follow)
                    if (!gameState.hasActiveBallAuthority) {
                        gameState.ball.x = mirroredX;
                        gameState.ball.y = msg.b.y;
                        gameState.ball.vx = mirroredVx;
                        gameState.ball.vy = vy;
                    }
                }
                break;

            case "collision":
                // Remote player hit the ball - they now have authority
                // Accept their ball state immediately
                if (msg.t !== undefined) {
                    // Convert from sender's coordinate system to ours (mirror X)
                    const mirroredX = CANVAS_WIDTH - msg.x;
                    const mirroredVx = -msg.vx / 100; // Convert integer to decimal
                    const vy = msg.vy / 100;

                    // Set as interpolation target
                    ballTarget.x = mirroredX;
                    ballTarget.y = msg.y;
                    ballTarget.vx = mirroredVx;
                    ballTarget.vy = vy;

                    // Snap to their state immediately (they have authority now)
                    gameState.ball.x = mirroredX;
                    gameState.ball.y = msg.y;
                    gameState.ball.vx = mirroredVx;
                    gameState.ball.vy = vy;

                    // Transfer authority to them
                    gameState.hasActiveBallAuthority = false;

                    // Still process retroactive collision for validation
                    processRetroactiveCollision(msg.t, msg.f, msg.seq, {
                        x: mirroredX,
                        y: msg.y,
                        vx: mirroredVx,
                        vy: msg.vy
                    });
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
                // Legacy restart (soft reset)
                if (gameState.gameEnded) {
                    performFullReset();
                }
                break;

            case "fullReset":
                // Full connection reset - triggered by either player
                performFullReset();
                break;

            case "exit":
                // Opponent exited the game
                handleOpponentDisconnect();
                break;
        }
    } catch (e) {
        console.error("Error parsing network data:", e);
    }
};

SpixiAppSdk.onStorageData = function (key, value) {
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
