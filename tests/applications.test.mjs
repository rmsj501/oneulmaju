import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../worker/index.mjs';
import {createPlatformHandler,extensionFor} from '../supabase/functions/platform-api/index.mjs';
const original=globalThis.fetch;after(()=>{globalThis.fetch=original;});
const env={SITE_ORIGIN:'https://oneulmaju.rmsj501.chatgpt.site',SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'publishable',APPLICATIONS_ENABLED:'true',EMAIL_AUTH_ENABLED:'true'};
const id='11111111-1111-4111-8111-111111111111',session='b'.repeat(64),invite='a'.repeat(64);
const user={id,email:'owner@example.test',email_confirmed_at:'2026-10-07',user_metadata:{role:'admin'}};
const reply=(data,status=200)=>Response.json(data,{status});
const request=(path,method='GET',body,headers={})=>new Request(env.SITE_ORIGIN+path,{method,headers:{Origin:env.SITE_ORIGIN,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
test('guest invite exchange hides the capability in an HttpOnly partitioned cookie and never creates an Auth account',async()=>{
  const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return reply({exchanged:true,sessionToken:session,applicationId:id});};
  const result=await api(request('/api/application/exchange','POST',{inviteToken:invite}),env);
  assert.deepEqual(await result.json(),{exchanged:true,applicationId:id});assert.match(result.headers.get('Set-Cookie'),/__Host-oneul_application_p=.*Secure; HttpOnly; SameSite=None; Partitioned/);
  assert.equal(calls.length,1);assert.ok(calls[0].url.endsWith('/platform-api/exchange'));assert.equal(calls[0].options.headers.Authorization,undefined);
});
test('disabled applications, foreign writes and rejected invite exchanges do not claim connection',async()=>{
  let calls=0;globalThis.fetch=async()=>{calls++;return reply({error:'만료되거나 새로 발급된 링크예요.'},400);};
  assert.equal((await api(request('/api/application/exchange','POST',{inviteToken:invite}),{...env,APPLICATIONS_ENABLED:'false'})).status,503);
  assert.equal((await api(request('/api/application/exchange','POST',{inviteToken:invite},{Origin:'https://evil.test'}),env)).status,403);assert.equal(calls,0);
  const failed=await api(request('/api/application/exchange','POST',{inviteToken:invite}),env);assert.equal(failed.status,400);assert.equal(failed.headers.get('Set-Cookie'),null);
});
test('application reads forward only the verified user and scoped cookie; admin requires login',async()=>{
  const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return reply(url.endsWith('/auth/v1/user')?user:{application:{id}});};
  await api(request('/api/application?id='+id,'GET',undefined,{Cookie:'__Host-oneul_access_p=member; __Host-oneul_application_p='+session}),env);
  assert.equal(calls.at(-1).options.headers.Authorization,'Bearer member');assert.equal(calls.at(-1).options.headers['X-Oneul-Application-Session'],session);
  assert.ok(calls.at(-1).url.endsWith('/platform-api/application?id='+id));
  const before=calls.length;assert.equal((await api(request('/api/admin/applications'),env)).status,401);assert.equal(calls.length,before);
});
test('application download proxies bytes privately without returning the upstream capability',async()=>{
  globalThis.fetch=async()=>new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/png'}});
  const result=await api(request('/api/application/files/face','GET',undefined,{Cookie:'__Host-oneul_application_p='+session}),env);
  assert.equal(result.status,200);assert.deepEqual([...new Uint8Array(await result.arrayBuffer())],[1,2,3]);assert.equal(result.headers.get('Cache-Control'),'no-store');assert.match(result.headers.get('Content-Disposition'),/attachment/);
});
test('admin file preview forwards the current verified operator session and preserves private binary headers',async()=>{
  const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return url.endsWith('/auth/v1/user')?reply(user):new Response(new Uint8Array([137,80,78,71]),{headers:{'Content-Type':'image/png'}});};
  const path='/api/admin/applications/'+id+'/file/face',result=await api(request(path,'GET',undefined,{Cookie:'__Host-oneul_access_p=actual-operator'}),env);
  assert.equal(result.status,200);assert.equal(result.headers.get('Content-Type'),'image/png');assert.equal(result.headers.get('Cache-Control'),'no-store');assert.equal(calls.at(-1).options.headers.Authorization,'Bearer actual-operator');assert.ok(calls.at(-1).url.endsWith('/platform-api/admin/applications/'+id+'/file/face'));assert.deepEqual([...new Uint8Array(await result.arrayBuffer())],[137,80,78,71]);
  const before=calls.length;assert.equal((await api(request(path),env)).status,401);assert.equal(calls.length,before);
});
function handler(respond){const calls=[];const edge=createPlatformHandler({origin:'https://test.supabase.co',key:'server-secret',fetcher:async(url,options)=>{calls.push({url,options});return respond(url,options);}});return {edge,calls};}
const edgeRequest=(path,method='GET',body,headers={})=>new Request('https://test.supabase.co/functions/v1/platform-api'+path,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
const item={id,member_user_id:null,payment_status:'paid',status:'draft',phone:'+821012345678',gender:'여성',profile:null};
test('Edge operator authorization ignores user-editable role metadata and always checks staff membership',async()=>{
  const {edge,calls}=handler(url=>reply(url.endsWith('/auth/v1/user')?user:[]));
  assert.equal((await edge(edgeRequest('/admin/applications','GET',undefined,{Authorization:'Bearer actual-user'}))).status,403);
  assert.ok(calls.some(c=>c.url.includes('oneul_staff')));assert.ok(!calls.some(c=>c.url.includes('oneul_applications')));
  assert.equal((await edge(edgeRequest('/admin/applications'))).status,401);
  assert.equal((await edge(edgeRequest('/admin/applications/'+id,'DELETE',{confirmOrderNo:'1234',expectedUpdatedAt:'2026-10-07'},{Authorization:'Bearer actual-user'}))).status,403);
});
test('actual operator attachment reads stay scoped to the selected application; ordinary members cannot download',async()=>{
  const file=id+'/face/22222222-2222-4222-8222-222222222222.png';
  const {edge,calls}=handler(url=>url.endsWith('/auth/v1/user')?reply(user):url.includes('/oneul_staff?')?reply([{user_id:id}]):url.includes('/oneul_applications?')?reply([{...item,profile:{face_path:file}}]):new Response(new Uint8Array([137,80,78,71]),{headers:{'Content-Type':'image/png'}}));
  const result=await edge(edgeRequest('/admin/applications/'+id+'/file/face','GET',undefined,{Authorization:'Bearer actual-operator'}));assert.equal(result.status,200);assert.equal(result.headers.get('Cache-Control'),'no-store');assert.equal(result.headers.get('Content-Type'),'image/png');assert.ok(calls.at(-1).url.endsWith('/storage/v1/object/authenticated/oneul-verification/'+file));
  const denied=handler(url=>reply(url.endsWith('/auth/v1/user')?user:[]));assert.equal((await denied.edge(edgeRequest('/admin/applications/'+id+'/file/face','GET',undefined,{Authorization:'Bearer ordinary-member'}))).status,403);assert.ok(!denied.calls.some(c=>c.url.includes('/storage/v1/')));
});
test('operator confirmation accepts omitted venue but still rejects a changed submission before its RPC',async()=>{
  const submitted={...item,status:'submitted',profile:{name:'테스트'},submitted_at:'2026-10-08T03:00:00Z'};
  const {edge,calls}=handler(url=>reply(url.endsWith('/auth/v1/user')?user:url.includes('/oneul_staff?')?[{user_id:user.id}]:url.includes('/oneul_applications?')?[submitted]:null));
  const path='/admin/applications/'+id+'/review',headers={Authorization:'Bearer actual-operator'};
  const changed=await edge(edgeRequest(path,'POST',{decision:'confirmed',expectedSubmittedAt:'2026-10-08T02:00:00Z'},headers));assert.equal(changed.status,409);assert.ok(!calls.some(c=>c.url.endsWith('/rpc/oneul_review_application')));
  const result=await edge(edgeRequest(path,'POST',{decision:'confirmed',expectedSubmittedAt:submitted.submitted_at,instructions:'신분증·휴대폰'},headers));assert.deepEqual(await result.json(),{updated:true});
  const body=JSON.parse(calls.at(-1).options.body);assert.equal(body.place,'');assert.equal(body.preparation,'신분증·휴대폰');assert.equal(body.expected_submission,submitted.submitted_at);assert.equal(body.actor_id,user.id);
});
test('Edge rejects absent and expired guest sessions without revealing application data',async()=>{
  const {edge,calls}=handler(()=>reply([]));assert.equal((await edge(edgeRequest('/application'))).status,401);assert.equal(calls.length,0);
  assert.equal((await edge(edgeRequest('/application','GET',undefined,{'X-Oneul-Application-Session':session}))).status,401);assert.ok(calls[0].url.includes('expires_at=gt.'));assert.ok(!calls.some(c=>c.url.includes('/oneul_applications?')));
});
test('a claimed application requires member login even when the guest capability is valid',async()=>{
  const {edge}=handler(url=>reply(url.includes('/oneul_application_sessions?')?[{application_id:id}]:[{...item,member_user_id:id}]));
  assert.equal((await edge(edgeRequest('/application','GET',undefined,{'X-Oneul-Application-Session':session}))).status,401);
});
test('reopened capabilities cannot read or edit a claimed application through another verified account',async()=>{
  const other={...user,id:'33333333-3333-4333-8333-333333333333'};
  const {edge,calls}=handler(url=>reply(url.endsWith('/auth/v1/user')?other:url.includes('/oneul_application_sessions?')?[{application_id:id}]:[{...item,member_user_id:id}]));
  for(const [path,method,body] of [['/application','GET',undefined],['/profile','PUT',{}],['/claim','POST',{claimConsent:true}]]){
    const result=await edge(edgeRequest(path,method,body,{Authorization:'Bearer another-real-user','X-Oneul-Application-Session':session}));assert.equal(result.status,403);assert.equal((await result.json()).code,'application_member_login');
  }
  assert.ok(!calls.some(c=>['PATCH','PUT'].includes(c.options.method)||c.url.includes('/rpc/oneul_submit_application')));
});
test('a guest cannot select another application by ID or acquire administrative permissions',async()=>{
  const {edge,calls}=handler(()=>{throw new Error('no database access expected');});
  assert.equal((await edge(edgeRequest('/application?id='+id,'GET',undefined,{'X-Oneul-Application-Session':session}))).status,403);
  assert.equal((await edge(edgeRequest('/admin/applications/'+id+'/review','POST',{decision:'confirmed'},{'X-Oneul-Application-Session':session}))).status,401);assert.equal(calls.length,0);
});
test('confirmed application cannot upload or resubmit, and an unclaimed guest cannot request reusable member storage',async()=>{
  const {edge}=handler(url=>reply(url.includes('/oneul_application_sessions?')?[{application_id:id}]:[{...item,status:'confirmed'}]));
  assert.equal((await edge(edgeRequest('/profile','PUT',{}, {'X-Oneul-Application-Session':session}))).status,403);
});
test('private application file formats enforce signatures and PDF employment-only usage',()=>{
  assert.equal(extensionFor('application/pdf',new TextEncoder().encode('%PDF-1.4'),'employment'),'pdf');
  assert.throws(()=>extensionFor('application/pdf',new TextEncoder().encode('%PDF-1.4'),'face'));
  assert.throws(()=>extensionFor('image/png',new TextEncoder().encode('<svg></svg>'),'face'));
});
test('guest submissions retain actual job and attachments while discarding retired lifestyle fields',async()=>{
  const file='22222222-2222-4222-8222-222222222222.png',attachments=Object.fromEntries(['face','fullbody','employment'].map(slot=>[slot,id+'/'+slot+'/'+file]));
  const {edge,calls}=handler(url=>reply(url.includes('/oneul_application_sessions?')?[{application_id:id}]:url.includes('/oneul_applications?')?[item]:id));
  const result=await edge(edgeRequest('/profile','PUT',{name:'신청자',birth:'1994-05-20',height:155,region:'서울',district:'송파구',job:'세무대리인',attachments,privacyConsent:true,photoConsent:true,employmentConsent:true,religion:'무교',smoking:'비흡연',drinking:'가끔 마셔요',sensitiveConsent:false},{'X-Oneul-Application-Session':session}));
  assert.equal(result.status,200);const data=await result.json();assert.equal(data.submitted,true);assert.equal(data.cardSaved,false);assert.equal(data.profile.job,'세무대리인');assert.equal(data.profile.employment_path,attachments.employment);
  const snapshot=JSON.parse(calls.find(c=>c.url.endsWith('/rpc/oneul_submit_application')).options.body).submission;
  for(const field of ['religion','smoking','drinking','sensitive_consent_at']){assert.equal(field in snapshot,false);assert.equal(field in data.profile,false);}
});
const deletable={...item,source:'frip',external_order_no:'1234',order_id:null,updated_at:'2026-10-07T08:55:27.695159+00:00',profile:{face_path:id+'/face/22222222-2222-4222-8222-222222222222.png'}};
const confirmedNotice={...deletable,status:'confirmed',confirmed_at:'2026-10-08T03:00:00Z',notice_sent_at:null,notice_text:''};
function noticeHandler(value=confirmedNotice,{empty=false,failed=false}={}){return handler((url,options)=>{
  if(url.endsWith('/auth/v1/user'))return reply(user);
  if(url.includes('/oneul_staff?'))return reply([{user_id:user.id}]);
  if(options.method==='PATCH')return failed?reply({error:'temporary failure'},503):reply(empty?[]:[{...value,...JSON.parse(options.body)}]);
  return reply([value]);
});}
test('manual notice recording returns only the real saved receipt and conditionally updates the confirmed paid version',async()=>{
  const {edge,calls}=noticeHandler(),result=await edge(edgeRequest('/admin/applications/'+id+'/notice','POST',{sent:true,message:'  실제로 보낸 문자  ',expectedUpdatedAt:confirmedNotice.updated_at},{Authorization:'Bearer actual-operator'}));
  assert.equal(result.status,200);const receipt=await result.json();assert.equal(receipt.recorded,true);assert.equal(receipt.applicationId,id);assert.equal(receipt.noticeText,'실제로 보낸 문자');assert.ok(Number.isFinite(Date.parse(receipt.noticeSentAt)));assert.equal(receipt.updatedAt,receipt.noticeSentAt);assert.equal('phone' in receipt,false);
  const mutation=calls.find(c=>c.options.method==='PATCH'),query=new URL(mutation.url).searchParams,body=JSON.parse(mutation.options.body);
  assert.equal(query.get('id'),'eq.'+id);assert.equal(query.get('status'),'eq.confirmed');assert.equal(query.get('payment_status'),'eq.paid');assert.equal(query.get('notice_sent_at'),'is.null');assert.equal(query.get('updated_at'),'eq.'+confirmedNotice.updated_at);assert.equal(mutation.options.headers.Prefer,'return=representation');assert.equal(body.notice_sent_at,receipt.noticeSentAt);assert.equal(body.notice_text,receipt.noticeText);
});
test('recording retries retain the original timestamp and exact message without another write',async()=>{
  const prior={...confirmedNotice,notice_sent_at:'2026-10-08T04:00:00Z',notice_text:'원래 발송한 문자'}, {edge,calls}=noticeHandler(prior);
  const result=await edge(edgeRequest('/admin/applications/'+id+'/notice','POST',{sent:true,message:'다른 문구',expectedUpdatedAt:'old'},{Authorization:'Bearer actual-operator'}));
  assert.deepEqual(await result.json(),{recorded:true,applicationId:id,noticeSentAt:prior.notice_sent_at,noticeText:prior.notice_text,updatedAt:prior.updated_at});assert.ok(!calls.some(c=>c.options.method==='PATCH'));
});
test('stale, unconfirmed, unpaid and unacknowledged notices never write a sent record',async()=>{
  for(const [value,body,status] of [[confirmedNotice,{sent:true,message:'문자',expectedUpdatedAt:'old'},409],[{...confirmedNotice,status:'canceled'},{sent:true,message:'문자'},400],[{...confirmedNotice,payment_status:'canceled'},{sent:true,message:'문자'},400],[confirmedNotice,{sent:false,message:'문자'},400],[confirmedNotice,{sent:true,message:''},400]]){
    const {edge,calls}=noticeHandler(value);assert.equal((await edge(edgeRequest('/admin/applications/'+id+'/notice','POST',body,{Authorization:'Bearer actual-operator'}))).status,status);assert.ok(!calls.some(c=>c.options.method==='PATCH'));
  }
});
test('concurrent state changes and database failures cannot return a false successful notice receipt',async()=>{
  for(const [options,status] of [[{empty:true},409],[{failed:true},503]]){
    const {edge}=noticeHandler(confirmedNotice,options),result=await edge(edgeRequest('/admin/applications/'+id+'/notice','POST',{sent:true,message:'문자'},{Authorization:'Bearer actual-operator'}));assert.equal(result.status,status);const data=await result.json();assert.equal(data.recorded,undefined);assert.ok(data.error);
  }
  const denied=handler(url=>reply(url.endsWith('/auth/v1/user')?user:[]));assert.equal((await denied.edge(edgeRequest('/admin/applications/'+id+'/notice','POST',{sent:true,message:'문자'},{Authorization:'Bearer ordinary-member'}))).status,403);assert.ok(!denied.calls.some(c=>c.options.method==='PATCH'));
});
function deleteHandler(value=deletable,removed=[value]){return handler((url,options)=>reply(url.endsWith('/auth/v1/user')?user:url.includes('/oneul_staff?')?[{user_id:user.id}]:options.method==='DELETE'?removed:[value]));}
test('an actual operator deletes only a matching external order version and returns no private snapshot',async()=>{
  const {edge,calls}=deleteHandler();const result=await edge(edgeRequest('/admin/applications/'+id,'DELETE',{confirmOrderNo:deletable.external_order_no,expectedUpdatedAt:deletable.updated_at},{Authorization:'Bearer actual-operator'}));
  assert.deepEqual(await result.json(),{deleted:true,applicationId:id,cleanupQueued:true});
  const mutation=calls.find(c=>c.options.method==='DELETE');assert.ok(mutation);const url=new URL(mutation.url);
  assert.equal(url.searchParams.get('id'),'eq.'+id);assert.equal(url.searchParams.get('source'),'in.(frip,munto)');assert.equal(url.searchParams.get('order_id'),'is.null');assert.equal(url.searchParams.get('external_order_no'),'eq.1234');assert.equal(url.searchParams.get('updated_at'),'eq.'+deletable.updated_at);assert.equal(mutation.options.headers.Prefer,'return=representation');
});
test('missing deletion confirmation, stale versions and protected website orders never reach DELETE',async()=>{
  for(const [value,body,status] of [[deletable,{},400],[deletable,{confirmOrderNo:'1234',expectedUpdatedAt:'old'},409],[{...deletable,source:'website'},{confirmOrderNo:'1234',expectedUpdatedAt:deletable.updated_at},409],[{...deletable,order_id:id},{confirmOrderNo:'1234',expectedUpdatedAt:deletable.updated_at},409]]){
    const {edge,calls}=deleteHandler(value);assert.equal((await edge(edgeRequest('/admin/applications/'+id,'DELETE',body,{Authorization:'Bearer actual-operator'}))).status,status);assert.ok(!calls.some(c=>c.options.method==='DELETE'));
  }
});
test('a concurrently changed or already deleted application cannot report deletion success',async()=>{
  const {edge}=deleteHandler(deletable,[]);const result=await edge(edgeRequest('/admin/applications/'+id,'DELETE',{confirmOrderNo:'1234',expectedUpdatedAt:deletable.updated_at},{Authorization:'Bearer actual-operator'}));assert.equal(result.status,409);assert.equal((await result.json()).deleted,undefined);
  const denied=await edge(edgeRequest('/admin/applications/'+id,'DELETE',{}, {'X-Oneul-Application-Session':session}));assert.equal(denied.status,401);
});
test('the Site proxy rejects cross-site deletion and forwards operator identity and exact confirmation',async()=>{
  const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return reply(url.endsWith('/auth/v1/user')?user:{deleted:true,applicationId:id,cleanupQueued:false});};
  const path='/api/admin/applications/'+id,body={confirmOrderNo:'1234',expectedUpdatedAt:deletable.updated_at};
  assert.equal((await api(request(path,'DELETE',body,{Origin:'https://evil.test',Cookie:'__Host-oneul_access_p=operator'}),env)).status,403);assert.equal(calls.length,0);
  const result=await api(request(path,'DELETE',body,{Cookie:'__Host-oneul_access_p=operator'}),env);assert.equal((await result.json()).deleted,true);assert.equal(calls.at(-1).options.method,'DELETE');assert.equal(calls.at(-1).options.headers.Authorization,'Bearer operator');assert.deepEqual(JSON.parse(calls.at(-1).options.body),body);
});
test('admin list joins only requested memo summaries using the verified operator, never array order or caller claims',async()=>{
 const second='22222222-2222-4222-8222-222222222222',stamp='2026-10-20T08:00:00Z';
 const {edge,calls}=handler(url=>reply(url.endsWith('/auth/v1/user')?user:url.includes('/oneul_staff?')?[{user_id:user.id}]:url.endsWith('/oneul_admin_application_memo_summaries')?[{applicationId:second,participantNumber:null,submittedAt:null},{applicationId:id,participantNumber:1,submittedAt:stamp,qrToken:'must-not-leak',text:'must-not-leak'}]:[{...item,id,source:'frip'},{...item,id:second,source:'munto'}]));
 const response=await edge(edgeRequest('/admin/applications?actorId='+second,'GET',undefined,{Authorization:'Bearer operator'}));assert.equal(response.status,200);const data=await response.json();assert.deepEqual(data.applications[0].memo,{participantNumber:1,submittedAt:stamp});assert.deepEqual(data.applications[1].memo,{participantNumber:null,submittedAt:null});assert.doesNotMatch(JSON.stringify(data),/must-not-leak/);const lookup=calls.find(c=>c.url.endsWith('/oneul_admin_application_memo_summaries'));assert.deepEqual(JSON.parse(lookup.options.body),{p_actor_id:user.id,p_application_ids:[id,second]});
});
test('admin list refuses unrelated memo metadata and skips the lookup when there are no applications',async()=>{
 for(const summaries of [[{applicationId:'22222222-2222-4222-8222-222222222222',participantNumber:1,submittedAt:null}],[{applicationId:id,participantNumber:1,submittedAt:'bad'}]]){const {edge}=handler(url=>reply(url.endsWith('/auth/v1/user')?user:url.includes('/oneul_staff?')?[{user_id:user.id}]:url.endsWith('/oneul_admin_application_memo_summaries')?summaries:[item]));const response=await edge(edgeRequest('/admin/applications','GET',undefined,{Authorization:'Bearer operator'}));assert.equal(response.status,502);assert.equal((await response.json()).applications,undefined);}
 const {edge,calls}=handler(url=>reply(url.endsWith('/auth/v1/user')?user:url.includes('/oneul_staff?')?[{user_id:user.id}]:[]));assert.deepEqual(await(await edge(edgeRequest('/admin/applications','GET',undefined,{Authorization:'Bearer operator'}))).json(),{applications:[]});assert.ok(!calls.some(c=>c.url.endsWith('/oneul_admin_application_memo_summaries')));
});
