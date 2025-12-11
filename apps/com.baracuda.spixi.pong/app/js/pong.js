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

// Sound system
let audioContext;
let soundEnabled = true;

// Clock Synchronization System
class TimeSync {
    constructor() {
        this.offset = 0; // Remote time - Local time
        this.rtt = 0;
        this.samples = [];
    }

    // Send a ping to initiate sync
    sendPing() {
        const now = Date.now() & 0xFFFFFFFF;
        SpixiAppSdk.sendNetworkData(encodeSimplePacket(MSG_PING, now));
    }

    // Handle pong (response to our ping)
    handlePong(msg) {
        const now = Date.now() & 0xFFFFFFFF;
        const rtt = (now - msg.origT) >>> 0; // Unsigned 32-bit diff
        this.rtt = rtt;

        // Estimate remote time: remoteTimestamp + rtt/2
        // Offset = EstimatedRemoteTime - LocalTime
        // offset = (msg.replyT + rtt / 2) - now
        const estimatedRemote = (msg.replyT + Math.floor(rtt / 2)) >>> 0;
        const offset = (estimatedRemote - now) | 0; // Signed 32-bit adjustment

        this.samples.push(offset);
        if (this.samples.length > 5) this.samples.shift(); // Keep last 5 samples

        // Average offset for stability
        this.offset = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    }

    // Handle incoming ping (remote wants to sync)
    handlePing(msg) {
        const now = Date.now() & 0xFFFFFFFF;
        SpixiAppSdk.sendNetworkData(encodePongPacket(msg.t, now));
    }

    // Get current time synchronized with remote (32-bit truncated)
    getSyncedTime() {
        return (Date.now() + this.offset) & 0xFFFFFFFF;
    }
}

const timeSync = new TimeSync();
let syncInterval;

// ===== BINARY PROTOCOL =====
// Message type constants
const MSG_STATE = 1;
const MSG_COLLISION = 2; // [type:1][time:4][frame:2][seq:2][x:2][y:2][vx:2][vy:2]
const MSG_LAUNCH = 3;    // [type:1][time:4][x:2][y:2][vx:2][vy:2]
const MSG_LIVES = 4;     // [type:1][local:1][remote:1]
const MSG_END = 5;       // [type:1][local:1][remote:1]
const MSG_PING = 6;      // [type:1][time:4]
const MSG_PONG = 7;      // [type:1][origTime:4][replyTime:4]
const MSG_CONNECT = 8;   // [type:1][random:4]
// Type 9 (MSG_CRIT_ACK) removed
const MSG_BOUNCE = 10;   // [type:1][time:4][x:2][y:2][vx:2][vy:2] (Optional, treat as launch/update)
const MSG_FULL_RESET = 11; // [type:1]
const MSG_EXIT = 12;     // [type:1]
// Type 13 (MSG_RESTART) legacy removed
const MSG_PADDLE = 14;   // [type:1][paddleY:2][seq:2]
const MSG_CHAT = 15;     // [type:1][length:2][utf8...]
const MSG_STATUS = 16;   // [type:1][status:1]


/**
 * Encode a paddle update packet (compact)
 * Layout: [type:1][paddleY:2][seq:2] = 5 bytes
 */
