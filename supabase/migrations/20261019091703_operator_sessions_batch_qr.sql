begin;
-- Batch receipts retain hashes and application references, never QR seeds/tokens.
create table oneul_private.memo_issue_batches (
 id uuid primary key,
 actor_id uuid references auth.users(id) on delete set null,
 event_date date not null,
 start_time text not null,
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 skipped_count integer not null default 0,
 created_at timestamptz not null default now()
);
create table oneul_private.memo_issue_batch_items (
 batch_id uuid not null references oneul_private.memo_issue_batches(id) on delete cascade,
 application_id uuid not null references public.oneul_applications(id) on delete cascade,
 page_id uuid not null references oneul_private.memo_pages(id) on delete cascade,
 qr_hash text not null check(qr_hash ~ '^[a-f0-9]{64}$'),
 primary key(batch_id,application_id)
);
create index memo_issue_batches_actor_idx on oneul_private.memo_issue_batches(actor_id);
create index memo_issue_batch_items_application_idx on oneul_private.memo_issue_batch_items(application_id);
create index memo_issue_batch_items_page_idx on oneul_private.memo_issue_batch_items(page_id);
alter table oneul_private.memo_issue_batches enable row level security;
alter table oneul_private.memo_issue_batch_items enable row level security;
revoke all on oneul_private.memo_issue_batches,oneul_private.memo_issue_batch_items from public,anon,authenticated;
grant all on oneul_private.memo_issue_batches,oneul_private.memo_issue_batch_items to service_role;

create function oneul_private.session_list(p_actor_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.oneul_staff where user_id=p_actor_id) then raise insufficient_privilege using message='Operator required'; end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x."eventDate" desc,x."startTime"),'[]'::jsonb) into result from (
  select a.event_date as "eventDate",a.start_time as "startTime",count(*) as "paidCount",
   count(*) filter(where a.gender='남성') as "maleCount",count(*) filter(where a.gender='여성') as "femaleCount",
   count(*) filter(where a.status='confirmed') as "confirmedCount",
   count(*) filter(where a.status='confirmed' and s.page_id is not null) as "submittedCount"
  from public.oneul_applications a left join oneul_private.memo_pages m on m.application_id=a.id and m.event_date=a.event_date and m.start_time=a.start_time and m.gender=a.gender
  left join oneul_private.matching_submissions s on s.page_id=m.id
  where a.payment_status='paid' and a.status<>'canceled' and a.expires_at>now()
  group by a.event_date,a.start_time
 ) x;
 return jsonb_build_object('sessions',result);
end; $$;

create function oneul_private.session_detail(p_actor_id uuid,p_event_date date,p_start_time text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.oneul_staff where user_id=p_actor_id) then raise insufficient_privilege using message='Operator required'; end if;
 with attendees as (
  select a.id,a.name,a.phone,a.gender,a.source,a.status,a.updated_at,m.id as page_id,m.participant_number,m.opponent_count,
    s.numbers,s.submitted_at,a.status='confirmed' as eligible
  from public.oneul_applications a left join oneul_private.memo_pages m on m.application_id=a.id and m.event_date=a.event_date and m.start_time=a.start_time and m.gender=a.gender
  left join oneul_private.matching_submissions s on s.page_id=m.id
  where a.event_date=p_event_date and a.start_time=p_start_time and a.payment_status='paid' and a.status<>'canceled' and a.expires_at>now()
 ), pairs as (
  select jsonb_build_object('male',jsonb_build_object('applicationId',m.id,'name',m.name,'phone',m.phone,'number',m.participant_number),
   'female',jsonb_build_object('applicationId',f.id,'name',f.name,'phone',f.phone,'number',f.participant_number)) as pair,m.participant_number as male_no,f.participant_number as female_no
  from attendees m join attendees f on m.gender='남성' and f.gender='여성' and m.eligible and f.eligible
    and m.participant_number=any(f.numbers) and f.participant_number=any(m.numbers)
 )
 select jsonb_build_object('eventDate',p_event_date,'startTime',p_start_time,
  'matchLimit',coalesce((select choice_limit from oneul_private.matching_rules where event_date=p_event_date and start_time=p_start_time),3),
  'paidCount',(select count(*) from attendees),'confirmedCount',(select count(*) from attendees where eligible),
  'submittedCount',(select count(*) from attendees where eligible and submitted_at is not null),
  'attendees',coalesce((select jsonb_agg(jsonb_build_object('applicationId',a.id,'name',a.name,'phone',a.phone,'gender',a.gender,'source',a.source,'status',a.status,
    'pageId',a.page_id,'participantNumber',a.participant_number,'opponentCount',a.opponent_count,'updatedAt',a.updated_at,
    'selection',case when a.eligible then to_jsonb(a.numbers) else null end,'submittedAt',case when a.eligible then a.submitted_at else null end)
    order by a.gender,a.participant_number nulls last,a.name,a.id) from attendees a),'[]'::jsonb),
  'pairs',coalesce((select jsonb_agg(pair order by male_no,female_no) from pairs),'[]'::jsonb)) into result;
 return result;
