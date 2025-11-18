# GitHub Copilot Instructions — Spixi Mini Apps Test Environment

This file provides focused, repository-specific guidance for AI coding agents working on the Spixi test harness and mini apps.

## Big picture
- Purpose: small, browser-hosted test environment for Spixi Mini Apps. Use it to iterate UI and SDK integration without the full Spixi client.
- Key components:
  - `index.html` — The hub UI + in-browser Spixi SDK mocks and Developer Tools
  - `server.js` — Node.js server that hosts the main hub (port 8000) and an app dev server (port 8081); exposes `/api/mqtt/*` for a simulated broker
  - `pack-app.js` + `package.json` — packer CLI used for creating `.zip`/`.spixi` packages for apps
  - `apps/` — each app is a folder `apps/<appId>/app` (deployable content) and `appinfo.spixi` metadata
  - `Go_Spixi_devPack/` — optional Go devpack with WebSocket `/ws` endpoint for deeper dev server tests

## Developer workflows (must-know commands)
- Start the Node servers (root repository):
  - Windows (PowerShell):
    ```powershell
    npm install
    npm start
    ```
  - Hub UI: http://localhost:8000 — Developer Tools in the hub let you toggle the simulated dev server and MQTT interactions.
  - Dev server to load a specific app: http://localhost:8081/?app=<appId> (example: `?app=com.baracuda.spixi.pong`)

- Run the Go devpack (optional dev server + WebSocket bridge):
  - From `Go_Spixi_devPack/cmd/quixi` run `go run .` which uses `internal/config/config.json` to pick WebSocket and HTTP ports.
  - WebSocket endpoint (default similar to): `ws://localhost:8888/ws` — apps use `SpixiAppSdk.sendNetworkProtocolData` to push to this stream in dev.

- Pack/publish an app:
  - Create `appinfo.spixi` and `app/index.html` under `apps/<appId>/`.
  - From repo root or any path with Node: `node pack-app.js ./apps/com.baracuda.spixi.pong ./packed`
  - Output: `<name>.zip`, `<name>.spixi`, and optionally `<name>.png` (pack-app auto-computes SHA256 checksum and content size)

## Project-specific conventions and patterns (for agents)
- App structure: `apps/<appId>/app/index.html` is required; `appinfo.spixi` key-value pairs are parsed by `pack-app.js`.
  - Required fields: `id`, `name`, `version` (pack-app also recognizes `image`, `contentUrl`, `minUsers`, `maxUsers`, `protocols` etc.)
  - `pack-app.js` only includes files under `app/`, `appinfo.spixi`, and `icon.png` into the ZIP.
- SDK usage patterns:
  - Use `SpixiAppSdk` and `SpixiTools` — they abstract the platform via location.href or mocks in `index.html`.
  - Important handlers that apps override: `SpixiAppSdk.onInit`, `onNetworkData`, `onNetworkProtocolData`, `onStorageData`.
  - For broadcasting/receiving cross-app network protocol data, apps call `SpixiAppSdk.sendNetworkProtocolData(protocolId, data)`; the dev environment uses a WebSocket `/ws` and a mock in the hub to simulate messages.
- Dev mode & mocks: `index.html` contains a browser mock for the Spixi SDK — do not call platform-specific code from tests; rely on `SpixiAppSdk` so dev is consistent.

## Integration points
- Node MQTT: `server.js` includes `MqttBrokerManager` and exposes the REST API endpoints: `/api/mqtt/status`, `/api/mqtt/connect`, `/api/mqtt/disconnect`, `/api/mqtt/subscribe`, `/api/mqtt/unsubscribe`, `/api/mqtt/publish`.
  - Use these to test MQTT behavior from the hub, or call them when simulating broker interactions.
  - Pack apps from the hub: There's a new `POST /api/pack` endpoint to run `pack-app.js` on the server. The hub UI (`index.html`) includes a `Pack` button in app cards that calls this endpoint and triggers a download of the resulting zip. Use this endpoint to automate packing as part of local test flows.
- WebSocket: `Go_Spixi_devPack/internal/network/ws_broker.go` provides `/ws` for the Go devpack; web SDK tries `ws://localhost:8888/ws` by default.

## Files to inspect when troubleshooting
- `server.js` — app & dev server routing, ports, MQTT API implementation
- `pack-app.js` — packaging, checksum, and output conventions
- `pack-app.js` — packaging, checksum, and output conventions
- `POST /api/pack` — server API that invokes the packer and returns `{ success, baseName, zip, spixi }` where `zip` and `spixi` are paths relative to the repo root (use to trigger downloads)
- `mini-apps-sdk/spixi-app-sdk.js` and `mini-apps-sdk/spixi-tools.js` — canonical SDK surface used by all apps
- `apps/<appId>/app/js` — app logic; look for SDK calls and handler overrides
- `Go_Spixi_devPack/**` — optional server implementation if you need advanced simulation

## Common tasks for agents and examples
- Adding or updating a sample app:
  - Add `apps/<id>/app/index.html` + `appinfo.spixi`; use `spixi-app-sdk.js`; run dev URLs for testing.
- Debugging SDK interactions:
  - Start `npm start`, open the hub, enable Developer Tools, check Console and network logs.
  - For WebSocket/MQTT debugging, use the Go devpack `go run .` and view logs in the terminal.
- Create new packaging or modify packer behavior:
  - Edit `pack-app.js` to add or change included file patterns; tests: run pack then open the hub or extract from `packed/`.

## Agent behavior & conservative rules
- Prefer using `SpixiAppSdk` and `SpixiTools` APIs to keep code compatible with both the browser mock and the real Spixi client.
- Avoid calling `location.href = "ixian:..."` directly in code; rely on `SpixiAppSdk.*` wrapper.
- When modifying `pack-app.js`, keep `appinfo.spixi` parsing backward-compatible (case/spacing tolerant). The current parser accepts `key = value` lines.
- Keep the hub and dev servers backward-compatible: `server.js` is intentionally minimal and may be used in CI; do not introduce heavy runtime dependencies.

---
If you'd like, I can:
- Add a short CI example or GitHub Actions workflow to start the dev server and smoke-test a sample app.
- Run quick validations to ensure `pack-app.js` behavior is preserved when edited.

## CI / Smoke tests 🧪
- A minimal GitHub Actions workflow is included at `.github/workflows/ci-smoke.yml`.
  - Actions run on push / pull request and perform these steps:
    1. `npm ci` to install dependencies.
    2. Start `server.js` (the hub) in the background.
    3. Wait for the server via `npx wait-on http://localhost:8000`.
    4. Verifies hub main page exists and `/api/mqtt/status` is reachable.
    5. Calls `node pack-app.js ./apps/com.baracuda.spixi.pong ./tests-outputs` to verify `pack-app.js` can create a package.
    6. Ensures `./tests-outputs/pong.zip` and `./tests-outputs/pong.spixi` exist.
    7. Runs `npm test` (Mocha) to validate the ZIP contents and `.spixi` checksum.

Tip: Run the smoke test locally with PowerShell:
```powershell
npm ci
# Start server in background
npm start &
# Wait for server
npx wait-on http://localhost:8000
# Pack a sample app
node pack-app.js ./apps/com.baracuda.spixi.pong ./tests-outputs
Get-ChildItem .\tests-outputs
# Run the Node smoke-test
npm run smoke-test -- ./apps/com.baracuda.spixi.pong ./tests-outputs
Get-ChildItem .\tests-outputs
# Run unit tests
npm test
```

Please tell me if any section is unclear or needs more detail (e.g., precise WebSocket/MQTT configuration examples or unit-test guidance).