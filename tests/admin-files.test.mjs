import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const html=await readFile(new URL('../web/admin/index.html',import.meta.url),'utf8'),script=await readFile(new URL('../web/admin-files.js',import.meta.url),'utf8');
const path='/api/admin/applications/11111111-1111-4111-8111-111111111111/file/';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR3sAAAAASUVORK5CYII=','base64');
function setup(fetcher=async()=>new Response(png,{headers:{'Content-Type':'image/png'}})){
  class Element{constructor(){this.hidden=false;this.open=false;this.events={};}addEventListener(name,fn){this.events[name]=fn;}removeAttribute(name){delete this[name];}showModal(){this.open=true;}close(){this.open=false;this.events.close();}}
  const nodes=Object.fromEntries([...html.matchAll(/\bid="(admin-file-[^"]+)"/g)].map(match=>[match[1],new Element()]));
  const calls=[],created=[],revoked=[],events={},window={addEventListener:(name,fn)=>events[name]=fn};
  vm.runInNewContext(script,{document:{getElementById:id=>nodes[id]},window,AbortController,URL:{createObjectURL:blob=>{created.push(blob);return'blob:private-'+created.length;},revokeObjectURL:url=>revoked.push(url)},fetch:async(url,options)=>{calls.push({url,options});return fetcher(url,options);}});
  return{nodes,calls,created,revoked,events,open:window.OneulAdminFile.open,close:window.OneulAdminFile.close};
}
test('private photos fetch with the current frame session and display a blob with a usable download extension',async()=>{
  const ui=setup();await ui.open(path+'face','얼굴 사진');assert.equal(ui.calls[0].url,path+'face');assert.equal(ui.calls[0].options.credentials,'same-origin');assert.equal(ui.calls[0].options.cache,'no-store');assert.equal(ui.calls[0].options.redirect,'error');assert.equal(ui.created.length,1);
  assert.equal(ui.nodes['admin-file-viewer'].open,true);assert.equal(ui.nodes['admin-file-image'].src,'blob:private-1');assert.equal(ui.nodes['admin-file-image'].hidden,false);assert.equal(ui.nodes['admin-file-pdf'].hidden,true);assert.equal(ui.nodes['admin-file-download'].href,'blob:private-1');assert.equal(ui.nodes['admin-file-download'].download,'얼굴 사진.png');
  ui.close();assert.deepEqual(ui.revoked,['blob:private-1']);assert.equal(ui.nodes['admin-file-image'].src,undefined);assert.equal(ui.nodes['admin-file-download'].href,undefined);assert.equal(ui.nodes['admin-file-viewer'].open,false);
});
test('employment PDFs use a document preview and download, while other slots reject PDF responses',async()=>{
  const fetcher=async()=>new Response('%PDF-1.4',{headers:{'Content-Type':'application/pdf'}}),ui=setup(fetcher);await ui.open(path+'employment','직업 확인 자료');assert.equal(ui.nodes['admin-file-pdf'].src,'blob:private-1');assert.equal(ui.nodes['admin-file-pdf'].hidden,false);assert.equal(ui.nodes['admin-file-image'].hidden,true);assert.equal(ui.nodes['admin-file-download'].download,'직업 확인 자료.pdf');
  const invalid=setup(fetcher);await invalid.open(path+'face','얼굴 사진');assert.equal(invalid.created.length,0);assert.equal(invalid.nodes['admin-file-image'].hidden,true);assert.match(invalid.nodes['admin-file-status'].textContent,/지원하는/);
});
test('expired login, denied access and HTML login responses stay in the dialog without opening or embedding private API URLs',async()=>{
  for(const status of [401,403,404]){
    const ui=setup(async()=>Response.json({error:'접근 권한을 확인해주세요.'},{status}));await ui.open(path+'fullbody','전신 사진');assert.equal(ui.created.length,0);assert.equal(ui.nodes['admin-file-download'].hidden,true);assert.equal(ui.nodes['admin-file-image'].src,undefined);assert.match(ui.nodes['admin-file-status'].textContent,status===401?/다시 로그인/:/접근 권한/);
  }
  const html=setup(async()=>new Response('<html>login</html>',{headers:{'Content-Type':'text/html'}}));await html.open(path+'employment','직업 확인 자료');assert.equal(html.created.length,0);assert.match(html.nodes['admin-file-status'].textContent,/지원하는/);
  const foreign=setup();await foreign.open('https://other.test/file','자료');assert.equal(foreign.calls.length,0);
});
test('closing or switching a preview while a download is pending cannot revive the old file',async()=>{
  let resolve;const ui=setup(()=>new Promise(done=>resolve=done));const pending=ui.open(path+'face','얼굴 사진');ui.close();assert.equal(ui.calls[0].options.signal.aborted,true);resolve(new Response(png,{headers:{'Content-Type':'image/png'}}));await pending;assert.equal(ui.created.length,0);assert.equal(ui.nodes['admin-file-viewer'].open,false);
  let finish;const switched=setup(url=>url.endsWith('/face')?new Promise(done=>finish=done):new Response(png,{headers:{'Content-Type':'image/png'}}));const first=switched.open(path+'face','얼굴 사진');await switched.open(path+'fullbody','전신 사진');finish(new Response(png,{headers:{'Content-Type':'image/png'}}));await first;assert.equal(switched.created.length,1);assert.equal(switched.nodes['admin-file-title'].textContent,'전신 사진');assert.equal(switched.nodes['admin-file-image'].src,'blob:private-1');switched.events.pagehide();assert.deepEqual(switched.revoked,['blob:private-1']);
});
