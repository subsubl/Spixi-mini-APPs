# Pong for Spixi

A real-time multiplayer Pong clone built for the Spixi platform, featuring robust networking, binary protocol communication, and time-based physics.

## Architecture

The application is built using a **Receiver-Authority** model for ball physics and **Client-Side Prediction** for paddle movement.

### Core Systems
1.  **Game Loop**: Runs at 60fps using `requestAnimationFrame`. Manages physics(`updateBall`), input (`updatePaddle`), and rendering.
2.  **Time-Based Physics**: All movement is calculated using `deltaTime` to ensure consistency across different frame rates.
3.  **Networking**: Custom implementation using `SpixiAppSdk`.

## Networking & Communication

The game uses a hybrid networking approach to balance responsiveness and bandwidth.

### Synchronization Stratgy
*   **Paddles**: Synchronized via dedicated lightweight packets (`MSG_PADDLE`) sent on position change (~30fps). Remote paddles are interpolated for smoothness.
*   **Ball**: Synchronized via:
    *   **Events**: Launch, Bounce, Collision (Highest Priority).
    *   **Heartbeat**: Periodic state updates (1fps) to drift correction.
    *   **Authority**: The player who last hit the ball (or is serving) calculates physics ("Owner"). The other player receives position updates ("Receiver").

### Latency Compensation
*   **Client-Side Prediction**: Local paddle moves instantly.
*   **Dead Reckoning**: Ball position is projected forward based on velocity and timestamps.
*   **Frame Counters**: Packets are validated against frame counters to reject out-of-order data.

## Binary Protocol Implementation

To optimize bandwidth, the game uses a custom **Binary Protocol** encoded in Base64.
All values are Little-Endian.

### Message Types
| ID | Name | Description |
|---|---|---|
| 1 | MSG_STATE | Unified game state (Frame, Ball, Paddle) |
| 2 | MSG_COLLISION | High-priority collision event |
| 3 | MSG_LAUNCH | Ball launch event |
| 14 | MSG_PADDLE | Dedicated paddle position update |

### Packet Structures

**MSG_PADDLE (5 bytes)**
*Dedicated packet for smooth paddle movement.*
```
[1 byte] Type (14)
[2 bytes] PaddleY (Uint16)
[2 bytes] Sequence (Uint16)
```

**MSG_STATE (17 bytes)**
*General heartbeat packet.*
```
[1 byte] Type (1)
[2 bytes] Frame Counter
[2 bytes] PaddleY
[2 bytes] Sequence
[2 bytes] LastAck
[2 bytes] Ball X
[2 bytes] Ball Y
[2 bytes] Ball VX (*100)
[2 bytes] Ball VY (*100)
```

**Ball Events (13 bytes)**
*Used for MSG_LAUNCH, MSG_COLLISION, MSG_BOUNCE.*
```
[1 byte] Type
[4 bytes] Timestamp (Uint32)
[2 bytes] Ball X
[2 bytes] Ball Y
[2 bytes] Ball VX (*100)
[2 bytes] Ball VY (*100)
```
