# Spixi Mini Apps - AI Coding Agent Instructions

## Project Overview

This repository contains the SDK, tooling, and example applications for **Spixi Mini Apps** - client-side WebView applications that run inside the Spixi decentralized messenger. Mini Apps are HTML/CSS/JavaScript applications that communicate with the Spixi native client via a custom protocol (`ixian:` URL scheme).

**Architecture**: Mini Apps run in isolated WebView sessions with bidirectional communication:
- **App → Spixi**: Uses `location.href = "ixian:command..."` protocol to trigger native actions
- **Spixi → App**: Calls global `executeUiCommand()` function with base64-encoded parameters

## Critical Conventions

### 1. SDK Integration Pattern

**Every Mini App MUST include both SDK files in this exact order:**

```html
<script src="js/spixi-app-sdk.js"></script>
<script src="js/spixi-tools.js"></script>
```

**Never modify SDK files** - they should be copied from `mini-apps-sdk/` unchanged.

### 2. Lifecycle Management

All Mini Apps follow this initialization pattern:

```javascript
// Override SDK callbacks BEFORE fireOnLoad
SpixiAppSdk.onInit = function(sessionId, userAddresses) {
    // Initialize app state with session info
    // userAddresses is comma-separated for multiUser apps
};

// Fire load event to notify Spixi when ready
window.onload = SpixiAppSdk.fireOnLoad;
```

**Critical**: Always call `SpixiAppSdk.fireOnLoad()` when the app is ready, typically in `window.onload`.

### 3. Storage Pattern

Storage operations are **asynchronous** and use base64 encoding:

```javascript
// Writing - always base64 encode
SpixiAppSdk.setStorageData(key, btoa(JSON.stringify(data)));

// Reading - request then handle callback
SpixiAppSdk.getStorageData(key);
SpixiAppSdk.onStorageData = function(key, value) {
    const data = JSON.parse(atob(value));  // base64 decode
};
```

**Pattern in multi-user apps**: Use remote user's address as storage key (see `com.ixilabs.spixi.tictactoe`).

### 4. Network Communication

For `multiUser` apps, use JSON-based messaging with action types:

```javascript
// Sending
const data = { action: "move", cellPosition: 5 };
SpixiAppSdk.sendNetworkData(JSON.stringify(data));

// Receiving
SpixiAppSdk.onNetworkData = function(senderAddress, data) {
    const parsed = JSON.parse(data);
    switch(parsed.action) {
        case "move": // handle move
        case "ping": // handle keepalive
    }
};
```

**Best Practice**: Implement periodic ping/keepalive to detect disconnections (see whiteboard/tictactoe examples).

### 5. Protocol Extensions

Advanced apps can define custom protocol handlers:

```javascript
// Register protocol ID (e.g., "com.yourcompany.yourapp")
SpixiAppSdk.sendNetworkProtocolData(protocolId, data);

SpixiAppSdk.onNetworkProtocolData = function(senderAddress, protocolId, data) {
    // Handle protocol-specific messages
};
```

Used in `com.mostnonameuser.spixi.aiassistant` for structured AI communication.

## File Structure Requirements

```
yourapp/
├── appinfo.spixi         # Metadata (REQUIRED)
├── icon.png              # 512x512 recommended
└── app/
    ├── index.html        # Entry point (REQUIRED)
    ├── js/
    │   ├── spixi-app-sdk.js    # SDK copy
    │   ├── spixi-tools.js      # SDK copy
    │   └── yourapp.js          # Your logic
    └── css/
```

### appinfo.spixi Format

```
caVersion = 0
id = com.company.appname          # Reverse DNS notation (REQUIRED)
publisher = Your Name             # REQUIRED
name = App Display Name          # REQUIRED
version = 1.0.0                  # REQUIRED
capabilities = multiUser         # REQUIRED - or singleUser, authentication, etc.
maxUsers = 2                     # Optional - limit concurrent users
minUsers = 1                     # Optional - minimum users to start
protocols = com.company.protocol # Optional - custom protocol handler
icon = icon.png                  # Optional - explicit icon reference
```

