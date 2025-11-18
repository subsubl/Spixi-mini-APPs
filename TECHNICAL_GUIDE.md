# Technical Guide — Spixi Mini Apps Test Environment

This technical guide captures the core integration points, service boundaries, and developer workflows for the Spixi test harness.

## Big picture architecture
- Hub UI: `index.html` — browser-hosted UI with Developer Tools and a Spixi SDK browser mock. Primary UI for opening, testing, and packing mini apps.
- Node server: `server.js` — main server on port 8000 and a simple dev server on port 8081 for loading individual app pages.
- Packer CLI: `pack-app.js` — command-line packer that zips app contents and writes `.spixi` metadata with SHA256 checksum.
- CI & Tests: `.github/workflows/ci-smoke.yml` — smoke-test workflow; `tests/pack.test.js` and `scripts/smoke-test.js` provide local and CI validations.
- Go DevPack: `Go_Spixi_devPack/` — optional sandbox with a WebSocket `/ws` endpoint for advanced network simulation.

## Important endpoints
- `GET /` — serves `index.html` (Hub)
- `GET /api/mqtt/status` — returns MQTT broker status (used by Developer Tools)
- `POST /api/mqtt/*` — connect/subscribe/publish helpers for testing
- `POST /api/pack` — server endpoint to run `pack-app.js` for an app and return `{ success, baseName, zip, spixi }`

## Developer workflows (concise)
- Start hub & dev server
  - Windows PowerShell:
```powershell
npm install
npm start
```
- Open the hub: http://localhost:8000
- Dev server with a specific app: http://localhost:8081/?app=<appId>
- Pack an app from the CLI
```powershell
node pack-app.js ./apps/com.baracuda.spixi.pong ./packed
```
- Pack from the Hub UI
  - Click the `📦 Pack` button on any app card to invoke `POST /api/pack` and trigger downloading the generated ZIP.

## Tests & CI
- `scripts/smoke-test.js`: Node-based validation that the packer created a `.zip` with `app/index.html` and verified `.spixi` checksum.
- `tests/pack.test.js`: Mocha tests that run `pack-app.js` and `POST /api/pack`, then confirm file content and checksum.
- CI runs these steps automatically using `.github/workflows/ci-smoke.yml`.

## Conventions & tips for agents
- App structure: `apps/<appId>/app/index.html` and `appinfo.spixi` are required for packaging.
- Packer matches `appinfo.spixi`'s `name` to compute output filenames. Keep `name`, `version`, `id` consistent.
- Use `SpixiAppSdk` and `SpixiTools` rather than `location.href = 'ixian:...'` directly — this keeps apps compatible with the hub mock.
- For new features, prefer adding server endpoints (e.g., `/api/pack`) and client UI hooks, then add tests covering the endpoint and UI behavior.

---
If you want this guide expanded (e.g., developer workflow videos, detailed protocol examples, or tests for other apps) tell me what you'd like to see next.