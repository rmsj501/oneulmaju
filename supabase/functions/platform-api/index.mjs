import {AppError,phone,cleanProfile,ownedPath,publicProfile} from '../../../shared/profile.mjs';

const BUCKET='oneul-verification',slots=['face','fullbody','employment'];
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const reject=(status,message,code='')=>{throw new AppError(status,message,code);};
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
export const hashToken=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
const text=(value,max,required=false)=>{if(typeof value!=='string'||value.length>max||(required&&!value.trim()))reject(400,'필수 항목과 입력 길이를 확인해주세요.');return value.trim();};
const date=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)reject(400,'참가 날짜를 확인해주세요.');return value;};
export async function limited(request,max){const reader=request.body?.getReader();if(!reader)return new Uint8Array();let size=0;const chunks=[];try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();reject(413,'파일 또는 입력 내용이 너무 커요.');}chunks.push(value);}}finally{reader.releaseLock();}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;}
export function extensionFor(type,bytes,slot){const first=new TextDecoder().decode(bytes.slice(0,12));if(type==='image/jpeg'&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return'jpg';if(type==='image/png'&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return'png';if(type==='image/webp'&&first.startsWith('RIFF')&&first.slice(8,12)==='WEBP')return'webp';if(slot==='employment'&&type==='application/pdf'&&first.startsWith('%PDF-'))return'pdf';reject(400,'JPG·PNG·WEBP 사진 또는 직업 확인용 PDF를 첨부해주세요.');}
const safeApplication=a=>({id:a.id,source:a.source,name:a.name,phone:a.phone,gender:a.gender,event_date:a.event_date,start_time:a.start_time,amount:a.amount,payment_status:a.payment_status,status:a.status,venue:a.status==='confirmed'?a.venue:'',instructions:a.status==='confirmed'?a.instructions:'',review_note:a.review_note,submitted_at:a.submitted_at,confirmed_at:a.confirmed_at,member:!!a.member_user_id,profile:publicProfile(a.profile)});

// The gateway JWT check is disabled because guests use application-scoped
// capabilities, not Auth accounts. Every private operation below validates
// either a real Auth user, operator membership, or an unexpired hashed session.
export function createPlatformHandler({origin,key,fetcher=fetch}){
  async function db(path,{method='GET',body,raw,token,headers={},binary=false}={}){
    const response=await fetcher(origin+path,{method,headers:{apikey:key,Authorization:'Bearer '+(token||key),'Content-Type':'application/json',...headers},body:raw??(body===undefined?undefined:JSON.stringify(body)),signal:AbortSignal.timeout(20000)});
    if(!response.ok){if(response.status>=500)reject(503,'저장 서비스가 잠시 응답하지 않아요. 다시 시도해주세요.');reject(400,'입력 내용을 확인하거나 새 작성 링크를 받아주세요.');}
    if(binary)return response;
    return response.json().catch(()=>null);
  }
  const rows=(table,query)=>db('/rest/v1/'+table+'?'+query);
  const rpc=(name,body)=>db('/rest/v1/rpc/'+name,{method:'POST',body});
  const download=async file=>{const response=await db('/storage/v1/object/authenticated/'+BUCKET+'/'+file,{binary:true});return new Response(response.body,{headers:{'Content-Type':response.headers.get('Content-Type')||'application/octet-stream','Content-Disposition':'attachment; filename="'+file.split('/').pop()+'"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});};
  async function authenticated(request,required=true){
    const bearer=request.headers.get('Authorization')||'';
    if(!bearer.startsWith('Bearer ')){if(required)reject(401,'회원 로그인이 필요해요.');return null;}
    const token=bearer.slice(7);
    const response=await fetcher(origin+'/auth/v1/user',{headers:{apikey:key,Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
    if(!response.ok)reject(401,'로그인이 만료됐어요. 다시 로그인해주세요.');
    const user=await response.json();
    if(!uuid(user.id)||!((user.email&&user.email_confirmed_at)||(user.phone&&user.phone_confirmed_at)))reject(403,'이메일 또는 휴대폰 인증이 필요해요.');
    return{user,token};
  }
  async function operator(request){const account=await authenticated(request);const staff=await rows('oneul_staff','user_id=eq.'+account.user.id+'&select=user_id');if(!staff?.length)reject(403,'운영자 계정만 이용할 수 있어요.');return account;}
  async function application(request){
    const account=await authenticated(request,false),id=new URL(request.url).searchParams.get('id');
    let applicationId;
    if(id){if(!uuid(id)||!account)reject(403,'신청 접근 권한을 확인해주세요.');applicationId=id;}
    else{const token=request.headers.get('X-Oneul-Application-Session')||'';if(!/^[a-f0-9]{64}$/.test(token))reject(401,'문자로 받은 작성 링크를 열어주세요.');const sessions=await rows('oneul_application_sessions','token_hash=eq.'+await hashToken(token)+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&select=application_id');if(!sessions?.length)reject(401,'작성 링크가 만료됐어요. 운영자에게 새 링크를 요청해주세요.');applicationId=sessions[0].application_id;}
    const result=await rows('oneul_applications','id=eq.'+applicationId+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&select=*');const item=result?.[0];
    if(!item)reject(404,'신청 내역을 확인하지 못했어요.');
    if(item.member_user_id&&item.member_user_id!==account?.user.id)reject(account?403:401,'이 신청에 연결한 회원 계정으로 로그인해주세요.','application_member_login');
    if(id&&!item.member_user_id)reject(403,'문자로 받은 전용 링크로 열어주세요.');
    return{item,account};
  }
  async function copyFile(source,target){const response=await db('/storage/v1/object/authenticated/'+BUCKET+'/'+source,{binary:true});const bytes=await limited(response,8*1024*1024);await db('/storage/v1/object/'+BUCKET+'/'+target,{method:'POST',raw:bytes,headers:{'Content-Type':response.headers.get('Content-Type')||'application/octet-stream','x-upsert':'false'}});return target;}
  async function body(request){try{const data=JSON.parse(new TextDecoder().decode(await limited(request,20000)));if(!data||typeof data!=='object'||Array.isArray(data))throw new Error();return data;}catch(e){if(e instanceof AppError)throw e;reject(400,'입력 내용을 확인해주세요.');}}
  return async request=>{
    const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
    try{
      if(!origin||!key)reject(503,'서비스 연결을 준비 중이에요.');
      const url=new URL(request.url),path=url.pathname.replace(/^.*\/platform-api/,'')||'/';
      if(path==='/logout'&&request.method==='POST'){const token=request.headers.get('X-Oneul-Application-Session')||'';if(/^[a-f0-9]{64}$/.test(token))await db('/rest/v1/oneul_application_sessions?token_hash=eq.'+await hashToken(token),{method:'DELETE'});return json({loggedOut:true});}
      if(path==='/exchange'&&request.method==='POST'){
        const data=await body(request);if(!/^[a-f0-9]{64}$/.test(data.inviteToken||''))reject(400,'문자로 받은 전체 작성 링크를 열어주세요.');
        const sessionToken=randomToken();const id=await rpc('oneul_exchange_application_invite',{invite_hash:await hashToken(data.inviteToken),session_hash:await hashToken(sessionToken)});
        return json({exchanged:true,sessionToken,applicationId:id});
      }
      if(path==='/member-applications'&&request.method==='GET'){
        const account=await authenticated(request);const items=await rows('oneul_applications','member_user_id=eq.'+account.user.id+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&order=event_date.desc&select=*&limit=100');return json({applications:(items||[]).map(safeApplication)});
      }
      if(path.startsWith('/admin')){
        const account=await operator(request);
        if(path==='/admin/status'&&request.method==='GET')return json({admin:true,email:account.user.email});
        if(path==='/admin/applications'&&request.method==='GET'){
          const items=await rows('oneul_applications','order=event_date.desc,created_at.desc&select=*&limit=200');
          if(!Array.isArray(items))reject(502,'참가 신청 목록을 확인하지 못했어요.');
          const ids=items.map(a=>a.id),summaries=ids.length?await rpc('oneul_admin_application_memo_summaries',{p_actor_id:account.user.id,p_application_ids:ids}):[];
          if(!Array.isArray(summaries)||summaries.some(s=>!uuid(s.applicationId)||!ids.includes(s.applicationId)||(s.participantNumber!==null&&(!Number.isInteger(s.participantNumber)||s.participantNumber<1||s.participantNumber>13))||(s.submittedAt!==null&&(typeof s.submittedAt!=='string'||!Number.isFinite(Date.parse(s.submittedAt))))))reject(502,'참가자의 매칭 상태를 확인하지 못했어요.');
          const memos=new Map(summaries.map(s=>[s.applicationId,{participantNumber:s.participantNumber,submittedAt:s.submittedAt}]));
          return json({applications:items.map(a=>({...safeApplication(a),memo:memos.get(a.id)||null,external_order_no:a.external_order_no,venue:a.venue,instructions:a.instructions,notice_sent_at:a.notice_sent_at,notice_text:a.notice_text,updated_at:a.updated_at,deletable:['frip','munto'].includes(a.source)&&!a.order_id}))});
        }
        if(path==='/admin/applications'&&request.method==='POST'){
          const data=await body(request);if(!['frip','munto'].includes(data.source)||data.paymentConfirmed!==true||!Number.isSafeInteger(data.amount)||data.amount<1||data.amount>10000000||!['남성','여성'].includes(data.gender))reject(400,'플랫폼 결제 확인과 성별·결제 금액을 확인해주세요.');
          const day=date(data.event_date);if(day<'2026-10-24'||day<new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date()))reject(400,'10월 24일 이후의 다가오는 참가 날짜를 선택해주세요.');
          const time=text(data.start_time,50,true);if(!/^\d{2}:\d{2}$/.test(time)||Number(time.slice(0,2))>23||Number(time.slice(3))>59)reject(400,'시작 시간을 확인해주세요.');
          const inviteToken=randomToken(),expiresAt=new Date(day+'T23:59:59+09:00');expiresAt.setDate(expiresAt.getDate()+30);
          const items=await db('/rest/v1/oneul_applications',{method:'POST',body:{source:data.source,external_order_no:text(data.external_order_no,100,true),name:text(data.name,30,true),phone:phone(data.phone),gender:data.gender,event_date:day,start_time:time,amount:data.amount,venue:text(data.venue||'',300),instructions:text(data.instructions||'',2000),expires_at:expiresAt.toISOString(),invitation_hash:await hashToken(inviteToken),invitation_expires_at:new Date(Math.min(Date.now()+7*86400000,expiresAt.getTime())).toISOString()},headers:{Prefer:'return=representation'}});
          const item=items?.[0];if(!item?.id)reject(502,'신청 등록 결과를 확인하지 못했어요.');
          await db('/rest/v1/oneul_application_audit',{method:'POST',body:{application_id:item.id,actor_id:account.user.id,action:'external_payment_registered'}});
          return json({created:true,application:safeApplication(item),inviteToken});
        }
        const match=path.match(/^\/admin\/applications\/([a-f0-9-]{36})(?:\/(invite|review|notice|file)\/?(face|fullbody|employment)?)?$/);
        if(!match)reject(404,'관리 요청을 확인해주세요.');
        const id=match[1],action=match[2],slot=match[3];if(!uuid(id))reject(404,'신청을 확인해주세요.');
        const deleting=!action&&request.method==='DELETE';
        const items=await rows('oneul_applications','id=eq.'+id+(deleting?'':'&expires_at=gt.'+encodeURIComponent(new Date().toISOString()))+'&select=*'),item=items?.[0];if(!item)reject(404,'신청을 확인하지 못했어요.');
        if(deleting){
          const data=await body(request);
          if(!['frip','munto'].includes(item.source)||item.order_id)reject(409,'홈페이지 결제 신청은 삭제할 수 없어요. 결제 내역을 유지한 채 취소 처리해주세요.');
          if(data.confirmOrderNo!==item.external_order_no)reject(400,'삭제할 신청의 주문번호를 확인해주세요.');
          if(!item.updated_at||data.expectedUpdatedAt!==item.updated_at)reject(409,'신청 내용이 변경됐어요. 새로고침한 뒤 다시 확인해주세요.');
          // One conditional DELETE owns the version check, cascading session removal
          // and the existing private-file cleanup trigger in the same transaction.
          const removed=await db('/rest/v1/oneul_applications?id=eq.'+id+'&source=in.(frip,munto)&order_id=is.null&external_order_no=eq.'+encodeURIComponent(item.external_order_no)+'&updated_at=eq.'+encodeURIComponent(item.updated_at),{method:'DELETE',headers:{Prefer:'return=representation'}});
          if(removed?.length!==1||removed[0].id!==id)reject(409,'신청이 변경되거나 이미 삭제됐어요. 목록을 새로고침해주세요.');
          return json({deleted:true,applicationId:id,cleanupQueued:slots.some(slot=>!!removed[0].profile?.[slot+'_path'])});
        }
        if(action==='file'&&slots.includes(slot)&&request.method==='GET'){
          const file=ownedPath(item.profile?.[slot+'_path'],{id},slot);if(!file)reject(404,'첨부 자료가 없어요.');return await download(file);
        }
        if(action==='invite'&&request.method==='POST'){
          if(item.payment_status!=='paid'||item.status==='canceled')reject(400,'취소된 신청에는 링크를 발급할 수 없어요.');
          const inviteToken=randomToken();await rpc('oneul_rotate_application_invite',{application_id:id,actor_id:account.user.id,new_hash:await hashToken(inviteToken)});return json({created:true,inviteToken,applicationId:id});
        }
        if(action==='review'&&request.method==='POST'){
          const data=await body(request);if(data.decision==='confirmed'&&data.expectedSubmittedAt!==item.submitted_at)reject(409,'검토 중 프로필이 변경됐어요. 새로고침해서 자료를 다시 확인해주세요.');await rpc('oneul_review_application',{application_id:id,actor_id:account.user.id,decision:data.decision,note:text(data.note||'',1000),place:text(data.venue||'',300),preparation:text(data.instructions||'',2000),expected_submission:data.expectedSubmittedAt||null});return json({updated:true});
        }
        if(action==='notice'&&request.method==='POST'){
          const data=await body(request);if(item.status!=='confirmed'||item.payment_status!=='paid'||data.sent!==true)reject(400,'참가 확정 후 실제 문자를 보낸 다음 기록해주세요.');
          // Retrying a recorded notice must retain its original text and time.
          const receipt=saved=>({recorded:true,applicationId:saved.id,noticeSentAt:saved.notice_sent_at,noticeText:saved.notice_text,updatedAt:saved.updated_at});
          if(item.notice_sent_at)return json(receipt(item));
          if(data.expectedUpdatedAt!==undefined&&data.expectedUpdatedAt!==item.updated_at)reject(409,'신청 내용이 변경됐어요. 새로고침한 뒤 안내 문구를 다시 확인해주세요.');
          const sentAt=new Date().toISOString(),message=text(data.message,4000,true);
          const saved=await db('/rest/v1/oneul_applications?id=eq.'+id+'&status=eq.confirmed&payment_status=eq.paid&notice_sent_at=is.null&updated_at=eq.'+encodeURIComponent(item.updated_at),{method:'PATCH',body:{notice_sent_at:sentAt,notice_text:message,updated_at:sentAt},headers:{Prefer:'return=representation'}});
          if(saved?.length!==1||saved[0].id!==id||!saved[0].notice_sent_at)reject(409,'신청이 변경되거나 이미 기록됐어요. 새로고침해서 발송 기록을 확인해주세요.');
          return json(receipt(saved[0]));
        }
        reject(405,'지원하지 않는 관리 요청이에요.');
      }
      const {item,account}=await application(request);
      if(path==='/application'&&request.method==='GET')return json({application:safeApplication(item),account:account?{email:account.user.email,name:account.user.user_metadata?.name||''}:null});
      if(path==='/claim'&&request.method==='POST'){
        if(!account)reject(401,'먼저 회원 로그인 또는 가입을 완료해주세요.');const data=await body(request);if(data.claimConsent!==true)reject(400,'표시된 계정으로 이 신청을 연결하는 데 동의해주세요.');
        if(item.member_user_id&&item.member_user_id!==account.user.id)reject(403,'이미 다른 계정에 연결된 신청이에요.');
        const updated=await db('/rest/v1/oneul_applications?id=eq.'+item.id+'&member_user_id=is.null',{method:'PATCH',body:{member_user_id:account.user.id,updated_at:new Date().toISOString()},headers:{Prefer:'return=representation'}});
        if(!updated?.length&&item.member_user_id!==account.user.id)reject(409,'신청 연결 상태가 변경됐어요. 새로고침해주세요.');
        return json({claimed:true});
      }
      if(path.startsWith('/file/')){
        const slot=path.slice(6);if(!slots.includes(slot))reject(404,'첨부 항목을 확인해주세요.');
        if(request.method==='GET'){const file=ownedPath(item.profile?.[slot+'_path'],{id:item.id},slot);if(!file)reject(404,'첨부 자료가 없어요.');return await download(file);}
        if(request.method==='POST'){
          if(item.payment_status!=='paid'||!['draft','submitted','changes_requested'].includes(item.status))reject(403,'현재 신청은 수정할 수 없어요.');
          if(request.headers.get('X-Oneul-File-Consent')!=='true')reject(400,'첨부 자료 확인·저장 안내에 동의해주세요.');
          const bytes=await limited(request,8*1024*1024),type=request.headers.get('Content-Type'),ext=extensionFor(type,bytes,slot),file=item.id+'/'+slot+'/'+crypto.randomUUID()+'.'+ext;
          await db('/storage/v1/object/'+BUCKET+'/'+file,{method:'POST',raw:bytes,headers:{'Content-Type':type,'x-upsert':'false'}});return json({uploaded:true,path:file});
        }
      }
      if(path==='/profile'&&request.method==='PUT'){
        if(item.payment_status!=='paid'||!['draft','submitted','changes_requested'].includes(item.status))reject(403,'확정되거나 취소된 신청은 수정할 수 없어요. 운영자에게 문의해주세요.');
        const data=await body(request),attachments={...data.attachments};
        for(const slot of slots){
          let file=attachments[slot];if(!file)reject(400,'얼굴·전신 사진과 직업 확인 자료를 모두 첨부해주세요.');
          if(item.member_user_id&&file.startsWith(item.member_user_id+'/')){
            ownedPath(file,{id:item.member_user_id},slot);const target=item.id+'/'+slot+'/'+crypto.randomUUID()+'.'+file.split('.').pop();file=await copyFile(file,target);attachments[slot]=file;
          }
        }
        // A capability attests access to this application, never SMS identity.
        const cleaned=cleanProfile({...data,phone:item.phone||data.phone,gender:item.gender,attachments},{id:item.id,email:null,phone:null,phone_confirmed_at:null});
        const snapshot=publicProfile(cleaned);delete snapshot.user_id;delete snapshot.kind;
        await rpc('oneul_submit_application',{application_id:item.id,actor_id:item.member_user_id,submission:snapshot});
        let cardSaved=false;
        if(item.member_user_id&&data.keepProfile===true){
          try{
            const memberAttachments={};for(const slot of slots){const source=attachments[slot];const target=item.member_user_id+'/'+slot+'/'+crypto.randomUUID()+'.'+source.split('.').pop();memberAttachments[slot]=await copyFile(source,target);}
            const member=cleanProfile({...data,phone:item.phone||data.phone,gender:item.gender,attachments:memberAttachments},account.user);
            const saved=await db('/rest/v1/oneul_profiles?on_conflict=user_id',{method:'POST',token:account.token,body:member,headers:{Prefer:'resolution=merge-duplicates,return=representation'}});cardSaved=saved?.[0]?.user_id===account.user.id;
          }catch{/* Submission remains real even if reusable-card saving fails. */}
        }
        return json({saved:true,submitted:true,cardSaved,profile:snapshot});
      }
      reject(404,'요청한 기능을 찾을 수 없어요.');
    }catch(error){return json({error:error instanceof AppError?error.message:'처리 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.',code:error.code||''},error.status||500);}
  };
}
if(typeof Deno!=='undefined')Deno.serve(createPlatformHandler({origin:Deno.env.get('SUPABASE_URL'),key:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}));