**Capabilities** (comma-separated):
- `singleUser` - Runs independently (video-test, auth)
- `multiUser` - Requires peer connection (tictactoe, whiteboard)
- `authentication` - Can authenticate users via QR codes
- `transactionSigning` - Can sign blockchain transactions
- `registeredNamesManagement` - Can manage decentralized names

**After Packing**: The packer adds `image`, `contentUrl`, `checksum`, and `contentSize` fields to the `.spixi` file.

## Development Workflow

### Testing
1. Use `apps/com.ixilabs.spixi.mini-apps-test/` to verify SDK integration
2. Test storage with sequence: write → read → overwrite → delete
3. Test network by running in two Spixi clients simultaneously
4. **Local Browser Testing**: Open `app/index.html` directly - limited SDK functions will work for UI testing

### Packaging

**CLI Tool (Recommended for automation)**:
```bash
# Install dependencies first
npm install

# Pack single app
node pack-app.js ./apps/com.ixilabs.spixi.yourapp

# Pack to specific output directory
node pack-app.js ./apps/com.ixilabs.spixi.yourapp ./packed

# Pack all apps (PowerShell)
Get-ChildItem ./apps -Directory | ForEach-Object { node pack-app.js $_.FullName ./packed }
```

**Browser Tool** (`app-packer/index.html`):
1. Drag app folder containing `appinfo.spixi` and `app/` directory
2. Generates: `.zip` (content), `.spixi` (metadata), `icon.png`
3. Upload all three files to your web host

**Note**: Browser packer works locally only in Firefox due to CORS; use https://apps.spixi.io/packer for other browsers.

## State Synchronization Pattern

Multi-user apps must handle state conflicts. See `tic-tac-toe.js` for canonical example:

```javascript
// Always compare move counts to determine authority
const myMovesCount = gameState.board.filter(x => x != '').length;
const otherMovesCount = receivedState.board.filter(x => x != '').length;

if (otherMovesCount > myMovesCount) {
    // Accept remote state
} else if (otherMovesCount < myMovesCount) {
    // Send our state
} else {
    // Conflict resolution (e.g., force update flag)
}
```

## Common Utilities (spixi-tools.js)

- `SpixiTools.getTimestamp()` - Current Unix timestamp
- `SpixiTools.base64ToBytes(base64)` - Base64 decode to UTF-8
- `SpixiTools.escapeParameter(str)` - Escape HTML entities
- `executeUiCommand(cmd, ...args)` - Internal SDK communication (do not call directly)

## Key Examples

- **Authentication App**: `com.ixilabs.spixi.auth` - QR code scanning with `spixiAction()`
- **Multiplayer Game**: `com.ixilabs.spixi.tictactoe` - State sync, turn management
- **Production Real-time Game**: `com.baracuda.spixi.pong` - **Reference implementation for advanced networking** - authority switching, client prediction, velocity interpolation, robust connection handshake
- **Real-time Collab**: `com.ixilabs.spixi.whiteboard` - Batched data transmission
- **Protocol Extension**: `com.mostnonameuser.spixi.aiassistant` - Custom protocol handlers

## Network Optimization Patterns

### Batched Data Transmission

For real-time collaborative apps, batch frequent updates to reduce network overhead:

```javascript
// Whiteboard pattern - accumulate changes in buffer
dataBatch = "";
addPositionToBatch(data) {
    this.dataBatch += data + ";";
}

// Send buffer periodically (every 200ms)
setInterval(() => { 
    if (this.dataBatch !== "") {
        SpixiAppSdk.sendNetworkData(this.dataBatch);
        this.dataBatch = "";
    }
}, 200);
```

See `whiteboard.js` for full implementation.

### Unified State Packets

For real-time games, combine multiple state elements into single packets:

