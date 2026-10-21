import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const html=await readFile(new URL('../web/profile/index.html',import.meta.url),'utf8');
const script=await readFile(new URL('../web/profile-flow.js',import.meta.url),'utf8');
function setup({search='',status={accountsReady:false},previewDraft,user,screenDraft,application,apiHandler}={}){
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]),nodes={};
  class Element{
    constructor(){this.value='';this.hidden=false;this.disabled=false;this.required=false;this.type='text';this.children=[];this.events={};this.classList={toggle(){}};}
    addEventListener(name,handler){this.events[name]=handler;}setAttribute(){}removeAttribute(){}focus(){}scrollIntoView(){}replaceChildren(){this.children=[];}append(...items){this.children.push(...items);}checkValidity(){return !this.required||!!this.value;}reportValidity(){return this.checkValidity();}
  }
  for(const id of ids)nodes[id]=new Element();
  const next=[...html.matchAll(/data-next="(\d+)"/g)].map(match=>Object.assign(new Element(),{dataset:{next:match[1]}}));
  const back=[...html.matchAll(/data-back="(\d+)"/g)].map(match=>Object.assign(new Element(),{dataset:{back:match[1]}}));
  const form=nodes['profile-form'];form.elements={namedItem:name=>nodes[name]};form.querySelectorAll=selector=>selector==='[data-next]'?next:selector==='[data-back]'?back:[];
  const steps=[...html.matchAll(/class="profile-step" data-step="\d+"/g)].map(()=>new Element());for(const step of steps){step.querySelector=()=>new Element();step.querySelectorAll=()=>[];}
  const labels=steps.map(()=>new Element());
  const document={getElementById:id=>nodes[id],createElement:()=>new Element(),querySelectorAll:selector=>selector==='[data-step]'?steps:labels};
  const stored=new Map([['oneulmaju-profile-screen-draft',JSON.stringify({ownerId:'another-account',name:'타인 이름'})]]);
  if(previewDraft)stored.set('oneulmaju-profile-preview-draft',JSON.stringify(previewDraft));
  if(screenDraft)stored.set('oneulmaju-profile-screen-draft',JSON.stringify(screenDraft));
  let fetches=0;const redirects=[];
  const context={document,window:{OneulReady:Promise.resolve(status),OneulAPI:async(path,body,method)=>{fetches++;if(apiHandler)return apiHandler(path,body,method);if(application&&path.startsWith('/api/application'))return{application};if(user&&path==='/api/auth/me')return {user};throw new Error('must not authenticate');},location:{search,replace:path=>redirects.push(path)}},sessionStorage:{getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value)},FormData:class{constructor(){this.get=name=>nodes[name]?.value;}},URL:{createObjectURL:()=> 'blob:local-preview',revokeObjectURL(){}},URLSearchParams,Intl,Date,JSON,fetch:()=>{fetches++;throw new Error('must not upload');}};
  vm.runInNewContext(script,context);return {nodes,stored,steps,next,back,redirects,flush:()=>new Promise(resolve=>setImmediate(resolve)),fetches:()=>fetches};
}
test('a platform guest opens only its application without Auth login, with separate retention and no reusable card',async()=>{
  const application={id:'11111111-1111-4111-8111-111111111111',name:'신청자',phone:'+821012345678',gender:'여성',member:false,status:'draft',payment_status:'paid',event_date:'2026-10-24',start_time:'14:00'};
  const ui=setup({search:'?application=1',status:{accountsReady:true},application});await ui.flush();
  assert.deepEqual(ui.redirects,[]);assert.equal(ui.fetches(),1);assert.equal(ui.nodes['save-profile'].disabled,false);assert.equal(ui.nodes['profile-mode'].textContent,'비회원 참가 프로필');assert.equal(ui.nodes['application-keep-wrap'].hidden,true);assert.equal(ui.nodes['delete-profile'].hidden,true);assert.equal(ui.nodes.phone.readOnly,true);assert.match(ui.nodes['draft-note'].textContent,/30일/);assert.equal(ui.nodes.name.value,'신청자');
});
test('a confirmed application keeps profile editing disabled instead of changing a reviewed submission',async()=>{
  const application={id:'11111111-1111-4111-8111-111111111111',status:'confirmed',payment_status:'paid'};
  const ui=setup({search:'?application=1',status:{accountsReady:true},application});await ui.flush();assert.equal(ui.nodes['save-profile'].disabled,true);assert.match(ui.nodes['profile-error'].textContent,/수정할 수 없어요/);
});
test('removed questions are absent; each upload has an accessible input, preview and status',()=>{
  for(const field of ['education','salary','marriage','intro','religion','smoking','drinking'])assert.ok(!new RegExp('name="'+field+'"').test(html));
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);assert.equal(new Set(ids).size,ids.length);
  for(const slot of ['face','fullbody','employment'])for(const suffix of ['file','preview','status','remove','view'])assert.ok(ids.includes(slot+'-'+suffix));
  const options=[...html.matchAll(/<select id="district"[^>]*>(.*?)<\/select>/gs)][0][1];assert.equal([...options.matchAll(/<option value="[^"]+"/g)].length,25);
});
test('a guest reviews and saves directly after basic information; old lifestyle values cannot return through a saved submission',async()=>{
  const id='11111111-1111-4111-8111-111111111111',file='22222222-2222-4222-8222-222222222222.png';
  const application={id,name:'신청자',phone:'+821012345678',gender:'여성',member:false,status:'changes_requested',payment_status:'paid',event_date:'2026-10-24',start_time:'14:00',profile:{name:'신청자',birth:'1994-05-20',height:155,region:'서울',district:'송파구',job:'회사원',religion:'무교',smoking:'비흡연',drinking:'가끔 마셔요',sensitive_consent_at:'2026-10-07',face_path:id+'/face/'+file,fullbody_path:id+'/fullbody/'+file,employment_path:id+'/employment/'+file}};
  let submitted;
  const ui=setup({search:'?application=1',status:{accountsReady:true},apiHandler:(path,body,method)=>{if(method==='PUT'){submitted=body;return{saved:true,profile:{}};}return{application};}});await ui.flush();
  assert.equal(ui.steps.length,2);assert.equal(ui.next.length,1);assert.equal(ui.next[0].dataset.next,'1');assert.equal(ui.back[0].dataset.back,'0');
  assert.equal(ui.nodes.job.value,'회사원');
  ui.nodes.job.value='';ui.next[0].events.click();assert.match(ui.nodes['profile-error'].textContent,/직업/);
  ui.nodes.job.value='세무대리인';ui.next[0].events.click();assert.equal(ui.steps[0].hidden,true);assert.equal(ui.steps[1].hidden,false);assert.match(ui.nodes['card-subtitle'].textContent,/세무대리인/);
  ui.back[0].events.click();assert.equal(ui.steps[0].hidden,false);assert.equal(ui.steps[1].hidden,true);
  for(const consent of ['privacy-consent','photo-consent','employment-consent'])ui.nodes[consent].checked=true;
  await ui.nodes['save-profile'].events.click();
  assert.equal(submitted.job,'세무대리인');assert.equal(submitted.gender,'여성');assert.equal(submitted.privacyConsent,true);assert.equal(submitted.attachments.employment,id+'/employment/'+file);
  for(const field of ['religion','smoking','drinking','sensitiveConsent','sensitive_consent_at'])assert.equal(field in submitted,false);
  const stored=JSON.parse(ui.stored.get('oneulmaju-application-draft-'+id));for(const field of ['religion','smoking','drinking','sensitive_consent_at'])assert.equal(field in stored,false);
  assert.match(ui.nodes['save-status'].textContent,/프로필을 제출했어요/);assert.equal(ui.steps[1].hidden,false);
});
test('only Seoul exposes and requires district; switching regions clears the old district',async()=>{
  const ui=setup();await ui.flush();const n=ui.nodes;
  n.region.value='서울';n.region.events.change();assert.equal(n['district-field'].hidden,false);assert.equal(n.district.required,true);assert.equal(n.district.disabled,false);
  n.district.value='강남구';n.region.value='경기';n.region.events.change();assert.equal(n['district-field'].hidden,true);assert.equal(n.district.required,false);assert.equal(n.district.disabled,true);assert.equal(n.district.value,'');
});
test('choosing images gives only a local preview until final save; invalid file types are rejected',async()=>{
  const ui=setup();await ui.flush();const n=ui.nodes;
  n['face-file'].files=[{name:'face.jpg',type:'image/jpeg',size:100}];n['face-file'].events.change();assert.equal(n['face-preview'].src,'blob:local-preview');assert.equal(n['face-preview'].hidden,false);assert.match(n['face-status'].textContent,/저장 시 업로드/);assert.equal(ui.fetches(),0);
  n['face-file'].files=[{name:'bad.pdf',type:'application/pdf',size:100}];n['face-file'].events.change();assert.match(n['face-status'].textContent,/파일을 선택/);assert.equal(n['face-preview'].hidden,true);assert.equal(n['save-profile'].disabled,true);
});
test('an unconfigured screen does not display another account draft as a saved profile',async()=>{
  const ui=setup();await ui.flush();assert.equal(ui.nodes.name.value,'');assert.equal(ui.nodes['save-profile'].disabled,true);assert.equal(ui.nodes['delete-profile'].disabled,true);assert.match(ui.nodes['save-status'].textContent,/아직 전송되지/);
});
test('signup, login and SMS pages keep a visible preview entry without account configuration',async()=>{
  for(const route of ['join','login','guest','verify-phone']){
    const page=await readFile(new URL('../web/'+route+'/index.html',import.meta.url),'utf8');
    assert.match(page,/<a class="button secondary full" href="\/profile\/\?preview=1">가입 없이 프로필 작성 화면 미리보기<\/a>/);
  }
});
test('explicit preview uses only its own draft even with configured authentication',async()=>{
  const ui=setup({search:'?preview=1',status:{accountsReady:true,phoneReady:true,profilesReady:true,uploadsReady:true},previewDraft:{name:'미리보기 이름',region:'서울',district:'송파구'}});await ui.flush();
  assert.equal(ui.nodes.name.value,'미리보기 이름');assert.equal(ui.nodes.district.value,'송파구');assert.equal(ui.fetches(),0);assert.equal(ui.nodes['save-profile'].disabled,true);assert.equal(ui.nodes.logout.hidden,true);assert.equal(ui.nodes['delete-profile'].hidden,true);
  ui.nodes.name.value='수정한 미리보기';ui.nodes['profile-form'].events.input({target:{type:'text'}});
  assert.equal(JSON.parse(ui.stored.get('oneulmaju-profile-preview-draft')).name,'수정한 미리보기');
  assert.equal(JSON.parse(ui.stored.get('oneulmaju-profile-screen-draft')).name,'타인 이름');
  await ui.nodes['save-profile'].events.click();assert.equal(ui.fetches(),0);
});
test('email-only testing opens the profile and keeps an editable unverified contact in its own draft',async()=>{
  const user={id:'email-owner',mode:'member',name:'마주',emailVerified:true,phoneVerified:false,phone:''};
  const status={accountsReady:true,phoneRequired:false,phoneReady:false,profilesReady:false,uploadsReady:false};
  const ui=setup({user,status,screenDraft:{ownerId:user.id,name:'마주',phone:'01099999999'}});await ui.flush();
  assert.deepEqual(ui.redirects,[]);assert.equal(ui.nodes.phone.value,'01099999999');assert.equal(ui.nodes.phone.readOnly,false);
  assert.match(ui.nodes['phone-note'].textContent,/아직 완료되지/);
  ui.nodes.phone.value='01012345678';ui.nodes['profile-form'].events.input({target:{type:'text'}});
  assert.equal(JSON.parse(ui.stored.get('oneulmaju-profile-screen-draft')).phone,'01012345678');
  assert.equal(ui.nodes['save-profile'].disabled,true);
  const production=setup({user,status:{...status,phoneRequired:true}});await production.flush();
  assert.deepEqual(production.redirects,['/verify-phone/']);
  const unconfirmed=setup({user:{...user,emailVerified:false},status});await unconfirmed.flush();
  assert.deepEqual(unconfirmed.redirects,['/verify-phone/']);
});
