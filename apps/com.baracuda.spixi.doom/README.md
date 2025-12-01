# DOOM Spixi Mini-App

A Spixi mini-app wrapper for the classic DOOM game running via WebAssembly.

## Features
- Full DOOM gameplay experience
- Runs entirely in WebAssembly
- Integrated with Spixi SDK
- Single-player mode (multiplayer planned)

## Controls
- Arrow Keys: Move
- Ctrl: Fire
- Space: Use/Open doors
- ESC: Menu
- Tab: Map

## Technical Details
- Uses Chocolate Doom WASM port
- Files: doom.wasm, doom.js, doom1.wad (shareware)
- Canvas rendering at 640x400

## Future Enhancements
- Multiplayer support via Spixi P2P messaging
- Save/load game states via SpixiTools.setStorage
- Touch controls for mobile
