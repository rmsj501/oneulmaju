begin;
-- The same invitation can be reopened until its original expiry. Only the
-- server role can exchange the hashed capability for an application session.
create or replace function public.oneul_exchange_application_invite(invite_hash text,session_hash text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare item public.oneul_applications;
begin
  if session_hash is null or invite_hash is null or session_hash !~ '^[a-f0-9]{64}$' or invite_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid invitation'; end if;
  select a.* into item from public.oneul_applications a
    where a.invitation_hash=invite_hash and a.invitation_expires_at>now()
      and a.expires_at>now() and a.payment_status='paid' and a.status<>'canceled'
    for update;
  if not found then raise exception 'Invitation unavailable'; end if;
  if item.invitation_used_at is null then
    update public.oneul_applications set invitation_used_at=now(),updated_at=now() where id=item.id;
  end if;
  insert into public.oneul_application_sessions(token_hash,application_id,expires_at)
    values(session_hash,item.id,least(now()+interval '3 days',item.expires_at,item.invitation_expires_at));
  return item.id;
end; $$;
revoke all on function public.oneul_exchange_application_invite(text,text) from public,anon,authenticated;
grant execute on function public.oneul_exchange_application_invite(text,text) to service_role;
commit;