end; $$;

create function oneul_private.session_batch_plan(p_actor_id uuid,p_event_date date,p_start_time text,p_batch_id uuid,p_request_hash text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare batch oneul_private.memo_issue_batches; expected jsonb; result jsonb;
begin
 if not exists(select 1 from public.oneul_staff where user_id=p_actor_id) then raise insufficient_privilege using message='Operator required'; end if;
 select * into batch from oneul_private.memo_issue_batches where id=p_batch_id;
 if found then
  if batch.actor_id is distinct from p_actor_id or batch.event_date is distinct from p_event_date or batch.start_time is distinct from p_start_time or batch.request_hash is distinct from p_request_hash then raise serialization_failure using message='Batch request changed'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('applicationId',a.id,'name',a.name,'gender',a.gender,'pageId',m.id,'participantNumber',m.participant_number,
    'opponentCount',m.opponent_count,'qrHash',i.qr_hash,'valid',m.qr_hash=i.qr_hash and m.expires_at>now() and a.expires_at>now() and a.status='confirmed' and a.payment_status='paid'
      and m.event_date=a.event_date and m.start_time=a.start_time and m.gender=a.gender)
    order by a.gender,m.participant_number),'[]'::jsonb) into result
   from oneul_private.memo_issue_batch_items i join public.oneul_applications a on a.id=i.application_id join oneul_private.memo_pages m on m.id=i.page_id where i.batch_id=batch.id;
  return jsonb_build_object('completed',true,'batchId',batch.id,'eventDate',batch.event_date,'startTime',batch.start_time,'skippedCount',batch.skipped_count,'items',result);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('applicationId',a.id,'updatedAt',a.updated_at,'pageUpdatedAt',m.updated_at) order by a.id),'[]'::jsonb) into expected
 from public.oneul_applications a left join oneul_private.memo_pages m on m.application_id=a.id
 where a.event_date=p_event_date and a.start_time=p_start_time and a.status='confirmed' and a.payment_status='paid' and a.expires_at>now();
 return jsonb_build_object('completed',false,'expected',expected);
end; $$;

