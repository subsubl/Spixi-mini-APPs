# Protocol: Eclipse 1.1.0 — native acceptance pending

Lightweight two-player Spixi mini app. Operative manipulates instruments; Dispatcher provides clues and overrides. HTML/CSS/Canvas 2D/JS only, no build-time dependencies in the app.

## Changes
- Fixed session host validates gameplay, timers and pressure, independently of gameplay-role swaps.
- Randomized frequency, wires, valve and glyph dictionary; shared victory/failure/restart.
- Periodic snapshots restore a reloaded guest; host page reload starts a new round (no persistent host recovery).
- Mobile layout, keyboard/pointer valve release, 44px buttons, background rendering suspension.
- Optional WebRTC audio; Spixi `sendNetworkData(data, recipientAddress)` carries signaling only.
- Explicit microphone opt-in, mute/disable, timeout and teardown; configurable S2 STUN URL.

## SDK contract
Bundled SDK unchanged. Call `fireOnLoad()` once at DOM ready; Spixi calls `onInit(sessionId, userAddress, ...remoteAddresses)`. Receive via `onNetworkData(senderAddress, data)`; teardown on `onAppEndSession`.
Official SDK 0.51 uses `ixian:onload` and base64-encoded `xa:` actions. Tests execute both bundled and official SDK implementations. Browser tests replace ONLY the native transport boundary, not gameplay state.

## Ixian S2 / voice
Sources inspected:
- https://docs.ixian.io/docs/architecture/trustless-client-discovery
- https://github.com/ixian-platform/Ixian-S2/blob/master/IxianS2/Meta/Node.cs (inspected revision 6b4dfe63aab34498cb9b293a5456ea84597bcacf)
- https://github.com/ixian-platform/Ixian-Core/blob/master/Network/STUN.cs

S2 starts an RFC5389 IPv4 UDP STUN server on port 3478. Enter an operator-confirmed reachable `stun:HOST:3478`. No default public endpoint is invented. STUN does not relay audio; some NATs require TURN, which this version does not configure. Native Spixi secure-context and microphone permissions must work for voice. Direct WebRTC exposes network addresses to the peer and STUN operator; voice is optional.

## Executed checks
- `tests/cooperative-win.cjs`: two browser contexts solve all three sectors using UI clues, shared victory, guest restart, five-failure game-over, retry, swaps, 390x844 layout and guest reload. PASS, zero JS errors. Transport simulated.
- `tests/voice.cjs`: real browser WebRTC with synthetic audio and local RFC5389 service; two binding requests, signaling, audio tracks, mute and teardown. PASS. NOT a public S2 or native Spixi test.
- `tests/sdk-contract.cjs`: actual official/bundled SDK load notification, ds recipient and xa encoding. PASS. NOT native integration.

Set PLAYWRIGHT_MODULE to your Playwright installation path if not installed locally. Run tests against a static server serving `app/` at localhost:8770. The voice fixture binds a temporary UDP port for the test only.

## Native release gate — BLOCKED / UNVERIFIED
This environment has no Spixi runtime, adb, emulator, or connected phones. No installed-Spixi failure has been observed: no such test was possible. Do not treat simulated results as native acceptance.

Required on TWO actual Spixi devices:
1. Install the generated .zspixiapp or scan HTTPS .spixi metadata. Confirm 1.1.0 on both.
2. Start a shared session with a contact; verify opposite roles and shared round.
3. Complete frequency/wires, timed valve override and glyph decoding using separate screens. Verify BOTH victory screens.
4. Retry, swap roles, disconnect/reconnect guest and verify convergence. End session and verify no active timers/microphone.
5. Configure an operator-confirmed S2 STUN endpoint; enable microphone on both; verify audible bidirectional voice, mute, permission denial and teardown. Repeat across different networks, not only same Wi-Fi.
6. Record OS, installed Spixi version, S2 hostname/version, observed behavior and logs excluding private addresses/credentials.

## Packaging
Official packer layout: `appinfo.spixi`, `icon.png`, `app/index.html`, `app/css/*`, `app/js/*`. Tests and this README are not in app/. External .spixi metadata includes absolute image/contentUrl plus archive SHA256 and size.
