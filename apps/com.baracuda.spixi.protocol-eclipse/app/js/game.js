/** Protocol: Eclipse 1.1.0 — dependency-free, host-authoritative co-op. */
(() => {
  'use strict';
  const sdk = window.SpixiAppSdk;
  const $ = id => document.getElementById(id);
  const LIMITS = [0, 180, 150, 120];
  const COLORS = ['RED', 'GREEN', 'BLUE', 'YELLOW'];
  const GLYPHS = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Sigma', 'Omega', 'Zeta', 'Seven', 'Three'];
  const clone = value => JSON.parse(JSON.stringify(value));
  let session = '', me = '', peer = '', host = false, connected = false, model = null;
  let boot = '', peerBoot = '', outSeq = 0, receivedSeq = 0, revision = 0, receivedRevision = -1;
  let epoch = 0, lastPeer = 0, lastTick = 0, lastPublish = 0, lastHello = 0;
  let interval = 0, raf = 0, audio = null, ready = false, displayedStage = '', lastStatus = '';
  let freqPending = 0, localValve = null, introTimer = 0;
  const token = () => Array.from(crypto.getRandomValues(new Uint32Array(2))).join('-');
  const role = () => model && model.operative === me ? 'operative' : 'dispatcher';
  const active = () => model && model.status === 'playing';

  function rng(seed) {
    return () => {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffle(list, random) {
    const result = [...list];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  function newRound(operative) {
    epoch++;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0], random = rng(seed);
    const digits = shuffle([0,1,2,3,4,5,6,7,8,9], random);
    const mapping = GLYPHS.map((glyph, i) => ({glyph, digit: digits[i]}));
    const glyphs = shuffle(GLYPHS, random).slice(0,4);
    model = {
      epoch, seed, operative, status: 'playing', stage: 1, elapsed: 0, remaining: LIMITS[1],
      failures: 0, totalFailures: 0, reason: '', notice: 'Round ready. Work together.', paused: !connected,
      freq: 250, wires: [], psi: 0, valve: null, code: '', authorized: false,
      puzzle: {
        frequency: 300 + Math.floor(random() * 301), wires: shuffle(COLORS,random),
        valve: ['A','B','C'][Math.floor(random() * 3)], pressure: 60 + Math.floor(random() * 15),
        glyphs, mapping, code: glyphs.map(g => mapping.find(m => m.glyph === g).digit).join('')
      }
    };
    clearTimeout(freqPending); freqPending = 0;
    localValve = null;
    publish();
  }
  function log(text) {
    const stream = $('disp-log-stream');
    if (!stream) return;
    const line = document.createElement('div');
    line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    stream.append(line);
    while (stream.children.length > 60) stream.firstChild.remove();
    stream.scrollTop = stream.scrollHeight;
  }
  function send(type, payload = {}) {
    if (!session || !peer) return;
    const message = {v:1, session, boot, epoch:model?.epoch || 0, seq:++outSeq, type, payload};
    try { sdk.sendNetworkData(JSON.stringify(message),peer); }
    catch (_) { connected = false; log('Transport unavailable. Waiting to reconnect.'); }
  }
  function publish() {
    if (!host || !model) return;
    revision++;
    lastPublish = performance.now();
    send('snapshot', {revision, state:model, forBoot:peerBoot});
    render();
  }
  function fail(reason) {
    model.failures++; model.totalFailures++; model.notice = reason;
    if (model.failures >= 5) { model.status = 'lost'; model.reason = 'Five failed overrides in this sector. Lockdown engaged.'; }
    log(reason);
  }
  function advance() {
    model.stage++; model.remaining = LIMITS[model.stage]; model.failures = 0;
    model.valve = null; model.notice = 'Sector cleared. Next security barrier online.';
  }
  // All gameplay intents — including the host's own inputs — use this reducer.
  function reduce(sender, action, value) {
    if (!host || !model || (sender !== me && sender !== peer)) return;
    const operative = sender === model.operative;
    if (action === 'restart') { newRound(model.operative); return; }
    if (!active() || model.paused) return;
    if (action === 'role' && ['operative','dispatcher'].includes(value)) {
      model.operative = value === 'operative' ? sender : sender === me ? peer : me;
      model.valve = null;
    } else if (action === 'frequency' && operative && model.stage === 1 && Number.isInteger(value) && value >= 100 && value <= 999) {
      model.freq = value;
    } else if (action === 'wire' && operative && model.stage === 1 && COLORS.includes(value)) {
      if (model.wires.length === model.puzzle.wires.length) model.wires = [];
      model.wires.push(value);
    } else if (action === 'pulse' && !operative && model.stage === 1) {
      if (Math.abs(model.freq-model.puzzle.frequency) <= 10 && model.wires.join() === model.puzzle.wires.join()) advance();
      else fail('Calibration rejected. Confirm the frequency and the wire order.');
    } else if (action === 'valve' && operative && model.stage === 2 && (value === null || ['A','B','C'].includes(value))) {
      model.valve = value;
    } else if (action === 'vent' && !operative && model.stage === 2) {
      if (model.valve === model.puzzle.valve && model.psi >= model.puzzle.pressure && model.psi <= model.puzzle.pressure+8) advance();
      else fail('Vent rejected. Coordinate the valve and pressure window.');
    } else if (action === 'authorize' && !operative && model.stage === 3) {
      model.authorized = true; model.notice = 'Authorization token received. Enter the decoded glyphs.';
    } else if (action === 'key' && operative && model.stage === 3 && typeof value === 'string') {
      if (value === 'CLR') model.code = '';
      else if (value === 'ENT') {
        if (model.code === model.puzzle.code && model.authorized) {
          model.status = 'won'; model.notice = 'Facility escaped. Both agents extracted.';
        } else fail('Access denied. Check the glyph decoding and authorization token.');
      } else if (/^\d$/.test(value) && model.code.length < 4) model.code += value;
      else return;
    } else return;
    publish();
  }
  function intent(action,value) {
    unlockAudio();
    if (!model || !connected) return;
    if (host) reduce(me,action,value);
    else send('intent',{action,value});
  }
  function validState(s) {
    return s && Number.isSafeInteger(s.epoch) && s.epoch > 0 && [me,peer].includes(s.operative)
      && ['playing','won','lost'].includes(s.status) && [1,2,3].includes(s.stage)
      && Number.isFinite(s.remaining) && Number.isFinite(s.psi) && s.psi >= 0 && s.psi <= 110
      && Array.isArray(s.wires) && s.wires.length <= 4 && s.wires.every(c=>COLORS.includes(c))
      && typeof s.code === 'string' && s.code.length <= 4 && s.puzzle
      && Array.isArray(s.puzzle.mapping) && s.puzzle.mapping.length === 10
      && Array.isArray(s.puzzle.glyphs) && s.puzzle.glyphs.length === 4;
  }
  sdk.onNetworkData = (sender,data) => {
    if (!ready || sender !== peer || typeof data !== 'string' || data.length > 16000) return;
    let m; try { m = JSON.parse(data); } catch (_) { return; }
    if (!m || m.v !== 1 || m.session !== session || typeof m.boot !== 'string'
      || !Number.isSafeInteger(m.seq) || m.seq <= 0 || !m.payload || typeof m.payload !== 'object') return;
    if (m.type === 'hello') {
      // A fresh page boot must introduce itself before any new intents are accepted.
      if (peerBoot !== m.boot) { peerBoot = m.boot; receivedSeq = 0; receivedRevision = -1; }
    } else if (m.boot !== peerBoot) { send('hello'); return; }
    if (m.seq <= receivedSeq) return;
    receivedSeq = m.seq; lastPeer = performance.now(); connected = true;
    if (m.type === 'voice') { window.EclipseVoice?.receive(m.payload); return; }
    if (m.type === 'hello') {
      if (host) { model.paused = false; publish(); }
      else send('request');
    } else if (m.type === 'request' && host) publish();
    else if (m.type === 'intent' && host && m.epoch === model?.epoch) {
      reduce(sender,m.payload.action,m.payload.value);
    } else if (m.type === 'snapshot' && !host && m.payload.forBoot === boot
      && Number.isSafeInteger(m.payload.revision) && m.payload.revision > receivedRevision && validState(m.payload.state)) {
      receivedRevision = m.payload.revision;
      model = clone(m.payload.state); epoch = model.epoch;
      render();
    }
  };
  sdk.onInit = (id,address,...others) => {
    if (!ready) { pendingInit = [id,address,...others]; return; }
    const remote = others.flat().filter(a=>typeof a === 'string' && a !== address)[0];
    if (typeof id !== 'string' || typeof address !== 'string' || !remote) {
      $('status-text').textContent = 'Waiting for a second Spixi participant'; return;
    }
    if (session === id && me === address && peer === remote) { send('hello'); return; }
    shutdown();
    session=id; me=address; peer=remote; host=me<peer; boot=token(); peerBoot='';
    outSeq=receivedSeq=revision=epoch=0; receivedRevision=-1; connected=false;
    lastPeer=0; model=null; lastTick=performance.now(); lastHello=lastTick;
    window.EclipseVoice?.init(payload => send('voice',payload),host);
    if (host) newRound(me);
    send('hello');
    interval=setInterval(tick,50);
    showIntro(); render();
  };
  let pendingInit = null;
  function tick() {
    const now=performance.now(), dt=Math.min((now-lastTick)/1000,0.25); lastTick=now;
    if (now-lastHello >= 1000) { lastHello=now; send('hello'); }
    if (lastPeer && now-lastPeer > 5000) connected=false;
    if (host && model) {
      model.paused = !connected;
      if (active() && connected) {
        model.elapsed+=dt; model.remaining=Math.max(0,model.remaining-dt);
        if (model.stage === 2) {
          // Pressure cycles instead of creating an unwinnable overshoot. Holding a valve slows it.
          model.psi=Math.max(0,Math.min(110,model.psi+dt*(model.valve ? -3 : 6)));
          if (model.psi >= 105) { model.psi=0; model.valve=null; fail('Pressure surge. Chamber vented; try the next cycle.'); }
        }
        if (model.remaining <= 0) { model.status='lost'; model.reason='The Eclipse completed before the sector was cleared.'; }
      }
      if (now-lastPublish >= 250) publish();
    }
    $('status-text').textContent=connected ? 'P2P linked · shared state' : 'Waiting for peer · round paused';
    document.querySelector('.status-dot').classList.toggle('connected',connected);
  }
  function shutdown() {
    window.EclipseVoice?.close();
    clearInterval(interval); interval=0; clearTimeout(freqPending); freqPending=0;
    clearTimeout(introTimer); cancelAnimationFrame(raf); raf=0;
    localValve=null;
  }
  sdk.onAppEndSession = () => {
    shutdown(); session=''; connected=false; model=null; render();
    $('status-text').textContent='Session ended. Return to Spixi to start again.';
  };
  function clock(seconds) { const s=Math.max(0,Math.ceil(seconds)); return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }
  function text(id,value) { const el=$(id); if(el) el.textContent=value; }
  function showIntro() {
    text('role-intro', role()==='operative' ? 'OPERATIVE: describe your glyphs, operate the panels, and follow your partner’s instructions.' : 'DISPATCHER: read the targets, decode your partner’s glyphs, and time the overrides.');
    $('role-intro').classList.add('visible'); clearTimeout(introTimer);
    introTimer=setTimeout(()=>$('role-intro').classList.remove('visible'),6000);
  }
  function setTab(id) {
    document.querySelectorAll('.term-tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===id));
    document.querySelectorAll('.tab-content').forEach(t=>t.classList.toggle('active',t.id===id));
  }
  let lastFailures=0, lastStage=1, oldRole='';
  function render() {
    const r=role(), status=model?.status || 'lobby';
    const screen=status==='lobby' ? 'lobby-screen' : status==='won' ? 'victory-screen' : status==='lost' ? 'gameover-screen' : r==='operative' ? 'operative-viewport' : 'dispatcher-viewport';
    document.querySelectorAll('.screen').forEach(el=>el.classList.toggle('active',el.id===screen));
    if (!model) { cancelAnimationFrame(raf); raf=0; return; }
    if(oldRole!==r) { oldRole=r; localValve=null; showIntro(); }
    text('role-badge',r.toUpperCase()); $('role-badge').className=`badge badge-${r}`;
    const stageKey=`${model.epoch}:${model.stage}:${r}`;
    if(displayedStage!==stageKey) {
      displayedStage=stageKey;
      setTab(['','tab-freq','tab-pressure','tab-cipher'][model.stage]);
    }
    document.querySelectorAll('.puzzle-panel').forEach(el=>el.classList.toggle('active',el.id===`op-loop${model.stage}-panel`));
    const objectives=['','Match the frequency and wire order supplied by your dispatcher.','Hold the instructed valve in the pressure window. Ask your dispatcher to vent.','Describe your glyphs. Enter the decoded digits after authorization.'];
    text('op-task-indicator',objectives[model.stage]);
    text('disp-objective',`SECTOR ${model.stage} · ${model.failures}/5 failed overrides`);
    text('mission-feedback',model.notice);
    text('eclipse-timer',`${model.paused ? 'PAUSED' : 'ECLIPSE'}: ${clock(model.remaining)}`);
    $('eclipse-timer').classList.toggle('critical',model.remaining<=30);
    text('disp-timer',`TIME: ${clock(model.elapsed)}`);
    text('disp-target-freq',`${model.puzzle.frequency} Hz (±10)`);
    text('disp-wire-order',model.puzzle.wires.join(' ➔ '));
    text('disp-target-valve',`VALVE ${model.puzzle.valve}`);
    text('disp-target-psi',`${model.puzzle.pressure}–${model.puzzle.pressure+8} PSI`);
    text('op-freq-val',`${model.freq} Hz`);
    if(!freqPending) $('op-freq-slider').value=model.freq;
    text('op-wire-status',`Sequence: ${model.wires.join(' ➔ ') || 'Empty'}`);
    text('disp-op-freq',`${model.freq} Hz`); text('disp-op-wire',model.wires.join(' ➔ ') || 'PENDING');
    text('gauge-val',`${Math.floor(model.psi)} PSI`); text('disp-op-psi',`${Math.floor(model.psi)} PSI`);
    $('gauge-fill').style.width=`${Math.min(100,model.psi)}%`;
    text('disp-op-valve',model.valve ? `VALVE ${model.valve}` : 'NONE');
    document.querySelectorAll('.btn-valve').forEach(b=>b.classList.toggle('active',b.id.endsWith((model.valve || '-').toLowerCase())));
    $('op-keypad-code').value=model.code;
    text('op-glyphs',model.puzzle.glyphs.join(' • '));
    // Dispatcher sees the dictionary, never the operative's glyph order or decoded answer.
    const table=$('cipher-dictionary');
    if(table && table.dataset.seed!==String(model.seed)) {
      table.replaceChildren();
      for(const entry of model.puzzle.mapping) { const row=document.createElement('div'); row.textContent=`${entry.glyph} → ${entry.digit}`; table.append(row); }
      table.dataset.seed=String(model.seed);
    }
    text('disp-token-sent',model.authorized?'YES':'NO');
    for(let i=1;i<=3;i++) {
      const cleared=model.stage>i || status==='won';
      const el=$(`disp-loop${i}-lock`); el.textContent=cleared?'CLEARED':'LOCKED'; el.className=`badge ${cleared?'badge-success':'badge-warn'}`;
    }
    text('vic-time',clock(model.elapsed)); text('vic-msgs',String(model.totalFailures));
    text('gameover-reason',model.reason); text('gameover-attempts',String(model.totalFailures));
    if(model.failures>lastFailures && status==='playing') { beep(150,.18); $('game-app').classList.remove('shake'); void $('game-app').offsetWidth; $('game-app').classList.add('shake'); }
    if(model.stage>lastStage) beep(750,.25);
    if(status!==lastStatus && status==='won') beep(880,.5);
    lastFailures=model.failures; lastStage=model.stage; lastStatus=status;
    if(active() && r==='operative' && !document.hidden) { if(!raf) raf=requestAnimationFrame(draw); }
    else { cancelAnimationFrame(raf); raf=0; }
  }
  function unlockAudio() {
    try { const Audio=window.AudioContext || window.webkitAudioContext; if(!audio && Audio) audio=new Audio(); if(audio?.state==='suspended') audio.resume().catch(()=>{}); } catch (_) {}
  }
  function beep(hz,duration) {
    if(!audio || audio.state!=='running') return;
    const osc=audio.createOscillator(), gain=audio.createGain();
    osc.frequency.value=hz; gain.gain.setValueAtTime(.035,audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);
    osc.connect(gain); gain.connect(audio.destination); osc.start(); osc.stop(audio.currentTime+duration);
    osc.onended=()=>{osc.disconnect();gain.disconnect();};
  }
  function draw(t) {
    raf=0;
    if(!active() || role()!=='operative' || document.hidden) return;
    const canvas=$('op-canvas'), rect=canvas.getBoundingClientRect(), dpr=Math.min(devicePixelRatio||1,2);
    const w=Math.max(1,rect.width), h=Math.max(1,rect.height), ctx=canvas.getContext('2d');
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)) {canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    if(!ctx) return;
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.fillStyle='#03060a';ctx.fillRect(0,0,w,h);
    const x=w/2,y=h/2;ctx.strokeStyle='#14314f';ctx.lineWidth=1;
    ctx.beginPath(); for(const [a,b] of [[0,0],[w,0],[0,h],[w,h]]){ctx.moveTo(a,b);ctx.lineTo(x,y);}ctx.stroke();
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const phase=reduced?0:t/2000%1;
    for(let i=1;i<=6;i++){const z=(i+phase)/7;ctx.strokeRect(x*(1-z),y*(1-z),w*z,h*z);}
    const bw=Math.min(w*.8,320),bh=Math.min(h*.6,150);
    ctx.fillStyle='#071625';ctx.fillRect(x-bw/2,y-bh/2,bw,bh);ctx.strokeStyle='#0088ff';ctx.strokeRect(x-bw/2,y-bh/2,bw,bh);
    ctx.strokeStyle='#00e676';ctx.lineWidth=2;
    if(model.stage===1){ctx.beginPath();for(let i=0;i<bw-24;i++){const yy=y+Math.sin(i*.001*model.freq+(reduced?0:t/180))*bh*.25;if(!i)ctx.moveTo(x-bw/2+12+i,yy);else ctx.lineTo(x-bw/2+12+i,yy);}ctx.stroke();}
    else {ctx.fillStyle=model.stage===2?'#ff9100':model.authorized?'#00e676':'#ff1744';ctx.font='bold 20px monospace';ctx.textAlign='center';ctx.fillText(model.stage===2?`${Math.floor(model.psi)} PSI`:model.authorized?'TOKEN ACCEPTED':'VAULT SEALED',x,y+8);}
    raf=requestAnimationFrame(draw);
  }
  function releaseValve() { if(localValve!==null){localValve=null;intent('valve',null);} }
  function bind() {
    $('btn-swap-role').onclick=()=>intent('role',role()==='operative'?'dispatcher':'operative');
    for(const id of ['btn-restart-game','btn-play-again','btn-retry-game']) $(id).onclick=()=>intent('restart');
    document.querySelectorAll('.select-role-btn').forEach(b=>b.onclick=()=>{
      if(!model) {text('status-text','Open this app with a Spixi contact. Browser preview needs two simulated peers.');return;}
      intent('role',b.dataset.role);
    });
    $('op-freq-slider').oninput=e=>{
      const value=Number(e.target.value);text('op-freq-val',`${value} Hz`);
      clearTimeout(freqPending);freqPending=setTimeout(()=>{freqPending=0;intent('frequency',value);},80);
    };
    document.querySelectorAll('.btn-wire').forEach(b=>b.onclick=()=>intent('wire',b.dataset.color));
    for(const v of ['a','b','c']) {
      const b=$(`op-valve-${v}`);
      b.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();b.setPointerCapture(e.pointerId);localValve=v;intent('valve',v.toUpperCase());};
      b.onpointerup=b.onpointercancel=b.onlostpointercapture=releaseValve;
      b.onkeydown=e=>{if((e.key===' '||e.key==='Enter')&&!e.repeat){e.preventDefault();localValve=v;intent('valve',v.toUpperCase());}};
      b.onkeyup=e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();releaseValve();}};
      b.onblur=releaseValve;
    }
    document.querySelectorAll('.btn-num').forEach(b=>b.onclick=()=>intent('key',b.textContent.trim()));
    $('disp-send-pulse').onclick=()=>intent('pulse');
    $('disp-trigger-vent').onclick=()=>intent('vent');
    $('disp-send-auth').onclick=()=>intent('authorize');
    document.querySelectorAll('.term-tab').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
    window.addEventListener('blur',releaseValve);
    document.addEventListener('visibilitychange',()=>{if(document.hidden){releaseValve();cancelAnimationFrame(raf);raf=0;}else{send('hello');render();}});
    window.addEventListener('pagehide',()=>{releaseValve();shutdown();if(audio)audio.close().catch(()=>{});});
  }
  document.addEventListener('DOMContentLoaded',()=>{
    ready=true;bind();render();
    if(pendingInit){const args=pendingInit;pendingInit=null;sdk.onInit(...args);}
    // Native lifecycle: announce load once, then await Spixi's onInit callback.
    sdk.fireOnLoad();
  });
  // Opt-in inspection is a deep copy: tests cannot mutate live game state.
  if(new URLSearchParams(location.search).get('debug')==='1') {
    Object.defineProperty(window,'__ECLIPSE__',{get:()=>clone({state:model,role:role(),host,connected,session,revision})});
  }
})();