create function oneul_private.session_batch_issue(p_actor_id uuid,p_event_date date,p_start_time text,p_batch_id uuid,p_request_hash text,p_expected jsonb,p_hashes jsonb,p_replace boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare current_plan jsonb; app public.oneul_applications; info jsonb; page oneul_private.memo_pages; prior integer;
 male_count integer; female_count integer; skipped integer:=0; opposite_max integer; token_hash text;
begin
 if not exists(select 1 from public.oneul_staff where user_id=p_actor_id) then raise insufficient_privilege using message='Operator required'; end if;
 if p_batch_id is null or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$' or p_replace is null or jsonb_typeof(p_expected)<>'array' or jsonb_typeof(p_hashes)<>'object' then raise invalid_parameter_value using message='Invalid batch request'; end if;
 perform pg_advisory_xact_lock(hashtextextended('memo-batch/'||p_batch_id::text,0));
 current_plan:=oneul_private.session_batch_plan(p_actor_id,p_event_date,p_start_time,p_batch_id,p_request_hash);
 if current_plan->>'completed'='true' then return current_plan; end if;
 -- Lock the current cohort before assigning either side's numbers.
 perform 1 from public.oneul_applications where event_date=p_event_date and start_time=p_start_time order by id for update;
 current_plan:=oneul_private.session_batch_plan(p_actor_id,p_event_date,p_start_time,p_batch_id,p_request_hash);
 if current_plan->'expected' is distinct from p_expected then raise serialization_failure using message='Session participant list changed'; end if;
 select count(*) filter(where gender='남성'),count(*) filter(where gender='여성') into male_count,female_count from public.oneul_applications
  where event_date=p_event_date and start_time=p_start_time and status='confirmed' and payment_status='paid' and expires_at>now();
 if male_count>13 or female_count>13 then raise invalid_parameter_value using message='At most 13 participants per side'; end if;
 insert into oneul_private.memo_issue_batches(id,actor_id,event_date,start_time,request_hash) values(p_batch_id,p_actor_id,p_event_date,p_start_time,p_request_hash);
 for app in select * from public.oneul_applications where event_date=p_event_date and start_time=p_start_time and status='confirmed' and payment_status='paid' and expires_at>now() order by gender,created_at,id loop
  select * into page from oneul_private.memo_pages where application_id=app.id;
  if found and not p_replace then skipped:=skipped+1;continue; end if;
  prior:=page.opponent_count;
  if male_count=0 or female_count=0 then raise invalid_parameter_value using message='Both sides need confirmed participants'; end if;
  token_hash:=p_hashes->>app.id::text;
  if token_hash is null or token_hash !~ '^[a-f0-9]{64}$' then raise invalid_parameter_value using message='QR hash missing'; end if;
  info:=oneul_private.memo_issue(app.id,p_actor_id,token_hash,13,null,app.updated_at,p_replace);
  insert into oneul_private.memo_issue_batch_items(batch_id,application_id,page_id,qr_hash) values(p_batch_id,app.id,(info->>'pageId')::uuid,token_hash);
  -- Retain any old range so reissuance cannot hide existing notes or choices.
  if prior is not null then update oneul_private.memo_pages set opponent_count=prior where id=(info->>'pageId')::uuid; end if;
 end loop;
 for page in select m.* from oneul_private.memo_pages m join public.oneul_applications a on a.id=m.application_id
  where a.event_date=p_event_date and a.start_time=p_start_time and a.status='confirmed' and a.payment_status='paid' and a.expires_at>now() loop
  select max(m.participant_number) into opposite_max from oneul_private.memo_pages m join public.oneul_applications a on a.id=m.application_id
   where a.event_date=p_event_date and a.start_time=p_start_time and a.gender<>page.gender and a.status='confirmed' and a.payment_status='paid' and a.expires_at>now();
  if exists(select 1 from oneul_private.memo_issue_batch_items where batch_id=p_batch_id and page_id=page.id) and page.opponent_count=13
    and not exists(select 1 from oneul_private.memo_entries where page_id=page.id) and not exists(select 1 from oneul_private.matching_submissions where page_id=page.id) then
    update oneul_private.memo_pages set opponent_count=greatest(coalesce(opposite_max,1),1) where id=page.id;
  elsif opposite_max>page.opponent_count then update oneul_private.memo_pages set opponent_count=opposite_max where id=page.id; end if;
 end loop;
 update oneul_private.memo_issue_batches set skipped_count=skipped where id=p_batch_id;
 return oneul_private.session_batch_plan(p_actor_id,p_event_date,p_start_time,p_batch_id,p_request_hash);
end; $$;

create function public.oneul_session_list(p_actor_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select oneul_private.session_list(p_actor_id); $$;
create function public.oneul_session_detail(p_actor_id uuid,p_event_date date,p_start_time text) returns jsonb language sql security invoker set search_path='' as $$ select oneul_private.session_detail(p_actor_id,p_event_date,p_start_time); $$;
create function public.oneul_session_batch_plan(p_actor_id uuid,p_event_date date,p_start_time text,p_batch_id uuid,p_request_hash text) returns jsonb language sql security invoker set search_path='' as $$ select oneul_private.session_batch_plan(p_actor_id,p_event_date,p_start_time,p_batch_id,p_request_hash); $$;
create function public.oneul_session_batch_issue(p_actor_id uuid,p_event_date date,p_start_time text,p_batch_id uuid,p_request_hash text,p_expected jsonb,p_hashes jsonb,p_replace boolean) returns jsonb language sql security invoker set search_path='' as $$ select oneul_private.session_batch_issue(p_actor_id,p_event_date,p_start_time,p_batch_id,p_request_hash,p_expected,p_hashes,p_replace); $$;
revoke all on function oneul_private.session_list(uuid),oneul_private.session_detail(uuid,date,text),oneul_private.session_batch_plan(uuid,date,text,uuid,text),oneul_private.session_batch_issue(uuid,date,text,uuid,text,jsonb,jsonb,boolean),public.oneul_session_list(uuid),public.oneul_session_detail(uuid,date,text),public.oneul_session_batch_plan(uuid,date,text,uuid,text),public.oneul_session_batch_issue(uuid,date,text,uuid,text,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function oneul_private.session_list(uuid),oneul_private.session_detail(uuid,date,text),oneul_private.session_batch_plan(uuid,date,text,uuid,text),oneul_private.session_batch_issue(uuid,date,text,uuid,text,jsonb,jsonb,boolean),public.oneul_session_list(uuid),public.oneul_session_detail(uuid,date,text),public.oneul_session_batch_plan(uuid,date,text,uuid,text),public.oneul_session_batch_issue(uuid,date,text,uuid,text,jsonb,jsonb,boolean) to service_role;
notify pgrst,'reload schema';
commit;