```javascript
// Pong pattern - unified game state at 60fps
function sendGameState() {
    const state = {
        a: "state",
        f: frameCounter,  // Frame number for sync
        p: paddleY        // Paddle position
    };
    
    // Include ball data if owner and active
    if (gameState.isBallOwner && ballActive) {
        state.b = {
            x: Math.round(ball.x),
            y: Math.round(ball.y),
            vx: ball.vx.toFixed(2),
            vy: ball.vy.toFixed(2)
        };
    }
    
    SpixiAppSdk.sendNetworkData(JSON.stringify(state));
}
```

**Benefits**:
- Reduces network packets by ~50%
- Better synchronization with frame counters
- Consistent update rate (60fps = 16ms intervals)
- Skip sending when nothing changed

### Smooth Interpolation

For fluid remote object movement, use interpolation instead of direct updates:

```javascript
// Store target position from network
let remotePaddleTarget = 0;

// In game loop - smooth interpolation
gameState.remotePaddle.y += (remotePaddleTarget - gameState.remotePaddle.y) * 0.4;

// On network receive - update target
SpixiAppSdk.onNetworkData = function(senderAddress, data) {
    const msg = JSON.parse(data);
    if (msg.p !== undefined) {
        remotePaddleTarget = msg.p;  // Don't set directly
    }
};
```

**Key Points**:
- Lerp factor 0.3-0.4 for smooth visuals
- Predictive positioning for ball movement
- Velocity threshold checks (>0.1) to detect stopped objects
- Snap to position when speed < 0.5 or distance > 200

See `pong.js` for complete implementation.

## Advanced Networking: Pong Reference Implementation

The `com.baracuda.spixi.pong` app demonstrates **production-quality real-time multiplayer networking** for Spixi Mini Apps. It implements Gabriel Gambetta's networking patterns adapted for peer-to-peer environments.

### Architecture Overview

**Game Loop Structure**:
- **Rendering**: 60 FPS (16.67ms frame time) - smooth visual updates
- **Network Updates**: 20 Hz (50ms intervals) - optimal balance between responsiveness and bandwidth
- **Physics Simulation**: Fixed timestep per frame (60 Hz)
- **Canvas**: 800x600 fixed size with responsive scaling on mobile

**Key Constants**:
```javascript
BALL_SPEED_INITIAL = 7          // Starting ball velocity (tuned for balanced gameplay)
BALL_SPEED_INCREMENT = 0.4      // Speed increase per paddle hit
PADDLE_SPEED = 8                // Paddle movement per frame
PADDLE_LERP_FACTOR = 0.25       // Remote paddle interpolation smoothness
BALL_LERP_FACTOR = 0.3          // Ball interpolation smoothness
MAX_LIVES = 3                   // Lives per player
```

### Critical Networking Patterns

#### 1. Bidirectional Connection Handshake

Both players continuously broadcast connection attempts until mutual acknowledgment:

```javascript
// Connection retry (500ms intervals)
connectionRetryInterval = setInterval(() => {
    if (!connectionEstablished) {
        const msg = { a: "connect", sid: sessionId, rand: myRandomNumber };
        SpixiAppSdk.sendNetworkData(JSON.stringify(msg));
    } else {
        clearInterval(connectionRetryInterval);
        connectionRetryInterval = null;
    }
}, 500);

// Always reply to incoming connection packets (fire-and-forget)
case "connect":
    if (msg.rand !== undefined) {
        remoteRandomNumber = msg.rand;
    }
    // Always send reply regardless of connection state
    SpixiAppSdk.sendNetworkData(JSON.stringify({ 
        a: "connect", sid: sessionId, rand: myRandomNumber 
    }));
    // Establish connection when both random numbers received
    if (!connectionEstablished && remoteRandomNumber !== null) {
        handleConnectionEstablished();
    }
    break;
```

