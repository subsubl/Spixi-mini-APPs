const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const dgram=require('node:dgram'), assert=require('node:assert/strict');
(async()=>{
 const stun=dgram.createSocket('udp4');let bindings=0;
 stun.on('message',(data,remote)=>{
  if(data.length<20||data.readUInt16BE(0)!==1)return;
  bindings++; const r=Buffer.alloc(32);r.writeUInt16BE(0x101,0);r.writeUInt16BE(12,2);r.writeUInt32BE(0x2112a442,4);data.copy(r,8,8,20);
  r.writeUInt16BE(0x20,20);r.writeUInt16BE(8,22);r[25]=1;r.writeUInt16BE(remote.port^0x2112,26);
  remote.address.split('.').forEach((v,i)=>r[28+i]=Number(v)^r[4+i]);stun.send(r,remote.port,remote.address);
 });
 await new Promise(resolve=>stun.bind(0,'0.0.0.0',resolve));
 const browser=await chromium.launch({args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 try{
 const pages=await Promise.all([browser.newPage(),browser.newPage()]);let errors=[],voiceMessages=0;const loaded=[false,false],queue=[Promise.resolve(),Promise.resolve()];
 for(let i=0;i<2;i++){
  pages[i].on('pageerror',e=>errors.push(e.message));
  await pages[i].exposeFunction('relay',data=>{
   if(!loaded[1-i])return;if(JSON.parse(data).type==='voice')voiceMessages++;
   queue[i]=queue[i].then(()=>pages[1-i].evaluate(({sender,data})=>SpixiAppSdk.onNetworkData(sender,data),{sender:['a','b'][i],data})).catch(e=>errors.push(e.message));
  });
  await pages[i].route('**/spixi-app-sdk.js',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:(await r.text())+'\nSpixiAppSdk.fireOnLoad=()=>{};SpixiAppSdk.sendNetworkData=data=>window.relay(data);'});});
 }
 await Promise.all(pages.map(async(p,i)=>{await p.goto('http://127.0.0.1:8770/');loaded[i]=true;}));
 for(let i=0;i<2;i++)await pages[i].evaluate(({me,peer})=>SpixiAppSdk.onInit('voice-test',me,peer),{me:['a','b'][i],peer:['b','a'][i]});
 for(const p of pages){await p.waitForFunction(()=>document.getElementById('status-text').textContent.includes('P2P linked'));await p.locator('summary').click();}
 await pages[0].locator('#voice-toggle').click();
 assert.match(await pages[0].locator('#voice-status').innerText(),/Enter stun:/);
 // Local RFC5389 fixture. This is NOT a public Ixian node availability test.
 const os=require('node:os');const ip=Object.values(os.networkInterfaces()).flat().find(a=>a.family==='IPv4'&&!a.internal)?.address||'127.0.0.1';
 for(const p of pages){await p.locator('#voice-stun').fill(`stun:${ip}:${stun.address().port}`);await p.locator('#voice-toggle').click();}
 for(const p of pages)await p.waitForFunction(()=>document.getElementById('voice-status').textContent.includes('Voice connected'),null,{timeout:20000});
 for(const p of pages)assert.equal(await p.locator('#voice-audio').evaluate(e=>e.srcObject?.getAudioTracks().some(t=>t.readyState==='live')),true);
 await pages[0].locator('#voice-mute').click();assert.equal(await pages[0].locator('#voice-mute').innerText(),'Unmute');
 await pages[0].locator('#voice-toggle').click();
 await pages[1].waitForFunction(()=>document.getElementById('voice-status').textContent.includes('Partner disabled'));
 for(const p of pages)assert.equal(await p.locator('#voice-audio').evaluate(e=>e.srcObject),null);
 assert.ok(bindings>0);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'PASS',realBrowserWebRTC:true,microphone:'synthetic test audio',signaling:'simulated Spixi transport',stun:'local RFC5389 test service, NOT live Ixian S2',stunBindings:bindings,voiceMessages,muteAndTeardown:true,pageErrors:errors},null,2));
 }finally{await browser.close();stun.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
