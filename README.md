# <img src="assets/images/logo.png" alt="Baracuda Logo" width="60" align="top"> Baracuda Mini Apps Test Environment

Local testing environment for Spixi Mini Apps. Run the packed apps directly in your browser without needing the full Spixi client.
# Spixi Mini Apps — Test Environment

Local test harness for Spixi Mini Apps. This repository provides a lightweight browser-hosted environment
to open and debug mini apps without the full Spixi client. It includes a small Node.js server for serving
the hub and a browser-side Dev Server simulator for WebSocket/MQTT behaviour.

## Quick Start (Windows)

- Install Node.js (LTS) if you don't have it. On Windows you can use `winget`:

```powershell
winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
```

- From the repo root:

```powershell
cd C:\Users\User\Spixi-Test-Enviroment
npm install
npm start
```

- Open the main UI: `http://localhost:8000`
- Dev server (to load a specific app): `http://localhost:8081/?app=<appId>` (example: `?app=com.baracuda.spixi.pong`)

## Technical Guide & API
- See `TECHNICAL_GUIDE.md` for a compact technical guide and pointers to server APIs, the packer, and CI smoke tests.

## Common Commands

- Pack an app (creates packed output):

```powershell
node pack-app.js ./apps/com.baracuda.spixi.pong ./packed

Or pack from the hub UI: Open `http://localhost:8000`, find an app card, then click the `📦 Pack` button — this calls the `POST /api/pack` endpoint and triggers a download of the resulting ZIP from the browser.
```

- Run the server in foreground (shows logs):

```powershell
npm start
```

- View server logs (if started by helper script):

```powershell
Get-Content 'C:\Users\User\Spixi-Test-Enviroment\server_temp.log' -Wait -Tail 200
```

## Developer Tools

- The hub (`index.html`) contains a Developer Tools section with controls to start the in-browser Dev Server
  (simulated WebSocket/MQTT) and to configure ports used by the simulator.
- Use the **Start** button in the Developer Tools section to enable the browser-side simulator.

## Apps

Apps are located under `apps/` — each app follows the structure `apps/<appId>/app/` with its `index.html`.

Example app IDs in this repo:

- `com.baracuda.spixi.pong`
- `com.ixilabs.spixi.tictactoe`

Open an app directly in the hub or use the dev server URL shown above.

## Notes

- This environment simulates some SDK features; full functionality (multiplayer networking, native
  device access) requires the real Spixi client and live infrastructure.
- The Node.js server is intentionally small — feel free to modify `server.js` to add features or
  change routes.

## Contributing

If you'd like changes or improvements, open a PR or issue.

---
Created for local testing of Spixi Mini Apps SDK
- **Mobile Browsers**: Full support (touch controls work)
