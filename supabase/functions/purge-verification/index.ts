// Invoke daily through Supabase Cron. This administrative key is confined to
// the scheduled cleanup function; browser-facing Site APIs use user tokens.
Deno.serve(async request => {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const origin = Deno.env.get('SUPABASE_URL');
  if (!key || !origin || request.method !== 'POST') return new Response('Unauthorized',{status:401});
  const call = async (path:string, method='GET', body?:unknown) => {
    const response = await fetch(origin+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error('cleanup_failed');
    return response.json().catch(()=>null);
  };
  try {
    const candidate=request.headers.get('X-Oneul-Cleanup-Token')||'';
    // Custom scheduler authentication. The gateway JWT check is disabled only
    // because the Vault credential is not a JWT; every invocation is checked.
    if(!/^[a-f0-9]{64}$/.test(candidate)||await call('/rest/v1/rpc/oneul_check_cleanup_token','POST',{candidate})!==true)return new Response('Unauthorized',{status:401});
    await call('/rest/v1/rpc/oneul_enqueue_expired','POST',{});
    const rows = await call('/rest/v1/oneul_file_cleanup?select=path&order=queued_at.asc&limit=100');
    for (const row of rows || []) {
      // Keep a file if it was referenced again before the retry job ran.
      const refs = await call('/rest/v1/oneul_profiles?select=user_id&or='+encodeURIComponent('(face_path.eq.'+row.path+',fullbody_path.eq.'+row.path+',employment_path.eq.'+row.path+')')+'&limit=1');
      const applications=await call('/rest/v1/oneul_applications?select=id&or='+encodeURIComponent('(profile->>face_path.eq.'+row.path+',profile->>fullbody_path.eq.'+row.path+',profile->>employment_path.eq.'+row.path+')')+'&limit=1');
      if(!refs?.length&&!applications?.length)await call('/storage/v1/object/oneul-verification','DELETE',{prefixes:[row.path]});
      await call('/rest/v1/oneul_file_cleanup?path=eq.'+encodeURIComponent(row.path),'DELETE');
    }
    return Response.json({processed:rows?.length||0});
  } catch { return new Response('Cleanup unavailable',{status:503}); }
});
