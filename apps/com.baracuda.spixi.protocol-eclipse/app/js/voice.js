/** Optional WebRTC audio. Ixian S2 supports RFC5389 STUN on UDP/3478.
 * Endpoint is user configured: no invented public node or automatic microphone access.
 */
(() => {
  'use strict';
  let send = null, offerer = false, enabled = false, remoteReady = false;
  let pc = null, stream = null, candidates = [], generation = 0, making = false;
  let localCall = '', remoteCall = '', queue = Promise.resolve(), timeout = 0;
  const el = id => document.getElementById(id);
  const status = text => { if(el('voice-status')) el('voice-status').textContent=text; };
  function parseServer(value) {
    const text=value.trim();
    if(!/^stun:(?:[a-z0-9.-]+|\[[a-f0-9:]+\]):\d{1,5}$/i.test(text)) throw new Error('Enter stun:your-s2-host:3478 (UDP STUN, not the S2 messaging port).');
    const port=Number(text.slice(text.lastIndexOf(':')+1));
    if(port<1||port>65535) throw new Error('STUN port must be 1–65535.');
    return text;
  }
  function stop(notify=true) {
    generation++; clearTimeout(timeout); timeout=0;
    if(notify && send && enabled) send({kind:'end',call:localCall});
    enabled=false; remoteReady=false; making=false; candidates=[]; localCall=''; remoteCall='';
    if(pc) {pc.onicecandidate=null;pc.onconnectionstatechange=null;pc.close();pc=null;}
    if(stream) {stream.getTracks().forEach(t=>t.stop());stream=null;}
    if(el('voice-audio')) el('voice-audio').srcObject=null;
    if(el('voice-toggle')) el('voice-toggle').textContent='Enable voice';
    if(el('voice-mute')) el('voice-mute').disabled=true;
    status('Voice off · game continues over Spixi');
  }
  async function offer() {
    if(!pc||!enabled||!remoteReady||!offerer||making||pc.signalingState!=='stable') return;
    making=true; const current=pc, gen=generation;
    try {
      const description=await current.createOffer();
      if(gen!==generation) return;
      await current.setLocalDescription(description);
      if(gen===generation) send({kind:'description',call:localCall,to:remoteCall,description:{type:current.localDescription.type,sdp:current.localDescription.sdp}});
    } finally {if(gen===generation)making=false;}
  }
  async function enable() {
    if(enabled){stop();return;}
    if(!send){status('Connect to a Spixi peer before enabling voice.');return;}
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia||!window.RTCPeerConnection){status('Voice unavailable in this WebView. Use a separate voice call.');return;}
    let url;
    try {url=parseServer(el('voice-stun').value);} catch(e){status(e.message);return;}
    const gen=++generation;
    status('Requesting microphone permission…');el('voice-toggle').disabled=true;
    try {
      const media=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
      if(gen!==generation){media.getTracks().forEach(t=>t.stop());return;}
      stream=media; enabled=true; localCall=crypto.getRandomValues(new Uint32Array(2)).join('-');
      pc=new RTCPeerConnection({iceServers:[{urls:url}],iceCandidatePoolSize:0});
      const current=pc;
      stream.getTracks().forEach(track=>current.addTrack(track,stream));
      current.onicecandidate=e=>{if(gen===generation&&e.candidate&&remoteCall)send({kind:'candidate',call:localCall,to:remoteCall,candidate:e.candidate.toJSON()});};
      current.ontrack=e=>{if(gen!==generation)return;el('voice-audio').srcObject=e.streams[0] || new MediaStream([e.track]);el('voice-audio').play().catch(()=>status('Audio ready; press play on the audio control.'));};
      current.onconnectionstatechange=()=>{
        if(gen!==generation)return;
        if(current.connectionState==='connected'){clearTimeout(timeout);status('Voice connected · encrypted WebRTC audio');}
        else if(current.connectionState==='failed'){stop();status('Voice connection failed. STUN cannot traverse every NAT; use a separate call or a configured TURN service.');}
        else if(current.connectionState==='disconnected')status('Voice interrupted · reconnect or disable voice');
      };
      el('voice-toggle').textContent='Disable voice';el('voice-mute').disabled=false;el('voice-mute').textContent='Mute';
      status('Microphone on · waiting for your partner to enable voice');
      timeout=setTimeout(()=>{if(pc&&pc.connectionState!=='connected'){stop();status('Voice timed out. Check the S2 STUN endpoint or use a separate call.');}},45000);
      send({kind:'ready',call:localCall});
    } catch(e) {
      if(gen===generation){stop();status(e.name==='NotAllowedError'?'Microphone permission denied. Game remains playable.':'Could not start voice. Check microphone and STUN settings.');}
    } finally {el('voice-toggle').disabled=false;}
  }
  async function receive(p) {
    if(!p||!enabled||!pc||typeof p.call!=='string'||p.call.length>100)return;
    if(p.kind==='ready') {
      if(remoteCall && remoteCall!==p.call){stop(false);status('Partner restarted voice. Enable it again to reconnect.');return;}
      const first=!remoteReady;remoteReady=true;remoteCall=p.call;
      if(first)send({kind:'ready',call:localCall});
      await offer();return;
    }
    if(p.call!==remoteCall)return;
    if(p.kind==='end'){stop(false);status('Partner disabled voice.');return;}
    if(p.to!==localCall)return;
    const current=pc,gen=generation;
    if(p.kind==='description'&&p.description&&typeof p.description.sdp==='string'&&p.description.sdp.length<14000) {
      const d=p.description;
      if((offerer&&d.type!=='answer')||(!offerer&&d.type!=='offer'))return;
      await current.setRemoteDescription(d);
      if(gen!==generation)return;
      for(const candidate of candidates)await current.addIceCandidate(candidate);
      candidates=[];
      if(d.type==='offer'){
        await current.setLocalDescription(await current.createAnswer());
        if(gen===generation)send({kind:'description',call:localCall,to:remoteCall,description:{type:current.localDescription.type,sdp:current.localDescription.sdp}});
      }
    } else if(p.kind==='candidate'&&p.candidate&&typeof p.candidate.candidate==='string'&&p.candidate.candidate.length<2000) {
      if(current.remoteDescription)await current.addIceCandidate(p.candidate);
      else if(candidates.length<64)candidates.push(p.candidate);
    }
  }
  window.EclipseVoice={
    init(transport,isOfferer){stop(false);send=transport;offerer=isOfferer;},
    receive(payload){queue=queue.then(()=>receive(payload)).catch(()=>{stop();status('Voice negotiation failed. Disable and retry; gameplay is unaffected.');});},
    close(){stop();send=null;}
  };
  document.addEventListener('DOMContentLoaded',()=>{
    el('voice-toggle').onclick=enable;
    el('voice-mute').onclick=()=>{if(!stream)return;const tracks=stream.getAudioTracks(),muted=tracks.some(t=>t.enabled);tracks.forEach(t=>t.enabled=!muted);el('voice-mute').textContent=muted?'Unmute':'Mute';};
    window.addEventListener('pagehide',()=>stop());
  });
})();
