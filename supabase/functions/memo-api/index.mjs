const validId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const validToken=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
const validSession=(date,time)=>typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date&&typeof time==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
async function batchToken(seed,batchId,date,time,id){const key=await crypto.subtle.importKey('raw',Uint8Array.from(seed.match(/../g),h=>parseInt(h,16)),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('oneulmaju-qr/'+batchId+'/'+date+'/'+time+'/'+id))),v=>v.toString(16).padStart(2,'0')).join('');}
class MemoError extends Error{constructor(status,message,code=''){super(message);this.status=status;this.code=code;}}
async function savedQRToken(secret,applicationId,pageId,canonicalHash){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(JSON.stringify(['oneulmaju-saved-qr-v1',applicationId,pageId,canonicalHash])))),v=>v.toString(16).padStart(2,'0')).join('');}
const reject=(status,message,code)=>{throw new MemoError(status,message,code);};
async function input(request){if(Number(request.headers.get('Content-Length'))>10000)reject(413,'입력 내용이 너무 길어요.');const reader=request.body?.getReader();let raw='',size=0;if(reader){const decoder=new TextDecoder();while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>10000){await reader.cancel();reject(413,'입력 내용이 너무 길어요.');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}try{const data=JSON.parse(raw);if(!data||typeof data!=='object'||Array.isArray(data))throw new Error();return data;}catch{reject(400,'입력 내용을 확인해주세요.');}}
// Guest requests authenticate by their private QR/session capability. Admin requests
// separately validate the real Auth account and staff membership; no metadata roles.
export function createMemoHandler({origin,key,fetcher=fetch}){
  async function db(path,{method='GET',body,token}={}){
    let response;try{response=await fetcher(origin+path,{method,headers:{apikey:key,Authorization:'Bearer '+(token||key),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});}
    catch(error){reject(503,error?.name==='TimeoutError'||error?.name==='AbortError'?'메모 서비스 응답이 늦어 확인하지 못했어요. 잠시 후 발급 상태나 저장 상태를 다시 확인해주세요.':'메모 서비스에 연결하지 못했어요. 잠시 후 다시 시도해주세요.','memo_backend_unavailable');}
    const data=await response.json().catch(()=>null);
    if(!response.ok){
      if(response.status>=500)reject(503,'메모 저장 서비스가 잠시 응답하지 않아요. 다시 시도해주세요.');
      if(path==='/auth/v1/user')reject(401,'운영자 로그인이 만료됐어요. 다시 로그인해주세요.');
      if(data?.code==='28000')reject(401,'QR이 만료되거나 새로 발급됐어요. 운영자에게 내 QR을 다시 받아주세요.','memo_session_required');
      if(['PT409','40001'].includes(data?.code)&&data.message==='Session settings would hide notes or choices')reject(409,'이미 작성된 메모나 제출된 매칭 선택이 있어 상대 번호 수 또는 선택 한도를 줄일 수 없어요. 기존 기록을 확인해주세요.','session_settings_conflict');
      if(data?.code==='PT409'&&data.message==='Application changed')reject(409,'신청 정보가 갱신됐어요. 개인 메모 QR 관리를 다시 열어 최신 상태에서 발급해주세요.','memo_conflict');
      if(data?.code==='PT409'&&data.message==='Memo session changed')reject(409,'이 창의 참가자와 현재 접속한 QR이 달라요. 이 참가자의 개인 QR을 다시 열어주세요.','memo_session_changed');
      if(['PT409','40001'].includes(data?.code))reject(409,'다른 화면에서 기록이나 접속 정보가 바뀌었어요. 내 QR 또는 최신 기록을 확인해주세요.','memo_conflict');
      if(data?.code==='23505')reject(409,'이미 사용 중인 번호이거나 발급된 QR이에요. 다시 확인해주세요.','memo_conflict');
      if(data?.code==='42501')reject(403,'운영자만 참가자 메모를 관리할 수 있어요.');
      if(data?.code==='P0002'&&data.message==='Memo QR not issued')reject(404,'아직 개인 QR을 발급하지 않았어요. 개인 메모 QR 관리에서 먼저 발급해주세요.');
      if(data?.code==='P0002')reject(404,'참가자 메모장을 찾을 수 없어요.');
      if(data?.code==='22023'&&data.message==='Opponent range excludes assigned participants')reject(400,'상대 번호 수가 참가자 번호보다 작아요. 상대방의 가장 큰 참가 번호까지 포함해주세요.');
      if(data?.code==='22023')reject(400,'선택할 수 있는 인원과 상대 번호를 확인해주세요.');
      reject(400,'참가 확정 상태와 번호·메모 내용을 확인해주세요.');
    }
    return data;
  }
  const rpc=(name,body)=>db('/rest/v1/rpc/'+name,{method:'POST',body});
  async function operator(request){
    const auth=request.headers.get('Authorization')||'';if(!auth.startsWith('Bearer '))reject(401,'운영자 로그인이 필요해요.');
    const user=await db('/auth/v1/user',{token:auth.slice(7)});
    if(!validId(user?.id)||!((user.email&&user.email_confirmed_at)||(user.phone&&user.phone_confirmed_at)))reject(403,'인증한 운영자 계정이 필요해요.');
    const staff=await db('/rest/v1/oneul_staff?user_id=eq.'+user.id+'&select=user_id');if(!Array.isArray(staff)||!staff.some(s=>s.user_id===user.id))reject(403,'운영자만 참가자 메모를 관리할 수 있어요.');return user.id;
  }
  return async request=>{
    const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
    try{
      if(!origin||!key)reject(503,'메모 연결을 준비 중이에요.');
      const url=new URL(request.url),path=url.pathname.replace(/^.*\/memo-api/,'')||'/';
      if(/^\/admin\/sessions(?:\/(?:detail|issue))?$/.test(path)){
        const actor=await operator(request);
        if(path==='/admin/sessions'&&request.method==='GET')return json(await rpc('oneul_session_list',{p_actor_id:actor}));
        if(path==='/admin/sessions/detail'&&request.method==='GET'){
          const date=url.searchParams.get('eventDate'),time=url.searchParams.get('startTime');if(!validSession(date,time))reject(400,'회차의 날짜와 시간을 확인해주세요.');
          return json(await rpc('oneul_session_detail',{p_actor_id:actor,p_event_date:date,p_start_time:time}));
        }
        if(path==='/admin/sessions/issue'&&request.method==='POST'){
          const data=await input(request),date=data.eventDate,time=data.startTime;
          if(!validSession(date,time)||!validId(data.requestId)||!validToken(data.seed)||typeof data.replaceExisting!=='boolean')reject(400,'회차와 QR 발급 요청을 확인해주세요.');
          const configured=['maleOpponentCount','femaleOpponentCount','matchLimit'].some(k=>Object.hasOwn(data,k));
          if(configured&&(![data.maleOpponentCount,data.femaleOpponentCount].every(n=>Number.isInteger(n)&&n>=1&&n<=13)||![2,3].includes(data.matchLimit)))reject(400,'상대 번호 수는 1~13개, 최대 매칭 인원은 2명 또는 3명으로 설정해주세요.');
          const values=[date,time,data.replaceExisting,data.seed];if(configured)values.push('settings-v1',data.maleOpponentCount,data.femaleOpponentCount,data.matchLimit);
          const args={p_actor_id:actor,p_event_date:date,p_start_time:time,p_batch_id:data.requestId,p_request_hash:await digest(JSON.stringify(values))};
          let result=await rpc('oneul_session_batch_plan',args);
          if(result?.completed!==true){
            if(!Array.isArray(result?.expected)||result.expected.length>26||result.expected.some(x=>!validId(x.applicationId)))reject(400,'참가 확정 명단과 성별별 최대 13명을 확인해주세요.');
            const hashes={};for(const row of result.expected)hashes[row.applicationId]=await digest(await batchToken(data.seed,data.requestId,date,time,row.applicationId));
            result=await rpc(configured?'oneul_session_batch_issue_configured':'oneul_session_batch_issue',{...args,p_expected:result.expected,p_hashes:hashes,p_replace:data.replaceExisting,...(configured?{p_male_opponent_count:data.maleOpponentCount,p_female_opponent_count:data.femaleOpponentCount,p_match_limit:data.matchLimit}:{})});
          }
          if(result?.completed!==true||result.batchId!==data.requestId||!Array.isArray(result.items))reject(502,'일괄 발급 결과를 확인하지 못했어요. 같은 요청으로 다시 확인해주세요.');
          const items=[];for(const row of result.items){
            if(!validId(row.applicationId)||!validToken(row.qrHash))reject(502,'QR 발급 결과를 확인하지 못했어요.');
            const token=await batchToken(data.seed,data.requestId,date,time,row.applicationId);if(await digest(token)!==row.qrHash)reject(502,'QR 발급 요청이 일치하지 않아요.');
            const {qrHash,valid,...item}=row;items.push({...item,available:valid===true,...(valid===true?{qrToken:token}:{})});
          }
          return json({issued:true,batchId:result.batchId,eventDate:date,startTime:time,skippedCount:result.skippedCount,...(result.settings?{settings:result.settings}:{}),items});
        }
        reject(405,'지원하지 않는 요청이에요.');
      }
      const admin=path.match(/^\/admin\/([a-f0-9-]{36})(\/(?:entries|matching-limit|qr))?$/);
      if(admin){
        if(!validId(admin[1]))reject(400,'참가 신청을 확인해주세요.');const actor=await operator(request);
        if(admin[2]==='/qr'){
          if(request.method!=='POST')reject(405,'버튼을 눌러 발급된 QR을 확인해주세요.');
          const info=await rpc('oneul_memo_qr_info',{p_application_id:admin[1],p_actor_id:actor});
          if(info?.issued!==true||!validId(info.pageId)||!validToken(info.qrHash))reject(502,'발급된 QR 정보를 확인하지 못했어요.');
          const token=await savedQRToken(key,admin[1],info.pageId,info.qrHash);
          const result=await rpc('oneul_memo_qr_register',{p_application_id:admin[1],p_actor_id:actor,p_qr_hash:await digest(token),p_expected_qr_hash:info.qrHash});
          if(result?.retrieved!==true||result.applicationId!==admin[1]||result.pageId!==info.pageId)reject(502,'발급된 QR을 확인하지 못했어요. 다시 시도해주세요.');
          const {qrHash,...safe}=result;return json({...safe,qrToken:token});
        }
        if(admin[2]==='/matching-limit'){
          if(request.method!=='POST')reject(405,'지원하지 않는 요청이에요.');
          const data=await input(request);if(![2,3].includes(data.limit))reject(400,'매칭 선택 인원은 2명 또는 3명으로 설정해주세요.');
          try{return json(await rpc('oneul_matching_limit',{p_application_id:admin[1],p_actor_id:actor,p_limit:data.limit}));}
          catch(error){if(error.status===409)reject(409,'이미 이 회차에 3명을 선택해 제출한 참가자가 있어요. 제출한 선택을 먼저 확인해주세요.','matching_limit_conflict');throw error;}
        }
        if(admin[2]==='/entries'){
          if(request.method!=='GET')reject(405,'메모는 읽기 전용으로 확인할 수 있어요.');
          return json(await rpc('oneul_memo_admin_read',{p_application_id:admin[1],p_actor_id:actor}));
        }
        if(request.method==='GET')return json(await rpc('oneul_memo_admin',{p_application_id:admin[1],p_actor_id:actor}));
        if(request.method==='POST'){
          const data=await input(request),count=data.opponentCount,number=data.participantNumber??null;
          if(!Number.isInteger(count)||count<1||count>13||(number!==null&&(!Number.isInteger(number)||number<1||number>13))||typeof data.expectedUpdatedAt!=='string'||!Number.isFinite(Date.parse(data.expectedUpdatedAt))||typeof data.replace!=='boolean')reject(400,'참가 번호와 상대 인원수를 확인해주세요.');
          const token=randomToken();const result=await rpc('oneul_memo_issue',{p_application_id:admin[1],p_actor_id:actor,p_qr_hash:await digest(token),p_opponent_count:count,p_participant_number:number,p_expected_updated_at:data.expectedUpdatedAt,p_replace:data.replace});
          if(result?.issued!==true||!validId(result.pageId))reject(502,'QR 발급 결과를 확인하지 못했어요.');return json({...result,qrToken:token});
        }
        reject(405,'지원하지 않는 요청이에요.');
      }
      if(path==='/exchange'&&request.method==='POST'){
        const data=await input(request);if(!validToken(data.qrToken))reject(400,'현장에서 받은 개인 QR을 열어주세요.');
        const sessionToken=randomToken(),result=await rpc('oneul_memo_exchange_qr',{p_qr_hash:await digest(data.qrToken),p_session_hash:await digest(sessionToken)});
        if(!validId(result?.pageId)||!Number.isFinite(Date.parse(result.expiresAt)))reject(502,'메모 연결 결과를 확인하지 못했어요.');return json({exchanged:true,...result,sessionToken});
      }
      const session=request.headers.get('X-Oneul-Memo-Session')||'';if(!validToken(session))reject(401,'내 개인 QR을 다시 스캔해주세요.','memo_session_required');
      const sessionHash=await digest(session);
      if(path==='/matching'&&request.method==='PUT'){
        const data=await input(request);
        if(!validId(data.pageId)||!validId(data.mutationId)||!Array.isArray(data.numbers)||data.numbers.length>3||data.numbers.some(n=>!Number.isInteger(n)||n<1||n>13)||new Set(data.numbers).size!==data.numbers.length||!Number.isInteger(data.expectedVersion)||data.expectedVersion<0||!Number.isInteger(data.expectedLimit)||data.expectedLimit<1||data.expectedLimit>3)reject(400,'선택 인원과 상대 번호를 확인해주세요.');
        try{return json(await rpc('oneul_matching_save',{p_session_hash:sessionHash,p_page_id:data.pageId,p_numbers:data.numbers,p_expected_version:data.expectedVersion,p_expected_limit:data.expectedLimit,p_mutation_id:data.mutationId}));}
        catch(error){if(error.status===409&&error.code!=='memo_session_changed')reject(409,'매칭 선택 또는 회차 인원 설정이 바뀌었어요. 저장된 선택을 다시 불러와주세요.','matching_conflict');throw error;}
      }
      if(path==='/'&&request.method==='GET'){
        const pageId=url.searchParams.get('pageId')||null;if(pageId&&!validId(pageId))reject(400,'메모장을 확인해주세요.');return json(await rpc('oneul_memo_read',{p_session_hash:sessionHash,p_page_id:pageId}));
      }
      if(path==='/'&&request.method==='PUT'){
        const data=await input(request);
        if(!validId(data.pageId)||!validId(data.mutationId)||!Number.isInteger(data.opponentNumber)||data.opponentNumber<1||data.opponentNumber>13||typeof data.text!=='string'||[...data.text].length>500||!Number.isInteger(data.hearts)||data.hearts<0||data.hearts>3||!Number.isInteger(data.expectedVersion)||data.expectedVersion<0)reject(400,'500자 이내 메모와 하트 0~3개를 확인해주세요.');
        return json(await rpc('oneul_memo_save',{p_session_hash:sessionHash,p_page_id:data.pageId,p_opponent_number:data.opponentNumber,p_text:data.text,p_hearts:data.hearts,p_expected_version:data.expectedVersion,p_mutation_id:data.mutationId}));
      }
      reject(404,'요청한 메모 기능을 찾을 수 없어요.');
    }catch(error){return json({error:error instanceof MemoError?error.message:'메모 연결에 문제가 생겼어요. 잠시 후 다시 시도해주세요.',code:error.code||''},error.status||500);}
  };
}
if(typeof Deno!=='undefined')Deno.serve(createMemoHandler({origin:Deno.env.get('SUPABASE_URL'),key:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}));
