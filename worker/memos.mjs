const MEMO_COOKIE='__Host-oneul_memo_p';
const validPageId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const pageCookie=id=>'__Host-oneul_memo_'+id.toLowerCase()+'_p';
export async function memos(request,env,ctx){
  const {json,identity,bodyOf,fail,headers,cookies,setCookie}=ctx,url=new URL(request.url),path=url.pathname;
  const admin=path.match(/^\/api\/admin\/memo\/([a-f0-9-]{36})(\/(?:entries|matching-limit|qr))?$/);
  const sessionAdmin=/^\/api\/admin\/sessions(?:\/(?:detail|issue))?$/.test(path);
  if(!path.startsWith('/api/memo')&&!admin&&!sessionAdmin)return null;
  if(env.MEMOS_ENABLED!=='true')fail(503,'현장 메모 연결을 준비 중이에요.','memo_setup_required');
  let target=sessionAdmin?path.slice('/api'.length):admin?'/admin/'+admin[1]+(admin[2]||''):path.slice('/api/memo'.length)||'/',account;
  if(admin||sessionAdmin)account=await identity(request,env,headers);
  const payload=request.method!=='GET'?await bodyOf(request):undefined,pageId=request.method==='GET'?url.searchParams.get('pageId'):payload?.pageId,jar=cookies(request);
  // Each QR page retains its own HttpOnly capability. Another tab opening a
  // different participant's QR must not replace this page's session.
  const session=(validPageId(pageId)&&jar[pageCookie(pageId)])||jar[MEMO_COOKIE]||'';
  const options={method:request.method,headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,...(account?{Authorization:'Bearer '+account.token}:{}),'X-Oneul-Memo-Session':session,'Content-Type':'application/json'}};
  if(payload!==undefined)options.body=JSON.stringify(payload);
  const params=new URLSearchParams();for(const key of sessionAdmin?['eventDate','startTime']:['pageId'])if(url.searchParams.has(key))params.set(key,url.searchParams.get(key));
  const query=params.size?'?'+params.toString():'';
  let response;try{response=await fetch(env.SUPABASE_URL+'/functions/v1/memo-api'+target+query,{...options,signal:AbortSignal.timeout(30000)});}catch{fail(503,'메모에 연결하지 못했어요. 입력 내용은 유지되니 다시 저장해주세요.');}
  const data=await response.json().catch(()=>null);
  if(!response.ok)fail([400,401,403,404,409,413,429,503].includes(response.status)?response.status:502,data?.error||'메모를 확인하지 못했어요.',data?.code||'');
  headers.set('Referrer-Policy','no-referrer');
  if(target==='/exchange'){
    const age=Math.floor((Date.parse(data?.expiresAt)-Date.now())/1000);
    if(data?.exchanged!==true||!validPageId(data.pageId)||!/^[a-f0-9]{64}$/.test(data.sessionToken||'')||!Number.isFinite(age)||age<=0)fail(502,'메모 접속을 확인하지 못했어요.');
    setCookie(headers,MEMO_COOKIE,data.sessionToken,Math.min(age,30*86400));setCookie(headers,pageCookie(data.pageId),data.sessionToken,Math.min(age,30*86400));return json({exchanged:true,pageId:data.pageId});
  }
  return json(data);
}
