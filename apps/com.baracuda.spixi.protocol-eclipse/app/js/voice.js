/* Experimental packet voice. ALL audio travels through the Spixi SDK transport.
 * PCM16LE mono/8kHz, 100ms frames; no RTCPeerConnection, STUN or TURN.
 */
(() => {
  'use strict';
  const P=window.EclipseVoicePackets, el=id=>document.getElementById(id);
  const workletURL=new URL('voice-capture.js',document.currentScript.src).href;
  let send=null,enabled=false,pending=false,generation=0,call='',remote='',muted=false;
  let context=null,stream=null,capture=null,input=null,gain=null,buffer=null,timer=0;
  let sequence=0,lastReady=0,lastPeer=0,started=0,windowStart=0,windowFrames=0;
  const playing=new Set();
  const status=text=>{el('voice-status').textContent=text;};
  function transmit(payload) {if(send)send({v:2,...payload});}
  function setCapture() {
    capture?.port.postMessage(enabled&&!muted&&!!remote);
    stream?.getAudioTracks().forEach(t=>{t.enabled=enabled&&!muted&&!!remote;});
  }
  function stop(notify=true) {
    if(notify&&enabled)try{transmit({kind:'end',call,to:remote});}catch(_){}
    generation++;enabled=pending=false;clearInterval(timer);timer=0;
    remote=call='';buffer?.reset();buffer=null;
    if(capture){capture.port.onmessage=null;capture.port.close();capture.disconnect();capture=null;}
    input?.disconnect();gain?.disconnect();input=gain=null;
    stream?.getTracks().forEach(t=>t.stop());stream=null;
    for(const source of playing){source.onended=null;try{source.stop();}catch(_){}source.disconnect();}playing.clear();
    if(context){context.close().catch(()=>{});context=null;}
    el('voice-toggle').textContent='Enable voice';el('voice-toggle').disabled=false;
    el('voice-mute').disabled=true;el('voice-mute').textContent='Mute';
    status('Voice off · game continues over Spixi');
  }
  function play(samples,time) {
    if(!enabled||!context||context.state!=='running'||playing.size>=8)return;
    const audio=context.createBuffer(1,P.SAMPLES,P.RATE);audio.copyToChannel(samples,0);
    const source=context.createBufferSource();source.buffer=audio;source.connect(context.destination);
    playing.add(source);source.onended=()=>{playing.delete(source);source.disconnect();};source.start(time);
    status('Receiving packet audio · Spixi AppData');
  }
  async function enable() {
    if(enabled||pending){stop();return;}
    if(!send){status('Connect to a Spixi peer before enabling voice.');return;}
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia||!AC||!window.AudioWorkletNode){status('Packet voice unavailable in this WebView. Gameplay remains available.');return;}
    const gen=++generation;pending=true;
    el('voice-toggle').textContent='Cancel voice';status('Requesting microphone permission…');
    try {
      context=new AC();
      if(!context.audioWorklet)throw Error('AudioWorklet unavailable');
      const ctx=context;await ctx.resume();if(gen!==generation)return;
      await ctx.audioWorklet.addModule(workletURL);if(gen!==generation)return;
      const media=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
      if(gen!==generation){media.getTracks().forEach(t=>t.stop());return;}
      stream=media;call=crypto.getRandomValues(new Uint32Array(2)).join('-');remote='';
      sequence=0;muted=false;windowStart=performance.now();windowFrames=0;
      capture=new AudioWorkletNode(ctx,'eclipse-capture');input=ctx.createMediaStreamSource(stream);
      gain=ctx.createGain();gain.gain.value=0;
      input.connect(capture);capture.connect(gain);gain.connect(ctx.destination);
      buffer=new P.JitterBuffer(()=>ctx.currentTime,play);
      capture.port.onmessage=e=>{
        if(gen!==generation||!enabled||muted||!remote||ctx.state!=='running')return;
        const now=performance.now();if(now-windowStart>=1000){windowStart=now;windowFrames=0;}
        // Do not flush queued worklet frames in a burst after a UI stall.
        if(++windowFrames>12)return;
        try{transmit({kind:'audio',call,to:remote,frame:P.encode(e.data,sequence++)});}
        catch(_){stop();status('Voice transport failed. Gameplay remains available.');}
      };
      enabled=true;pending=false;setCapture();lastReady=0;lastPeer=0;started=performance.now();
      el('voice-toggle').textContent='Disable voice';el('voice-mute').disabled=false;
      status('Voice enabled · waiting for partner consent');
      timer=setInterval(()=>{
        if(!enabled)return;
        if(ctx.state!=='running'){stop();status('Audio suspended. Enable voice again when ready.');return;}
        buffer.pump();
        const now=performance.now();
        if((remote&&now-lastPeer>5000)||(!remote&&now-started>30000)){stop();status('Voice peer timed out. Enable again to reconnect.');return;}
        if(now-lastReady>=1000){lastReady=now;try{transmit({kind:'ready',call});}catch(_){stop();}}
      },20);
      transmit({kind:'ready',call});lastReady=performance.now();
    } catch(e) {
      if(gen===generation){stop();status(e.name==='NotAllowedError'?'Microphone permission denied. Game remains playable.':'Could not start packet voice in this WebView.');}
    }
  }
  function receive(p) {
    if(!enabled||!p||p.v!==2||typeof p.call!=='string'||!/^\d+-\d+$/.test(p.call)||p.call.length>30)return;
    if(p.kind==='ready') {
      if(remote&&remote!==p.call){stop(false);status('Partner restarted voice. Enable it again to reconnect.');return;}
      lastPeer=performance.now();
      if(!remote){remote=p.call;setCapture();transmit({kind:'ready',call});}
      return;
    }
    if(p.call!==remote||p.to!==call)return;
    if(p.kind==='end'){stop(false);status('Partner disabled voice.');return;}
    if(p.kind==='audio'){const frame=P.decode(p.frame);if(frame)buffer.push(frame);}
  }
  window.EclipseVoice={
    init(transport){stop(false);send=transport;},
    receive(payload){try{receive(payload);}catch(_){stop();status('Packet voice stopped. Gameplay remains available.');}},
    close(){stop();send=null;}
  };
  document.addEventListener('DOMContentLoaded',()=>{
    el('voice-toggle').onclick=enable;
    el('voice-mute').onclick=()=>{if(!enabled)return;muted=!muted;setCapture();el('voice-mute').textContent=muted?'Unmute':'Mute';};
    window.addEventListener('pagehide',()=>stop());
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  });
})();
