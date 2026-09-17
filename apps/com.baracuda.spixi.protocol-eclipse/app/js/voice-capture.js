/* AudioWorklet: downsample with box averaging, PCM framing happens on main thread. */
class EclipseCapture extends AudioWorkletProcessor {
  constructor() {
    super();this.active=false;this.phase=0;this.sum=0;this.count=0;
    this.frame=new Float32Array(800);this.offset=0;
    this.port.onmessage=e=>{this.active=e.data===true;this.phase=this.sum=this.count=this.offset=0;};
  }
  process(inputs) {
    const input=inputs[0]?.[0];
    if(!input||!this.active)return true;
    for(const sample of input) {
      this.sum+=sample;this.count++;this.phase+=8000;
      if(this.phase>=sampleRate) {
        this.phase-=sampleRate;this.frame[this.offset++]=this.sum/this.count;this.sum=this.count=0;
        if(this.offset===800){this.port.postMessage(this.frame,[this.frame.buffer]);this.frame=new Float32Array(800);this.offset=0;}
      }
    }
    return true;
  }
}
registerProcessor('eclipse-capture',EclipseCapture);
