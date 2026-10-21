begin;
-- Venue is optional during participant verification. Keep the remaining
-- paid-submission and recorded-confirmation invariants at the table boundary.
alter table public.oneul_applications drop constraint oneul_applications_check1;
alter table public.oneul_applications add constraint oneul_applications_confirmed_state_check
  check(status<>'confirmed' or (profile is not null and payment_status='paid' and confirmed_at is not null));

create or replace function public.oneul_review_application(application_id uuid,actor_id uuid,decision text,note text,place text,preparation text,expected_submission timestamptz) returns void
language plpgsql security invoker set search_path='' as $$
declare item public.oneul_applications;
begin
  if not exists(select 1 from public.oneul_staff s where s.user_id=actor_id) then raise exception 'Operator required'; end if;
  select a.* into item from public.oneul_applications a where a.id=application_id for update;
  if not found or item.expires_at<=now() or decision not in ('changes_requested','confirmed','canceled') then raise exception 'Invalid decision'; end if;
  if decision='confirmed' and item.submitted_at is distinct from expected_submission then raise exception 'Submission changed; reload before review'; end if;
  if decision='confirmed' and (item.payment_status<>'paid' or item.profile is null or item.status not in ('submitted','confirmed')) then raise exception 'Submitted paid profile required'; end if;
  if decision='changes_requested' and (item.status not in ('submitted','confirmed','changes_requested') or char_length(btrim(note))=0) then raise exception 'Revision note required'; end if;
  update public.oneul_applications set status=decision,review_note=note,
    venue=coalesce(nullif(btrim(place),''),item.venue),instructions=preparation,
    payment_status=case when decision='canceled' then 'canceled' else payment_status end,
    confirmed_at=case when decision='confirmed' then now() else null end,
    confirmed_by=case when decision='confirmed' then actor_id else null end,
    notice_sent_at=null,updated_at=now() where id=item.id;
  insert into public.oneul_application_audit(application_id,actor_id,action) values(item.id,actor_id,decision);
end; $$;
revoke all on function public.oneul_review_application(uuid,uuid,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.oneul_review_application(uuid,uuid,text,text,text,text,timestamptz) to service_role;
commit;
