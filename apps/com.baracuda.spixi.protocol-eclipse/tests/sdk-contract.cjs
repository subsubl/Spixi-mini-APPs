const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const bundled=path.resolve(__dirname,'../app/js/spixi-app-sdk.js');
const files=[bundled,...(process.env.OFFICIAL_SPIXI_SDK?[process.env.OFFICIAL_SPIXI_SDK]:[])];
for(const file of files){
 const navigations=[],jobs=[];
 const window={addEventListener(){}};window.parent=window;
 const context=vm.createContext({window,console,setTimeout:fn=>jobs.push(fn),btoa:s=>btoa(s),atob:s=>atob(s),location:{set href(v){navigations.push(v);}}});
 vm.runInContext(fs.readFileSync(file,'utf8'),context);
 const sdk=context.SpixiAppSdk;
 sdk.fireOnLoad();jobs.splice(0).forEach(fn=>fn());assert.equal(navigations.pop(),'ixian:onload:0.51');
 const message=JSON.stringify({v:1,session:'test',type:'voice',payload:{description:{type:'offer',sdp:'v=0\r\n'}}});
 sdk.sendNetworkData(message,'peer-address');jobs.splice(0).forEach(fn=>fn());
 const url=navigations.pop();assert.ok(url.startsWith('xa:'));
 const wire=JSON.parse(Buffer.from(url.slice(3),'base64').toString('utf8'));
 assert.deepEqual(wire,{c:'ds',d:message,r:'peer-address'});
 let result;sdk.onInit=(...args)=>result=args;sdk.onInit('session','local','remote');assert.deepEqual(result,['session','local','remote']);
 console.log('PASS actual SDK execution: load notification, directed ds payload, xa: base64 encoding, callback signature — '+file);
}
console.log('Native-host installation/microphone/network not exercised by this contract test.');