**Why This Works**:
- Resilient to packet loss (continuous retry)
- Works regardless of which player opens app first
- Fire-and-forget reply ensures both players respond
- Connection established once both exchange random numbers
- Intervals cleared after handshake to save bandwidth

#### 2. Dynamic Authority Switching

Ball control transfers to whoever hit it last, eliminating lag for the active player:

```javascript
// Authority switches on paddle collision
function checkCollisions() {
    if (paddleCollision) {
        gameState.hasActiveBallAuthority = true;  // Take control
        gameState.ball.vx += BALL_SPEED_INCREMENT;
        
        // Send collision event with new velocity
        const msg = {
            a: "collision",
            x: Math.round(gameState.ball.x),
            y: Math.round(gameState.ball.y),
            vx: gameState.ball.vx.toFixed(2),
            vy: gameState.ball.vy.toFixed(2)
        };
        SpixiAppSdk.sendNetworkData(JSON.stringify(msg));
    }
}

// Ball simulation only runs on authoritative client
function gameLoop() {
    if (gameState.hasActiveBallAuthority) {
        simulateBall();  // Full physics
    } else {
        updateBallInterpolation();  // Predict from network data
    }
}
```

**Benefits**:
- Zero perceived lag for player hitting ball
- Non-authoritative player sees smooth interpolated motion
- Authority naturally alternates as ball bounces between paddles
- Eliminates "both players are server" conflicts

#### 3. Velocity-Based Frame Interpolation

Non-authoritative client achieves smooth 60 FPS motion from 20 Hz network updates:

```javascript
function updateBallInterpolation() {
    // Extrapolate position using last known velocity
    gameState.ball.x += gameState.ball.vx;
    gameState.ball.y += gameState.ball.vy;
    
    // Handle wall bounces locally for immediate response
    if (gameState.ball.y - BALL_SIZE/2 <= 0 || 
        gameState.ball.y + BALL_SIZE/2 >= canvas.height) {
        gameState.ball.vy *= -1;
    }
    
    // Gentle drift correction when difference > 5px
    const dx = ballTarget.x - gameState.ball.x;
    const dy = ballTarget.y - gameState.ball.y;
    const distance = Math.sqrt(dx*dx + dy*dy);
    
    if (distance > 5) {
        gameState.ball.x += dx * 0.1;  // 10% correction per frame
        gameState.ball.y += dy * 0.1;
    }
    
    // Snap velocity on significant change (bounce detection)
    const dvx = Math.abs(ballTarget.vx - gameState.ball.vx);
    const dvy = Math.abs(ballTarget.vy - gameState.ball.vy);
    
    if (dvx > 1.0 || dvy > 1.0) {
        gameState.ball.vx = ballTarget.vx;  // Instant velocity sync
        gameState.ball.vy = ballTarget.vy;
    }
}
```

**Why This Works**:
- Velocity extrapolation creates continuous motion between network updates
- Local wall bounces eliminate bounce lag perception
- Gentle position correction (10%/frame) fixes drift without visible snapping
- Velocity snap on >1.0 change detects paddle bounces and instantly syncs
- Achieves perceived 60 FPS from actual 20 Hz network data

#### 4. Client-Side Prediction with Reconciliation

Local paddle responds instantly while waiting for network confirmation:

```javascript
// Immediate local response to input
function handleInput() {
    if (keys.up) {
        localPaddle.y -= PADDLE_SPEED;
        inputSequence++;
        pendingInputs.push({ seq: inputSequence, dy: -PADDLE_SPEED });
    }
    // Send input with sequence number
    sendInput(inputSequence, keys);
}

// Server authoritative position in state update
case "state":
    if (msg.p !== undefined) {
        // Reconcile: reapply inputs newer than server state
        const serverPaddleY = msg.p;
        localPaddle.y = serverPaddleY;
        
        // Replay pending inputs after server frame
        for (let input of pendingInputs) {
            if (input.seq > msg.f) {  // Frame counter comparison
                localPaddle.y += input.dy;
            }
        }
        
        // Clear acknowledged inputs
        pendingInputs = pendingInputs.filter(i => i.seq > msg.f);
    }
    break;
```

