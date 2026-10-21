const APPLICATION_COOKIE='__Host-oneul_application_p';
export async function applications(request,env,ctx){
  const {json,identity,bodyOf,fail,headers,cookies,setCookie,limitedBody}=ctx;
  const url=new URL(request.url),path=url.pathname;
  if(!path.startsWith('/api/application')&&!path.startsWith('/api/admin/'))return null;
  if(env.APPLICATIONS_ENABLED!=='true')fail(503,'플랫폼 신청 연결을 준비 중이에요.','application_setup_required');
  if(path==='/api/application/logout'&&request.method==='POST')setCookie(headers,APPLICATION_COOKIE,'',0);
  let target;
  if(path==='/api/applications')target='/member-applications';
  else if(path.startsWith('/api/admin/'))target=path.slice(4);
  else if(path==='/api/application')target='/application';
  else if(path.startsWith('/api/application/files/'))target='/file/'+path.split('/')[4];
  else target=path.replace('/api/application','');
  let account;
  if(target!=='/exchange'){
    try{account=await identity(request,env,headers);}catch(error){if(error.status!==401||path.startsWith('/api/admin/')||path==='/api/applications')throw error;}
  }
  const options={method:request.method,headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,...(account?{Authorization:'Bearer '+account.token}:{}),'X-Oneul-Application-Session':cookies(request)[APPLICATION_COOKIE]||'','Content-Type':request.headers.get('Content-Type')||'application/json'}};
  if(request.headers.get('X-Oneul-File-Consent')==='true')options.headers['X-Oneul-File-Consent']='true';
  if(request.method!=='GET')options.body=target.startsWith('/file/')?await limitedBody(request,8*1024*1024):JSON.stringify(await bodyOf(request));
  const query=url.searchParams.has('id')?'?id='+encodeURIComponent(url.searchParams.get('id')):'';
  let result;
  try{result=await fetch(env.SUPABASE_URL+'/functions/v1/platform-api'+target+query,{...options,signal:AbortSignal.timeout(60000)});}catch{fail(503,'신청 서비스에 연결하지 못했어요. 입력 내용은 유지되니 다시 시도해주세요.');}
  if(result.ok&&target.includes('/file/')){
    headers.set('Content-Type',result.headers.get('Content-Type')||'application/octet-stream');headers.set('Content-Disposition','attachment; filename="'+target.split('/').pop()+'"');
    return new Response(result.body,{headers});
  }
  const data=await result.json().catch(()=>null);if(!result.ok)fail([400,401,403,404,409,413,429,503].includes(result.status)?result.status:502,data?.error||'신청 내역을 확인하지 못했어요. 다시 시도해주세요.',data?.code||'');
  if(target==='/exchange'){
    if(data?.exchanged!==true||!/^[a-f0-9]{64}$/.test(data.sessionToken||''))fail(502,'작성 링크 연결 결과를 확인하지 못했어요.');
    setCookie(headers,APPLICATION_COOKIE,data.sessionToken,3*86400);return json({exchanged:true,applicationId:data.applicationId});
  }
  return json(data);
}
