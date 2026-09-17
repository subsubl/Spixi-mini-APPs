# Protocol: Eclipse 1.2.0 — experimental packet voice

Dependency-free two-player asymmetric co-op for Spixi. The operative manipulates instruments; the dispatcher provides clues and overrides. Fixed session host validates gameplay; randomized puzzles, shared victory/failure/restart, mobile controls and guest resynchronization are retained from 1.1.

## Voice now carries AUDIO in Spixi messages
This replaces 1.1's WebRTC signaling-only implementation. No RTCPeerConnection, STUN, TURN, external media endpoint or codec library. Native Spixi and real Ixian transport acceptance is still pending.

- AudioWorklet captures mono microphone samples, box-averaged to 8000 Hz (basic narrowband quality, not a production-grade resampler).
- PCM16LE, 800 samples / 100 ms. Binary header: `EV`, version byte 1, reserved byte 0, uint32 LE sequence; total 1608 bytes.
- Base64 frame: 2144 characters. Payload: `{v:2,kind:'audio',call,to,frame}` inside the game's `type:'voice'` envelope.
- `SpixiAppSdk.sendNetworkData(JSON.stringify(envelope), recipient)` carries audio; `onNetworkData(sender,data)` routes it to playback.
- Both peers explicitly enable microphone/playback and exchange call IDs via `ready`. No audio sent before peer consent. Both need 1.2; incompatible with 1.1 voice.
- Bounded jitter buffer: initial 150 ms target, max eight pending frames, duplicate/late rejection and silence recovery. Missing frames become silence; no retransmission. Game envelope sequencing can discard reordered messages before the jitter buffer.
- 10 frames/sec normally; roughly 21.4 KB/sec per speaker BEFORE JSON, SDK encoding, encryption and relay overhead. Actual network latency and capacity are not measured. No transport backpressure API; bursts locally limited, but native queue behavior is unverified.
- Mute disables capture tracks/sending. Disable, page hide, hidden document, session end, peer timeout or suspended audio context stops microphone and playback. Headphones recommended.
- Requires secure-context microphone access and AudioWorklet. Spixi's file-based WebView support is UNVERIFIED. Unsupported hosts show an explicit unavailable message; gameplay remains usable.

## Executed tests
Serve `app/` on localhost:8770. Set `PLAYWRIGHT_MODULE` to an external Playwright installation if necessary.

```
node tests/voice-packets.cjs
node tests/voice.cjs
node tests/cooperative-win.cjs
node tests/sdk-contract.cjs
```

- Codec/fake-clock test: PASS conversion, frame bounds, reordering, duplicates, idle recovery. Fake-clock delay is NOT real network latency.
- Browser voice: PASS real AudioWorklet and Web Audio capture/playback with synthetic Chromium microphone input. Both peers decode nonzero audio frames. WebRTC constructor is forbidden by test. Consent, mute/resume, re-enable, peer teardown and total transport-loss timeout pass; zero page errors. Transport is a LOCAL SDK relay, NOT real Ixian.
- Gameplay: PASS both peers solve all three sectors through UI clues and reach victory; shared failure/retry, role swaps, mobile controls and guest reload. SDK transport simulated.
- SDK contract: actual bundled and official SDK load/directed ds/xa encoding checks passed; not native integration.

No agent review has run for 1.2. Implementation and tests performed directly.

## Native acceptance — pending
1. Install the branch's `dist/install-test.spixi` on TWO actual Spixi devices and confirm 1.2.0 on both.
2. Play all sectors to shared victory, retry, swap and reconnect.
3. Enable packet voice on both: confirm audible two-way speech, permission denial, mute/resume, timeout, app-background and session-end microphone teardown.
4. Repeat across different networks. Record Spixi/WebView/OS versions, latency, sustained throughput and gameplay responsiveness. Do not record wallet secrets or private conversations.
5. Real QuIXI transport testing may validate Ixian AppData delivery, but cannot validate Spixi WebView microphone/AudioWorklet permissions.

## Packaging
Archive preserves root `appinfo.spixi`, `icon.png`, and `app/` (including capture worklet). `dist/install-test.spixi` points at this experimental branch, not production. Tests/docs/dist are excluded from the archive. SHA256 and byte size describe the actual archive. A valid layout/checksum is not proof of successful native installation.
