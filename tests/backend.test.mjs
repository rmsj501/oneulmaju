import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../worker/index.mjs';
const originalFetch=globalThis.fetch;
after(()=>{globalThis.fetch=originalFetch;});
const env={SITE_ORIGIN:'https://oneulmaju.rmsj501.chatgpt.site',SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',EMAIL_AUTH_ENABLED:'true',PHONE_AUTH_ENABLED:'true',PROFILE_STORAGE_ENABLED:'true',FILE_STORAGE_ENABLED:'true'};
const user={id:'11111111-1111-4111-8111-111111111111',phone:'821012345678',phone_confirmed_at:'2026-10-06',email:'test@example.test',email_confirmed_at:'2026-10-06',user_metadata:{name:'마주'}};
const session={access_token:'test-access',refresh_token:'test-refresh',expires_in:3600};
const face=user.id+'/face/22222222-2222-4222-8222-222222222222.jpg';
const profile={name:'마주',phone:'01099999999',user_id:'attacker',mode:'guest',gender:'여성',birth:'1994-05-20',height:165,weight:'',region:'서울',district:'강남구',job:'회사원',privacyConsent:true,attachments:{}};
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function mock(handler){const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return handler(url,options);};return calls;}
function request(path,method='GET',body,headers={}){return new Request(env.SITE_ORIGIN+path,{method,headers:{Origin:env.SITE_ORIGIN,Cookie:'__Host-oneul_access_p=test-access','Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});}
function dbMock(verified=user){return mock((url,options)=>{if(url.endsWith('/auth/v1/user'))return reply(verified);if(options.method==='POST')return reply([{...JSON.parse(options.body),user_id:verified.id}]);return reply([]);});}
function recoveryToken(overrides={}) {
  const now=Math.floor(Date.now()/1000);
  const claims={sub:user.id,iss:env.SUPABASE_URL+'/auth/v1',exp:now+3600,amr:[{method:'otp',timestamp:now}],...overrides};
  return Buffer.from('{"alg":"ES256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.signature';
}

test('unconfigured and malformed settings fail without upstream calls or false readiness',async()=>{
  const calls=mock(()=>{throw new Error('must not call');});
  for(const setting of [{},{...env,SUPABASE_URL:'invalid'},{...env,SUPABASE_URL:'https://evil.test'}]){
    const status=await api(request('/api/status'),setting);assert.equal((await status.json()).accountsReady,false);
    assert.equal((await api(request('/api/auth/signup','POST',{}),setting)).status,503);
  }assert.equal(calls.length,0);
});
test('cross-site writes are rejected before authentication',async()=>{
  const calls=mock(()=>{throw new Error('must not call');});assert.equal((await api(request('/api/profile','PUT',profile,{Origin:'https://evil.test'}),env)).status,403);assert.equal(calls.length,0);
});
test('provider keys alone do not enable email accounts before email delivery and redirects are configured',async()=>{
  const calls=mock(()=>{throw new Error('must not call');});
  for(const setting of [{...env,EMAIL_AUTH_ENABLED:undefined},{...env,EMAIL_AUTH_ENABLED:'false'}]){
    const readiness=await (await api(request('/api/status'),setting)).json();
    assert.deepEqual(readiness,{accountsReady:false,phoneRequired:true,phoneReady:false,profilesReady:false,uploadsReady:false});
    for(const path of ['/api/auth/signup','/api/auth/login','/api/auth/import-session','/api/auth/email/resend','/api/auth/recovery/request','/api/auth/recovery/inspect','/api/auth/recovery/status','/api/auth/password']){
      const result=await api(request(path,'POST',{}),setting);
      assert.equal(result.status,503);assert.equal((await result.json()).code,'email_setup_required');
    }
  }
  assert.equal(calls.length,0);
});
test('profiles require a remotely validated account and verified phone',async()=>{
  mock(()=>reply({error:'invalid'},401));assert.equal((await api(request('/api/profile'),env)).status,401);
  dbMock({...user,phone_confirmed_at:null});assert.equal((await api(request('/api/profile'),env)).status,403);
});
test('email-only testing permits verified email but never trusts metadata or marks an entered phone verified',async()=>{
  const testing={...env,PHONE_VERIFICATION_REQUIRED:'false',PHONE_AUTH_ENABLED:'false'};
  const emailUser={...user,phone:'',phone_confirmed_at:null};
  dbMock(emailUser);
  const result=await api(request('/api/profile','PUT',{...profile,phone_verified:true}),testing);
  assert.equal(result.status,200);const saved=(await result.json()).profile;
  assert.equal(saved.phone,'+821099999999');assert.equal(saved.phone_verified,false);assert.equal(saved.user_id,user.id);
  assert.equal((await api(request('/api/profile','PUT',{...profile,phone:'invalid'}),testing)).status,400);
  const me=await (await api(request('/api/auth/me'),testing)).json();
  assert.equal(me.user.emailVerified,true);assert.equal(me.user.phoneVerified,false);
  dbMock({...emailUser,email_confirmed_at:null,user_metadata:{emailVerified:true,phoneVerified:true}});
  assert.equal((await api(request('/api/profile'),testing)).status,403);
  dbMock(emailUser);assert.equal((await api(request('/api/profile'),env)).status,403);
});
test('email test signup, login, confirmation and password reset go directly to the profile; production still requires SMS',async()=>{
  const emailUser={...user,phone:'',phone_confirmed_at:null};
  for(const required of ['false','true',undefined]){
    const setting={...env,PHONE_VERIFICATION_REQUIRED:required};
    mock(url=>url.endsWith('/auth/v1/user')?reply(emailUser):reply(session));
    const next=required==='false'?'/profile/':'/verify-phone/';
    for(const [path,body,headers] of [
      ['/api/auth/signup',{name:'마주',email:user.email,password:'long-password',accountConsent:true},{}],
      ['/api/auth/login',{email:user.email,password:'long-password'},{}],
      ['/api/auth/import-session',{refresh_token:'test-refresh'},{Cookie:'__Host-oneul_signup_p=test%40example.test'}],
      ['/api/auth/password',{password:'long-new-password'},{Cookie:'__Host-oneul_access_p=test-access; __Host-oneul_password_reset_p='+user.id}]
    ]){
      const response=await api(request(path,'POST',body,headers),setting);
      assert.equal(response.status,200);assert.equal((await response.json()).next,next);
    }
  }
});
test('expired access tokens refresh through provider and secure HttpOnly cookies',async()=>{
  const calls=mock((url,options)=>url.includes('grant_type=refresh_token')?reply(session):options.headers.Authorization==='Bearer old'?reply({},401):reply(user));
  const r=await api(request('/api/auth/me','GET',undefined,{Cookie:'__Host-oneul_access_p=old; __Host-oneul_refresh_p=test-refresh'}),env);
  assert.equal(r.status,200);assert.equal((await r.json()).user.id,user.id);assert.equal(calls.length,3);
  assert.match(r.headers.get('Set-Cookie'),/Secure; HttpOnly; SameSite=None; Partitioned/);assert.match(r.headers.get('Set-Cookie'),/Path=\//);
});
test('partitioned login cookies survive a full session round trip and logout clears both cookie generations',async()=>{
  mock(url=>url.includes('grant_type=password')?reply(session):reply(user));
  const login=await api(request('/api/auth/login','POST',{email:user.email,password:'long-password'},{Cookie:''}),env);
  const values=login.headers.getSetCookie();
  const active=values.filter(value=>!value.includes('Max-Age=0;'));
  assert.equal(active.length,2);
  for(const value of active){assert.match(value,/^__Host-oneul_(access|refresh)_p=/);assert.match(value,/Path=\/; Secure; HttpOnly; SameSite=None; Partitioned$/);assert.ok(!value.includes('Domain='));}
  const cookie=active.map(value=>value.split(';')[0]).join('; ');
  const me=await api(request('/api/auth/me','GET',undefined,{Cookie:cookie}),env);
  assert.equal(me.status,200);assert.equal((await me.json()).user.id,user.id);
  const mine=await api(request('/api/my','GET',undefined,{Cookie:cookie}),env);
  assert.equal(mine.status,200);assert.equal((await mine.json()).user.id,user.id);
  const logout=await api(request('/api/auth/logout','POST',{}, {Cookie:cookie}),env);
  for(const name of ['access','refresh','signup','recovery','password_reset']){
    assert.ok(logout.headers.getSetCookie().some(value=>value.startsWith('__Host-oneul_'+name+'_p=; Max-Age=0;')&&value.endsWith('Partitioned')));
    assert.ok(logout.headers.getSetCookie().some(value=>value.startsWith('__Host-oneul_'+name+'=; Max-Age=0;')&&value.endsWith('SameSite=Lax')));
  }
  assert.equal((await api(request('/api/auth/me','GET',undefined,{Cookie:''}),env)).status,401);
});
test('legacy cookie migration validates with the provider and never overrides a newer partitioned account',async()=>{
  const calls=mock(()=>reply(user));
  await api(request('/api/auth/me','GET',undefined,{Cookie:'__Host-oneul_access=legacy'}),env);
  assert.equal(calls.at(-1).options.headers.Authorization,'Bearer legacy');
  await api(request('/api/auth/me','GET',undefined,{Cookie:'__Host-oneul_access=legacy; __Host-oneul_access_p=current'}),env);
  assert.equal(calls.at(-1).options.headers.Authorization,'Bearer current');
  await api(request('/api/auth/me','GET',undefined,{Cookie:'__Host-oneul_access_p=current; __Host-oneul_access=legacy'}),env);
  assert.equal(calls.at(-1).options.headers.Authorization,'Bearer current');
});
test('profile ownership and contact derive from the verified account, and removed fields are ignored',async()=>{
  const calls=dbMock();const r=await api(request('/api/profile','PUT',{...profile,education:'x',salary:'x',marriage:'x',intro:'x',religion:'무교',smoking:'비흡연',drinking:'가끔 마셔요',sensitiveConsent:false}),env);
  assert.equal(r.status,200);const data=await r.json();assert.equal(data.saved,true);assert.equal(data.profile.user_id,user.id);assert.equal(data.profile.phone,'+821012345678');assert.equal(data.profile.kind,'member');
  for(const field of ['education','salary','marriage','intro','religion','smoking','drinking','sensitive_consent_at'])assert.equal(field in data.profile,false);
  const stored=JSON.parse(calls.find(c=>c.url.includes('on_conflict=user_id')).options.body);for(const field of ['religion','smoking','drinking','sensitive_consent_at'])assert.equal(stored[field],null);
  assert.ok(calls.every(c=>c.options.headers.Authorization==='Bearer test-access'));assert.equal(data.profile.district,'강남구');
});
test('Seoul requires one of its districts; other regions discard hidden district data',async()=>{
  dbMock();assert.equal((await api(request('/api/profile','PUT',{...profile,district:''}),env)).status,400);
  assert.equal((await api(request('/api/profile','PUT',{...profile,district:'가짜구'}),env)).status,400);
  const r=await api(request('/api/profile','PUT',{...profile,region:'경기',district:'강남구'}),env);assert.equal((await r.json()).profile.district,null);
});
test('consent, dates, enums and attachment ownership are enforced server-side',async()=>{
  dbMock();for(const change of [{privacyConsent:false},{birth:'2026-02-30'},{gender:'invalid'},{job:''},{attachments:{face},photoConsent:false},{attachments:{face:'someone-else/face/a.jpg'},photoConsent:true}])assert.equal((await api(request('/api/profile','PUT',{...profile,...change}),env)).status,400);
  const r=await api(request('/api/profile','PUT',{...profile,attachments:{face},photoConsent:true}),env);assert.equal((await r.json()).profile.face_path,face);
});
test('failed or mismatched saves never report saved',async()=>{
  mock((url,options)=>url.endsWith('/auth/v1/user')?reply(user):options.method==='POST'?reply([{user_id:'someone-else'}]):reply([]));
  const r=await api(request('/api/profile','PUT',profile),env);assert.equal(r.status,502);assert.equal((await r.json()).saved,undefined);
});
test('SMS setup guard prevents sending; managed SMS failures never report sent',async()=>{
  const calls=mock(()=>reply({},429));assert.equal((await api(request('/api/auth/guest/request','POST',{phone:'01012345678',accountConsent:true}),{...env,PHONE_AUTH_ENABLED:'false'})).status,503);assert.equal(calls.length,0);
  const r=await api(request('/api/auth/guest/request','POST',{phone:'01012345678',accountConsent:true}),env);assert.equal(r.status,429);assert.equal((await r.json()).sent,undefined);
});
test('SMS signup uses normalized Korean number and requires consent',async()=>{
  const calls=mock(()=>reply({}));assert.equal((await api(request('/api/auth/guest/request','POST',{phone:'01012345678'}),env)).status,400);assert.equal(calls.length,0);
  const r=await api(request('/api/auth/guest/request','POST',{phone:'010-1234-5678',accountConsent:true}),env);assert.equal((await r.json()).sent,true);assert.deepEqual(JSON.parse(calls[0].options.body),{phone:'+821012345678',create_user:true});
});
test('OTP must validate with provider and match the verified number before setting a session',async()=>{
  mock(url=>url.endsWith('/auth/v1/verify')?reply(session):reply({...user,phone:'821099999999'}));
  const r=await api(request('/api/auth/guest/verify','POST',{phone:'01012345678',code:'123456'}),env);assert.equal(r.status,403);assert.equal(r.headers.get('Set-Cookie'),null);
  mock(()=>reply({},400));assert.equal((await api(request('/api/auth/guest/verify','POST',{phone:'01012345678',code:'123456'}),env)).status,400);
});
test('member phone verification cannot switch account identity',async()=>{
  let reads=0;mock(url=>url.endsWith('/auth/v1/verify')?reply(session):reply(++reads===1?user:{...user,id:'someone-else'}));
  const r=await api(request('/api/auth/phone/verify','POST',{phone:'01012345678',code:'123456'}),env);assert.equal(r.status,403);assert.equal(r.headers.get('Set-Cookie'),null);
});
test('email signup and login return no access tokens or passwords to browser JSON',async()=>{
  mock(url=>url.endsWith('/auth/v1/user')?reply(user):reply(session));
  for(const [path,body]of [['/api/auth/signup',{name:'마주',email:'test@example.test',password:'long-password',phone:'01012345678',accountConsent:true}],['/api/auth/login',{email:'test@example.test',password:'long-password'}]]){
    const r=await api(request(path,'POST',body),env);assert.equal(r.status,200);const text=await r.text();assert.ok(!text.includes('test-access'));assert.ok(!text.includes('test-refresh'));assert.ok(!text.includes('long-password'));assert.match(r.headers.get('Set-Cookie'),/HttpOnly/);
  }
});
test('email reissue and recovery use the allowed callback and never disclose account existence or tokens',async()=>{
  const calls=mock(()=>reply({}));
  for(const [route,upstream,cookie] of [['email/resend','resend','__Host-oneul_signup_p'],['recovery/request','recover','__Host-oneul_recovery_p']]){
    const response=await api(request('/api/auth/'+route,'POST',{email:' Test@Example.test '}),env);
    assert.deepEqual(await response.json(),{accepted:true});
    const call=calls.at(-1);const url=new URL(call.url);
    assert.equal(url.pathname,'/auth/v1/'+upstream);
    assert.equal(url.searchParams.get('redirect_to'),env.SITE_ORIGIN+'/auth/confirm/');
    assert.deepEqual(JSON.parse(call.options.body),upstream==='resend'?{type:'signup',email:user.email}:{email:user.email});
    assert.match(response.headers.get('Set-Cookie'),new RegExp(cookie+'=test%40example.test; Max-Age=3600; Path=/; Secure; HttpOnly; SameSite=None; Partitioned'));
  }
  const before=calls.length;
  assert.equal((await api(request('/api/auth/recovery/request','POST',{email:'invalid'}),env)).status,400);
  assert.equal((await api(request('/api/auth/email/resend','POST',{email:user.email},{Origin:'https://evil.test'}),env)).status,403);
  assert.equal(calls.length,before);
  mock(()=>reply({error_code:'over_email_send_rate_limit'},429));
  const limited=await api(request('/api/auth/recovery/request','POST',{email:user.email}),env);
  assert.equal(limited.status,429);assert.equal(limited.headers.get('Set-Cookie'),null);assert.equal((await limited.json()).accepted,undefined);
});
test('confirmation import requires the initiating browser and a provider-confirmed matching email',async()=>{
  const calls=mock(url=>url.includes('grant_type=refresh_token')?reply(session):reply(user));
  assert.equal((await api(request('/api/auth/import-session','POST',{refresh_token:'test-refresh'},{Cookie:''}),env)).status,403);
  assert.equal(calls.length,0);
  const response=await api(request('/api/auth/import-session','POST',{refresh_token:'test-refresh'},{Cookie:'__Host-oneul_signup_p=test%40example.test'}),env);
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{next:'/profile/'});
  assert.match(response.headers.get('Set-Cookie'),/__Host-oneul_access_p=test-access/);
  for(const changed of [{...user,email:'other@example.test'},{...user,email_confirmed_at:null}]){
    mock(url=>url.includes('grant_type=refresh_token')?reply(session):reply(changed));
    const rejected=await api(request('/api/auth/import-session','POST',{refresh_token:'test-refresh'},{Cookie:'__Host-oneul_signup_p=test%40example.test'}),env);
    assert.equal(rejected.status,403);assert.equal(rejected.headers.get('Set-Cookie'),null);
  }
});
test('recovery cannot borrow a signup flow and binds password editing to the recovered account',async()=>{
  const calls=mock(url=>url.includes('grant_type=refresh_token')?reply(session):reply(user));
  const body={refresh_token:'test-refresh',purpose:'recovery'};
  assert.equal((await api(request('/api/auth/import-session','POST',body,{Cookie:'__Host-oneul_signup_p=test%40example.test'}),env)).status,403);
  assert.equal(calls.length,0);
  const response=await api(request('/api/auth/import-session','POST',body,{Cookie:'__Host-oneul_recovery_p=test%40example.test'}),env);
  assert.deepEqual(await response.json(),{passwordResetReady:true});
  assert.match(response.headers.get('Set-Cookie'),new RegExp('__Host-oneul_password_reset_p='+user.id+'; Max-Age=600; Path=/; Secure; HttpOnly; SameSite=None; Partitioned'));
  assert.match(response.headers.get('Set-Cookie'),/__Host-oneul_recovery_p=; Max-Age=0/);
  assert.equal((await api(request('/api/auth/password','POST',{password:'new-password-long'}),env)).status,403);
  const wrong={Cookie:'__Host-oneul_access_p=test-access; __Host-oneul_password_reset_p=another-user'};
  assert.equal((await api(request('/api/auth/password','POST',{password:'new-password-long'},wrong),env)).status,403);
  assert.equal(calls.filter(c=>c.options.method==='PUT').length,0);
});
test('password reset validates length, confirms the changed identity and clears the short-lived reset permission',async()=>{
  const calls=mock(()=>reply(user));
  const headers={Cookie:'__Host-oneul_access_p=test-access; __Host-oneul_password_reset_p='+user.id};
  assert.deepEqual(await (await api(request('/api/auth/recovery/status','GET',undefined,headers),env)).json(),{passwordResetReady:true});
  assert.equal((await api(request('/api/auth/password','POST',{password:'short'},headers),env)).status,400);
  const response=await api(request('/api/auth/password','POST',{password:'new-password-long'},headers),env);
  assert.deepEqual(await response.json(),{updated:true,next:'/profile/'});
  const update=calls.find(c=>c.options.method==='PUT');
  assert.equal(update.url,env.SUPABASE_URL+'/auth/v1/user');assert.equal(update.options.headers.Authorization,'Bearer test-access');
  assert.deepEqual(JSON.parse(update.options.body),{password:'new-password-long'});
  assert.match(response.headers.get('Set-Cookie'),/__Host-oneul_password_reset_p=; Max-Age=0/);
  mock((_url,options)=>reply(options.method==='PUT'?{id:'different-user'}:user));
  const mismatch=await api(request('/api/auth/password','POST',{password:'new-password-long'},headers),env);
  assert.equal(mismatch.status,502);assert.equal((await mismatch.json()).updated,undefined);
});
test('login failures distinguish wrong credentials from an unconfirmed email without returning provider secrets',async()=>{
  for(const [code,message] of [['invalid_credentials',/이메일 또는 비밀번호/],['email_not_confirmed',/이메일 인증/]]){
    mock(()=>reply({error_code:code,msg:'sensitive upstream detail'},400));
    const response=await api(request('/api/auth/login','POST',{email:user.email,password:'long-password'}),env);
    const body=await response.json();assert.equal(body.code,code);assert.match(body.error,message);assert.ok(!body.error.includes('sensitive'));
  }
});
test('a valid recovery link is inspected without the request-browser cookie, without logging in or returning credentials',async()=>{
  const token=recoveryToken();const calls=mock(()=>reply(user));
  const response=await api(request('/api/auth/recovery/inspect','POST',{access_token:token},{Cookie:''}),env);
  assert.deepEqual(await response.json(),{passwordResetReady:true,email:user.email});
  assert.equal(response.headers.get('Set-Cookie'),null);assert.equal(calls.length,1);
  assert.equal(calls[0].options.headers.Authorization,'Bearer '+token);
  const foreign=await api(request('/api/auth/recovery/inspect','POST',{access_token:token},{Cookie:'',Origin:'https://evil.test'}),env);
  assert.equal(foreign.status,403);assert.equal(calls.length,1);
});
test('recovery inspection rejects unverified provider tokens, non-recovery sessions, old recovery and conflicting claims',async()=>{
  mock(()=>reply({error_code:'bad_jwt'},401));
  const invalid=await api(request('/api/auth/recovery/inspect','POST',{access_token:recoveryToken()},{Cookie:''}),env);
  assert.equal(invalid.status,401);assert.equal((await invalid.json()).passwordResetReady,undefined);
  const now=Math.floor(Date.now()/1000);
  for(const change of [{amr:[{method:'password',timestamp:now}]},{amr:[{method:'recovery',timestamp:now-3601}]},{sub:'different-user'},{iss:'https://evil.supabase.co/auth/v1'},{exp:now-1}]){
    mock(()=>reply(user));
    const response=await api(request('/api/auth/recovery/inspect','POST',{access_token:recoveryToken(change)},{Cookie:''}),env);
    assert.equal(response.status,403);assert.equal(response.headers.get('Set-Cookie'),null);
  }
  mock(()=>reply({...user,email_confirmed_at:null}));
  assert.equal((await api(request('/api/auth/recovery/inspect','POST',{access_token:recoveryToken()},{Cookie:''}),env)).status,403);
});
test('recovery submits a new password without a browser marker only after account consent and matching recovery sessions',async()=>{
  const token=recoveryToken();const refreshed={...session,access_token:token};
  const calls=mock((url)=>url.includes('grant_type=refresh_token')?reply(refreshed):reply(user));
  const body={access_token:token,refresh_token:'test-refresh',email:user.email,password:'new-long-password',recoveryConsent:true};
  const denied=await api(request('/api/auth/password','POST',{...body,recoveryConsent:false},{Cookie:''}),env);
  assert.equal(denied.status,400);assert.equal(calls.length,0);
  const response=await api(request('/api/auth/password','POST',body,{Cookie:''}),env);
  assert.deepEqual(await response.json(),{updated:true,next:'/profile/'});
  assert.match(response.headers.get('Set-Cookie'),/__Host-oneul_access_p=/);
  const put=calls.find(c=>c.options.method==='PUT');assert.deepEqual(JSON.parse(put.options.body),{password:'new-long-password'});
  assert.equal(put.options.headers.Authorization,'Bearer '+token);
  mock(()=>reply(user));
  assert.equal((await api(request('/api/auth/password','POST',{...body,email:'different@example.test'},{Cookie:''}),env)).status,403);
});
test('recovery cannot mix an access token and refresh token belonging to different accounts',async()=>{
  const other={...user,id:'22222222-2222-4222-8222-222222222222',email:'other@example.test'};
  const token=recoveryToken();const otherToken=recoveryToken({sub:other.id});
  const calls=mock((url,options)=>url.includes('grant_type=refresh_token')?reply({...session,access_token:otherToken}):reply(options.headers.Authorization==='Bearer '+token?user:other));
  const response=await api(request('/api/auth/password','POST',{access_token:token,refresh_token:'other-refresh',email:user.email,password:'new-long-password',recoveryConsent:true},{Cookie:''}),env);
  assert.equal(response.status,403);assert.equal(response.headers.get('Set-Cookie'),null);assert.equal(calls.filter(c=>c.options.method==='PUT').length,0);
});
test('uploads require setup, verified identity and consent; foreign download paths are denied',async()=>{
  const calls=dbMock();assert.equal((await api(request('/api/uploads/face','POST',{}),{...env,FILE_STORAGE_ENABLED:'false'})).status,503);assert.equal(calls.length,0);
  assert.equal((await api(request('/api/uploads/face','POST',{}),env)).status,400);
  assert.equal((await api(request('/api/uploads/face?path=someone-else%2Fface%2Fa.jpg'),env)).status,400);
});
test('uploads validate bytes and MIME; PDF is accepted only for employment and oversized streams are rejected',async()=>{
  const calls=mock(url=>url.endsWith('/auth/v1/user')?reply(user):reply({Key:'file'}));
  const upload=(slot,body,type)=>new Request(env.SITE_ORIGIN+'/api/uploads/'+slot,{method:'POST',headers:{Origin:env.SITE_ORIGIN,Cookie:'__Host-oneul_access_p=test-access','Content-Type':type,'X-Oneul-File-Consent':'true'},body});
  assert.equal((await api(upload('face','<script>evil</script>','image/jpeg'),env)).status,400);
  assert.equal((await api(upload('face','%PDF-1.7 test','application/pdf'),env)).status,400);
  const result=await api(upload('employment','%PDF-1.7 test','application/pdf'),env);assert.equal(result.status,200);const data=await result.json();assert.ok(data.path.startsWith(user.id+'/employment/'));assert.ok(data.path.endsWith('.pdf'));assert.equal(calls.at(-1).options.headers['x-upsert'],'false');
  assert.equal((await api(upload('face',new Uint8Array(8*1024*1024+1),'image/png'),env)).status,413);
});
test('private downloads keep cache disabled and never expose auth credentials',async()=>{
  mock(url=>url.endsWith('/auth/v1/user')?reply(user):new Response(new Uint8Array([255,216,255]),{headers:{'Content-Type':'image/jpeg'}}));
  const r=await api(request('/api/uploads/face?path='+encodeURIComponent(face)),env);assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.match(r.headers.get('Content-Disposition'),/attachment/);assert.equal(r.headers.get('Authorization'),null);
});
test('delete removes only authenticated profile attachments before the profile row',async()=>{
  const calls=mock((url,options)=>url.endsWith('/auth/v1/user')?reply(user):url.includes('select=*')?reply([{user_id:user.id,face_path:face}]):reply([]));
  assert.equal((await api(request('/api/profile','DELETE',{}),env)).status,200);
  const deletion=calls.filter(c=>c.options.method==='DELETE');assert.equal(deletion.length,2);assert.deepEqual(JSON.parse(deletion[0].options.body),{prefixes:[face]});assert.ok(deletion[1].url.includes(user.id));
});
