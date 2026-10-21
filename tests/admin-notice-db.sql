begin;
-- Conditional metadata writes only; no message is sent and all fixtures roll back.
do $$
declare
  application_id uuid;
  original_version timestamptz := '2026-10-08 00:00:00+00';
  sent_at timestamptz := '2026-10-08 01:00:00+00';
  changed integer;
begin
  insert into public.oneul_applications(source,external_order_no,name,phone,gender,event_date,start_time,amount,status,profile,confirmed_at,updated_at,expires_at)
    values ('frip','notice-rollback-'||gen_random_uuid(),'검증용','+821000000000','여성','2026-10-24','18:00',1000,'confirmed','{"name":"검증용"}',now(),original_version,now()+interval '1 day') returning id into application_id;

  update public.oneul_applications set notice_sent_at=sent_at,notice_text='검증용 발송 기록',updated_at=sent_at
    where id=application_id and status='confirmed' and payment_status='paid' and notice_sent_at is null and updated_at=original_version;
  get diagnostics changed = row_count;
  if changed<>1 then raise exception 'Expected exactly one notice update'; end if;
  if not exists(select 1 from public.oneul_applications where id=application_id and notice_sent_at=sent_at and notice_text='검증용 발송 기록' and updated_at=sent_at) then raise exception 'Saved receipt mismatch'; end if;

  update public.oneul_applications set notice_sent_at=now(),notice_text='중복 기록'
    where id=application_id and status='confirmed' and payment_status='paid' and notice_sent_at is null and updated_at=sent_at;
  get diagnostics changed = row_count;
  if changed<>0 then raise exception 'Duplicate notice overwrote original'; end if;

  update public.oneul_applications set notice_sent_at=null,updated_at=sent_at where id=application_id;
  update public.oneul_applications set notice_sent_at=now()
    where id=application_id and status='confirmed' and payment_status='paid' and notice_sent_at is null and updated_at=original_version;
  get diagnostics changed = row_count;
  if changed<>0 then raise exception 'Stale version was accepted'; end if;

  update public.oneul_applications set status='canceled',payment_status='canceled' where id=application_id;
  update public.oneul_applications set notice_sent_at=now()
    where id=application_id and status='confirmed' and payment_status='paid' and notice_sent_at is null and updated_at=sent_at;
  get diagnostics changed = row_count;
  if changed<>0 then raise exception 'Canceled application was recorded'; end if;
end;
$$;
rollback;