**Key Points**:
- Input sequence numbers track local actions
- Server frame counter indicates last acknowledged input
- Client replays unacknowledged inputs after server position
- Prevents "rubber-banding" while maintaining server authority

#### 5. Delta State Updates

Only transmit changed data to minimize bandwidth:

```javascript
function sendGameState() {
    const state = { a: "state", f: frameCounter };
    
    // Always include paddle position
    const currentPaddleY = Math.round(gameState.localPaddle.y);
    if (currentPaddleY !== lastSentPaddleY) {
        state.p = currentPaddleY;
        lastSentPaddleY = currentPaddleY;
    }
    
    // Include ball only when authoritative AND ball changed
    if (gameState.hasActiveBallAuthority && ballActive) {
        const ballX = Math.round(gameState.ball.x);
        const ballY = Math.round(gameState.ball.y);
        
        if (Math.abs(ballX - lastSentBallX) > 2 || 
            Math.abs(ballY - lastSentBallY) > 2 ||
            gameState.ball.vx !== lastSentVx ||
            gameState.ball.vy !== lastSentVy) {
            
            state.b = {
                x: ballX,
                y: ballY,
                vx: gameState.ball.vx.toFixed(2),
                vy: gameState.ball.vy.toFixed(2)
            };
            
            lastSentBallX = ballX;
            lastSentBallY = ballY;
            lastSentVx = gameState.ball.vx;
            lastSentVy = gameState.ball.vy;
        }
    }
    
    SpixiAppSdk.sendNetworkData(JSON.stringify(state));
}
```

**Bandwidth Savings**:
- Paddle: ~15 bytes when moving, 0 when stationary
- Ball: ~30 bytes only when authoritative and changed >2px
- Integer velocity encoding saves ~20% vs decimal strings
- Total: ~400 bytes/sec vs ~12KB/sec for full state at 60 FPS
- **97% bandwidth reduction** vs naive full-state sync

#### 6. Bounce-Only Ball Synchronization

Ball position only synced on collisions, not mid-flight:

```javascript
// Only send ball state on significant events
function checkCollisions() {
    if (paddleCollision || wallCollision) {
        const msg = {
            a: "collision",
            x: Math.round(gameState.ball.x),
            y: Math.round(gameState.ball.y),
            vx: gameState.ball.vx.toFixed(2),
            vy: gameState.ball.vy.toFixed(2),
            t: SpixiTools.getTimestamp()
        };
        SpixiAppSdk.sendNetworkData(JSON.stringify(msg));
    }
}
```

**Why This Works**:
- Ball trajectory is deterministic between collisions
- Velocity extrapolation recreates flight path
- Only sync on direction changes (bounces)
- Reduces ball packets from 20/sec to ~2-4/sec average (collision events only)
- **80-90% ball network traffic reduction**

### Network Message Types

```javascript
SpixiAppSdk.onNetworkData = function(senderAddress, data) {
    const msg = JSON.parse(data);
    
    switch(msg.a) {
        case "connect":       // Connection handshake with random number
        case "ping":          // Keepalive (500ms intervals)
        case "input":         // Player input with sequence number
        case "state":         // Unified game state (10 Hz)
        case "collision":     // Ball bounce event with velocity
        case "score":         // Score update and life loss
        case "life":          // Life count sync
        case "endgame":       // Game over notification
        case "restart":       // New game request
    }
};
```

### Ball Launch Mechanics

Classic Pong behavior - ball launches from paddle position:

```javascript
function resetBallPosition() {
    // Position ball at paddle based on ownership
    if (gameState.isBallOwner) {
        gameState.ball.x = gameState.localPaddle.x + PADDLE_WIDTH + BALL_SIZE;
        gameState.ball.y = gameState.localPaddle.y;
    } else {
        gameState.ball.x = gameState.remotePaddle.x - BALL_SIZE;
        gameState.ball.y = gameState.remotePaddle.y;
    }
    gameState.ball.vx = 0;
    gameState.ball.vy = 0;
}

function launchBall() {
    gameState.hasActiveBallAuthority = true;  // Owner gets authority
    
    // Shoot toward opponent with random Y velocity
    gameState.ball.vx = -BALL_SPEED_INITIAL;  // Always negative for owner
    gameState.ball.vy = (Math.random() - 0.5) * BALL_SPEED_INITIAL * 0.6;
    
    // Notify opponent
    const msg = { a: "launch", vx: gameState.ball.vx, vy: gameState.ball.vy };
    SpixiAppSdk.sendNetworkData(JSON.stringify(msg));
}

// Ball follows paddle before launch
function gameLoop() {
    if (gameState.ball.vx === 0 && gameState.hasActiveBallAuthority) {
        resetBallPosition();  // Update ball to current paddle position
    }
}
```

### Mobile-First Responsive Design

Pong implements a mobile-first responsive layout:

```css
/* Mobile-first base styles */
.container {
    width: 100%;
    max-width: 100vw;  /* Full width on mobile */
}

.canvas-wrapper {
    padding: var(--spacing-md);  /* Compact spacing on mobile */
}

.header-buttons button {
    width: 44px;   /* WCAG minimum touch target */
    height: 44px;
}

.touch-control {
    height: 70px;  /* Larger on mobile for easier tapping */
}

/* Desktop enhancements (≥768px) */
@media (min-width: 768px) {
    .container {
        max-width: 950px;  /* Constrained width on desktop */
    }
    
    .canvas-wrapper {
        padding: var(--spacing-xl);  /* More generous spacing */
    }
    
    .header-buttons button {
        width: 36px;   /* Smaller on desktop (precision cursor) */
        height: 36px;
    }
    
    .touch-control {
        height: 90px;  /* Even larger on desktop */
    }
}
```

**Key Design Principles**:
- **Base = Mobile**: Default styles for <768px screens
- **44px Touch Targets**: WCAG 2.1 Level AAA compliance for mobile
- **Responsive Spacing**: Compact on mobile (lg/md), generous on desktop (xl/2xl)
- **Canvas Centering**: Flexbox with responsive padding
- **Header Layout**: Restart + Exit buttons absolutely positioned top-right
- **Score Container Padding**: Top padding on mobile prevents header overlap, removed on desktop
- **Status Badge**: Moves to top (order: -1) on mobile for better visibility
- **Touch Controls**: Larger on both mobile (70px) and desktop (90px) for easy tapping

**Critical Fix (v3.6.4)**: Added `padding-top: var(--spacing-xl)` to `.score-container` on mobile to prevent header buttons from overlapping score displays. Media query removes padding on desktop.

### Paddle Interpolation

Remote paddle uses lerp for smooth motion:

```javascript
// Store target from network
let remotePaddleTarget = 0;

// Smooth interpolation in game loop
gameState.remotePaddle.y += 
    (remotePaddleTarget - gameState.remotePaddle.y) * PADDLE_LERP_FACTOR;

// Update target from network
case "state":
    if (msg.p !== undefined) {
        remotePaddleTarget = msg.p;  // Don't snap directly
    }
    break;
```

**PADDLE_LERP_FACTOR = 0.25**:
- Lower = smoother but more lag
- Higher = more responsive but jittery
- 0.25 balances smooth visuals with <100ms perceived lag

### Score and Life Management

```javascript
// Score updates sent immediately
function updateScore(scorer) {
    if (scorer === "local") {
        gameState.localScore++;
        gameState.remoteLives--;
    } else {
        gameState.remoteScore++;
        gameState.localLives--;
    }
    
    const msg = {
        a: "score",
        scorer: scorer,
        localScore: gameState.localScore,
        remoteScore: gameState.remoteScore,
        localLives: gameState.localLives,
        remoteLives: gameState.remoteLives
    };
    SpixiAppSdk.sendNetworkData(JSON.stringify(msg));
    
    // Check game over
    if (gameState.localLives <= 0 || gameState.remoteLives <= 0) {
        endGame();
    } else {
        resetBall();
    }
}
```