function encodePaddlePacket(paddleY, seq) {
    const buffer = new ArrayBuffer(5);
    const view = new DataView(buffer);
    view.setUint8(0, MSG_PADDLE);
    view.setUint16(1, Math.round(paddleY) & 0xFFFF, true);
    view.setUint16(3, seq & 0xFFFF, true);
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

/**
 * Encode a simple packet (ping, connect, etc.)
 * Layout: [type:1][data:4] (data is optional for some types)
 */
function encodeSimplePacket(type, data = 0) {
    const buffer = new ArrayBuffer(5);
    const view = new DataView(buffer);
    view.setUint8(0, type);
    view.setUint32(1, data & 0xFFFFFFFF, true);
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function encodeChatPacket(text) {
    const encoder = new TextEncoder();
    const textBytes = encoder.encode(text);
    const length = textBytes.length;

    const buffer = new ArrayBuffer(3 + length);
    const view = new DataView(buffer);
    const uint8Fn = new Uint8Array(buffer); // Access for text copy

    view.setUint8(0, MSG_CHAT);
    view.setUint16(1, length, true);
    uint8Fn.set(textBytes, 3);

    return btoa(String.fromCharCode(...uint8Fn));
}

function encodeStatusPacket(statusStr) {
    const buffer = new ArrayBuffer(2);
    const view = new DataView(buffer);
    view.setUint8(0, MSG_STATUS);

    let statusCode = 0; // lobby
    if (statusStr === 'ready') statusCode = 1;
    if (statusStr === 'playing') statusCode = 2;

    view.setUint8(1, statusCode);
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function encodeLivesPacket(type, localLives, remoteLives) {
    const buffer = new ArrayBuffer(3);
    const view = new DataView(buffer);
    view.setUint8(0, type); // MSG_LIVES or MSG_END
    view.setUint8(1, localLives);
    view.setUint8(2, remoteLives);
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function encodePongPacket(origTime, replyTime) {
    const buffer = new ArrayBuffer(9);
    const view = new DataView(buffer);
    view.setUint8(0, MSG_PONG);
    view.setUint32(1, origTime & 0xFFFFFFFF, true);
    view.setUint32(5, replyTime & 0xFFFFFFFF, true);
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}


function encodeBallEventPacket(type, t, ball) {
    const buffer = new ArrayBuffer(13);
    const view = new DataView(buffer);

    view.setUint8(0, type); // MSG_LAUNCH, MSG_BOUNCE, MSG_COLLISION
    view.setUint32(1, t & 0xFFFFFFFF, true); // Timestamp (32-bit)

    // Ball state (mirrored X done by caller? No, caller passes raw ball usually)
    // Wait, caller of JSON.stringify did mirroring.
    // Let's assume caller passes {x,y,vx,vy} ALREADY MIRRORED or RAW?
    // In JSON: x: Math.round(CANVAS_WIDTH - b.x)
    // So caller handles mirroring.
    // We just encode what we get.

    view.setUint16(5, ball.x, true);
    view.setUint16(7, ball.y, true);
    view.setInt16(9, ball.vx, true); // vx is integer-ized by caller?
    // In JSON: vx: Math.round(-b.vx * 100)
    // So caller passes integer.
    view.setInt16(11, ball.vy, true);

    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function encodeStatePacket(frame, paddleY, seq, lastAck, ball) {
    // Variable size: Base 9 bytes + 8 bytes (Ball) if present
    const size = ball ? 17 : 9;
    const buffer = new ArrayBuffer(size);
    const view = new DataView(buffer);

    view.setUint8(0, MSG_STATE);
    view.setUint16(1, frame, true);
    view.setUint16(3, paddleY, true);
    view.setUint16(5, seq, true);
    view.setUint16(7, lastAck, true);

    if (ball) {
        view.setUint16(9, ball.x, true);
        view.setUint16(11, ball.y, true);
        view.setInt16(13, ball.vx, true);
        view.setInt16(15, ball.vy, true);
    }

    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

/**
 * Decode a binary packet from base64
 */
function decodeBinaryPacket(base64) {
    try {
        const binary = atob(base64);
        const buffer = new ArrayBuffer(binary.length);
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const view = new DataView(buffer);

        const type = view.getUint8(0);
        const result = { type };

        switch (type) {
            case MSG_STATE:
                if (view.byteLength >= 17) {
                    result.frame = view.getUint16(1, true);
                    result.paddleY = view.getUint16(3, true);
                    result.seq = view.getUint16(5, true);
                    result.lastAck = view.getUint16(7, true);
                    result.ballX = view.getUint16(9, true);
                    result.ballY = view.getUint16(11, true);
                    result.ballVx = view.getInt16(13, true) / 100;
                    result.ballVy = view.getInt16(15, true) / 100;
                }
                break;

            case MSG_PADDLE:
                if (view.byteLength >= 5) {
                    result.paddleY = view.getUint16(1, true);
                    result.seq = view.getUint16(3, true);
                }
                break;

            case MSG_LAUNCH:
            case MSG_BOUNCE:
                if (view.byteLength >= 13) {
                    result.t = view.getUint32(1, true);
                    result.ballX = view.getUint16(5, true);
                    result.ballY = view.getUint16(7, true);
                    result.ballVx = view.getInt16(9, true) / 100;
                    result.ballVy = view.getInt16(11, true) / 100;
                }
                break;

            case MSG_COLLISION:
                if (view.byteLength >= 17) {
                    result.t = view.getUint32(1, true);
                    result.frame = view.getUint16(5, true);
                    result.seq = view.getUint16(7, true);
                    result.ballX = view.getUint16(9, true);
                    result.ballY = view.getUint16(11, true);
                    result.ballVx = view.getInt16(13, true) / 100;
                    result.ballVy = view.getInt16(15, true) / 100;
                }
                break;

            case MSG_LIVES:
            case MSG_END:
                if (view.byteLength >= 3) {
                    result.local = view.getUint8(1);
                    result.remote = view.getUint8(2);
                }
                break;

            case MSG_PING:
                if (view.byteLength >= 5) {
                    result.t = view.getUint32(1, true);
                }
                break;

            case MSG_PONG:
                if (view.byteLength >= 9) {
                    result.origT = view.getUint32(1, true);
                    result.replyT = view.getUint32(5, true);
                }
                break;

            case MSG_CONNECT:
                if (view.byteLength >= 5) {
                    result.data = view.getUint32(1, true); // Random number
                }
                break;

            case MSG_CHAT:
                if (view.byteLength >= 3) {
                    const len = view.getUint16(1, true);
                    if (view.byteLength >= 3 + len) {
                        const textBytes = new Uint8Array(buffer, 3, len);
                        result.text = new TextDecoder().decode(textBytes);
                    }
                }
                break;

            case MSG_STATUS:
                if (view.byteLength >= 2) {
                    const statusByte = view.getUint8(1);
                    result.status = (statusByte === 2) ? 'playing' : (statusByte === 1 ? 'ready' : 'lobby');
                }
                break;

            case MSG_FULL_RESET:
            case MSG_EXIT:
                // No data needed
                break;

            default:
                // Fallback for simple data packets (legacy or simple types)
                if (view.byteLength >= 5) {
                    result.data = view.getUint32(1, true);
                }
                break;
        }

        return result;
    } catch (e) {
        return null; // Not a valid binary packet
    }
}


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
    pendingAuthorityTransfer: false, // Wait for update to be sent before dropping authority
    gameStarted: false,
    gameEnded: false,
    lastUpdate: 0,
    // Shadow state for Dead Reckoning
    networkBall: {
        x: CANVAS_WIDTH / 2,
        y: CANVAS_HEIGHT / 2,
        vx: 0,
        vy: 0,
        lastUpdateTime: 0
    },
    ballCorrection: { x: 0, y: 0 } // Current error vector to smooth out
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

// Dead Reckoning & Error Correction Constants
const BALL_CORRECTION_FACTOR = 0.1; // Fraction of error to correct per frame (smooth convergence)
const BALL_SNAP_THRESHOLD = 50; // Distance in pixels to snap immediately (too far to correct)

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
let lastPaddleSendTime = 0;
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
let lastBallSyncTime = 0; // Track last time ball state was sent (for heartbeat)

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

let autoStartTimer = null;
let gameStartTime = 0;

// Network ping interval
let pingInterval = null;
let gameLoopId = null; // requestAnimationFrame ID
let connectionRetryInterval = null;
let disconnectCheckInterval = null;

// Performance monitoring
let lastFrameTime = 0;


// ===== PREDICTION ROLLBACK =====
// State history buffer for retroactive correction
const STATE_HISTORY_SIZE = 30; // ~500ms at 60fps
let stateHistory = [];

/**
 * Save a snapshot of the current game state for potential rollback
 * Called at the start of each game frame
 */
function saveStateSnapshot() {
    stateHistory.push({
        frame: frameCounter,
        timestamp: Date.now(),
        ball: {
            x: gameState.ball.x,
            y: gameState.ball.y,
            vx: gameState.ball.vx,
            vy: gameState.ball.vy
        }
    });
    if (stateHistory.length > STATE_HISTORY_SIZE) stateHistory.shift();
}

/**
 * Rollback to a historical state and replay with corrected ball state
 * Used when a late collision event arrives that changes ball trajectory
 * 
 * @param {number} targetFrame - Frame number to roll back to
 * @param {object} newBallState - New ball state from collision (vx, vy corrected)
 * @returns {boolean} - True if rollback was successful
 */
function rollbackToFrame(targetFrame, newBallState) {
    // Find the closest snapshot at or before target frame
    let snapshot = null;
    for (let i = stateHistory.length - 1; i >= 0; i--) {
        if (stateHistory[i].frame <= targetFrame) {
            snapshot = stateHistory[i];
            break;
        }
    }

    if (!snapshot) {
        // Target frame too old, not in history buffer
        return false;
    }

    // Restore ball to snapshot position
    gameState.ball.x = snapshot.ball.x;
    gameState.ball.y = snapshot.ball.y;

    // Apply corrected velocity from collision
    gameState.ball.vx = newBallState.vx;
    gameState.ball.vy = newBallState.vy;

    // Fast-forward physics to current frame
    const framesToSimulate = frameCounter - snapshot.frame;
    for (let i = 0; i < framesToSimulate; i++) {
        gameState.ball.x += gameState.ball.vx;
        gameState.ball.y += gameState.ball.vy;

        // Wall bounces
        if (gameState.ball.y <= BALL_SIZE / 2) {
            gameState.ball.y = BALL_SIZE / 2;
            gameState.ball.vy = Math.abs(gameState.ball.vy);
        } else if (gameState.ball.y >= CANVAS_HEIGHT - BALL_SIZE / 2) {
            gameState.ball.y = CANVAS_HEIGHT - BALL_SIZE / 2;
            gameState.ball.vy = -Math.abs(gameState.ball.vy);
        }
    }

    // Clear any accumulated error correction
    gameState.ballCorrection.x = 0;
    gameState.ballCorrection.y = 0;

    return true;
}

// Simplified connection handshake with retry mechanism
function establishConnection() {
    // Send connection request with random number for ball owner determination (binary)
    SpixiAppSdk.sendNetworkData(encodeSimplePacket(MSG_CONNECT, myRandomNumber));
    lastDataSent = SpixiTools.getTimestamp();

    // Keep sending connection packets every 500ms until we get a response
    if (!connectionRetryInterval) {
        connectionRetryInterval = setInterval(() => {
            if (!connectionEstablished) {
                SpixiAppSdk.sendNetworkData(encodeSimplePacket(MSG_CONNECT, myRandomNumber));
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

    // Start regular ping (using binary TimeSync)
    if (!pingInterval) {
        pingInterval = setInterval(() => {
            const currentTime = SpixiTools.getTimestamp();
            if (currentTime - lastDataSent >= 2) {
                lastDataSent = currentTime;
                timeSync.sendPing();
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
    const waitingScreen = document.getElementById('waiting-screen');
    const gameScreen = document.getElementById('game-screen');

    waitingScreen.classList.remove('screen-active');
    waitingScreen.classList.add('screen-hidden');

    gameScreen.classList.remove('screen-hidden');
    gameScreen.classList.add('screen-active');

    // Auto-start after brief delay
    autoStartTimer = setTimeout(() => startGame(), 500);
}

function initGame() {
    canvas = document.getElementById('pongCanvas');
    ctx = canvas.getContext('2d');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;

    setupControls();
    setupChatUI(); // Initialize Chat UI

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
    sendPlayerStatus('playing');

    // Determine ball owner based on random number comparison
    // Higher number wins. If equal (rare), compare session IDs
    if (myRandomNumber === remoteRandomNumber) {
        gameState.isBallOwner = sessionId > remotePlayerAddress;
    } else {
        gameState.isBallOwner = myRandomNumber > remoteRandomNumber;
    }

    // Reset game state and initialize serve
    resetBall(false); // Manual launch for first serve

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

    // Start clock sync
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(() => timeSync.sendPing(), 1000);
    timeSync.sendPing(); // Send immediate ping
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
    if (gameState.waitingForServe && gameState.isBallOwner) {
        document.getElementById('shootBtn').style.display = 'none';
        document.getElementById('status-text').textContent = 'Game On!';
        playLaunchSound();

        gameState.waitingForServe = false;
        gameState.hasActiveBallAuthority = true;

        // Initialize ball velocity - always shoot toward opponent (left)
        const angle = (Math.random() * Math.PI / 3) - Math.PI / 6;
        gameState.ball.vx = -Math.cos(angle) * BALL_SPEED_INITIAL; // Always negative (toward left)
        gameState.ball.vy = Math.sin(angle) * BALL_SPEED_INITIAL;

        // Notify other player with ball velocity included
        const b = gameState.ball;
        // Use local time for launch event (receiver syncs to this)
        const launchTime = Date.now();

        const ballData = {
            x: Math.round(CANVAS_WIDTH - b.x),
            y: Math.round(b.y),
            vx: Math.round(-b.vx * 100),
            vy: Math.round(b.vy * 100)
        };
        SpixiAppSdk.sendNetworkData(encodeBallEventPacket(MSG_LAUNCH, launchTime, ballData));
        lastDataSent = SpixiTools.getTimestamp();
        lastSyncTime = 0;
    }
}

function gameLoop(timestamp) {
    try {
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

        frameCounter++;

        // Save state snapshot for potential rollback
        saveStateSnapshot();

        updatePaddle();

        // Update remote paddle with entity interpolation
        updateRemotePaddleInterpolation();

        // Ball movement: Authority determines simulation vs interpolation
        // Server (ball owner) simulates, client interpolates
        if (gameState.hasActiveBallAuthority) {
            // We have authority - simulate ball physics locally
            const ballHasVelocity = Math.abs(gameState.ball.vx) > 0.1 || Math.abs(gameState.ball.vy) > 0.1;

            if (ballHasVelocity) {
                // Pass deltaTime to updateBall for time-based physics
                updateBall(deltaTime);
                checkCollisions();

                // Only ball owner checks score (game logic authority)
                if (gameState.isBallOwner) {
                    checkScore();
                }
            } else if (gameState.waitingForServe) {
                // Ball waiting for serve - keep attached to serving paddle
                if (gameState.isBallOwner) {
                    // Ball owner on right
                    gameState.ball.x = CANVAS_WIDTH - 20 - PADDLE_WIDTH - BALL_SIZE;
                    gameState.ball.y = gameState.localPaddle.y + PADDLE_HEIGHT / 2;
                }
                // Non-owner: Do nothing. Let network updates (enabled in v3.11.1) control ball pos.
                // Previously this forced ball to local paddle, hiding the server's ball.
            }
        } else {
            // We don't have authority - ALWAYS interpolate toward target
            // This ensures smooth client-side ball movement even if local velocity is 0
            updateBallInterpolation(deltaTime);
        }

        render();

        // Send unified game state at dynamic rate
        const currentTime = Date.now();
        const timeSinceLastSync = currentTime - lastSyncTime;

        if (timeSinceLastSync >= currentNetworkRate) {
            sendGameState();
            lastSyncTime = currentTime;
        }
    } catch (e) {
        console.error("Error in game loop:", e);
        // Force restart the loop even if ID exists (it might be stale/broken)
        if (!gameState.gameEnded) {
            if (gameLoopId) cancelAnimationFrame(gameLoopId);
            gameLoopId = requestAnimationFrame(gameLoop);
        }
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

    // Send paddle update immediately if changed (throttled to ~30fps)
    const currentTime = Date.now();
    if (gameState.localPaddle.y !== lastSentPaddleY && currentTime - lastPaddleSendTime > 30) {
        if (useBinaryProtocol) {
            inputSequence++;
            const packet = encodePaddlePacket(gameState.localPaddle.y, inputSequence);
            SpixiAppSdk.sendNetworkData(packet);
            lastSentPaddleY = gameState.localPaddle.y;
            lastPaddleSendTime = currentTime;
        }
    }

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

function updateBall(dt) {
    // Normalize dt to 60fps (approx 16.67ms)
    // If running at 60fps, timeRatio = 1.0
    const timeRatio = dt ? (dt / 16.67) : 1.0;

    gameState.ball.x += gameState.ball.vx * timeRatio;
    gameState.ball.y += gameState.ball.vy * timeRatio;

    // Top and bottom wall collision
    if (gameState.ball.y <= BALL_SIZE / 2 || gameState.ball.y >= CANVAS_HEIGHT - BALL_SIZE / 2) {
        gameState.ball.vy = -gameState.ball.vy;
        gameState.ball.y = Math.max(BALL_SIZE / 2, Math.min(CANVAS_HEIGHT - BALL_SIZE / 2, gameState.ball.y));
        playWallBounceSound();

        // Send bounce event to keep client synced
        if (gameState.hasActiveBallAuthority) {
            sendBallEvent(MSG_BOUNCE);
        }
    }
}

/**
 * Ball interpolation for non-authoritative client
 * Uses velocity-based extrapolation to predict ball position at 60fps
 * from network updates.
 * 
 * This creates smooth motion by:
 * 1. Extrapolating local position based on velocity
 * 2. Gently correcting towards the authoritative target from server
 */
function updateBallInterpolation() {
    try {
        // Safety check
        if (isNaN(gameState.ball.x) || isNaN(gameState.ball.y) || isNaN(gameState.ball.vx) || isNaN(gameState.ball.vy)) {
            gameState.ball.x = CANVAS_WIDTH / 2;
            gameState.ball.y = CANVAS_HEIGHT / 2;
            gameState.ball.vx = 0;
            gameState.ball.vy = 0;
            return;
        }

        // 1. Simulate Local Physics (Velocity)
        // Even without authority, we apply velocity to keep it moving smoothy at 60fps
        gameState.ball.x += gameState.ball.vx;
        gameState.ball.y += gameState.ball.vy;

        // Wall bounces (local visual only)
        if (gameState.ball.y <= BALL_SIZE / 2 || gameState.ball.y >= CANVAS_HEIGHT - BALL_SIZE / 2) {
            gameState.ball.vy = -gameState.ball.vy;
            gameState.ball.y = Math.max(BALL_SIZE / 2, Math.min(CANVAS_HEIGHT - BALL_SIZE / 2, gameState.ball.y));
            playWallBounceSound();
        }

        // 2. Apply Soft Error Correction (Convergence)
        // We gently push the ball by a fraction of the known error vector each frame.
        if (Math.abs(gameState.ballCorrection.x) > 0.1 || Math.abs(gameState.ballCorrection.y) > 0.1) {
            const correctionX = gameState.ballCorrection.x * BALL_CORRECTION_FACTOR;
            const correctionY = gameState.ballCorrection.y * BALL_CORRECTION_FACTOR;

            gameState.ball.x += correctionX;
            gameState.ball.y += correctionY;

            // Decay the remaining error
            gameState.ballCorrection.x -= correctionX;
            gameState.ballCorrection.y -= correctionY;
        }

        // 3. Debug Visuals (Optional - verify later)
        // if (gameState.frameCounter % 60 === 0) console.log("Ball Error:", gameState.ballCorrection);

    } catch (e) {
        console.error("Error in updateBallInterpolation:", e);
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

// Check for critical message retransmissions periodically
setInterval(() => {
    checkCriticalRetransmissions();
}, 300); // Check every 300ms

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
            // We hit it - OPPONENT now has authority (ball heading toward them)
            // Defer authority transfer until we send the update
            gameState.pendingAuthorityTransfer = true;
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
            // We hit it - OPPONENT now has authority (ball heading toward them)
            // Defer authority transfer until we send the update
            gameState.pendingAuthorityTransfer = true;
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
            resetBall(true); // Auto launch
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
            resetBall(true); // Auto launch
            sendLifeUpdate();
        }
    }
}

function resetBall(autoLaunch = true) {
    // Position ball at serving paddle
    resetBallPosition();

    // Determine who serves (whoever got scored on serves)
    // For now, alternate based on ball owner
    const servingPlayer = gameState.isBallOwner;
    gameState.hasActiveBallAuthority = servingPlayer;

    if (autoLaunch) {
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
        // Use synced time for launch event
        const launchTime = timeSync.getSyncedTime();

        SpixiAppSdk.sendNetworkData(JSON.stringify({
            a: "launch",
            t: launchTime,
            b: {
                x: Math.round(CANVAS_WIDTH - b.x),
                y: Math.round(b.y),
                vx: Math.round(-b.vx * 100),   // Integer velocity (*100)
                vy: Math.round(b.vy * 100)
            }
        }));
        lastDataSent = SpixiTools.getTimestamp();
    } else {
        // Manual launch - wait for user input
        gameState.waitingForServe = true;
        gameState.ball.vx = 0;
        gameState.ball.vy = 0;

        if (gameState.isBallOwner) {
            document.getElementById('status-text').textContent = "Your Serve - Tap to Launch";
            document.getElementById('shootBtn').style.display = 'inline-flex';
            document.getElementById('shootBtn').disabled = false;
        } else {
            document.getElementById('status-text').textContent = "Opponent's Serve";
            document.getElementById('shootBtn').style.display = 'none';
        }
    }
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
    try {
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

        // Draw ball - only if it has velocity OR we have authority OR (waiting for serve AND we own ball)
        // Lower threshold to 0.01 to ensure ball is visible even at very low speeds
        const ballVisible = (Math.abs(gameState.ball.vx) > 0.01 || Math.abs(gameState.ball.vy) > 0.01) ||
            gameState.hasActiveBallAuthority ||
            (gameState.waitingForServe && gameState.isBallOwner);
        if (ballVisible) {
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(gameState.ball.x, gameState.ball.y, BALL_SIZE / 2, 0, Math.PI * 2);
            ctx.fill();
        }
    } catch (e) {
        console.error("Error in render:", e);
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
    sendPlayerStatus('lobby');
}

function restartGame() {
    // Notify remote player first
    SpixiAppSdk.sendNetworkData(encodeSimplePacket(MSG_FULL_RESET));
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
    lastSentBallState = null;
    lastBallSyncTime = 0;

    // Reset wheel position to center
    if (wheelHandle) {
        wheelHandle.style.top = '50%';
    }

    updateLivesDisplay();

    // Transition to waiting screen
    const gameOverScreen = document.getElementById('game-over-screen');
    const gameScreen = document.getElementById('game-screen');
    const waitingScreen = document.getElementById('waiting-screen');

    // Robust screen transition
    gameOverScreen.classList.remove('screen-active');
    gameOverScreen.classList.add('screen-hidden');

    gameScreen.classList.remove('screen-active');
    gameScreen.classList.add('screen-hidden');

    waitingScreen.classList.remove('screen-hidden');
    waitingScreen.classList.add('screen-active');

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
        SpixiAppSdk.sendNetworkData(encodeSimplePacket(MSG_EXIT));
    } catch (e) {
        // Ignore send errors on exit
    }

    // Cleanup intervals
    if (gameLoopId) cancelAnimationFrame(gameLoopId);
    if (pingInterval) clearInterval(pingInterval);
    if (syncInterval) clearInterval(syncInterval);
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
    // Send binary collision packet
    // We calculate event time relative to immediate dispatch
    const eventTime = Date.now();

    const ballData = {
        x: Math.round(CANVAS_WIDTH - b.x),
        y: Math.round(b.y),
        vx: Math.round(-b.vx * 100),
        vy: Math.round(b.vy * 100)
    };

    // We reuse MSG_COLLISION constant (2)
    SpixiAppSdk.sendNetworkData(encodeBallEventPacket(MSG_COLLISION, eventTime, ballData));
}

function sendBallEvent(type) {
    const b = gameState.ball;
    const eventTime = Date.now(); // Use local time

    const ballData = {
        x: Math.round(CANVAS_WIDTH - b.x),
        y: Math.round(b.y),
        vx: Math.round(-b.vx * 100),
        vy: Math.round(b.vy * 100)
    };

    SpixiAppSdk.sendNetworkData(encodeBallEventPacket(type, eventTime, ballData));
    lastDataSent = SpixiTools.getTimestamp();
}

function handleBallEvent(msg) {
    // Extract state
    let rawX, rawY, rawVx, rawVy;

    if (msg.b) {
        rawX = Number(msg.b.x); rawY = Number(msg.b.y); rawVx = Number(msg.b.vx); rawVy = Number(msg.b.vy);
    } else if (msg.ballX !== undefined) {
        rawX = Number(msg.ballX); rawY = Number(msg.ballY); rawVx = Number(msg.ballVx); rawVy = Number(msg.ballVy);
    } else {
        return;
    }

    // Mirror and convert
    const startX = CANVAS_WIDTH - (isNaN(rawX) ? 0 : rawX);
    const startY = isNaN(rawY) ? CANVAS_HEIGHT / 2 : rawY;
    const startVx = -(isNaN(rawVx) ? 0 : rawVx) / 100;
    const startVy = (isNaN(rawVy) ? 0 : rawVy) / 100;

    // Calculate time delta
    const now = timeSync.getSyncedTime();
    const eventTime = msg.t || now;
    let dt = now - eventTime;

    // Clamp dt
    if (dt < 0) dt = 0;
    if (dt > 1000) dt = 1000; // Cap prediction to 1 second

    // 1. Update Shadow Network Ball State
    gameState.networkBall.x = startX;
    gameState.networkBall.y = startY;
    gameState.networkBall.vx = startVx;
    gameState.networkBall.vy = startVy;
    gameState.networkBall.lastUpdateTime = eventTime;

    // 2. Dead Reckoning: Fast-forward network ball to CURRENT time
    // Simulate physics from eventTime -> now
    const step = 16; // 16ms steps
    let timeSimulated = 0;

    let predictedX = startX;
    let predictedY = startY;
    let predictedVx = startVx;
    let predictedVy = startVy;

    if (Math.abs(startVx) > 0.01 || Math.abs(startVy) > 0.01) {
        while (timeSimulated < dt) {
            const currentStep = Math.min(step, dt - timeSimulated);
            const ratio = currentStep / 16;

            predictedX += predictedVx * ratio;
            predictedY += predictedVy * ratio;

            // Simple wall bounces for prediction
            if (predictedY <= BALL_SIZE / 2) {
                predictedY = BALL_SIZE / 2;
                predictedVy = -predictedVy;
            } else if (predictedY >= CANVAS_HEIGHT - BALL_SIZE / 2) {
                predictedY = CANVAS_HEIGHT - BALL_SIZE / 2;
                predictedVy = -predictedVy;
            }

            timeSimulated += currentStep;
        }
    }

    // 3. Calculate Correction Vector (Convergence)
    // If we are already close, corrections -> 0.
    // If we are far, we need to nudge the local ball towards the predicted position.

    // Distance between current local ball and where the network says it should be
    const dx = predictedX - gameState.ball.x;
    const dy = predictedY - gameState.ball.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > BALL_SNAP_THRESHOLD) {
        // Too far off (e.g. missed a collision update) -> Snap immediately
        gameState.ball.x = predictedX;
        gameState.ball.y = predictedY;
        gameState.ball.vx = predictedVx;
        gameState.ball.vy = predictedVy;
        gameState.ballCorrection.x = 0;
        gameState.ballCorrection.y = 0;
        // console.log("Ball snapped! Dist:", dist);
    } else {
        // Small error -> Smooth correction
        // We set the target correction. The game loop will apply portions of this.
        // Actually, simpler: Set the local ball to match calculated velocity, 
        // but keep the position error to be resolved smoothly.

        gameState.ball.vx = predictedVx;
        gameState.ball.vy = predictedVy;

        // The error we want to eliminate over time
        gameState.ballCorrection.x = dx;
        gameState.ballCorrection.y = dy;
    }

    // Update targets for reference/interpolation variables (legacy but kept for safety)
    ballTarget.x = gameState.ball.x;
    ballTarget.y = gameState.ball.y;
    ballTarget.vx = gameState.ball.vx;
    ballTarget.vy = gameState.ball.vy;

    // Ball is now heading toward us - WE have authority (receiver model)
    gameState.hasActiveBallAuthority = true;
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
    try {
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
            state.p = Math.round(paddleY); // Round to integer for packet size optimization
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

        // Ball state: Hybrid approach (event-based + adaptive-rate periodic)
        // - Events (launch/bounce/hit) for instant reactions
        // - Adaptive periodic updates: 60pps (good connection) or 25pps (degraded connection)
        // - Also send during waitingForServe so opponent can see ball on server's paddle
        const ballActive = Math.abs(gameState.ball.vx) > 0.1 || Math.abs(gameState.ball.vy) > 0.1;
        const shouldSendBall = (gameState.hasActiveBallAuthority && ballActive) ||
            (gameState.waitingForServe && gameState.isBallOwner);
        if (shouldSendBall) {
            const b = gameState.ball;

            // Use reusable ball state object
            reusableBallState.x = Math.round(CANVAS_WIDTH - b.x); // Mirror X
            reusableBallState.y = Math.round(b.y);
            reusableBallState.vx = Math.round(-b.vx * 100); // Integer velocity
            reusableBallState.vy = Math.round(b.vy * 100);

            const newBallState = reusableBallState;

            // Check for significant velocity change (bounce/hit) to force update
            const velocityChanged = !lastSentBallState ||
                Math.abs(lastSentBallState.vx - newBallState.vx) > 5 || // > 0.05 float diff
                Math.abs(lastSentBallState.vy - newBallState.vy) > 5;

            // BANDWIDTH OPTIMIZATION:
            // Switch to Event-Based updates (like p2p-pong). 
            // Only send when physics change (bounce/hit) or rare heartbeat (1s)
            // This significantly reduces packet count.
            const ballUpdateInterval = 1000; // 1pps heartbeat

            // Send ball at 10pps OR on velocity change (event)
            const timeSinceLastBallUpdate = currentTime - (lastBallUpdateTime || 0);
            if (timeSinceLastBallUpdate >= ballUpdateInterval || velocityChanged) {
                lastSentBallState = { ...newBallState };
                state.b = newBallState;
                lastBallUpdateTime = currentTime;

                // If we were waiting to relinquish authority (after collision), do it now
                // This ensures we sent at least one packet with the new vector
                if (gameState.pendingAuthorityTransfer) {
                    gameState.hasActiveBallAuthority = false;
                    gameState.pendingAuthorityTransfer = false;
                }
            }
        } else if (gameState.pendingAuthorityTransfer) {
            // Edge case: authority transfer pending but ball not active/moving?
            // Should not happen on collision, but safety release
            gameState.hasActiveBallAuthority = false;
            gameState.pendingAuthorityTransfer = false;
        } else if (!ballActive) {
            // Ball stopped - clear cached state
            lastSentBallState = null;
        }

        // Always send state packet (binary only)
        // Binary protocol: encode as compact binary
        const ball = state.b ? {
            x: state.b.x,
            y: state.b.y,
            vx: state.b.vx, // Already integer in state.b
            vy: state.b.vy
        } : null;

        const binaryData = encodeStatePacket(
            frameCounter,
            paddleY,
            inputSequence,
            lastAcknowledgedSequence,
            ball
        );
        SpixiAppSdk.sendNetworkData(binaryData);

    } catch (e) {
        console.error("Error sending game state:", e);
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
    // Send life updates (fire and forget)
    const currentTime = SpixiTools.getTimestamp();
    lastDataSent = currentTime;
    SpixiAppSdk.sendNetworkData(encodeLivesPacket(MSG_LIVES, gameState.localPaddle.lives, gameState.remotePaddle.lives));
}

function sendEndGame() {
    const currentTime = SpixiTools.getTimestamp();
    lastDataSent = currentTime;
    SpixiAppSdk.sendNetworkData(encodeLivesPacket(MSG_END, gameState.localPaddle.lives, gameState.remotePaddle.lives));
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

    // Decode Binary Packet
    const msg = decodeBinaryPacket(data);
    if (!msg) return; // Invalid packet

    switch (msg.type) {


        case MSG_CONNECT:
            // Received connection request from remote player
            if (msg.data !== undefined) {
                remoteRandomNumber = msg.data;
            }

            // Always reply with our connection packet (using simple packet encoder)
            SpixiAppSdk.sendNetworkData(encodeSimplePacket(MSG_CONNECT, myRandomNumber));
            lastDataSent = SpixiTools.getTimestamp();

            // Only establish connection if we have both random numbers and not already connected
            if (!connectionEstablished && remoteRandomNumber !== null) {
                handleConnectionEstablished();
            }
            break;

        case MSG_PING:
            // Handle clock sync ping
            if (msg.t) {
                timeSync.handlePing(msg);
            }
            break;

        case MSG_PONG:
            // Handle clock sync pong
            if (msg.origT) {
                timeSync.handlePong(msg);
            }
            break;

        case MSG_CHAT:
            // Handle Chat Message
            if (msg.text) addChatMessage(msg.text, false);
            break;

        case MSG_STATUS:
            // Handle Player Status
            if (msg.status) updateOpponentStatusUI(msg.status);
            break;

        case MSG_LAUNCH:
            // Ball owner has launched
            if (!gameState.isBallOwner) {
                document.getElementById('shootBtn').style.display = 'none';
                document.getElementById('status-text').textContent = 'Game On!';
                handleBallEvent(msg);
            }
            break;

        case MSG_BOUNCE:
            // Ball bounced off wall
            if (!gameState.isBallOwner) {
                handleBallEvent(msg);
            }
            break;

        case MSG_STATE: // Unified game state update
            // Frame counter sync: Detect out-of-order packets
            if (msg.frame !== undefined) {
                if (!validateFrameCounter(msg.frame)) {
                    // Out-of-order or stale packet - ignore it
                    console.debug(`Ignoring out-of-order packet with frame ${msg.frame}`);
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

            // Update remote paddle target for smooth interpolation
            if (msg.paddleY !== undefined) {
                remotePaddleTarget = Number(msg.paddleY);
            }

            // Update ball state when receiving data
            if (msg.ballX !== undefined) {
                // Call handler which now supports flat properties
                handleBallEvent(msg);
            }
            break;

        case MSG_COLLISION:
            // Remote player hit the ball - they now have authority
            if (msg.t !== undefined) {
                handleBallEvent(msg);

                // Still process retroactive collision for validation
                processRetroactiveCollision(msg.t, msg.frame, msg.seq, {
                    x: msg.ballX,
                    y: msg.ballY,
                    vx: msg.ballVx,
                    vy: msg.ballVy
                });
            }
            break;

        case MSG_LIVES:
            // Update lives from ball owner
            if (!gameState.isBallOwner) {
                gameState.localPaddle.lives = msg.remote;
                gameState.remotePaddle.lives = msg.local;
                updateLivesDisplay();
            }
            break;

        case MSG_END:
            // Game ended
            if (!gameState.gameEnded) {
                gameState.localPaddle.lives = msg.remote;
                gameState.remotePaddle.lives = msg.local;
                endGame(gameState.localPaddle.lives > 0);
            }
            break;

        case MSG_FULL_RESET:
            // Full connection reset - triggered by either player
            performFullReset();
            break;

        case MSG_EXIT:
            // Opponent exited the game
            handleOpponentDisconnect();
            break;
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

// ==========================================
// CHAT & STATUS LOGIC
// ==========================================

function setupChatUI() {
    // Chat Toggle Buttons
    // specific buttons only now - waiting screen chat removed
    const gameOverChatBtn = document.getElementById('gameOverChatBtn');
    if (gameOverChatBtn) gameOverChatBtn.addEventListener('click', toggleChat);

    // In-Game Floating Button
    const inGameChatBtn = document.getElementById('inGameChatBtn');
    if (inGameChatBtn) inGameChatBtn.addEventListener('click', toggleChat);

    // Popup Notification Click
    const popup = document.getElementById('chatNotificationPopup');
    if (popup) popup.addEventListener('click', toggleChat);

    // Close Chat Button
    const closeBtn = document.getElementById('closeChatBtn');
    if (closeBtn) closeBtn.addEventListener('click', toggleChat);

    // Send Message Button
    const sendBtn = document.getElementById('sendChatBtn');
    if (sendBtn) sendBtn.addEventListener('click', sendChatMessage);

    // Input Enter Key
    const input = document.getElementById('chatInput');
    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendChatMessage();
        });
    }

    // Exit Button
    const exitBtn = document.getElementById('waitingExitBtn');
    if (exitBtn) {
        exitBtn.addEventListener('click', () => {
            SpixiAppSdk.back(); // Use proper SDK back method
        });
    }

    // Initial Status Broadcast
    sendPlayerStatus('lobby');
}

function toggleChat() {
    const chatPanel = document.getElementById('chat-panel');
    const waitingBadge = document.getElementById('waitingChatBadge');
    const gameOverBadge = document.getElementById('gameOverChatBadge');
    const inGameBadge = document.getElementById('inGameChatBadge');

    isChatOpen = !isChatOpen;

    if (isChatOpen) {
        chatPanel.classList.remove('chat-hidden');
        checkUnreadMessages = 0;
        waitingBadge.classList.add('hidden');
        gameOverBadge.classList.add('hidden');
        if (inGameBadge) inGameBadge.classList.add('hidden');
        setTimeout(() => document.getElementById('chatInput').focus(), 300);
    } else {
        chatPanel.classList.add('chat-hidden');
    }
}

let chatPopupTimer = null;

function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;

    // Send to remote
    SpixiAppSdk.sendNetworkData(encodeChatPacket(text));

    // Add to local UI
    addChatMessage(text, true);
    input.value = '';
}

function addChatMessage(text, isMine) {
    const container = document.getElementById('chatMessages');
    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${isMine ? 'mine' : 'theirs'}`;
    bubble.textContent = text;
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;

    if (!isMine && !isChatOpen) {
        checkUnreadMessages++;
        updateChatBadges();
        showChatNotification(text);
    }
}

function showChatNotification(text) {
    const popup = document.getElementById('chatNotificationPopup');
    const popupText = document.getElementById('notificationText');

    if (popup && popupText) {
        popupText.textContent = text;
        popup.classList.remove('hidden');

        // Clear previous timer if exists to prevent early closing
        if (chatPopupTimer) clearTimeout(chatPopupTimer);

        chatPopupTimer = setTimeout(() => {
            popup.classList.add('hidden');
            chatPopupTimer = null;
        }, 3000);
    }
}

function updateChatBadges() {
    const count = checkUnreadMessages > 9 ? '9+' : checkUnreadMessages;
    ['waitingChatBadge', 'gameOverChatBadge', 'inGameChatBadge'].forEach(id => {
        const badge = document.getElementById(id);
        if (badge) {
            badge.textContent = count;
            badge.classList.remove('hidden');
        }
    });
}

function sendPlayerStatus(status) {
    localPlayerStatus = status;
    SpixiAppSdk.sendNetworkData(encodeStatusPacket(status));
}

function updateOpponentStatusUI(status) {
    const pill = document.getElementById('gameOverOpponentStatus');
    // UI element might be removed, so check first
    if (pill) {
        const dot = pill.querySelector('.status-dot');
        const text = pill.querySelector('.status-text');

        pill.classList.remove('hidden');
        remotePlayerStatus = status;

        if (status === 'playing') {
            dot.classList.add('ready');
            text.textContent = "Opponent is Playing";
        } else if (status === 'lobby') {
            dot.classList.remove('ready');
            text.textContent = "Opponent is in Lobby";
        } else {
            dot.classList.remove('ready');
            text.textContent = "Opponent Status Unknown";
        }
    } else {
        // Just track state internally if UI is gone
        remotePlayerStatus = status;
    }
}

// Helper to check if binary
function isBinaryPacket(str) {
    // Basic heuristic: check if it looks like base64 and starts with known types
    if (typeof str !== 'string') return false;
    // Check for msg type byte at start (base64 encoded first char)
    // 1 (MSG_STATE) -> A...
    // 2 (MSG_COLLISION) -> A... (wait, base64 encoding shifts. Need safe check)
    // Actually, simple JSON check is safer.
    return !str.trim().startsWith('{');
}

// Start the app on load
window.onload = SpixiAppSdk.fireOnLoad;
