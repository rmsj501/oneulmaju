begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
-- Generate the scheduler credential inside Vault; never return it to a client.
select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'oneul_cleanup_token')
where not exists(select 1 from vault.decrypted_secrets where name='oneul_cleanup_token');
create function oneul_private.check_cleanup_token(candidate text) returns boolean
language sql security definer set search_path='' as $$
  select exists(select 1 from vault.decrypted_secrets where name='oneul_cleanup_token' and
    extensions.digest(decrypted_secret,'sha256')=extensions.digest(candidate,'sha256'));
$$;
revoke all on function oneul_private.check_cleanup_token(text) from public,anon,authenticated;
grant execute on function oneul_private.check_cleanup_token(text) to service_role;
create function public.oneul_check_cleanup_token(candidate text) returns boolean
language sql security invoker set search_path='' as $$ select oneul_private.check_cleanup_token(candidate); $$;
revoke all on function public.oneul_check_cleanup_token(text) from public,anon,authenticated;
grant execute on function public.oneul_check_cleanup_token(text) to service_role;
drop function public.oneul_enqueue_expired();
create function public.oneul_enqueue_expired() returns void
language plpgsql security invoker set search_path='' as $$
begin
  delete from public.oneul_profiles where expires_at<=now();
  delete from public.oneul_applications where expires_at<=now();
  delete from public.oneul_application_sessions where expires_at<=now();
  insert into public.oneul_file_cleanup(path)
  select o.name from storage.objects o where o.bucket_id='oneul-verification' and o.created_at<now()-interval '24 hours'
    and not exists(select 1 from public.oneul_profiles p where o.name in (p.face_path,p.fullbody_path,p.employment_path))
    and not exists(select 1 from public.oneul_applications a where o.name in (a.profile->>'face_path',a.profile->>'fullbody_path',a.profile->>'employment_path'))
  on conflict do nothing;
end; $$;
revoke all on function public.oneul_enqueue_expired() from public,anon,authenticated;
grant execute on function public.oneul_enqueue_expired() to service_role;
select cron.schedule('oneul-verification-cleanup','0 19 * * *',$job$
  select net.http_post(
    url:='https://fpqfuignltadutstuhth.supabase.co/functions/v1/purge-verification',
    headers:=jsonb_build_object('Content-Type','application/json','X-Oneul-Cleanup-Token',(select decrypted_secret from vault.decrypted_secrets where name='oneul_cleanup_token')),
    body:='{}'::jsonb,timeout_milliseconds:=30000
  );
$job$);
commit;
