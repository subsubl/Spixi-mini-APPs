/* Packet voice v1: PCM16LE mono, 8000 Hz, 100 ms frames. No network dependency. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EclipseVoicePackets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const RATE=8000, SAMPLES=800, HEADER=8, BYTES=HEADER+SAMPLES*2, DURATION=.1;
  function encode(samples, seq) {
    if(samples.length!==SAMPLES || !Number.isInteger(seq) || seq<0 || seq>0xffffffff) throw Error('Invalid frame');
    const bytes=new Uint8Array(BYTES), view=new DataView(bytes.buffer);
    bytes.set([69,86,1,0]); view.setUint32(4,seq,true);
    for(let i=0;i<SAMPLES;i++) {
      const v=Number.isFinite(samples[i])?Math.max(-1,Math.min(1,samples[i])):0;
      view.setInt16(HEADER+i*2,Math.round(v*(v<0?32768:32767)),true);
    }
    return btoa(String.fromCharCode(...bytes));
  }
  function decode(text) {
    if(typeof text!=='string'||text.length!==Math.ceil(BYTES/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
    let raw;try{raw=atob(text);}catch(_){return null;}
    if(raw.length!==BYTES)return null;
    const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),view=new DataView(bytes.buffer);
    if(bytes[0]!==69||bytes[1]!==86||bytes[2]!==1||bytes[3]!==0)return null;
    const samples=new Float32Array(SAMPLES);
    for(let i=0;i<SAMPLES;i++){const v=view.getInt16(HEADER+i*2,true);samples[i]=v/(v<0?32768:32767);}
    return {seq:view.getUint32(4,true),samples};
  }
  // Injected clock (seconds) and sink make scheduling independently testable.
  class JitterBuffer {
    constructor(clock,play) {this.clock=clock;this.play=play;this.reset();}
    reset(){this.frames=new Map();this.base=null;this.last=-1;this.lastArrival=-Infinity;this.dropped=0;}
    push(frame) {
      const now=this.clock();
      if(!frame||frame.seq<=this.last||this.frames.has(frame.seq)){this.dropped++;return false;}
      if(this.base===null || (now-this.lastArrival>.2 && this.frames.size===0
        && this.start+(frame.seq-this.base)*DURATION<now-.05)) {
        this.base=frame.seq;this.start=now+.15;
      }
      const time=this.start+(frame.seq-this.base)*DURATION;
      if(time<now-.05||time>now+.6||this.frames.size>=8){this.dropped++;return false;}
      this.frames.set(frame.seq,{...frame,time});this.lastArrival=now;return true;
    }
    pump() {
      const now=this.clock();
      for(const [seq,frame] of [...this.frames].sort((a,b)=>a[0]-b[0])) {
        if(frame.time>now+.04)break;
        this.frames.delete(seq);
        if(seq<=this.last||frame.time<now-.05){this.dropped++;continue;}
        this.last=seq;this.play(frame.samples,Math.max(now,frame.time));
      }
    }
  }
  return {RATE,SAMPLES,BYTES,DURATION,encode,decode,JitterBuffer};
});
