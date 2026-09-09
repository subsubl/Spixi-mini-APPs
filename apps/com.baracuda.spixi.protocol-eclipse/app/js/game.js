/**
 * Protocol: Eclipse - Asymmetric Co-Op Game Core
 * Powered by Spixi Mini Apps SDK & Web Audio API
 */

(function () {
    'use strict';

    // Game Global State
    const state = {
        role: 'operative', // 'operative' | 'dispatcher'
        sessionId: 'sess_default',
        myAddress: 'user_local',
        peerAddress: null,
        p2pConnected: false,
        currentLoop: 1, // 1, 2, 3, or 4 (Victory)
        startTime: Date.now(),
        messageCount: 0,
        
        // Loop 1 State (Frequency & Wires)
        loop1: {
            targetFreq: 432,
            targetWireOrder: ['GREEN', 'RED', 'BLUE'],
            opFreq: 250,
            opWireSeq: [],
            completed: false
        },

        // Loop 2 State (Pressure Venting)
        loop2: {
            targetValve: 'B',
            targetMinPsi: 70,
            targetMaxPsi: 80,
            currentPsi: 0,
            opHeldValve: null, // 'A', 'B', 'C', or null
            completed: false
        },

        // Loop 3 State (Biometric Cipher Keypad)
        loop3: {
            glyphs: ['Alpha', 'Delta', 'Sigma', '7'],
            targetCode: '8419',
            opInputCode: '',
            tokenAuthorized: false,
            completed: false
        }
    };

    // Web Audio Synthesizer
    let audioCtx = null;

    function initAudio() {
        if (!audioCtx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) audioCtx = new AudioContext();
        }
    }

    function playBeep(freq = 440, type = 'sine', duration = 0.1) {
        if (!audioCtx) return;
        try {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
            gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + duration);
        } catch (e) {}
    }

    function playValveHiss() {
        if (!audioCtx) return;
        try {
            const bufferSize = audioCtx.sampleRate * 0.4;
            const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
            const output = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                output[i] = Math.random() * 2 - 1;
            }
            const whiteNoise = audioCtx.createBufferSource();
            whiteNoise.buffer = buffer;
            const filter = audioCtx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = 1000;
            whiteNoise.connect(filter);
            filter.connect(audioCtx.destination);
            whiteNoise.start();
        } catch (e) {}
    }

    // =========================================================================
    // SPIXI P2P NETWORK INTEGRATION
    // =========================================================================

    function sendP2P(type, payload = {}) {
        state.messageCount++;
        const msgObj = { type, payload, sender: state.myAddress, timestamp: Date.now() };
        logDispatcherEvent(`[OUT] ${type}: ${JSON.stringify(payload)}`);
        
        if (window.SpixiAppSdk && typeof window.SpixiAppSdk.sendNetworkData === 'function') {
            window.SpixiAppSdk.sendNetworkData(JSON.stringify(msgObj));
        }
    }

    window.SpixiAppSdk.onInit = function (sessionId, userAddress, ...remoteAddresses) {
        state.sessionId = sessionId;
        state.myAddress = userAddress;
        state.peerAddress = remoteAddresses[0] || null;
        state.p2pConnected = true;

        updateP2PStatus(true, `Connected to ${state.peerAddress ? state.peerAddress.substring(0, 8) + '...' : 'Peer'}`);

        // Auto-assign role based on lexicographical order
        if (state.peerAddress && userAddress > state.peerAddress) {
            setRole('dispatcher');
        } else {
            setRole('operative');
        }

        // Fire OnLoad
        window.SpixiAppSdk.fireOnLoad();
    };

    window.SpixiAppSdk.onNetworkData = function (senderAddress, dataStr) {
        state.p2pConnected = true;
        updateP2PStatus(true, 'P2P Active');
        
        try {
            const msg = JSON.parse(dataStr);
            logDispatcherEvent(`[IN] ${msg.type}: ${JSON.stringify(msg.payload || {})}`);
            handleIncomingP2P(msg);
        } catch (e) {
            console.error('Failed to parse P2P message:', e);
        }
    };

    function handleIncomingP2P(msg) {
        const p = msg.payload || {};
        switch (msg.type) {
            case 'ROLE_SWAP':
                setRole(p.newRole);
                break;
            case 'OP_STATE_UPDATE':
                if (p.opFreq !== undefined) state.loop1.opFreq = p.opFreq;
                if (p.opWireSeq) state.loop1.opWireSeq = p.opWireSeq;
                if (p.currentPsi !== undefined) state.loop2.currentPsi = p.currentPsi;
                if (p.opHeldValve !== undefined) state.loop2.opHeldValve = p.opHeldValve;
                if (p.opInputCode !== undefined) state.loop3.opInputCode = p.opInputCode;
                updateDispatcherUI();
                break;
            case 'ACTION_PULSE':
                playBeep(600, 'sine', 0.2);
                checkLoop1Completion();
                break;
            case 'ACTION_VENT':
                playValveHiss();
                checkLoop2Completion();
                break;
            case 'ACTION_AUTH':
                state.loop3.tokenAuthorized = true;
                playBeep(880, 'square', 0.2);
                updateDispatcherUI();
                break;
            case 'RESTART_GAME':
                resetGame(false);
                break;
        }
    }

    // =========================================================================
    // ROLE & UI MANAGEMENT
    // =========================================================================

    function setRole(newRole) {
        state.role = newRole;
        const badge = document.getElementById('role-badge');
        badge.textContent = newRole.toUpperCase();
        badge.className = `badge badge-${newRole}`;

        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        if (newRole === 'operative') {
            document.getElementById('operative-viewport').classList.add('active');
        } else {
            document.getElementById('dispatcher-viewport').classList.add('active');
        }
    }

    function updateP2PStatus(connected, text) {
        const dot = document.querySelector('.status-dot');
        const textEl = document.getElementById('status-text');
        if (dot) dot.className = `status-dot ${connected ? 'connected' : ''}`;
        if (textEl) textEl.textContent = text;
    }

    function logDispatcherEvent(msg) {
        const stream = document.getElementById('disp-log-stream');
        if (!stream) return;
        const time = new Date().toLocaleTimeString();
        const div = document.createElement('div');
        div.textContent = `[${time}] ${msg}`;
        stream.appendChild(div);
        stream.scrollTop = stream.scrollHeight;
    }

    // =========================================================================
    // PUZZLE LOGIC & SIMULATION LOOPS
    // =========================================================================

    function checkLoop1Completion() {
        if (state.currentLoop !== 1) return;
        const freqMatch = Math.abs(state.loop1.opFreq - state.loop1.targetFreq) <= 10;
        const wiresMatch = JSON.stringify(state.loop1.opWireSeq) === JSON.stringify(state.loop1.targetWireOrder);

        if (freqMatch && wiresMatch) {
            state.loop1.completed = true;
            state.currentLoop = 2;
            playBeep(800, 'triangle', 0.4);
            logDispatcherEvent('⚡ LOOP 1 CLEARED! Moving to Loop 2...');
            updatePanelsForCurrentLoop();
        } else {
            playBeep(200, 'sawtooth', 0.3);
            logDispatcherEvent(`❌ Loop 1 Pulse Failed: Freq (${state.loop1.opFreq}/${state.loop1.targetFreq}), Wires Match: ${wiresMatch}`);
        }
    }

    function checkLoop2Completion() {
        if (state.currentLoop !== 2) return;
        const valveMatch = state.loop2.opHeldValve === state.loop2.targetValve;
        const psiMatch = state.loop2.currentPsi >= state.loop2.targetMinPsi && state.loop2.currentPsi <= state.loop2.targetMaxPsi;

        if (valveMatch && psiMatch) {
            state.loop2.completed = true;
            state.currentLoop = 3;
            playBeep(900, 'triangle', 0.4);
            logDispatcherEvent('💨 LOOP 2 CLEARED! Airlock Vented!');
            updatePanelsForCurrentLoop();
        } else {
            playBeep(180, 'sawtooth', 0.3);
            logDispatcherEvent(`❌ Loop 2 Vent Failed: Held Valve (${state.loop2.opHeldValve}), PSI (${state.loop2.currentPsi})`);
        }
    }

    function checkLoop3Completion() {
        if (state.currentLoop !== 3) return;
        if (state.loop3.opInputCode === state.loop3.targetCode && state.loop3.tokenAuthorized) {
            state.loop3.completed = true;
            state.currentLoop = 4;
            triggerVictory();
        } else {
            playBeep(150, 'sawtooth', 0.3);
            logDispatcherEvent('❌ Keypad Access Denied!');
        }
    }

    function updatePanelsForCurrentLoop() {
        // Operative panels
        document.querySelectorAll('.puzzle-panel').forEach(p => p.classList.remove('active'));
        const opPanel = document.getElementById(`op-loop${Math.min(state.currentLoop, 3)}-panel`);
        if (opPanel) opPanel.classList.add('active');

        // Objectives
        const taskObj = {
            1: 'CURRENT OBJECTIVE: ALIGN FREQUENCY & PATCH WIRES',
            2: 'CURRENT OBJECTIVE: HOLD VENT VALVE B AT 75 PSI',
            3: 'CURRENT OBJECTIVE: ENTER BIOMETRIC CIPHER CODE',
            4: 'OBJECTIVE COMPLETE: FACILITY ESCAPED!'
        };
        const ind = document.getElementById('op-task-indicator');
        if (ind) ind.textContent = taskObj[state.currentLoop] || '';

        // Dispatcher Tabs
        if (state.role === 'dispatcher') {
            document.querySelectorAll('.term-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            const targetTabId = state.currentLoop === 1 ? 'tab-freq' : (state.currentLoop === 2 ? 'tab-pressure' : 'tab-cipher');
            const tabBtn = document.querySelector(`.term-tab[data-tab="${targetTabId}"]`);
            const tabContent = document.getElementById(targetTabId);
            if (tabBtn) tabBtn.classList.add('active');
            if (tabContent) tabContent.classList.add('active');
        }
    }

    function triggerVictory() {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById('victory-screen').classList.add('active');

        const totalSecs = Math.floor((Date.now() - state.startTime) / 1000);
        const mins = String(Math.floor(totalSecs / 60)).padStart(2, '0');
        const secs = String(totalSecs % 60).padStart(2, '0');
        
        document.getElementById('vic-time').textContent = `${mins}:${secs}`;
        document.getElementById('vic-msgs').textContent = state.messageCount;

        playBeep(523, 'sine', 0.2);
        setTimeout(() => playBeep(659, 'sine', 0.2), 200);
        setTimeout(() => playBeep(783, 'sine', 0.4), 400);
    }

    function resetGame(notifyPeer = true) {
        state.currentLoop = 1;
        state.startTime = Date.now();
        state.loop1.opFreq = 250;
        state.loop1.opWireSeq = [];
        state.loop1.completed = false;
        state.loop2.currentPsi = 0;
        state.loop2.opHeldValve = null;
        state.loop2.completed = false;
        state.loop3.opInputCode = '';
        state.loop3.tokenAuthorized = false;
        state.loop3.completed = false;

        document.getElementById('op-freq-slider').value = 250;
        document.getElementById('op-freq-val').textContent = '250 Hz';
        document.getElementById('op-wire-status').textContent = 'Sequence: Empty';
        document.getElementById('op-keypad-code').value = '';

        if (notifyPeer) sendP2P('RESTART_GAME');
        setRole(state.role);
        updatePanelsForCurrentLoop();
    }

    // =========================================================================
    // 3D CANVAS RENDERING SYSTEM (OPERATIVE FIRST PERSON)
    // =========================================================================

    let canvas, ctx;

    function init3DCanvas() {
        canvas = document.getElementById('op-canvas');
        if (!canvas) return;
        ctx = canvas.getContext('2d');

        function resize() {
            canvas.width = canvas.clientWidth;
            canvas.height = canvas.clientHeight;
        }
        window.addEventListener('resize', resize);
        resize();

        requestAnimationFrame(renderLoop);
    }

    let time = 0;
    function renderLoop() {
        time += 0.03;
        if (ctx && canvas) {
            const w = canvas.width;
            const h = canvas.height;

            // Background Sci-Fi Corridor 3D Perspective Grid
            ctx.fillStyle = '#03060a';
            ctx.fillRect(0, 0, w, h);

            // Draw Perspective Vanishing Point Lines
            const cx = w / 2;
            const cy = h / 2 - 30;

            ctx.strokeStyle = '#0e1d33';
            ctx.lineWidth = 1.5;

            // Corridor walls
            ctx.beginPath();
            ctx.moveTo(0, 0); ctx.lineTo(cx, cy);
            ctx.moveTo(w, 0); ctx.lineTo(cx, cy);
            ctx.moveTo(0, h); ctx.lineTo(cx, cy);
            ctx.moveTo(w, h); ctx.lineTo(cx, cy);
            ctx.stroke();

            // Animated Corridor floor grid
            ctx.strokeStyle = 'rgba(0, 136, 255, 0.15)';
            for (let i = 1; i <= 6; i++) {
                const z = (i + (time % 1)) / 6;
                const gy = cy + (h - cy) * z;
                ctx.beginPath();
                ctx.moveTo(cx * (1 - z), gy);
                ctx.lineTo(w - (w - cx) * (1 - z), gy);
                ctx.stroke();
            }

            // Draw Active Loop 3D Apparatus Frame
            if (state.currentLoop === 1) {
                drawLoop1Oscilloscope(cx, cy, w, h);
            } else if (state.currentLoop === 2) {
                drawLoop2AirlockGauge(cx, cy, w, h);
            } else if (state.currentLoop === 3) {
                drawLoop3VaultDoor(cx, cy, w, h);
            }
        }
        requestAnimationFrame(renderLoop);
    }

    function drawLoop1Oscilloscope(cx, cy, w, h) {
        // Render 3D Oscilloscope Frame
        const boxW = 320;
        const boxH = 180;
        const bx = cx - boxW / 2;
        const by = cy - boxH / 2 + 20;

        ctx.fillStyle = '#081220';
        ctx.strokeStyle = '#0088ff';
        ctx.lineWidth = 2;
        ctx.fillRect(bx, by, boxW, boxH);
        ctx.strokeRect(bx, by, boxW, boxH);

        // Oscilloscope Screen Waveform
        ctx.fillStyle = '#020912';
        ctx.fillRect(bx + 15, by + 15, boxW - 30, boxH - 30);

        ctx.strokeStyle = '#00e676';
        ctx.lineWidth = 2;
        ctx.beginPath();

        const freqFactor = state.loop1.opFreq / 50;
        for (let x = 0; x < boxW - 30; x++) {
            const y = (by + boxH / 2) + Math.sin(x * 0.05 * freqFactor + time * 5) * 35;
            if (x === 0) ctx.moveTo(bx + 15 + x, y);
            else ctx.lineTo(bx + 15 + x, y);
        }
        ctx.stroke();
    }

    function drawLoop2AirlockGauge(cx, cy, w, h) {
        // Chamber Pressure Rise Simulation
        if (state.currentLoop === 2 && state.loop2.currentPsi < 100) {
            state.loop2.currentPsi = Math.min(100, state.loop2.currentPsi + 0.15);
            document.getElementById('gauge-fill').style.width = `${state.loop2.currentPsi}%`;
            document.getElementById('gauge-val').textContent = `${Math.floor(state.loop2.currentPsi)} PSI`;
            updateDispatcherUI();
        }

        // Draw 3D Chamber Valve Wheel
        ctx.save();
        ctx.translate(cx, cy + 20);
        ctx.strokeStyle = state.loop2.opHeldValve ? '#00e676' : '#ff9100';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(0, 0, 70, 0, Math.PI * 2);
        ctx.stroke();

        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-70, 0); ctx.lineTo(70, 0);
        ctx.moveTo(0, -70); ctx.lineTo(0, 70);
        ctx.stroke();
        ctx.restore();
    }

    function drawLoop3VaultDoor(cx, cy, w, h) {
        // Vault Bulkhead Door
        ctx.strokeStyle = '#0088ff';
        ctx.lineWidth = 4;
        ctx.strokeRect(cx - 140, cy - 100, 280, 240);

        // Locking Bolts
        ctx.fillStyle = state.loop3.tokenAuthorized ? '#00e676' : '#ff1744';
        ctx.fillRect(cx - 130, cy - 80, 20, 40);
        ctx.fillRect(cx + 110, cy - 80, 20, 40);
        ctx.fillRect(cx - 130, cy + 40, 20, 40);
        ctx.fillRect(cx + 110, cy + 40, 20, 40);
    }

    function updateDispatcherUI() {
        if (state.role !== 'dispatcher') return;
        document.getElementById('disp-op-freq').textContent = `${state.loop1.opFreq} Hz`;
        document.getElementById('disp-op-wire').textContent = state.loop1.opWireSeq.length > 0 ? state.loop1.opWireSeq.join(' ➔ ') : 'PENDING';
        document.getElementById('disp-loop1-lock').textContent = state.loop1.completed ? 'CLEARED' : 'UNLOCKED';
        document.getElementById('disp-loop1-lock').className = `badge ${state.loop1.completed ? 'badge-success' : 'badge-warn'}`;

        document.getElementById('disp-op-psi').textContent = `${Math.floor(state.loop2.currentPsi)} PSI`;
        document.getElementById('disp-op-valve').textContent = state.loop2.opHeldValve ? `VALVE ${state.loop2.opHeldValve}` : 'NONE';
        document.getElementById('disp-loop2-lock').textContent = state.loop2.completed ? 'VENTED' : 'SEALED';
        document.getElementById('disp-loop2-lock').className = `badge ${state.loop2.completed ? 'badge-success' : 'badge-warn'}`;

        document.getElementById('disp-token-sent').textContent = state.loop3.tokenAuthorized ? 'YES' : 'NO';
        document.getElementById('disp-loop3-lock').textContent = state.loop3.completed ? 'UNLOCKED' : 'LOCKED';
        document.getElementById('disp-loop3-lock').className = `badge ${state.loop3.completed ? 'badge-success' : 'badge-warn'}`;
    }

    // =========================================================================
    // EVENT LISTENERS & BINDINGS
    // =========================================================================

    function bindEvents() {
        // Role Selection
        document.querySelectorAll('.select-role-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                initAudio();
                const r = e.target.dataset.role;
                setRole(r);
                sendP2P('ROLE_SWAP', { newRole: r === 'operative' ? 'dispatcher' : 'operative' });
            });
        });

        document.getElementById('btn-swap-role').addEventListener('click', () => {
            const nextRole = state.role === 'operative' ? 'dispatcher' : 'operative';
            setRole(nextRole);
            sendP2P('ROLE_SWAP', { newRole: state.role });
        });

        document.getElementById('btn-restart-game').addEventListener('click', () => resetGame(true));
        document.getElementById('btn-play-again').addEventListener('click', () => resetGame(true));

        // Loop 1 Operative Controls
        const freqSlider = document.getElementById('op-freq-slider');
        freqSlider.addEventListener('input', (e) => {
            initAudio();
            state.loop1.opFreq = parseInt(e.target.value, 10);
            document.getElementById('op-freq-val').textContent = `${state.loop1.opFreq} Hz`;
            sendP2P('OP_STATE_UPDATE', { opFreq: state.loop1.opFreq });
        });

        document.querySelectorAll('.btn-wire').forEach(btn => {
            btn.addEventListener('click', (e) => {
                initAudio();
                playBeep(500, 'sine', 0.1);
                const color = e.target.dataset.color;
                if (state.loop1.opWireSeq.length >= 3) state.loop1.opWireSeq = [];
                state.loop1.opWireSeq.push(color);
                document.getElementById('op-wire-status').textContent = `Sequence: ${state.loop1.opWireSeq.join(' ➔ ')}`;
                sendP2P('OP_STATE_UPDATE', { opWireSeq: state.loop1.opWireSeq });
            });
        });

        // Loop 2 Valve Controls
        ['a', 'b', 'c'].forEach(v => {
            const btn = document.getElementById(`op-valve-${v}`);
            const valveName = v.toUpperCase();
            
            const startValve = () => {
                initAudio();
                state.loop2.opHeldValve = valveName;
                btn.classList.add('active');
                sendP2P('OP_STATE_UPDATE', { opHeldValve: valveName });
            };
            const stopValve = () => {
                state.loop2.opHeldValve = null;
                btn.classList.remove('active');
                sendP2P('OP_STATE_UPDATE', { opHeldValve: null });
            };

            btn.addEventListener('mousedown', startValve);
            btn.addEventListener('mouseup', stopValve);
            btn.addEventListener('touchstart', (e) => { e.preventDefault(); startValve(); });
            btn.addEventListener('touchend', stopValve);
        });

        // Loop 3 Keypad Controls
        document.querySelectorAll('.btn-num').forEach(btn => {
            btn.addEventListener('click', (e) => {
                initAudio();
                const val = e.target.textContent;
                if (val === 'CLR') {
                    state.loop3.opInputCode = '';
                } else if (val === 'ENT') {
                    checkLoop3Completion();
                } else if (state.loop3.opInputCode.length < 4) {
                    playBeep(700, 'sine', 0.08);
                    state.loop3.opInputCode += val;
                }
                document.getElementById('op-keypad-code').value = state.loop3.opInputCode;
                sendP2P('OP_STATE_UPDATE', { opInputCode: state.loop3.opInputCode });
            });
        });

        // Dispatcher Action Buttons
        document.getElementById('disp-send-pulse').addEventListener('click', () => {
            initAudio();
            sendP2P('ACTION_PULSE');
            checkLoop1Completion();
        });

        document.getElementById('disp-trigger-vent').addEventListener('click', () => {
            initAudio();
            sendP2P('ACTION_VENT');
            checkLoop2Completion();
        });

        document.getElementById('disp-send-auth').addEventListener('click', () => {
            initAudio();
            state.loop3.tokenAuthorized = true;
            sendP2P('ACTION_AUTH');
            updateDispatcherUI();
        });

        // Terminal Tab Switching
        document.querySelectorAll('.term-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                initAudio();
                document.querySelectorAll('.term-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                
                e.target.classList.add('active');
                const targetId = e.target.dataset.tab;
                document.getElementById(targetId).classList.add('active');
            });
        });
    }

    // Init on DOM ready
    window.addEventListener('DOMContentLoaded', () => {
        init3DCanvas();
        bindEvents();
        updatePanelsForCurrentLoop();
    });

})();