### Persistent State Storage

Game state saved to Spixi storage for resumability:

```javascript
function saveGameState() {
    const state = {
        localScore: gameState.localScore,
        remoteScore: gameState.remoteScore,
        localLives: gameState.localLives,
        remoteLives: gameState.remoteLives,
        timestamp: SpixiTools.getTimestamp()
    };
    
    // Storage key = remote user's address
    SpixiAppSdk.setStorageData(remoteAddress, btoa(JSON.stringify(state)));
}

// Load on reconnection
SpixiAppSdk.onStorageData = function(key, value) {
    if (value) {
        const state = JSON.parse(atob(value));
        // Check if state is recent (< 1 hour)
        if (SpixiTools.getTimestamp() - state.timestamp < 3600) {
            restoreGameState(state);
        }
    }
};
```

### Lessons Learned

1. **Authority Switching Eliminates Lag**: The player hitting the ball has zero perceived lag because they have authority during their interaction.

2. **Velocity Extrapolation > Position Interpolation**: Extrapolating position from velocity creates smoother motion than lerping positions, especially with gentle drift correction.

3. **Fire-and-Forget Connection**: Both players continuously broadcasting AND immediately replying to connection packets creates bulletproof handshake resilient to packet loss and timing issues.

4. **Delta Updates Save 95% Bandwidth**: Only sending changed data reduces typical traffic from ~6KB/sec to ~300 bytes/sec.

5. **Bounce-Only Ball Sync**: Ball trajectory is deterministic, so only sync on direction changes (collisions), not every frame.

6. **20 Hz Network Updates Optimal**: With velocity extrapolation and interpolation, 20 Hz (50ms) network updates provide ultra-smooth 60 FPS gameplay with minimal lag.

7. **Integer Encoding Reduces Bandwidth**: Encoding velocities as integers (*100) instead of toFixed(2) strings reduces packet size by ~20% with no loss of precision.

8. **Client-Side Prediction Required**: Immediate local response with reconciliation prevents "mushy" input feel.

9. **Frame Counters Essential**: Sequence numbers on both input and state packets enable proper reconciliation and out-of-order detection.

10. **Local Wall Bounces**: Non-authoritative client handling wall bounces locally eliminates visible bounce lag.

11. **Gentle Drift Correction**: 10% position correction per frame fixes desync without visible snapping or rubber-banding.

12. **Mobile-First Scaling**: Design for mobile constraints first, then enhance for desktop - ensures excellent experience across all devices.

13. **Touch Target Sizing**: 44px minimum (WCAG 2.1) prevents mis-taps and improves mobile UX significantly.

14. **Responsive Spacing**: Different spacing scales for mobile vs desktop prevents UI overlap and maintains visual hierarchy.

15. **20 Hz Network Rate**: Doubling from 10 Hz to 20 Hz provides noticeably smoother gameplay with minimal bandwidth cost (~200 bytes/sec increase).

### Performance Metrics

- **Rendering**: Consistent 60 FPS (16.67ms frame time)
- **Network**: 20 Hz state updates (50ms intervals) - 2x improvement from v3.4.0
- **Bandwidth**: ~400-600 bytes/sec per player during gameplay (97% reduction vs full-state sync)
- **Perceived Lag**: <30ms for authoritative player, <60ms for non-authoritative
- **Connection Time**: <1 second typical, <3 seconds worst case
- **Packet Optimization**: Integer velocity encoding reduces packet size by ~20%
- **Mobile Performance**: Full 60 FPS on modern mobile devices with responsive scaling
- **Touch Responsiveness**: <16ms input latency with client-side prediction

