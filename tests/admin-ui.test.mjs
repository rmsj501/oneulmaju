import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const html=await readFile(new URL('../web/admin/index.html',import.meta.url),'utf8'),script=await readFile(new URL('../web/admin-flow.js',import.meta.url),'utf8');
const item={id:'11111111-1111-4111-8111-111111111111',source:'frip',name:'테스트',external_order_no:'1234',gender:'여성',event_date:'2026-10-24',start_time:'18:00',phone:'+821000000000',status:'draft',amount:1000,deletable:true,updated_at:'2026-10-07T08:55:27.695159+00:00'};
function setup({confirm=true,failDelete=false,deletable=true,profile=null,memo=null,status='draft',venue='',failReview=false,failNotice=false,noticeGate,noticeSentAt=null,badNotice=false}={}){
  class Element{constructor(tag='div'){this.tagName=tag.toUpperCase();this.value='';this.hidden=false;this.disabled=false;this.children=[];this.events={};this.scrolls=0;this.focuses=0;}addEventListener(name,fn){this.events[name]=fn;}replaceChildren(){this.children=[];}append(...nodes){this.children.push(...nodes);}scrollIntoView(){this.scrolls++;}focus(){this.focuses++;}select(){}}
  const nodes=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>[match[1],new Element()]));nodes['admin-filter'].value='all';nodes['admin-detail'].hidden=true;nodes['admin-invite'].hidden=true;
  let items=[{...item,deletable,profile,memo,status,venue,notice_sent_at:noticeSentAt,notice_text:noticeSentAt?'실제로 보낸 안내 문자':'',submitted_at:'2026-10-08T03:00:00Z'}],calls=[],confirmations=[],files=[],closed=0;
  const api=async(path,body,method)=>{calls.push({path,body,method});if(path==='/api/admin/status')return{admin:true,email:'operator@example.test'};if(method==='DELETE'){if(failDelete)throw new Error('신청 내용이 변경됐어요.');items=[];return{deleted:true,applicationId:item.id,cleanupQueued:false};}if(path.endsWith('/review')){if(failReview)throw new Error('검토 중 프로필이 변경됐어요.');items[0]={...items[0],status:body.decision,instructions:body.instructions};return{updated:true};}if(path.endsWith('/notice')){await noticeGate;if(failNotice)throw new Error('신청 내용이 변경됐어요. 새로고침해주세요.');if(badNotice)return{recorded:true};const stamp='2026-10-08T04:00:00Z';items[0]={...items[0],notice_sent_at:stamp,notice_text:body.message,updated_at:stamp};return{recorded:true,applicationId:item.id,noticeSentAt:stamp,noticeText:body.message,updatedAt:stamp};}return{applications:items};};
  vm.runInNewContext(script,{document:{getElementById:id=>nodes[id],createElement:tag=>new Element(tag)},window:{OneulAPI:api,OneulReady:Promise.resolve({}),OneulAdminFile:{open:(path,label)=>files.push({path,label}),close:()=>closed++},location:{origin:'https://test.site'},confirm:message=>{confirmations.push(message);return confirm;}},navigator:{clipboard:{writeText:async()=>{}}},Intl,Date,Number,FormData:class{}});
  return{nodes,calls,confirmations,files,get closed(){return closed;},flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
test('operator list deletion confirms the exact order, clears its selected detail and never leaves a copied invite visible',async()=>{
  const ui=setup();await ui.flush();const card=ui.nodes['admin-applications'].children[0],actions=card.children.at(-1);actions.children[0].events.click();assert.equal(ui.nodes['admin-detail'].hidden,false);
  ui.nodes['admin-invite'].hidden=false;ui.nodes['admin-invite-text'].value='private-invite';
  await actions.children[1].events.click();const call=ui.calls.find(call=>call.method==='DELETE');assert.equal(call.path,'/api/admin/applications/'+item.id);assert.equal(call.body.confirmOrderNo,'1234');assert.equal(call.body.expectedUpdatedAt,item.updated_at);assert.match(ui.confirmations[0],/1234/);assert.match(ui.confirmations[0],/테스트/);assert.match(ui.confirmations[0],/복구할 수 없/);
  assert.equal(ui.nodes['admin-detail'].hidden,true);assert.equal(ui.nodes['admin-invite'].hidden,true);assert.equal(ui.nodes['admin-invite-text'].value,'');assert.match(ui.nodes['admin-message'].textContent,/신청을 삭제/);
});
const openDetail=ui=>ui.nodes['admin-applications'].children[0].children.at(-1).children[0].events.click();
test('both close controls clear private detail, return focus to the list and keep it closed after refresh',async()=>{
  for(const button of ['admin-detail-close','admin-back-list']){
    const ui=setup({status:'confirmed',profile:{name:'테스트',face_path:'private/face.png'}});await ui.flush();openDetail(ui);ui.nodes['admin-filter'].value='confirmed';ui.nodes[button].events.click();
    assert.equal(ui.nodes['admin-detail'].hidden,true);assert.equal(ui.nodes['admin-detail-profile'].children.length,0);assert.equal(ui.nodes['admin-detail-files'].children.length,0);assert.equal(ui.nodes['admin-notice-text'].value,'');assert.equal(ui.nodes['admin-filter'].value,'confirmed');assert.equal(ui.nodes['admin-list-title'].focuses,1);assert.equal(ui.nodes['admin-list-title'].scrolls,1);
    await ui.nodes['admin-refresh'].events.click();assert.equal(ui.nodes['admin-detail'].hidden,true);assert.equal(ui.nodes['admin-applications'].children.length,1);assert.ok(ui.closed>=2);
  }
});
test('notice confirmation is visible inside the page even when browser modal confirmation is unavailable',async()=>{
  const ui=setup({confirm:false,status:'confirmed',profile:{name:'테스트'}});await ui.flush();openDetail(ui);ui.nodes['admin-notice-sent'].events.click();
  assert.equal(ui.nodes['admin-notice-confirm'].hidden,false);assert.equal(ui.nodes['admin-notice-sent'].hidden,true);assert.match(ui.nodes['admin-notice-status'].textContent,/실제로 발송/);assert.equal(ui.nodes['admin-notice-save'].focuses,1);assert.equal(ui.confirmations.length,0);assert.ok(!ui.calls.some(c=>c.path.endsWith('/notice')));
  ui.nodes['admin-notice-cancel'].events.click();assert.equal(ui.nodes['admin-notice-confirm'].hidden,true);assert.equal(ui.nodes['admin-notice-sent'].disabled,false);assert.ok(!ui.calls.some(c=>c.path.endsWith('/notice')));
});
test('notice save prevents duplicates while pending, shows the server timestamp in place and survives refresh',async()=>{
  let release;const noticeGate=new Promise(resolve=>release=resolve),ui=setup({status:'confirmed',profile:{name:'테스트'},noticeGate});await ui.flush();openDetail(ui);const scrolls=ui.nodes['admin-detail'].scrolls;
  ui.nodes['admin-notice-sent'].events.click();const saving=ui.nodes['admin-notice-save'].events.click();assert.match(ui.nodes['admin-notice-sent'].textContent,/저장 중/);assert.equal(ui.nodes['admin-notice-sent'].disabled,true);assert.equal(ui.nodes['admin-notice-save'].disabled,true);
  await ui.nodes['admin-notice-save'].events.click();assert.equal(ui.calls.filter(c=>c.path.endsWith('/notice')).length,1);release();await saving;
  const call=ui.calls.find(c=>c.path.endsWith('/notice'));assert.equal(call.body.sent,true);assert.equal(call.body.expectedUpdatedAt,item.updated_at);assert.match(call.body.message,/참가 확정/);assert.match(ui.nodes['admin-notice-status'].textContent,/발송 완료로 기록했어요/);assert.match(ui.nodes['admin-notice-status'].textContent,/2026/);assert.equal(ui.nodes['admin-detail'].scrolls,scrolls);assert.equal(ui.nodes['admin-notice-sent'].textContent,'발송 완료 기록됨');assert.equal(ui.nodes['admin-notice-sent'].disabled,true);
  await ui.nodes['admin-refresh'].events.click();assert.equal(ui.nodes['admin-notice-sent'].disabled,true);assert.equal(ui.nodes['admin-detail'].scrolls,scrolls);assert.equal(ui.nodes['admin-notice-text'].value,call.body.message);assert.match(html,/id="admin-notice-status" role="status" aria-live="polite"/);
});
test('notice failures and incomplete receipts show feedback beside the button and allow a retry',async()=>{
  for(const options of [{failNotice:true},{badNotice:true}]){
    const ui=setup({...options,status:'confirmed',profile:{name:'테스트'}});await ui.flush();openDetail(ui);ui.nodes['admin-notice-sent'].events.click();await ui.nodes['admin-notice-save'].events.click();
    assert.match(ui.nodes['admin-notice-status'].textContent,/변경됐어요|기록을 확인하지 못했어요/);assert.equal(ui.nodes['admin-notice-sent'].disabled,false);assert.equal(ui.nodes['admin-notice-sent'].textContent,'실제 발송 완료로 기록');assert.equal(ui.nodes['admin-detail-status'].textContent,'');assert.equal(ui.nodes['admin-detail'].scrolls,1);
  }
});
test('closing a detail during notice saving does not reopen it when the request finishes',async()=>{
  let release;const noticeGate=new Promise(resolve=>release=resolve),ui=setup({status:'confirmed',profile:{name:'테스트'},noticeGate});await ui.flush();openDetail(ui);ui.nodes['admin-notice-sent'].events.click();const saving=ui.nodes['admin-notice-save'].events.click();ui.nodes['admin-back-list'].events.click();release();await saving;
  assert.equal(ui.nodes['admin-detail'].hidden,true);assert.equal(ui.nodes['admin-notice-text'].value,'');assert.match(ui.nodes['admin-message'].textContent,/발송 완료 기록을 저장/);await ui.nodes['admin-refresh'].events.click();assert.equal(ui.nodes['admin-detail'].hidden,true);
});
test('an existing notice displays its stored text and time and cannot be recorded again',async()=>{
  const ui=setup({status:'confirmed',profile:{name:'테스트'},noticeSentAt:'2026-10-08T04:00:00Z'});await ui.flush();openDetail(ui);assert.equal(ui.nodes['admin-notice-text'].value,'실제로 보낸 안내 문자');assert.equal(ui.nodes['admin-notice-sent'].disabled,true);ui.nodes['admin-notice-sent'].events.click();await ui.nodes['admin-notice-save'].events.click();assert.ok(!ui.calls.some(c=>c.path.endsWith('/notice')));
});
test('canceling confirmation sends no request; rejected deletion retains the application and shows the error',async()=>{
  const canceled=setup({confirm:false});await canceled.flush();await canceled.nodes['admin-applications'].children[0].children.at(-1).children[1].events.click();assert.ok(!canceled.calls.some(call=>call.method==='DELETE'));
  const failed=setup({failDelete:true});await failed.flush();await failed.nodes['admin-applications'].children[0].children.at(-1).children[1].events.click();assert.equal(failed.nodes['admin-applications'].children.length,1);assert.match(failed.nodes['admin-message'].textContent,/변경됐어요/);
});
test('a protected website payment has no list or detail delete control',async()=>{
  const ui=setup({deletable:false});await ui.flush();const actions=ui.nodes['admin-applications'].children[0].children.at(-1);assert.equal(actions.children.length,1);actions.children[0].events.click();assert.equal(ui.nodes['admin-delete'].hidden,true);
});
test('all three private attachments use the in-frame viewer instead of API navigation in a new tab',async()=>{
  const ui=setup({profile:{face_path:'private/face.png',fullbody_path:'private/fullbody.png',employment_path:'private/employment.pdf'}});await ui.flush();ui.nodes['admin-applications'].children[0].children.at(-1).children[0].events.click();
  const buttons=ui.nodes['admin-detail-files'].children;assert.equal(buttons.length,3);
  for(const button of buttons){assert.equal(button.tagName,'BUTTON');assert.equal(button.target,undefined);assert.equal(button.href,undefined);button.events.click();}
  assert.deepEqual(ui.files,[{path:'/api/admin/applications/'+item.id+'/file/face',label:'얼굴 사진'},{path:'/api/admin/applications/'+item.id+'/file/fullbody',label:'전신 사진'},{path:'/api/admin/applications/'+item.id+'/file/employment',label:'직업 확인 자료'}]);
  await ui.nodes['admin-applications'].children[0].children.at(-1).children[1].events.click();assert.ok(ui.closed>=2);
});
test('a submitted profile can be confirmed without a venue field, preserving guidance and omitting a blank place from the notice',async()=>{
  assert.doesNotMatch(html,/id="admin-venue"/);
  const ui=setup({status:'submitted',profile:{name:'테스트'}});await ui.flush();ui.nodes['admin-applications'].children[0].children.at(-1).children[0].events.click();assert.equal(ui.nodes['admin-confirm'].disabled,false);
  ui.nodes['admin-instructions'].value='신분증과 휴대폰을 준비해주세요.';await ui.nodes['admin-confirm'].events.click();
  const call=ui.calls.find(c=>c.path.endsWith('/review'));assert.equal(call.body.decision,'confirmed');assert.equal(call.body.expectedSubmittedAt,'2026-10-08T03:00:00Z');assert.equal(call.body.instructions,'신분증과 휴대폰을 준비해주세요.');assert.equal('venue' in call.body,false);assert.equal(ui.nodes['admin-notice'].hidden,false);assert.match(ui.nodes['admin-notice-text'].value,/참가가 확정/);assert.doesNotMatch(ui.nodes['admin-notice-text'].value,/장소:/);
});
test('unsubmitted profiles stay disabled, stale review errors show no confirmation, and existing venue text remains in the notice',async()=>{
  const draft=setup();await draft.flush();draft.nodes['admin-applications'].children[0].children.at(-1).children[0].events.click();assert.equal(draft.nodes['admin-confirm'].disabled,true);
  const rejected=setup({status:'submitted',profile:{name:'테스트'},failReview:true});await rejected.flush();rejected.nodes['admin-applications'].children[0].children.at(-1).children[0].events.click();await rejected.nodes['admin-confirm'].events.click();assert.match(rejected.nodes['admin-detail-status'].textContent,/프로필이 변경/);assert.equal(rejected.nodes['admin-notice'].hidden,true);
  const existing=setup({status:'submitted',profile:{name:'테스트'},venue:'기존 모임 장소'});await existing.flush();existing.nodes['admin-applications'].children[0].children.at(-1).children[0].events.click();await existing.nodes['admin-confirm'].events.click();assert.match(existing.nodes['admin-notice-text'].value,/장소: 기존 모임 장소/);
});
test('compact individual rows use saved profile and matching state, retain date context and open the same detail',async()=>{
 const ui=setup({status:'confirmed',profile:{height:180,job:'<img src=x>',mbti:'ENTJ'},memo:{participantNumber:1,submittedAt:'2026-10-20T08:00:00Z'}});await ui.flush();const card=ui.nodes['admin-applications'].children[0],open=card.children.at(-1).children[0];assert.equal(card.children[0].textContent,'2026-10-24 18:00');assert.equal(open.children[0].children[0].textContent,'여성 1호');assert.equal(open.children[1].textContent,'180cm · <img src=x> · ENTJ');assert.equal(open.children[1].children.length,0);assert.equal(open.children[2].children[1].textContent,'매칭 제출');open.events.click();assert.match(ui.nodes['admin-detail-title'].textContent,/테스트/);
 const unissued=setup({memo:{participantNumber:null,submittedAt:null}});await unissued.flush();assert.equal(unissued.nodes['admin-applications'].children[0].children.at(-1).children[0].children[2].children[1].textContent,'매칭 미제출');
});
