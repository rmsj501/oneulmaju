import {AppError,phone,ownedPath,cleanProfile,publicProfile} from '../shared/profile.mjs';
import { commerce, commercePublic } from './commerce.mjs';
import { applications } from './applications.mjs';
import { memos } from './memos.mjs';
const ACCESS = '__Host-oneul_access_p';
const REFRESH = '__Host-oneul_refresh_p';
const FLOW = '__Host-oneul_signup_p';
const RECOVERY = '__Host-oneul_recovery_p';
const PASSWORD_RESET = '__Host-oneul_password_reset_p';
const AUTH_COOKIES = [ACCESS, REFRESH, FLOW, RECOVERY, PASSWORD_RESET];
const BUCKET = 'oneul-verification';
const SLOTS = ['face','fullbody','employment'];
const fail = (status, message, code) => { throw new AppError(status, message, code); };
function cookies(request) {
  const map = {};
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const at = part.indexOf('='); if (at < 0) continue;
    try { map[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1)); } catch { /* ignore invalid cookie */ }
  }
  // Prefer the new partitioned cookie when both generations are present.
  for (const name of AUTH_COOKIES) if (map[name] === undefined && map[name.slice(0,-2)] !== undefined) map[name] = map[name.slice(0,-2)];
  return map;
}
function setCookie(headers, name, value, age) {
  // CHIPS keeps HttpOnly sessions inside cross-site Site previews, including
  // browsers blocking ordinary third-party cookies. Origin checks still apply.
  headers.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Max-Age=${age}; Path=/; Secure; HttpOnly; SameSite=None; Partitioned`);
  // Remove the former unpartitioned cookie; never duplicate its live value.
  headers.append('Set-Cookie', `${name.slice(0,-2)}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`);
}
function clearSession(headers) { setCookie(headers, ACCESS, '', 0); setCookie(headers, REFRESH, '', 0); }
function setSession(headers, session) {
  if (!session?.access_token || !session?.refresh_token) fail(502, '로그인 정보를 확인하지 못했어요. 다시 로그인해주세요.');
  setCookie(headers, ACCESS, session.access_token, Math.min(Number(session.expires_in) || 3600, 7200));
  setCookie(headers, REFRESH, session.refresh_token, 60 * 60 * 24 * 30);
}
function config(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !env.SITE_ORIGIN) fail(503, '회원 서비스 연결을 준비 중이에요. 잠시 후 다시 이용해주세요.', 'setup_required');
  let u, site;
  try { u = new URL(env.SUPABASE_URL); site = new URL(env.SITE_ORIGIN); } catch { fail(503, '회원 서비스 설정을 확인 중이에요.', 'setup_required'); }
  if (u.protocol !== 'https:' || !u.hostname.endsWith('.supabase.co') || u.pathname !== '/' || u.search || u.hash) fail(503, '회원 서비스 설정을 확인 중이에요.', 'setup_required');
  if (site.protocol !== 'https:' || site.origin !== env.SITE_ORIGIN) fail(503, '사이트 연결 설정을 확인 중이에요.', 'setup_required');
  return u.origin;
}
async function provider(env, path, {method = 'GET', body, rawBody, rawResponse = false, token, headers = {}} = {}) {
  const origin = config(env);
  let response;
  try {
    response = await fetch(origin + path, {method, headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY, ...(token ? {Authorization:'Bearer '+token} : {}), 'Content-Type':'application/json', ...headers}, body:rawBody || (body === undefined ? undefined : JSON.stringify(body)), signal:AbortSignal.timeout(15000)});
  } catch { fail(503, '회원 서비스에 연결하지 못했어요. 입력 내용은 유지되니 잠시 후 다시 시도해주세요.'); }
  if (response.ok && rawResponse) return response;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 429) fail(429, '요청이 많아요. 잠시 기다린 후 다시 시도해주세요.');
    if (response.status >= 500) fail(503, '회원 서비스가 잠시 응답하지 않아요. 다시 시도해주세요.');
    const code = data?.error_code || data?.code || 'provider_error';
    if (code === 'invalid_credentials') fail(400, '이메일 또는 비밀번호가 맞지 않아요. 비밀번호가 기억나지 않으면 재설정해주세요.', code);
    if (code === 'email_not_confirmed') fail(400, '이메일 인증을 먼저 완료해주세요. 확인메일이 없다면 인증 메일을 다시 받아주세요.', code);
    if (code === 'otp_expired') fail(400, '인증 링크가 만료됐거나 이미 사용됐어요. 인증을 마쳤다면 로그인하고, 아니라면 새 메일을 받아주세요.', code);
    fail(response.status === 401 || response.status === 403 ? 401 : 400, '입력 정보 또는 인증번호를 확인해주세요. 만료된 인증번호는 다시 요청해주세요.', code);
  }
  return data;
}
async function identity(request, env, responseHeaders) {
  const c = cookies(request);
  let token = c[ACCESS];
  if (token) {
    try { const user = await provider(env, '/auth/v1/user', {token}); return {user, token}; }
    catch (error) { if (error.status !== 401 && error.status !== 400) throw error; }
  }
  if (c[REFRESH]) {
    try {
      const session = await provider(env, '/auth/v1/token?grant_type=refresh_token', {method:'POST', body:{refresh_token:c[REFRESH]}});
      const user = await provider(env, '/auth/v1/user', {token:session.access_token});
      setSession(responseHeaders, session); return {user, token:session.access_token};
    } catch (error) { if (error.status !== 401 && error.status !== 400) throw error; }
  }
  clearSession(responseHeaders); fail(401, '로그인이 필요해요. 회원 로그인 또는 휴대폰 인증으로 시작해주세요.');
}
function summary(user) { return {id:user.id, name:String(user.user_metadata?.name || ''), phone:user.phone || '', email:user.email || '', mode:user.email ? 'member' : 'guest', emailVerified:!!user.email_confirmed_at && !!user.email, phoneVerified:!!user.phone_confirmed_at && !!user.phone}; }
const phoneRequired = env => env.PHONE_VERIFICATION_REQUIRED !== 'false';
function verifiedForProfile(user, env) { const value = summary(user); return value.phoneVerified || (!phoneRequired(env) && value.emailVerified); }
const authNext = (user,env) => verifiedForProfile(user,env) ? '/profile/' : '/verify-phone/';
async function recoveryIdentity(env, token) {
  if (typeof token !== 'string' || token.length > 8000 || token.split('.').length !== 3) fail(400, '새 비밀번호 재설정 메일의 링크를 열어주세요.','recovery_required');
  // The provider validates the signed token before any decoded claim is trusted.
  const user = await provider(env,'/auth/v1/user',{token});
  let claims;
  try { const encoded = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'); claims = JSON.parse(atob(encoded)); }
  catch { fail(403, '비밀번호 재설정 인증을 확인하지 못했어요. 새 메일을 받아주세요.','recovery_required'); }
  const now = Math.floor(Date.now()/1000);
  // Supabase's implicit email-link verification records recovery as OTP.
  // Require fresh provider-attested OTP/recovery plus explicit account consent;
  // the client-supplied URL "type" is never authorization evidence.
  const recovered = Array.isArray(claims.amr) && claims.amr.some(method => ['otp','recovery'].includes(method.method) && Number.isFinite(method.timestamp) && method.timestamp <= now+30 && method.timestamp >= now-3600);
  if (!recovered || claims.sub !== user.id || claims.iss !== config(env)+'/auth/v1' || !Number.isFinite(claims.exp) || claims.exp <= now || !user.email || !user.email_confirmed_at) fail(403, '비밀번호 재설정 인증이 만료됐거나 확인되지 않았어요. 새 메일을 받아주세요.','recovery_required');
  return user;
}
async function verifiedIdentity(request, env, headers) {
  const result = await identity(request, env, headers);
  if (!verifiedForProfile(result.user,env)) fail(403, phoneRequired(env) ? '프로필을 이용하려면 휴대폰 인증을 먼저 완료해주세요.' : '이메일 또는 휴대폰 인증을 먼저 완료해주세요.', 'verification_required');
  return result;
}
async function bodyOf(request) {
  const raw = new TextDecoder().decode(await limitedBody(request,16000));
  try { const value = JSON.parse(raw); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { fail(400, '입력 내용을 확인해주세요.'); }
}
async function limitedBody(request, limit) {
  if (Number(request.headers.get('Content-Length')) > limit) fail(413, '파일 또는 입력 내용이 너무 커요.');
  const reader = request.body?.getReader(); if (!reader) return new Uint8Array();
  let length = 0; const chunks = [];
  try { while (true) { const {done,value} = await reader.read(); if (done) break; length += value.length; if (length > limit) { await reader.cancel(); fail(413,'파일 또는 입력 내용이 너무 커요.'); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let at = 0; for (const chunk of chunks) { bytes.set(chunk,at); at += chunk.length; } return bytes;
}
const attachmentPaths = row => SLOTS.map(slot=>row?.[slot+'_path']).filter(Boolean);
async function deleteFiles(env, token, paths) {
  if (paths.length) await provider(env,'/storage/v1/object/'+BUCKET,{method:'DELETE',token,body:{prefixes:paths}});
}
export async function api(request, env) {
  const path = new URL(request.url).pathname;
  const headers = new Headers({'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});
  const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers});
  try {
    if (path === '/api/status' && request.method === 'GET') { let accountsReady = false; try { config(env); accountsReady = env.EMAIL_AUTH_ENABLED === 'true'; } catch {} return json({accountsReady, phoneRequired:phoneRequired(env), phoneReady:accountsReady && env.PHONE_AUTH_ENABLED === 'true', profilesReady:accountsReady && env.PROFILE_STORAGE_ENABLED === 'true', uploadsReady:accountsReady && env.FILE_STORAGE_ENABLED === 'true'}); }
    const publicResult = await commercePublic(request,env,{json,provider}); if (publicResult) return publicResult;
    config(env);
    if (!['GET','POST','PUT','DELETE'].includes(request.method)) fail(405, '지원하지 않는 요청이에요.');
    if (request.method !== 'GET' && request.headers.get('Origin') !== new URL(env.SITE_ORIGIN).origin) fail(403, '이 사이트에서 다시 요청해주세요.');
    const memoResult=await memos(request,env,{json,identity,bodyOf,fail,headers,cookies,setCookie});if(memoResult)return memoResult;
    const applicationResult=await applications(request,env,{json,identity,bodyOf,fail,headers,cookies,setCookie,limitedBody});if(applicationResult)return applicationResult;
    if (['/api/auth/signup','/api/auth/login','/api/auth/import-session','/api/auth/email/resend','/api/auth/recovery/request','/api/auth/recovery/inspect','/api/auth/recovery/status','/api/auth/password'].includes(path) && env.EMAIL_AUTH_ENABLED !== 'true') fail(503, '회원가입 확인메일 연결을 준비 중이에요. 잠시 후 다시 이용해주세요.', 'email_setup_required');
    const commerceResult = await commerce(request,env,{json,provider,identity,verifiedIdentity,bodyOf,fail,summary,headers}); if (commerceResult) return commerceResult;
    if (path === '/api/auth/signup' && request.method === 'POST') {
      const b = await bodyOf(request); const email = String(b.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || typeof b.password !== 'string' || b.password.length < 10 || b.password.length > 128 || !String(b.name || '').trim() || String(b.name).length > 30) fail(400, '이름·이메일과 10자 이상 비밀번호를 확인해주세요.');
      if (b.accountConsent !== true) fail(400,'회원 등록을 위한 개인정보 수집·이용 안내에 동의해주세요.');
      const data = await provider(env, '/auth/v1/signup?redirect_to=' + encodeURIComponent(new URL('/auth/confirm/', env.SITE_ORIGIN).href), {method:'POST', body:{email,password:b.password,data:{name:String(b.name).trim()}}});
      if (data.access_token) { const user = await provider(env,'/auth/v1/user',{token:data.access_token}); if (!summary(user).emailVerified) fail(403,'이메일 인증을 먼저 완료해주세요.','email_not_confirmed'); setSession(headers, data); return json({next:authNext(user,env)}); }
      setCookie(headers, FLOW, email, 3600); return json({emailConfirmationRequired:true});
    }
    if (path === '/api/auth/import-session' && request.method === 'POST') {
      const b = await bodyOf(request);
      if (b.purpose !== undefined && b.purpose !== 'recovery') fail(400, '인증 요청을 확인해주세요.');
      const recovering = b.purpose === 'recovery';
      const expected = cookies(request)[recovering ? RECOVERY : FLOW];
      if (!expected || typeof b.refresh_token !== 'string' || !b.refresh_token || b.refresh_token.length > 500) fail(403, recovering ? '비밀번호 재설정을 요청한 브라우저에서 새 메일의 링크를 열어주세요.' : '가입한 브라우저에서 확인 링크를 열어주세요. 이메일 확인 후 회원 로그인으로도 계속할 수 있어요.');
      const data = await provider(env, '/auth/v1/token?grant_type=refresh_token', {method:'POST',body:{refresh_token:b.refresh_token}});
      const user = await provider(env, '/auth/v1/user', {token:data.access_token});
      if (!user.email_confirmed_at || !user.email || user.email.toLowerCase() !== expected.toLowerCase()) fail(403, '이메일 확인 정보를 확인해주세요.');
      setSession(headers,data);
      setCookie(headers,recovering ? RECOVERY : FLOW,'',0);
      if (recovering) { setCookie(headers,PASSWORD_RESET,user.id,600); return json({passwordResetReady:true}); }
      setCookie(headers,PASSWORD_RESET,'',0);
      return json({next:authNext(user,env)});
    }
    if ((path === '/api/auth/email/resend' || path === '/api/auth/recovery/request') && request.method === 'POST') {
      const b = await bodyOf(request); const email = String(b.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) fail(400, '이메일 주소를 확인해주세요.');
      const recovering = path === '/api/auth/recovery/request';
      const redirect = encodeURIComponent(new URL('/auth/confirm/',env.SITE_ORIGIN).href);
      await provider(env,'/auth/v1/'+(recovering ? 'recover' : 'resend')+'?redirect_to='+redirect,{method:'POST',body:recovering ? {email} : {type:'signup',email}});
      setCookie(headers,recovering ? RECOVERY : FLOW,email,3600);
      setCookie(headers,PASSWORD_RESET,'',0);
      return json({accepted:true});
    }
    if (path === '/api/auth/recovery/inspect' && request.method === 'POST') {
      const b = await bodyOf(request); const user = await recoveryIdentity(env,b.access_token);
      return json({passwordResetReady:true,email:user.email});
    }
    let passwordBody;
    if (path === '/api/auth/password' && request.method === 'POST') {
      const b = await bodyOf(request);
      passwordBody = b;
      if (b.access_token !== undefined) {
        if (b.recoveryConsent !== true || typeof b.refresh_token !== 'string' || !b.refresh_token || b.refresh_token.length > 500) fail(400, '표시된 이메일 계정의 비밀번호 변경에 동의해주세요.','recovery_required');
        if (typeof b.password !== 'string' || b.password.length < 10 || b.password.length > 128) fail(400, '새 비밀번호를 10~128자로 입력해주세요.');
        const recovered = await recoveryIdentity(env,b.access_token);
        if (b.email !== recovered.email) fail(403, '비밀번호를 변경할 이메일 계정을 확인해주세요.','recovery_required');
        const session = await provider(env,'/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:b.refresh_token}});
        const user = await recoveryIdentity(env,session.access_token);
        if (user.id !== recovered.id || user.email !== recovered.email) fail(403, '비밀번호 재설정 계정이 일치하지 않아요.','recovery_required');
        const updated = await provider(env,'/auth/v1/user',{method:'PUT',token:session.access_token,body:{password:b.password}});
        if (updated?.id !== user.id) fail(502, '비밀번호 변경을 확인하지 못했어요. 다시 시도해주세요.');
        setSession(headers,session);setCookie(headers,PASSWORD_RESET,'',0);setCookie(headers,RECOVERY,'',0);setCookie(headers,FLOW,'',0);
        return json({updated:true,next:authNext(updated,env)});
      }
    }
    if ((path === '/api/auth/recovery/status' && request.method === 'GET') || (path === '/api/auth/password' && request.method === 'POST')) {
      if (!cookies(request)[PASSWORD_RESET]) fail(403, '비밀번호 재설정 메일을 먼저 요청해주세요.','recovery_required');
      const {user,token} = await identity(request,env,headers);
      if (cookies(request)[PASSWORD_RESET] !== user.id) fail(403, '비밀번호 재설정 정보를 확인해주세요.','recovery_required');
      if (request.method === 'GET') return json({passwordResetReady:true});
      const b = passwordBody;
      if (typeof b.password !== 'string' || b.password.length < 10 || b.password.length > 128) fail(400, '새 비밀번호를 10~128자로 입력해주세요.');
      const updated = await provider(env,'/auth/v1/user',{method:'PUT',token,body:{password:b.password}});
      if (updated?.id !== user.id) fail(502, '비밀번호 변경을 확인하지 못했어요. 다시 시도해주세요.');
      setCookie(headers,PASSWORD_RESET,'',0);
      return json({updated:true,next:authNext(updated,env)});
    }
    if (path === '/api/auth/login' && request.method === 'POST') {
      const b = await bodyOf(request);
      if (typeof b.email !== 'string' || typeof b.password !== 'string' || b.email.length > 254 || b.password.length > 128) fail(400,'이메일과 비밀번호를 입력해주세요.');
      const data = await provider(env, '/auth/v1/token?grant_type=password', {method:'POST',body:{email:b.email.trim().toLowerCase(),password:b.password}});
      const user = await provider(env,'/auth/v1/user',{token:data.access_token}); if (!summary(user).emailVerified && !summary(user).phoneVerified) fail(403,'이메일 인증을 먼저 완료해주세요.','email_not_confirmed'); setSession(headers,data);
      setCookie(headers,PASSWORD_RESET,'',0); setCookie(headers,RECOVERY,'',0); setCookie(headers,FLOW,'',0);
      return json({next:authNext(user,env)});
    }
    if (path === '/api/auth/me' && request.method === 'GET') { const {user} = await identity(request,env,headers); return json({user:summary(user)}); }
    if ((path === '/api/auth/guest/request' || path === '/api/auth/phone/request') && request.method === 'POST') {
      if (env.PHONE_AUTH_ENABLED !== 'true') fail(503,'문자 인증 연결을 준비 중이에요. 아직 인증번호가 발송되지 않아요.','sms_setup_required');
      const b = await bodyOf(request); const p = phone(b.phone);
      if (path.includes('/guest/')) { if (b.accountConsent !== true) fail(400,'휴대폰 인증을 위한 개인정보 안내에 동의해주세요.'); await provider(env,'/auth/v1/otp',{method:'POST',body:{phone:p,create_user:true}}); }
      else { const {token} = await identity(request,env,headers); await provider(env,'/auth/v1/user',{method:'PUT',token,body:{phone:p}}); }
      return json({sent:true,phone:p});
    }
    if ((path === '/api/auth/guest/verify' || path === '/api/auth/phone/verify') && request.method === 'POST') {
      if (env.PHONE_AUTH_ENABLED !== 'true') fail(503,'문자 인증 연결을 준비 중이에요.','sms_setup_required');
      const b = await bodyOf(request); const p = phone(b.phone);
      if (!/^\d{6}$/.test(String(b.code || ''))) fail(400,'인증번호 6자리를 입력해주세요.');
      const guest = path.includes('/guest/');
      const previous = guest ? null : await identity(request,env,headers);
      const data = await provider(env,'/auth/v1/verify',{method:'POST',token:previous?.token,body:{phone:p,token:b.code,type:guest ? 'sms' : 'phone_change'}});
      const token = data.access_token || previous?.token;
      if (!token) fail(502,'로그인을 완료하지 못했어요. 다시 인증해주세요.');
      const user = await provider(env,'/auth/v1/user',{token});
      if (previous && user.id !== previous.user.id) fail(403,'휴대폰 인증 정보를 확인해주세요.');
      if (!summary(user).phoneVerified || phone(user.phone) !== p) fail(403,'휴대폰 인증이 완료되지 않았어요. 다시 인증해주세요.');
      if (data.access_token) setSession(headers,data);
      return json({next:'/profile/'});
    }
    if (path === '/api/auth/logout' && request.method === 'POST') {
      const token = cookies(request)[ACCESS];
      clearSession(headers);setCookie(headers,FLOW,'',0);
      setCookie(headers,RECOVERY,'',0);setCookie(headers,PASSWORD_RESET,'',0);
      if (token) await provider(env,'/auth/v1/logout',{method:'POST',token}).catch(()=>{});
      return json({loggedOut:true});
    }
    if (path.startsWith('/api/uploads/')) {
      if (env.FILE_STORAGE_ENABLED !== 'true') fail(503,'첨부 파일 저장 연결을 준비 중이에요. 아직 파일이 전송되지 않아요.','file_setup_required');
      const slot = path.split('/')[3]; if (!SLOTS.includes(slot)) fail(404,'첨부 항목을 확인해주세요.');
      const {user,token} = await verifiedIdentity(request,env,headers);
      if (request.method === 'POST') {
        if (request.headers.get('X-Oneul-File-Consent') !== 'true') fail(400,'첨부 자료 확인·저장 안내에 동의해주세요.');
        const type = request.headers.get('Content-Type'); const bytes = await limitedBody(request,8*1024*1024);
        const start = new TextDecoder().decode(bytes.slice(0,12));
        let extension;
        if (type === 'image/jpeg' && bytes[0]===255 && bytes[1]===216 && bytes[2]===255) extension='jpg';
        if (type === 'image/png' && [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)) extension='png';
        if (type === 'image/webp' && start.startsWith('RIFF') && start.slice(8,12)==='WEBP') extension='webp';
        if (slot === 'employment' && type === 'application/pdf' && start.startsWith('%PDF-')) extension='pdf';
        if (!extension) fail(400,'지원하는 사진 또는 PDF 파일을 선택해주세요.');
        const objectPath = user.id+'/'+slot+'/'+crypto.randomUUID()+'.'+extension;
        await provider(env,'/storage/v1/object/'+BUCKET+'/'+objectPath,{method:'POST',token,rawBody:bytes,headers:{'Content-Type':type,'x-upsert':'false','Cache-Control':'no-store'}});
        return json({uploaded:true,path:objectPath});
      }
      if (request.method === 'GET') {
        const objectPath = ownedPath(new URL(request.url).searchParams.get('path'),user,slot); if (!objectPath) fail(400,'첨부 파일을 확인해주세요.');
        const result = await provider(env,'/storage/v1/object/authenticated/'+BUCKET+'/'+objectPath,{token,rawResponse:true});
        headers.set('Content-Type',result.headers.get('Content-Type') || 'application/octet-stream');headers.set('Content-Disposition','attachment; filename="'+slot+'.'+objectPath.split('.').pop()+'"');
        return new Response(result.body,{headers});
      }
      fail(405,'지원하지 않는 첨부 요청이에요.');
    }
    if (path === '/api/profile') {
      if (env.PROFILE_STORAGE_ENABLED !== 'true') fail(503,'프로필 저장 연결을 준비 중이에요. 입력 내용은 유지돼요.','profile_setup_required');
      const {user,token} = await verifiedIdentity(request,env,headers);
      if (request.method === 'GET') {
        const rows = await provider(env,'/rest/v1/oneul_profiles?user_id=eq.'+encodeURIComponent(user.id)+'&select=*',{token});
        return json({profile:publicProfile(rows?.[0])});
      }
      if (request.method === 'PUT') {
        const b = await bodyOf(request); const profile = cleanProfile(b,user);
        if (attachmentPaths(profile).length && env.FILE_STORAGE_ENABLED !== 'true') fail(503,'첨부 파일 저장 연결을 준비 중이에요.');
        const old = await provider(env,'/rest/v1/oneul_profiles?user_id=eq.'+encodeURIComponent(user.id)+'&select=*',{token});
        const rows = await provider(env,'/rest/v1/oneul_profiles?on_conflict=user_id',{method:'POST',token,body:profile,headers:{Prefer:'resolution=merge-duplicates,return=representation'}});
        if (rows?.[0]?.user_id !== user.id) fail(502,'저장 결과를 확인하지 못했어요. 입력 내용은 유지돼요.');
        let cleanupPending = false;
        const removed = attachmentPaths(old?.[0]).filter(p=>!attachmentPaths(profile).includes(p));
        try { await deleteFiles(env,token,removed); } catch { cleanupPending = true; }
        return json({saved:true,profile:publicProfile(rows[0]),cleanupPending});
      }
      if (request.method === 'DELETE') { const rows = await provider(env,'/rest/v1/oneul_profiles?user_id=eq.'+encodeURIComponent(user.id)+'&select=*',{token}); await deleteFiles(env,token,attachmentPaths(rows?.[0])); await provider(env,'/rest/v1/oneul_profiles?user_id=eq.'+encodeURIComponent(user.id),{method:'DELETE',token}); return json({deleted:true}); }
    }
    fail(404,'요청한 기능을 찾을 수 없어요.');
  } catch (error) {
    if (!(error instanceof AppError)) console.error('oneul_api_error');
    return json({error:error instanceof AppError ? error.message : '처리 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.',code:error.code || ''},error.status || 500);
  }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return api(request,env);
    if (!['GET','HEAD'].includes(request.method)) return new Response('Method Not Allowed',{status:405});
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { return new Response('Bad Request',{status:400}); }
    if (path.includes('..') || path.includes('\\')) return new Response('Not Found',{status:404});
    const asset = ASSET_TABLE[path] || ASSET_TABLE[path.replace(/\/$/,'')+'/index.html'];
    if (!asset) return new Response('Not Found',{status:404});
    const bytes = Uint8Array.from(atob(asset.data),character=>character.charCodeAt(0));
    return new Response(request.method === 'HEAD' ? null : bytes,{headers:{'Content-Type':asset.type,'Cache-Control':asset.type.startsWith('text/html') ? 'no-store' : 'public, max-age=3600','X-Content-Type-Options':'nosniff','Referrer-Policy':path.startsWith('/memo')?'no-referrer':'same-origin',...(path.startsWith('/memo')?{'X-Robots-Tag':'noindex, nofollow, noarchive'}:{})}});
  }
};