### Implementation Checklist

When building similar real-time multiplayer games:

- ✅ Implement bidirectional connection retry (both players broadcast + reply)
- ✅ Use authority switching to eliminate active player lag
- ✅ Extrapolate positions from velocity between network updates
- ✅ Apply gentle drift correction (5-10% per frame) for desync
- ✅ Implement client-side prediction with reconciliation for local input
- ✅ Use frame counters for state packet ordering
- ✅ Send delta updates (only changed fields)
- ✅ Handle deterministic events (wall bounces) locally on both clients
- ✅ Lerp remote entities for smooth motion (0.25-0.4 factor)
- ✅ Separate rendering rate (60 FPS) from network rate (20 Hz)
- ✅ Use integer encoding for velocities to reduce packet size
- ✅ Implement keepalive pings to detect disconnections
- ✅ Save game state to storage for resumability

### Common Pitfalls to Avoid

- ❌ **Full State Sync at 60 FPS**: Wastes bandwidth, 20 Hz sufficient with interpolation
- ❌ **String-Based Numbers**: Use integers for compact encoding (velocity * 100)
- ❌ **Direct Position Updates**: Causes jitter, use lerp/extrapolation instead
- ❌ **Single Authority Model**: Creates lag for non-authoritative player, use dynamic authority
- ❌ **No Input Prediction**: Creates mushy feel, predict locally and reconcile
- ❌ **Ignoring Packet Order**: Can cause desyncs, use frame counters
- ❌ **Sending Unchanged Data**: Wastes bandwidth, use delta updates
- ❌ **One-Way Connection Handshake**: Unreliable, use bidirectional fire-and-forget
- ❌ **Hard Position Snaps**: Visible rubber-banding, use gradual correction
- ❌ **Syncing Deterministic Events**: Wall bounces predictable, handle locally

## Error Handling Pattern

SDK functions use `try/catch` internally. The `executeUiCommand()` wrapper in `spixi-tools.js` catches errors and displays alerts with stack traces during development. Production apps should override callbacks to handle edge cases gracefully.

## CLI Packer Tool

The repository includes `pack-app.js` - a Node.js CLI tool for automated packaging:

**Installation**: `npm install` (requires `jszip` dependency)

**Features**:
- Validates required files (`appinfo.spixi`, `app/index.html`, optional `icon.png`)
- Auto-generates SHA-256 checksum and adds to `.spixi` file
- Auto-fills `contentUrl` and `image` fields based on app name
- Outputs `.zip`, `.spixi`, and `.png` files
- Supports batch processing for CI/CD pipelines

**Output Location**: By default saves to app directory, or specify custom output directory as second argument.

## Testing Your App

1. **Local Testing**: Open `app/index.html` directly in browser - limited SDK functions will work
2. **Spixi Testing**: Load app in Spixi client for full SDK testing
3. **Multi-user Testing**: Use two Spixi instances to test network communication
4. **Storage Testing**: Use `mini-apps-test` app to verify storage operations sequence

## Repository Structure

```
mini-apps-sdk/     # Source of truth for SDK files - copy to each app
apps/              # Example Mini Apps - each is a standalone package
app-packer/        # Browser tool to generate .zip/.spixi/.png for deployment
packed/            # Sample packaged apps showing final output format
```

## What NOT to Do

- ❌ Don't modify `spixi-app-sdk.js` or `spixi-tools.js` - copy them unchanged
- ❌ Don't call `executeUiCommand()` directly - it's internal SDK machinery
- ❌ Don't store data without base64 encoding - Spixi expects it
- ❌ Don't forget `fireOnLoad()` - app won't initialize properly
- ❌ Don't use `&&` in terminal commands (Windows PowerShell) - use `;` instead
- ❌ Don't rely on external CDNs - bundle all dependencies for offline use
- ❌ Don't use Node.js or build tools - Mini Apps are pure client-side HTML/CSS/JS
