# Spixi Pong

Spixi Pong is a high-performance, real-time multiplayer arcade game built for the Spixi messaging platform. It demonstrates advanced P2P networking concepts, including client-side prediction, entity interpolation, and hybrid binary/JSON protocols.

## Features

*   **Real-time Multiplayer**: 60fps local physics with predictive networking.
*   **P2P Architecture**: Direct peer-to-peer connection via Spixi SDK.
*   **Lobby Chat**: Encrypted, transient chat available pre- and post-game.
*   **Adaptive Networking**: Hybrid protocol switching between high-efficiency binary (gameplay) and flexible JSON (chat/status).
*   **Lag Compensation**: Retroactive collision detection and smooth interpolation for reliable play over cellular networks.

## Architecture

### Networking Strategy
Pong uses a **Receiver-Authoritative** model for ball physics to ensure fairness and responsiveness:
1.  **Ball Authority**: The player who last hit the ball (or is serving) "owns" the ball simulation. They send definitive updates to the remote peer.
2.  **Paddle Prediction**: Your local paddle moves instantly (zero latency). Remote paddle updates are interpolated to smooth out network jitter.
3.  **Hybrid Protocol**:
    *   **Binary (Type 14)**: High-frequency paddle updates (~30Hz). 5-byte packet for minimal overhead.
    *   **Binary (Type 1)**: Game state updates (ball position, velocity). Sent only on significant events (launch, bounce, collision).
    *   **JSON**: Used for low-frequency events like Chat, Handshakes, and Game Over.

### Synchronization Techniques
*   **Client-Side Prediction**: Local inputs are applied immediately.
*   **Entity Interpolation**: Remote entities (opponent paddle) are rendered slightly in the past, interpolating between the last two received network snapshots for silky-smooth movement.
*   **Frame Counters**: Every packet is tagged with a frame counter to detect out-of-order delivery and prevent "time travel" glitches.

## Protocol Specification

### Binary Protocol
Used for gameplay critical data to minimize bandwidth.

**Paddle Packet (Type 14)**
`[Type: 1 byte][PaddleY: 2 bytes][Seq: 2 bytes]`
*   Total: 5 bytes
*   Sent on every local paddle movement (throttled).

**State Packet (Type 1)**
`[Type: 1 byte][Frame: 4 bytes][PaddleY: 2 bytes][BallX: 2 bytes][BallY: 2 bytes][...velocity...]`
*   Includes full game state.
*   Sent on ball events (Collision, Launch).

### JSON Protocol
Used for structured, low-frequency data.

*   **Chat**: `{ "a": "chat", "text": "Hello!" }`
*   **Status**: `{ "a": "status", "state": "lobby" | "playing" }`
*   **Connection**: `{ "a": "connect", "sid": "...", "rand": 123 }`

## Development

### Prerequisites
*   Node.js (for packing script)
*   Spixi Desktop (for testing/deployment)

### Directory Structure
*   `app/`: Source code (HTML, JS, CSS).
*   `app/js/pong.js`: Core game logic and networking.
*   `appinfo.spixi`: App metadata.

### Building
To pack the application for Spixi:

```bash
node pack-app.js apps/com.baracuda.spixi.pong packed
```

This creates `packed/pong.spixi`, which can be dragged into Spixi Desktop to install.

## License
Copyright (C) 2025 Baracuda. MIT License.
