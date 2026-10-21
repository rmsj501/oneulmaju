import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const html=await readFile(new URL('../web/auth/confirm/index.html',import.meta.url),'utf8');
const script=await readFile(new URL('../web/auth-flow.js',import.meta.url),'utf8');
function setup(hash,{importResult={next:'/verify-phone/'},importError,inspectError,sessionError}={}){
  const nodes={};
  for(const [,id]of html.matchAll(/\bid="([^"]+)"/g))nodes[id]={textContent:'',value:'',disabled:false,hidden:false,children:[],append(...items){this.children.push(...items);},events:{},addEventListener(name,fn){this.events[name]=fn;},reportValidity(){return true;}};
  nodes['password-reset-form'].hidden=true;
  const consent={checked:true};
  nodes['password-reset-form'].elements={namedItem:name=>name==='recoveryConsent'?consent:nodes[name==='password'?'new-password':'new-password-confirm']};
  const calls=[],historyCalls=[],redirects=[];
  const context={document:{getElementById:id=>nodes[id],createElement:tag=>({tag})},window:{location:{hash,pathname:'/auth/confirm/',replace:path=>redirects.push(path)}},history:{replaceState:(_state,_title,path)=>historyCalls.push(path)},URLSearchParams,sessionStorage:{setItem(){},removeItem(){}},fetch:async(path,options)=>{
    calls.push({path,body:options.body&&JSON.parse(options.body)});
    const data=path==='/api/status'?{accountsReady:true,phoneReady:false}:path==='/api/auth/me'?(sessionError?{error:sessionError}:{user:{id:'confirmed-user'}}):path==='/api/auth/import-session'?(importError?{error:importError}:importResult):path==='/api/auth/recovery/inspect'?(inspectError?{error:inspectError}:{passwordResetReady:true,email:'test@example.test'}):path==='/api/auth/password'?{updated:true,next:'/verify-phone/'}:{error:'recovery required'};
    return new Response(JSON.stringify(data),{status:path==='/api/auth/me'&&sessionError?401:path==='/api/auth/recovery/status'||(path==='/api/auth/import-session'&&importError)||(path==='/api/auth/recovery/inspect'&&inspectError)?403:200});
  }};
  vm.runInNewContext(script,context);
  return {nodes,calls,historyCalls,redirects,flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
test('an expired link removes secret URL fragments and offers recovery in Korean without retrying a spent token',async()=>{
  const ui=setup('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');await ui.flush();
  assert.deepEqual(ui.historyCalls,['/auth/confirm/']);
  assert.match(ui.nodes['confirmation-status'].textContent,/이미 사용/);assert.match(ui.nodes['confirmation-status'].textContent,/회원 로그인/);
  assert.ok(!ui.nodes['confirmation-status'].textContent.includes('Email link'));
  assert.equal(ui.calls.filter(c=>c.path==='/api/auth/import-session').length,0);
  for(const route of ['/login/','/auth/resend/','/forgot-password/'])assert.ok(html.includes('href="'+route+'"'));
});
test('a fresh signup callback imports its session once and follows the server-confirmed next step',async()=>{
  const ui=setup('#type=signup&refresh_token=private-refresh&access_token=private-access');await ui.flush();
  const imports=ui.calls.filter(c=>c.path==='/api/auth/import-session');assert.equal(imports.length,1);
  assert.deepEqual(imports[0].body,{refresh_token:'private-refresh'});assert.deepEqual(ui.redirects,['/verify-phone/']);
  assert.deepEqual(ui.historyCalls,['/auth/confirm/']);
  assert.ok(Object.values(ui.nodes).every(n=>!n.textContent.includes('private-')));
});
test('recovery needs a server-approved session before exposing the password form, and clears submitted passwords',async()=>{
  const ui=setup('#type=recovery&refresh_token=private-refresh&access_token=private-access');await ui.flush();
  assert.deepEqual(ui.calls.find(c=>c.path==='/api/auth/recovery/inspect').body,{access_token:'private-access'});
  assert.equal(ui.calls.filter(c=>c.path==='/api/auth/import-session').length,0);
  assert.equal(ui.nodes['recovery-email'].textContent,'test@example.test');
  assert.equal(ui.nodes['password-reset-form'].hidden,false);assert.equal(ui.nodes['confirmation-actions'].hidden,true);
  ui.nodes['new-password'].value='new-long-password';ui.nodes['new-password-confirm'].value='different-password';
  await ui.nodes['password-reset-form'].events.submit({preventDefault(){}});
  assert.equal(ui.calls.filter(c=>c.path==='/api/auth/password').length,0);
  ui.nodes['new-password-confirm'].value='new-long-password';
  await ui.nodes['password-reset-form'].events.submit({preventDefault(){}});
  assert.deepEqual(ui.calls.find(c=>c.path==='/api/auth/password').body,{password:'new-long-password',access_token:'private-access',refresh_token:'private-refresh',email:'test@example.test',recoveryConsent:true});
  assert.equal(ui.nodes['new-password'].value,'');assert.equal(ui.nodes['new-password-confirm'].value,'');
  assert.deepEqual(ui.redirects,['/verify-phone/']);
});
test('a provider-rejected recovery token stays on the recovery guidance screen without enabling password entry',async()=>{
  const ui=setup('#type=recovery&refresh_token=private-refresh&access_token=invalid-access',{inspectError:'새 재설정 메일을 받아주세요.'});await ui.flush();
  assert.equal(ui.nodes['password-reset-form'].hidden,true);assert.deepEqual(ui.redirects,[]);
  assert.match(ui.nodes['confirmation-status'].textContent,/새 재설정 메일/);
});
test('login and signup waiting screens provide password recovery rather than encouraging repeated registration',async()=>{
  for(const route of ['login','join']){
    const page=await readFile(new URL('../web/'+route+'/index.html',import.meta.url),'utf8');
    assert.ok(page.includes('href="/forgot-password/"'));assert.ok(page.includes('href="/auth/resend/"'));
  }
});
test('a callback with blocked session cookies offers a new window instead of returning to the login loop',async()=>{
  const ui=setup('#type=signup&refresh_token=private-refresh&access_token=private-access',{sessionError:'로그인이 필요해요.'});await ui.flush();
  assert.deepEqual(ui.redirects,[]);assert.equal(ui.calls.filter(c=>c.path==='/api/auth/me').length,1);
  assert.match(ui.nodes['confirmation-status'].textContent,/로그인이 유지되지/);
  const link=ui.nodes['confirmation-status'].children.find(node=>node.tag==='a');
  assert.equal(link.href,'/login/');assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener');
});
test('password reset completes but a blocked browser session does not silently redirect into a login loop',async()=>{
  const ui=setup('#type=recovery&refresh_token=private-refresh&access_token=private-access',{sessionError:'로그인이 필요해요.'});await ui.flush();
  ui.nodes['new-password'].value='new-long-password';ui.nodes['new-password-confirm'].value='new-long-password';
  await ui.nodes['password-reset-form'].events.submit({preventDefault(){}});
  assert.deepEqual(ui.redirects,[]);assert.match(ui.nodes['password-reset-error'].textContent,/로그인이 유지되지/);
  assert.equal(ui.nodes['new-password'].value,'');assert.equal(ui.nodes['save-password'].disabled,false);
});
