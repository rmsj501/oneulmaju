begin;
create index oneul_application_audit_actor_idx on public.oneul_application_audit(actor_id) where actor_id is not null;
create index oneul_applications_confirmer_idx on public.oneul_applications(confirmed_by) where confirmed_by is not null;
drop function public.oneul_review_application(uuid,uuid,text,text,text,text);
create function public.oneul_review_application(application_id uuid,actor_id uuid,decision text,note text,place text,preparation text,expected_submission timestamptz) returns void
language plpgsql security invoker set search_path='' as $$
declare item public.oneul_applications;
begin
  if not exists(select 1 from public.oneul_staff s where s.user_id=actor_id) then raise exception 'Operator required'; end if;
  select a.* into item from public.oneul_applications a where a.id=application_id for update;
  if not found or item.expires_at<=now() or decision not in ('changes_requested','confirmed','canceled') then raise exception 'Invalid decision'; end if;
  if decision='confirmed' and item.submitted_at is distinct from expected_submission then raise exception 'Submission changed; reload before review'; end if;
  if decision='confirmed' and (item.payment_status<>'paid' or item.profile is null or item.status not in ('submitted','confirmed') or char_length(btrim(place))=0) then raise exception 'Submitted paid profile and venue required'; end if;
  if decision='changes_requested' and (item.status not in ('submitted','confirmed','changes_requested') or char_length(btrim(note))=0) then raise exception 'Revision note required'; end if;
  update public.oneul_applications set status=decision,review_note=note,venue=place,instructions=preparation,
    payment_status=case when decision='canceled' then 'canceled' else payment_status end,
    confirmed_at=case when decision='confirmed' then now() else null end,
    confirmed_by=case when decision='confirmed' then actor_id else null end,
    notice_sent_at=null,updated_at=now() where id=item.id;
  insert into public.oneul_application_audit(application_id,actor_id,action) values(item.id,actor_id,decision);
end; $$;

revoke all on function public.oneul_review_application(uuid,uuid,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.oneul_review_application(uuid,uuid,text,text,text,text,timestamptz) to service_role;
create function public.oneul_rotate_application_invite(application_id uuid,actor_id uuid,new_hash text) returns void
language plpgsql security invoker set search_path='' as $$
declare item public.oneul_applications;
begin
  if not exists(select 1 from public.oneul_staff where user_id=actor_id) or new_hash !~ '^[a-f0-9]{64}$' then raise exception 'Operator and valid hash required'; end if;
  select * into item from public.oneul_applications where id=application_id for update;
  if not found or item.expires_at<=now() or item.payment_status<>'paid' or item.status='canceled' then raise exception 'Application unavailable'; end if;
  delete from public.oneul_application_sessions where oneul_application_sessions.application_id=item.id;
  update public.oneul_applications set invitation_hash=new_hash,invitation_used_at=null,invitation_expires_at=least(now()+interval '7 days',expires_at),updated_at=now() where id=item.id;
  insert into public.oneul_application_audit(application_id,actor_id,action) values(item.id,actor_id,'invite_rotated');
end; $$;
revoke all on function public.oneul_rotate_application_invite(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.oneul_rotate_application_invite(uuid,uuid,text) to service_role;
commit;
