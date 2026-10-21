import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const html=await readFile(new URL('../web/application/index.html',import.meta.url),'utf8'),script=await readFile(new URL('../web/application-flow.js',import.meta.url),'utf8');
const token='a'.repeat(64),id='11111111-1111-4111-8111-111111111111';
const application={id,source:'frip',name:'테스트',event_date:'2026-10-24',start_time:'18:00',amount:1000,status:'draft',payment_status:'paid',member:false};
function setup({hash='#invite='+token,search='',account=null,item=application,error,failExchange=false,confirm=true,ready=Promise.resolve({})}={}){
  class Element{constructor(tag){this.tagName=tag.toUpperCase();this.hidden=false;this.disabled=false;this.events={};this.attributes={};}addEventListener(name,fn){this.events[name]=fn;}setAttribute(name,value){this.attributes[name]=value;}removeAttribute(name){delete this.attributes[name];}}
  const nodes=Object.fromEntries([...html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)].map(match=>{const node=new Element(match[1]);node.hidden=/\bhidden\b/.test(match[2]);return[match[3],node];}));
  const calls=[],navigations=[],history=[],stored=new Map(),confirmations=[];
  let fail=failExchange;
  const api=async(path,body)=>{calls.push({path,body});if(path==='/api/application/exchange'){if(fail){fail=false;throw new Error('연결을 다시 시도해주세요.');}return{exchanged:true,applicationId:id};}if(path.includes('/claim'))return{claimed:true};if(error)throw error;return{application:item,account};};
  vm.runInNewContext(script,{document:{getElementById:id=>nodes[id]},window:{OneulAPI:api,OneulReady:ready,location:{hash,search,pathname:'/application/',assign:path=>navigations.push(path)},history:{replaceState:(a,b,path)=>history.push(path)},confirm:message=>{confirmations.push(message);return confirm;}},URLSearchParams,sessionStorage:{setItem:(key,value)=>stored.set(key,value)}});
  return{nodes,calls,navigations,history,stored,confirmations,click:name=>nodes[name].events.click({preventDefault(){}}),flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
test('an invitation displays member/signup/guest choices before any exchange or application read',async()=>{
  const ui=setup();await ui.flush();assert.equal(ui.calls.length,0);assert.equal(ui.nodes['application-choose'].hidden,false);assert.equal(ui.nodes['application-content'].hidden,true);assert.deepEqual(ui.history,['/application/']);assert.equal(ui.stored.size,0);assert.match(ui.nodes['application-message'].textContent,/작성 방법/);
});
test('guest choice verifies the scoped session before profile navigation and never claims a logged-in account',async()=>{
  for(const account of [null,{email:'member@example.test'}]){
    const ui=setup({account});await ui.click('application-guest');assert.deepEqual(ui.calls.map(c=>c.path),['/api/application/exchange','/api/application']);assert.equal(ui.calls[0].body.inviteToken,token);assert.deepEqual(ui.navigations,['/profile/?application=1']);assert.equal(ui.stored.size,0);assert.ok(!ui.calls.some(c=>c.path.includes('/claim')));
  }
});
test('member and signup choice establish the application session before leaving, storing only the safe return route',async()=>{
  for(const [control,route] of [['application-member-login','/login/'],['application-signup','/join/']]){
    const ui=setup();await ui.click(control);assert.deepEqual(ui.calls.map(c=>c.path),['/api/application/exchange','/api/application']);assert.deepEqual(ui.navigations,[route]);assert.deepEqual([...ui.stored.values()],['/application/']);
  }
});
test('a member selection with an existing login requires separate claim consent',async()=>{
  const ui=setup({account:{email:'member@example.test'},confirm:false});await ui.click('application-member-login');assert.equal(ui.nodes['application-member'].hidden,false);assert.equal(ui.nodes['application-account'].textContent,'로그인한 계정: member@example.test');assert.equal(ui.navigations.length,0);await ui.click('application-claim');assert.ok(!ui.calls.some(c=>c.path.includes('/claim')));
  const allowed=setup({account:{email:'member@example.test'}});await allowed.click('application-member-login');await allowed.click('application-claim');assert.equal(allowed.calls.at(-1).body.claimConsent,true);assert.deepEqual(allowed.navigations,['/profile/?application=1']);
});
test('an exchange can be retried after a network failure and repeated taps cause only one exchange',async()=>{
  const ui=setup({failExchange:true});await ui.click('application-guest');assert.equal(ui.navigations.length,0);assert.match(ui.nodes['application-error'].textContent,/다시/);assert.equal(ui.nodes['application-guest'].disabled,false);await ui.click('application-guest');assert.equal(ui.calls.filter(c=>c.path.endsWith('/exchange')).length,2);assert.deepEqual(ui.navigations,['/profile/?application=1']);
  let release;const ready=new Promise(resolve=>{release=resolve;});const duplicate=setup({ready});const first=duplicate.click('application-guest');await duplicate.click('application-guest');release({});await first;assert.equal(duplicate.calls.filter(c=>c.path.endsWith('/exchange')).length,1);
});
test('claimed applications require their member login and a rejected cookie read never navigates or stores a return route',async()=>{
  const error=Object.assign(new Error('회원 로그인 필요'),{code:'application_member_login'}),ui=setup({error});await ui.click('application-guest');assert.equal(ui.navigations.length,0);assert.equal(ui.nodes['application-login'].hidden,false);assert.match(ui.nodes['application-error'].textContent,/연결한 회원 계정/);await ui.click('application-login');assert.equal(ui.stored.get('oneul-application-return'),'/application/');
  const failed=setup({error:new Error('작성 링크를 열어주세요.')});await failed.click('application-signup');assert.equal(failed.navigations.length,0);assert.equal(failed.stored.size,0);
});
test('reopening a submitted or confirmed application preserves its status and does not claim or submit it',async()=>{
  const submitted=setup({item:{...application,status:'submitted'}});await submitted.click('application-guest');assert.equal(submitted.nodes['application-status'].textContent,'프로필 확인 중');assert.equal(submitted.calls.length,2);assert.deepEqual(submitted.navigations,['/profile/?application=1']);
  const confirmed=setup({item:{...application,status:'confirmed',venue:'서울',instructions:'준비물 안내'}});await confirmed.click('application-guest');assert.equal(confirmed.nodes['application-confirmed'].hidden,false);assert.equal(confirmed.nodes['application-choose'].hidden,true);assert.equal(confirmed.navigations.length,0);assert.match(confirmed.nodes['application-message'].textContent,/확정/);
});
test('returning without a fragment uses the existing scoped session and supports member application routes',async()=>{
  const ui=setup({hash:'',search:'?id='+id,item:{...application,member:true},account:{email:'member@example.test'}});await ui.flush();assert.deepEqual(ui.calls.map(c=>c.path),['/api/application?id='+id]);assert.equal(ui.nodes['application-profile'].href,'/profile/?application='+id);assert.equal(ui.nodes['application-profile'].hidden,false);
});
