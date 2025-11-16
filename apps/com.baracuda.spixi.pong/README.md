# Pong - Spixi Mini App

![Version](https://img.shields.io/badge/version-1.2.0-blue.svg)
![Platform](https://img.shields.io/badge/platform-Spixi-green.svg)
![Players](https://img.shields.io/badge/players-2-orange.svg)

A classic Pong game reimagined as a real-time multiplayer Spixi Mini App. Challenge your friends to a fast-paced paddle battle with responsive controls and smooth gameplay.

## 🎮 Game Features

- **Real-time Multiplayer**: Play against another Spixi user with minimal latency
- **Lives System**: Each player starts with 3 lives - last one standing wins!
- **Responsive Controls**: Keyboard (Arrow keys/W-S) and touch controls
- **Optimized Network**: Minimal packet sizes for smooth gameplay even on slower connections
- **Mobile-First Design**: Responsive UI that works great on all devices
- **Session Persistence**: Game state is saved automatically

## 🎯 How to Play

### Starting the Game

1. Open the app in Spixi and invite another user
2. Wait for both players to connect (you'll see "Press START when ready!")
3. Both players click the **START** button
4. Watch the 3-second countdown (3... 2... 1...)
5. Host player clicks **SHOOT** to launch the ball
6. Use controls to move your paddle and prevent the ball from passing

### Controls

**Desktop:**
- Arrow Up / W - Move paddle up
- Arrow Down / S - Move paddle down

**Mobile:**
- Touch ▲ button - Move paddle up
- Touch ▼ button - Move paddle down

### Rules

- Each player has **3 lives**
- Lose a life when the ball passes your paddle
- First player to run out of lives loses
- Ball speed increases with each paddle hit for more excitement

### In-Game Actions

- **START** - Mark yourself as ready (both players must click)
- **SHOOT** - Launch the ball (host player only, after countdown)
- **Exit** - Close the app and return to Spixi
- **Play Again** - Restart the game after it ends (resets lives to 3)

## 🏗️ Technical Details

### Architecture

- **Host-Client Model**: Player with lower address is the host
- **Host Authority**: Ball physics calculated by host, synced to client
- **Peer-to-Peer**: Direct communication between players via Spixi network
- **Handshake Protocol**: Hello messages ensure both players are present before starting

### Network Optimization

The app uses highly optimized network packets:
- Single-character action codes (`a` field)
- Rounded coordinates to reduce float precision
- Minimal JSON structure
- ~16ms paddle update rate for real-time responsiveness

**Packet Examples:**
```javascript
Hello:       {"a":"h"}
Paddle Move: {"a":"m","y":250}
Game State:  {"a":"g","b":{"x":400,"y":300,"vx":"6.00","vy":"3.50"},"l":3,"r":2}
```

### Performance

- 60 FPS game loop
- ~60 FPS paddle position updates
- Automatic connection health monitoring via ping/pong
- Graceful handling of network delays

## 📱 Compatibility

- **Platform**: Spixi Messenger
- **SDK Version**: 0.3+
- **App Type**: multiUser (2 players required)
- **Capabilities**: Real-time P2P communication, local storage

## 🔧 Development

### File Structure

```
com.baracuda.spixi.pong/
├── appinfo.spixi          # App metadata
├── icon.png               # 512x512 app icon
├── README.md              # This file
└── app/
    ├── index.html         # Main HTML
    ├── css/
    │   └── styles.css     # All styling
    └── js/
        ├── pong.js        # Game logic
        ├── spixi-app-sdk.js
        └── spixi-tools.js
```

### Key Functions

- `initGame()` - Initialize canvas and controls
- `startGame()` - Begin game loop and enable controls
- `gameLoop()` - 60 FPS update cycle
- `updateBall()` - Host-only ball physics
- `checkCollisions()` - Paddle-ball collision detection
- `sendPaddlePosition()` - Real-time paddle sync
- `sendGameState()` - Ball state sync (host to client)

### Network Protocol

| Action Code | Description | Direction |
|------------|-------------|-----------|
| `h` | Hello handshake (1s interval) | Both |
| `p` | Ping keepalive | Both |
| `m` | Paddle move | Both |
| `ready` | Player ready for countdown | Both |
| `shoot` | Ball launched | Host → Client |
| `g` | Game state (ball + lives) | Host → Client |
| `e` | End game | Both |
| `r` | Restart request | Both |

## 📝 Version History

### v1.3.0 (Current)
- 🎯 Fixed ball stuck in center - now moves only after shoot
- 🔫 Added SHOOT button for host player to start the ball
- ⏱️ Added 3-second animated countdown before game starts
- 🤝 Improved hello handshake - pings every 1 second until connection
- 🚪 Fixed exit function (now uses `spixiAction("close")`)
- ✅ Both players must click START to begin countdown
- 🏓 More realistic pong gameplay flow

### v1.2.0
- ✨ Added hello handshake system for user presence detection
- 🚀 Optimized network packets (50%+ size reduction)
- 🔧 Fixed exit button (now uses SDK `back()` method)
- 📱 Prevented zoom on mobile WebView
- 🎨 Improved waiting screen UX
- 📚 Added comprehensive README

### v1.1.0
- ✨ Added lives system (3 lives per player)
- 🎮 Added Start Game and Exit buttons
- 🔄 Improved real-time paddle synchronization
- 🎨 Updated UI to show lives instead of score

### v1.0.0
- 🎉 Initial release
- 🎮 Basic Pong gameplay
- 👥 Two-player multiplayer
- 📊 Score-based system

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Report bugs
- Suggest new features
- Submit pull requests
- Improve documentation

## 📄 License

Copyright (C) 2025 Baracuda

This app is part of the Spixi Mini Apps ecosystem.

## 👤 Author

**Baracuda**

## 🔗 Links

- [Spixi Messenger](https://www.spixi.io)
- [Spixi Mini Apps SDK](https://github.com/ixian-platform/Spixi-Mini-Apps)
- [IXI Labs](https://www.ixian.io)

---

Enjoy the game! 🏓
