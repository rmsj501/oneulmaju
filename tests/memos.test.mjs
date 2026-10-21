import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {api} from '../worker/index.mjs';
import {createMemoHandler} from '../supabase/functions/memo-api/index.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const originalFetch=globalThis.fetch;after(()=>{globalThis.fetch=originalFetch;});
const origin='https://oneulmaju.rmsj501.chatgpt.site',env={SITE_ORIGIN:origin,SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-key',MEMOS_ENABLED:'true'};
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',token='a'.repeat(64),session='b'.repeat(64);
const user={id,email:'operator@example.test',email_confirmed_at:'2026-10-19',user_metadata:{role:'admin'}};
const page={id,eventDate:'2026-10-24',startTime:'13:00',gender:'여성',participantNumber:1,opponentCount:3,expiresAt:'2026-11-01T00:00:00+09:00'};
const req=(path,method='GET',body,headers={})=>new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
const reply=(value,status=200)=>Response.json(value,{status});
function edge(handler,{staff=true,account=user}={}){const calls=[];const fetcher=async(url,options)=>{const data=options.body?JSON.parse(options.body):null;calls.push({url,options,data});if(url.endsWith('/auth/v1/user'))return reply(account);if(url.includes('/oneul_staff?'))return reply(staff?[{user_id:account.id}]:[]);return handler(url,data,options);};return{calls,run:createMemoHandler({origin:env.SUPABASE_URL,key:'private-service-key',fetcher})};}
test('QR exchange sets a private partitioned cookie, returns no token and does not require Auth',async()=>{
  const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return reply({exchanged:true,pageId:id,expiresAt:'2026-11-01T00:00:00+09:00',sessionToken:session});};
  const response=await api(req('/api/memo/exchange','POST',{qrToken:token}),env);assert.equal(response.status,200);assert.deepEqual(await response.json(),{exchanged:true,pageId:id});assert.match(response.headers.get('Set-Cookie'),/__Host-oneul_memo_p=.*HttpOnly; SameSite=None; Partitioned/);assert.equal(calls.length,1);assert.ok(calls[0].url.endsWith('/memo-api/exchange'));assert.equal(calls[0].options.headers.Authorization,undefined);
});
test('memo setup, bad origin and unconfirmed exchange cannot claim a working session',async()=>{
  let calls=0;globalThis.fetch=async()=>{calls++;return reply({exchanged:true,pageId:id,sessionToken:'invalid',expiresAt:page.expiresAt});};
  assert.equal((await api(req('/api/memo/exchange','POST',{}),{...env,MEMOS_ENABLED:'false'})).status,503);assert.equal((await api(req('/api/memo','PUT',{}, {Origin:'https://evil.test'}),env)).status,403);assert.equal(calls,0);
  const response=await api(req('/api/memo/exchange','POST',{qrToken:token}),env);assert.equal(response.status,502);assert.equal(response.headers.get('Set-Cookie'),null);
});
test('memo writes forward only their dedicated session and never the platform profile capability',async()=>{
  let sent;globalThis.fetch=async(url,options)=>{sent={url,options};return reply({saved:true});};const payload={pageId:id,opponentNumber:1,text:'한 줄',hearts:2,expectedVersion:0,mutationId:other};
  await api(req('/api/memo','PUT',payload,{Cookie:'__Host-oneul_memo_p='+session+'; __Host-oneul_application_p=not-a-memo'}),env);assert.equal(sent.options.headers['X-Oneul-Memo-Session'],session);assert.equal(sent.options.headers.Authorization,undefined);assert.deepEqual(JSON.parse(sent.options.body),payload);
});
test('ordinary users cannot issue QR by claiming an admin role in metadata',async()=>{
  const e=edge(()=>{throw new Error('must not issue');},{staff:false});const response=await e.run(req('/memo-api/admin/'+id,'POST',{}, {Authorization:'Bearer valid-user'}));assert.equal(response.status,403);assert.ok(!e.calls.some(c=>c.url.includes('/rpc/')));
});
test('memo review requires real verified staff Auth and is read-only',async()=>{
  for(const options of [{staff:false},{account:{...user,email_confirmed_at:null}}]){const e=edge(()=>{throw new Error('must not read');},options);const result=await e.run(req('/memo-api/admin/'+id+'/entries','GET',undefined,{Authorization:'Bearer actual'}));assert.equal(result.status,403);assert.ok(!e.calls.some(c=>c.url.includes('/rpc/')));}
  const anonymous=edge(()=>{throw new Error('must not read');});assert.equal((await anonymous.run(req('/memo-api/admin/'+id+'/entries'))).status,401);assert.equal(anonymous.calls.length,0);
  const e=edge(()=>{throw new Error('must not write');});assert.equal((await e.run(req('/memo-api/admin/'+id+'/entries','POST',{}, {Authorization:'Bearer actual'}))).status,405);assert.ok(!e.calls.some(c=>c.url.includes('/rpc/')));
});
test('operator review uses the Auth actor and only the selected application read RPC',async()=>{
  const payload={issued:true,applicationId:id,page,entries:[{opponentNumber:1,text:'저장한 메모',hearts:2}]};const e=edge((url,data)=>reply(payload));const response=await e.run(req('/memo-api/admin/'+id+'/entries?actorId='+other,'GET',undefined,{Authorization:'Bearer actual'}));assert.equal(response.status,200);assert.deepEqual(await response.json(),payload);assert.equal(e.calls.at(-1).url,env.SUPABASE_URL+'/rest/v1/rpc/oneul_memo_admin_read');assert.deepEqual(e.calls.at(-1).data,{p_application_id:id,p_actor_id:user.id});assert.equal(response.headers.get('Cache-Control'),'no-store');
});
test('site memo review route requires a login cookie and forwards Auth without changing memo sessions',async()=>{
  const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});if(url.endsWith('/auth/v1/user'))return reply(user);return reply({issued:false,applicationId:id});};
  const denied=await api(req('/api/admin/memo/'+id+'/entries'),env);assert.equal(denied.status,401);assert.equal(calls.length,0);
  const result=await api(req('/api/admin/memo/'+id+'/entries','GET',undefined,{Cookie:'__Host-oneul_access_p=operator-token'}),env);assert.equal(result.status,200);assert.ok(calls.at(-1).url.endsWith('/memo-api/admin/'+id+'/entries'));assert.equal(calls.at(-1).options.headers.Authorization,'Bearer operator-token');assert.equal(result.headers.get('Set-Cookie'),null);
});
test('operator QR issuance derives actor from Auth, hashes the new QR and never accepts caller secrets',async()=>{
  const e=edge((url,data)=>reply({issued:true,pageId:id,participantNumber:1,opponentCount:3,gender:'여성',eventDate:page.eventDate,startTime:'13:00'}));const response=await e.run(req('/memo-api/admin/'+id,'POST',{participantNumber:null,opponentCount:3,expectedUpdatedAt:'2026-10-19T00:00:00Z',replace:false,actorId:other,qrToken:token},{Authorization:'Bearer actual'}));const data=await response.json();assert.equal(response.status,200);assert.match(data.qrToken,/^[a-f0-9]{64}$/);const sent=e.calls.at(-1).data;assert.equal(sent.p_actor_id,user.id);assert.equal(sent.p_application_id,id);assert.notEqual(sent.p_qr_hash,data.qrToken);assert.match(sent.p_qr_hash,/^[a-f0-9]{64}$/);assert.equal(sent.p_replace,false);assert.equal(sent.p_qr_hash,Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(data.qrToken))).toString('hex'));
});
test('guest read requires a dedicated session; cross-owner page binding is always sent to DB',async()=>{
  const e=edge((url,data)=>reply({page,entries:[]}));assert.equal((await e.run(req('/memo-api/'))).status,401);assert.equal(e.calls.length,0);const result=await e.run(req('/memo-api/?pageId='+other,'GET',undefined,{'X-Oneul-Memo-Session':session}));assert.equal(result.status,200);assert.equal(e.calls.at(-1).data.p_page_id,other);assert.notEqual(e.calls.at(-1).data.p_session_hash,session);
});
test('invalid notes, heart values and mutation IDs never reach a privileged save',async()=>{
  const payload={pageId:id,opponentNumber:1,text:'hi',hearts:2,expectedVersion:0,mutationId:other};for(const change of [{hearts:4},{hearts:-1},{hearts:'2'},{opponentNumber:0},{opponentNumber:14},{text:'가'.repeat(501)},{mutationId:'not-uuid'},{expectedVersion:-1}]){const e=edge(()=>{throw new Error('must not save');});const result=await e.run(req('/memo-api/','PUT',{...payload,...change},{'X-Oneul-Memo-Session':session}));assert.equal(result.status,400);assert.equal(e.calls.length,0);}
});
test('stale writes and revoked QR sessions return errors rather than saved responses',async()=>{
  for(const [code,status]of [['40001',409],['28000',401]]){const e=edge(()=>reply({code},400));const result=await e.run(req('/memo-api/','GET',undefined,{'X-Oneul-Memo-Session':session}));assert.equal(result.status,status);assert.equal((await result.json()).saved,undefined);}
});
test('matching submissions bind the private session and page and validate distinct bounded numbers before SQL',async()=>{
  const body={pageId:id,numbers:[1,3],expectedVersion:0,expectedLimit:3,mutationId:other};
  for(const change of [{numbers:[1,1]},{numbers:[0]},{numbers:[14]},{numbers:[1,2,3,4]},{numbers:['1']},{numbers:null},{expectedLimit:4},{expectedVersion:-1},{pageId:'bad'},{mutationId:'bad'}]){const e=edge(()=>{throw new Error('invalid matching reached SQL');});assert.equal((await e.run(req('/memo-api/matching','PUT',{...body,...change},{'X-Oneul-Memo-Session':session}))).status,400);assert.equal(e.calls.length,0);}
  const e=edge((url,data)=>reply({submitted:true,pageId:id}));assert.equal((await e.run(req('/memo-api/matching','PUT',body))).status,401);assert.equal((await e.run(req('/memo-api/matching','PUT',body,{'X-Oneul-Memo-Session':session}))).status,200);assert.ok(e.calls.at(-1).url.endsWith('/rpc/oneul_matching_save'));assert.deepEqual(e.calls.at(-1).data.p_numbers,[1,3]);assert.equal(e.calls.at(-1).data.p_page_id,id);assert.notEqual(e.calls.at(-1).data.p_session_hash,session);
});
test('only a real operator can set a whole session matching limit of two or three',async()=>{
  const denied=edge(()=>{throw new Error('not staff');},{staff:false});assert.equal((await denied.run(req('/memo-api/admin/'+id+'/matching-limit','POST',{limit:2},{Authorization:'Bearer member'}))).status,403);
  for(const limit of [1,4,'2',null]){const e=edge(()=>{throw new Error('bad limit');});assert.equal((await e.run(req('/memo-api/admin/'+id+'/matching-limit','POST',{limit},{Authorization:'Bearer actual'}))).status,400);assert.ok(!e.calls.some(c=>c.url.includes('/rpc/')));}
  const e=edge(()=>reply({updated:true,applicationId:id,limit:2}));assert.equal((await e.run(req('/memo-api/admin/'+id+'/matching-limit','POST',{limit:2,actorId:other},{Authorization:'Bearer actual'}))).status,200);assert.ok(e.calls.at(-1).url.endsWith('/rpc/oneul_matching_limit'));assert.equal(e.calls.at(-1).data.p_actor_id,user.id);
});
test('session roster and results reject ordinary members; the site route preserves only the selected date/time',async()=>{
 for(const path of ['/admin/sessions','/admin/sessions/detail?eventDate=2026-10-24&startTime=13:00']){const e=edge(()=>{throw new Error('not staff');},{staff:false});assert.equal((await e.run(req('/memo-api'+path,'GET',undefined,{Authorization:'Bearer member'}))).status,403);assert.ok(!e.calls.some(x=>x.url.includes('/rpc/')));}
 const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});if(url.endsWith('/auth/v1/user'))return reply(user);return reply({attendees:[],pairs:[]});};const result=await api(req('/api/admin/sessions/detail?eventDate=2026-10-24&startTime=13%3A00&actorId='+other,'GET',undefined,{Cookie:'__Host-oneul_access_p=operator'}),env);assert.equal(result.status,200);const url=new URL(calls.at(-1).url);assert.equal(url.pathname,'/functions/v1/memo-api/admin/sessions/detail');assert.equal(url.searchParams.get('startTime'),'13:00');assert.equal(url.searchParams.has('actorId'),false);
});
test('bulk QR issuance derives repeatable private tokens, sends only hashes to SQL and safely recovers a lost receipt',async()=>{
 const body={eventDate:'2026-10-24',startTime:'13:00',requestId:other,replaceExisting:false,seed:'c'.repeat(64)};let stored=null,issues=0;
 const e=edge((url,data)=>{if(url.endsWith('oneul_session_batch_plan'))return reply(stored||{completed:false,expected:[{applicationId:id,updatedAt:'2026-10-19'}]});if(url.endsWith('oneul_session_batch_issue')){issues++;assert.equal(data.p_actor_id,user.id);assert.equal(data.seed,undefined);stored={completed:true,batchId:other,skippedCount:0,items:[{applicationId:id,pageId:id,name:'테스트',gender:'여성',participantNumber:1,qrHash:data.p_hashes[id],valid:true}]};return reply(stored);}throw new Error('unexpected RPC');});
 const first=await e.run(req('/memo-api/admin/sessions/issue','POST',body,{Authorization:'Bearer operator'}));assert.equal(first.status,200);const result=await first.json();assert.match(result.items[0].qrToken,/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(result),/qrHash|seed|private-service-key/);assert.notEqual(result.items[0].qrToken,body.seed);const retry=await e.run(req('/memo-api/admin/sessions/issue','POST',body,{Authorization:'Bearer operator'}));assert.deepEqual(await retry.json(),result);assert.equal(issues,1);
});
test('invalid sessions, missing seeds and unapproved bulk replacement never reach a QR issuance RPC',async()=>{
 const body={eventDate:'2026-10-24',startTime:'13:00',requestId:other,replaceExisting:false,seed:'c'.repeat(64)};
 for(const change of [{eventDate:'2026-02-31'},{startTime:'99:00'},{seed:'bad'},{requestId:'bad'},{replaceExisting:'true'}]){const e=edge(()=>{throw new Error('invalid reached DB');});assert.equal((await e.run(req('/memo-api/admin/sessions/issue','POST',{...body,...change},{Authorization:'Bearer operator'}))).status,400);assert.ok(!e.calls.some(c=>c.url.includes('/rpc/')));}
});
test('configured bulk settings are validated, hashed into retry identity and forwarded only to the configured RPC',async()=>{
 const body={eventDate:'2026-10-24',startTime:'13:00',requestId:other,seed:'c'.repeat(64),replaceExisting:false,maleOpponentCount:7,femaleOpponentCount:8,matchLimit:2};
 for(const change of [{maleOpponentCount:0},{maleOpponentCount:14},{femaleOpponentCount:1.5},{femaleOpponentCount:'8'},{matchLimit:1},{matchLimit:null},{maleOpponentCount:undefined}]){const e=edge(()=>{throw new Error('invalid settings reached DB');});assert.equal((await e.run(req('/memo-api/admin/sessions/issue','POST',{...body,...change},{Authorization:'Bearer operator'}))).status,400);assert.ok(!e.calls.some(c=>c.url.includes('/rpc/')));}
 const hashes=[];const e=edge((url,data)=>{if(url.endsWith('oneul_session_batch_plan')){hashes.push(data.p_request_hash);return reply({completed:false,expected:[]});}assert.ok(url.endsWith('oneul_session_batch_issue_configured'));assert.equal(data.p_male_opponent_count,7);assert.equal(data.p_female_opponent_count,8);assert.equal(data.p_match_limit,2);return reply({completed:true,batchId:other,skippedCount:0,settings:{maleOpponentCount:7,femaleOpponentCount:8,matchLimit:2},items:[]});});
 const result=await e.run(req('/memo-api/admin/sessions/issue','POST',body,{Authorization:'Bearer operator'}));assert.equal(result.status,200);assert.equal((await result.json()).settings.matchLimit,2);
 const changed=edge((url,data)=>{if(url.endsWith('oneul_session_batch_plan')){assert.notEqual(data.p_request_hash,hashes[0]);return reply({code:'40001'},400);}throw new Error('changed retry issued');});assert.equal((await changed.run(req('/memo-api/admin/sessions/issue','POST',{...body,matchLimit:3},{Authorization:'Bearer operator'}))).status,409);
});
test('unsafe reductions explain existing memo or selection protection',async()=>{
 const e=edge(()=>reply({code:'40001',message:'Session settings would hide notes or choices'},400));const response=await e.run(req('/memo-api/admin/sessions/issue','POST',{eventDate:'2026-10-24',startTime:'13:00',requestId:other,seed:'c'.repeat(64),replaceExisting:false,maleOpponentCount:3,femaleOpponentCount:3,matchLimit:2},{Authorization:'Bearer operator'}));assert.equal(response.status,409);assert.match((await response.json()).error,/이미 작성된 메모나 제출된 매칭 선택/);
});
test('PT409 is returned promptly as a conflict, including stale issuance and protected reductions',async()=>{
 for(const [message,pattern]of [['Application changed',/신청 정보가 갱신/],['Session settings would hide notes or choices',/이미 작성된 메모/],['Memo QR already issued',/다른 화면/]]){
  const e=edge(()=>reply({code:'PT409',message},409));const response=await e.run(req('/memo-api/admin/'+id,'POST',{participantNumber:null,opponentCount:3,expectedUpdatedAt:'2026-10-19T00:00:00Z',replace:false},{Authorization:'Bearer actual'}));
  assert.equal(response.status,409);assert.match((await response.json()).error,pattern);assert.equal(e.calls.filter(c=>c.url.includes('/rpc/')).length,1);
 }
});
test('a backend timeout returns a useful 503 and never retries a QR mutation automatically',async()=>{
 const e=edge(()=>{throw Object.assign(new Error('timeout'),{name:'TimeoutError'});});const response=await e.run(req('/memo-api/admin/'+id,'POST',{participantNumber:null,opponentCount:3,expectedUpdatedAt:'2026-10-19T00:00:00Z',replace:false},{Authorization:'Bearer actual'}));assert.equal(response.status,503);assert.match((await response.json()).error,/발급 상태나 저장 상태/);assert.equal(e.calls.filter(c=>c.url.includes('/rpc/')).length,1);
});
test('two participant QR tabs keep separate HttpOnly sessions for reads, matching changes and memo saves',async()=>{
 const sessions=new Map([[id,session],[other,'c'.repeat(64)]]),jar=new Map(),sent=[];
 globalThis.fetch=async(url,options)=>{const body=options.body?JSON.parse(options.body):undefined;sent.push({url,options,body});if(url.endsWith('/memo-api/exchange')){const pageId=body.qrToken===token?id:other;return reply({exchanged:true,pageId,expiresAt:'2026-11-01T00:00:00+09:00',sessionToken:sessions.get(pageId)});}return reply({submitted:true});};
 for(const qrToken of [token,'d'.repeat(64)]){const response=await api(req('/api/memo/exchange','POST',{qrToken}),env);assert.equal(response.status,200);assert.equal((await response.json()).sessionToken,undefined);
  for(const cookie of response.headers.getSetCookie()){assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);const [name,value]=cookie.split(';')[0].split('=');if(value)jar.set(name,value);else jar.delete(name);}
 }
 assert.equal(jar.get('__Host-oneul_memo_p'),sessions.get(other));assert.equal(jar.get('__Host-oneul_memo_'+id+'_p'),session);
 const Cookie=[...jar].map(([name,value])=>name+'='+value).join('; ');
 for(const pageId of [id,other]){for(const [path,method,body]of [['/api/memo?pageId='+pageId,'GET',undefined],['/api/memo/matching','PUT',{pageId,numbers:[1],expectedVersion:1,expectedLimit:3,mutationId:other}],['/api/memo','PUT',{pageId,opponentNumber:1,text:'test',hearts:2,expectedVersion:0,mutationId:other}]]){assert.equal((await api(req(path,method,body,{Cookie}),env)).status,200);assert.equal(sent.at(-1).options.headers['X-Oneul-Memo-Session'],sessions.get(pageId));}}
});
test('a mismatched QR session has a specific recovery message instead of a selection-version error',async()=>{
 const e=edge(()=>reply({code:'PT409',message:'Memo session changed'},409));const response=await e.run(req('/memo-api/matching','PUT',{pageId:id,numbers:[1],expectedVersion:1,expectedLimit:3,mutationId:other},{'X-Oneul-Memo-Session':session}));assert.equal(response.status,409);const data=await response.json();assert.equal(data.code,'memo_session_changed');assert.match(data.error,/이 참가자의 개인 QR/);
});
test('QR retrieval requires verified staff Auth and POST, ignoring caller roles',async()=>{
 for(const options of [{staff:false},{account:{...user,email_confirmed_at:null}}]){const e=edge(()=>{throw new Error('unauthorized RPC');},options);assert.equal((await e.run(req('/memo-api/admin/'+id+'/qr','POST',{actorId:user.id},{Authorization:'Bearer actual'}))).status,403);assert.ok(!e.calls.some(c=>c.url.includes('/rpc/')));}
 const e=edge(()=>{throw new Error('invalid request reached RPC');});assert.equal((await e.run(req('/memo-api/admin/'+id+'/qr','POST',{}))).status,401);assert.equal((await e.run(req('/memo-api/admin/'+id+'/qr','GET',undefined,{Authorization:'Bearer actual'}))).status,405);
});
test('retrieved QR is stable and bound to application, page and canonical QR; only digests reach SQL',async()=>{
 let app=id,pageId=id,canonical='c'.repeat(64);const e=edge((url,data)=>{if(url.endsWith('oneul_memo_qr_info'))return reply({issued:true,applicationId:app,pageId,qrHash:canonical});assert.ok(url.endsWith('oneul_memo_qr_register'));assert.equal(data.p_actor_id,user.id);assert.equal(data.p_application_id,app);assert.equal(data.p_expected_qr_hash,canonical);return reply({issued:true,retrieved:true,applicationId:app,pageId,qrHash:canonical});});
 const retrieve=async()=>{const response=await e.run(req('/memo-api/admin/'+app+'/qr','POST',{actorId:other,qrToken:token},{Authorization:'Bearer actual'}));assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');const result=await response.json();assert.doesNotMatch(JSON.stringify(result),/qrHash|private-service-key/);assert.match(result.qrToken,/^[a-f0-9]{64}$/);assert.equal(e.calls.at(-1).data.p_qr_hash,Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(result.qrToken))).toString('hex'));return result.qrToken;};
 const first=await retrieve();assert.equal(await retrieve(),first);canonical='d'.repeat(64);const changed=await retrieve();assert.notEqual(changed,first);pageId=other;const changedPage=await retrieve();assert.notEqual(changedPage,changed);app=other;assert.notEqual(await retrieve(),changedPage);assert.ok(!e.calls.some(c=>c.url.endsWith('oneul_memo_issue')));
});
test('QR retrieval races, unissued pages and malformed info fail without issuing or exposing a token',async()=>{
 for(const error of [{code:'PT409',message:'Memo QR changed'},{code:'P0002',message:'Memo QR not issued'}]){const e=edge(url=>url.endsWith('oneul_memo_qr_info')&&error.code==='PT409'?reply({issued:true,pageId:id,qrHash:'c'.repeat(64)}):reply(error,409));const response=await e.run(req('/memo-api/admin/'+id+'/qr','POST',{},{Authorization:'Bearer actual'}));assert.equal(response.status,error.code==='PT409'?409:404);assert.equal((await response.json()).qrToken,undefined);}
 const e=edge(()=>reply({issued:true,pageId:id,qrHash:'bad'}));assert.equal((await e.run(req('/memo-api/admin/'+id+'/qr','POST',{},{Authorization:'Bearer actual'}))).status,502);assert.equal(e.calls.filter(c=>c.url.includes('/rpc/')).length,1);
});
test('site QR retrieval requires login and forwards only operator Auth without altering memo cookies',async()=>{
 const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return reply(url.endsWith('/auth/v1/user')?user:{retrieved:true,applicationId:id,qrToken:token});};assert.equal((await api(req('/api/admin/memo/'+id+'/qr','POST',{}),env)).status,401);assert.equal(calls.length,0);const result=await api(req('/api/admin/memo/'+id+'/qr','POST',{},{Cookie:'__Host-oneul_access_p=operator-token'}),env);assert.equal(result.status,200);assert.ok(calls.at(-1).url.endsWith('/memo-api/admin/'+id+'/qr'));assert.equal(calls.at(-1).options.headers.Authorization,'Bearer operator-token');assert.equal(result.headers.get('Set-Cookie'),null);
});
test('both original and retrieved QR scans use the checked exchange RPC',async()=>{
 const e=edge((url,data)=>{assert.ok(url.endsWith('/oneul_memo_exchange_qr'));assert.notEqual(data.p_qr_hash,token);return reply({pageId:id,expiresAt:page.expiresAt});});assert.equal((await e.run(req('/memo-api/exchange','POST',{qrToken:token}))).status,200);
});
