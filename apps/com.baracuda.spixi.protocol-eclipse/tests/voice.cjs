/* Real AudioWorklet capture/playback; ONLY native SDK transport is replaced. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 try {
  const pages=await Promise.all([browser.newPage(),browser.newPage()]);
  const errors=[],messages=[[],[]],loaded=[false,false],queues=[Promise.resolve(),Promise.resolve()];
  for(let i=0;i<2;i++){
   pages[i].on('pageerror',e=>errors.push(e.message));
   await pages[i].addInitScript(()=>{
    window.audioTrace={played:0,nonzero:0,contexts:[],tracks:[],rtc:0};
    window.RTCPeerConnection=function(){audioTrace.rtc++;throw Error('WebRTC forbidden in packet voice test');};
    const AC=window.AudioContext;
    window.AudioContext=class extends AC {constructor(...args){super(...args);audioTrace.contexts.push(this);}
     createBufferSource(){const source=super.createBufferSource(),start=source.start.bind(source);
      source.start=(...args)=>{if(source.buffer?.sampleRate===8000&&source.buffer?.length===800){audioTrace.played++;if(source.buffer.getChannelData(0).some(x=>Math.abs(x)>.001))audioTrace.nonzero++;}return start(...args);};return source;}
    };
    const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async opts=>{const stream=await gum(opts);audioTrace.tracks.push(...stream.getTracks());return stream;};
   });
   await pages[i].exposeFunction('relay',data=>{
    const m=JSON.parse(data);if(m.type==='voice')messages[i].push(m.payload);
    if(!loaded[1-i])return;
    queues[i]=queues[i].then(()=>pages[1-i].evaluate(({sender,data})=>SpixiAppSdk.onNetworkData(sender,data),{sender:['a','b'][i],data})).catch(e=>errors.push(e.message));
   });
   await pages[i].route('**/spixi-app-sdk.js',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:(await r.text())+'\nSpixiAppSdk.fireOnLoad=()=>{};SpixiAppSdk.sendNetworkData=data=>window.relay(data);'});});
  }
  await Promise.all(pages.map(async(p,i)=>{await p.goto(process.env.GAME_URL||'http://127.0.0.1:8770/');loaded[i]=true;}));
  for(let i=0;i<2;i++)await pages[i].evaluate(({me,peer})=>SpixiAppSdk.onInit('packet-voice-test',me,peer),{me:['a','b'][i],peer:['b','a'][i]});
  for(const p of pages){await p.waitForFunction(()=>document.getElementById('status-text').textContent.includes('P2P linked'));await p.locator('summary').click();}
  await pages[0].locator('#voice-toggle').click();
  await pages[0].waitForFunction(()=>document.getElementById('voice-toggle').textContent==='Disable voice');
  await pages[0].waitForTimeout(300);assert.equal(messages[0].filter(m=>m.kind==='audio').length,0,'no audio before peer opt-in');
  await pages[1].locator('#voice-toggle').click();
  for(const p of pages)await p.waitForFunction(()=>audioTrace.nonzero>=3,null,{timeout:15000});
  const counts=await Promise.all(pages.map(p=>p.evaluate(()=>({played:audioTrace.played,nonzero:audioTrace.nonzero,rtc:audioTrace.rtc}))));
  await pages[0].locator('#voice-mute').click();assert.equal(await pages[0].locator('#voice-mute').innerText(),'Unmute');
  const before=messages[0].filter(m=>m.kind==='audio').length;
  await pages[0].waitForTimeout(400);assert.equal(messages[0].filter(m=>m.kind==='audio').length,before,'mute sends no audio');
  const receiverBefore=await pages[1].evaluate(()=>audioTrace.played);
  await pages[0].locator('#voice-mute').click();
  await pages[1].waitForFunction(n=>audioTrace.played>n+2,receiverBefore);
  await pages[0].locator('#voice-toggle').click();
  await pages[1].waitForFunction(()=>document.getElementById('voice-status').textContent.includes('Partner disabled'));
  for(const p of pages)await p.waitForFunction(()=>audioTrace.contexts.every(c=>c.state==='closed')&&audioTrace.tracks.every(t=>t.readyState==='ended'));
  for(const batch of messages){assert.ok(batch.some(m=>m.kind==='audio'&&m.frame.length===2144));assert.ok(batch.every(m=>m.v===2&&['ready','audio','end'].includes(m.kind)));}
  for(const p of pages)await p.locator('#voice-toggle').click();
  for(const p of pages)await p.waitForFunction(()=>document.getElementById('voice-status').textContent.includes('Receiving packet audio'));
  loaded[0]=loaded[1]=false; // Drop all transport in both directions.
  for(const p of pages){
    await p.waitForFunction(()=>document.getElementById('voice-status').textContent.includes('timed out'),null,{timeout:8000});
    await p.waitForFunction(()=>audioTrace.contexts.every(c=>c.state==='closed')&&audioTrace.tracks.every(t=>t.readyState==='ended'));
  }
  assert.ok(counts.every(c=>c.rtc===0));assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'PASS',packetAudio:true,realAudioWorklet:true,microphone:'synthetic Chromium audio',playback:counts,transport:'local SDK relay; NOT real Ixian',framesSent:messages.map(a=>a.filter(m=>m.kind==='audio').length),consent:true,mute:true,teardown:true,pageErrors:errors},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
