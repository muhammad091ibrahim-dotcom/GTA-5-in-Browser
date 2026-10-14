const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
async function run(failure){
  const nodes={};const make=()=>({textContent:'',style:{},attrs:{},events:{},setAttribute(k,v){this.attrs[k]=v},getAttribute(k){return this.attrs[k]},addEventListener(k,v){this.events[k]=v},scrollIntoView(){}});
  const link=make(),adapter={features:new Set(failure==='bc'?[]:['texture-compression-bc']),limits:{},requestDevice:async()=>({destroy(){}})};
  const context=vm.createContext({navigator:{userAgent:'test',gpu:{requestAdapter:async()=>adapter}},isSecureContext:true,crossOriginIsolated:true,SharedArrayBuffer,OffscreenCanvas:function(){},WebAssembly:{validate:()=>failure!=='memory64'},URLSearchParams,location:{search:''},document:{getElementById:id=>nodes[id]??=make(),querySelectorAll:()=>[link]},fetch:async url=>url==='/'?{status:200,text:async()=>'/b/test/'}:{status:206,arrayBuffer:async()=>new Uint8Array([0,97,115,109]).buffer}});
  vm.runInContext(fs.readFileSync('support/check.js','utf8'),context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(link.attrs['aria-disabled'],failure==='ok'?'false':'true');
  let prevented=false;link.events.click({preventDefault(){prevented=true}});assert.equal(prevented,failure!=='ok');
  if(failure==='memory64') assert.match(nodes.status.textContent,/64-bit WebAssembly/);
  if(failure==='bc') assert.match(nodes.status.textContent,/BC texture compression/);
}
(async()=>{for(const failure of ['ok','memory64','bc'])await run(failure);console.log('PASS: capability failures explain and block launch loops; supported devices can launch');})().catch(e=>{console.error(e);process.exitCode=1});
