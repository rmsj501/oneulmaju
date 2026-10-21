begin;
-- Counts describe the opponents seen by each gender, not that gender's own size.
alter table oneul_private.matching_rules
 add column male_opponent_count integer check(male_opponent_count between 1 and 13),
 add column female_opponent_count integer check(female_opponent_count between 1 and 13);
alter table oneul_private.memo_issue_batches add column settings jsonb;

create or replace function oneul_private.session_detail(p_actor_id uuid,p_event_date date,p_start_time text) returns jsonb
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
  'maleOpponentCount',(select male_opponent_count from oneul_private.matching_rules where event_date=p_event_date and start_time=p_start_time),
  'femaleOpponentCount',(select female_opponent_count from oneul_private.matching_rules where event_date=p_event_date and start_time=p_start_time),
  'paidCount',(select count(*) from attendees),'confirmedCount',(select count(*) from attendees where eligible),
  'submittedCount',(select count(*) from attendees where eligible and submitted_at is not null),
  'attendees',coalesce((select jsonb_agg(jsonb_build_object('applicationId',a.id,'name',a.name,'phone',a.phone,'gender',a.gender,'source',a.source,'status',a.status,
    'pageId',a.page_id,'participantNumber',a.participant_number,'opponentCount',a.opponent_count,'updatedAt',a.updated_at,
    'selection',case when a.eligible then to_jsonb(a.numbers) else null end,'submittedAt',case when a.eligible then a.submitted_at else null end)
    order by a.gender,a.participant_number nulls last,a.name,a.id) from attendees a),'[]'::jsonb),
  'pairs',coalesce((select jsonb_agg(pair order by male_no,female_no) from pairs),'[]'::jsonb)) into result;
 return result;
end; $$;

create or replace function oneul_private.session_batch_plan(p_actor_id uuid,p_event_date date,p_start_time text,p_batch_id uuid,p_request_hash text) returns jsonb
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
  return jsonb_build_object('completed',true,'batchId',batch.id,'eventDate',batch.event_date,'startTime',batch.start_time,'skippedCount',batch.skipped_count,'settings',batch.settings,'items',result);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('applicationId',a.id,'updatedAt',a.updated_at,'pageUpdatedAt',m.updated_at) order by a.id),'[]'::jsonb) into expected
 from public.oneul_applications a left join oneul_private.memo_pages m on m.application_id=a.id
 where a.event_date=p_event_date and a.start_time=p_start_time and a.status='confirmed' and a.payment_status='paid' and a.expires_at>now();
 return jsonb_build_object('completed',false,'expected',expected);
end; $$;

-- Existing RPC remains compatible with older clients. Configured issuance is atomic:
-- no QR, rule or page change survives if any prior note/choice would be hidden.
create function oneul_private.session_batch_issue_configured(
 p_actor_id uuid,p_event_date date,p_start_time text,p_batch_id uuid,p_request_hash text,
 p_expected jsonb,p_hashes jsonb,p_replace boolean,
 p_male_opponent_count integer,p_female_opponent_count integer,p_match_limit integer
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; chosen_settings jsonb;
begin
 if not exists(select 1 from public.oneul_staff where user_id=p_actor_id) then raise insufficient_privilege using message='Operator required'; end if;
 if p_male_opponent_count is null or p_male_opponent_count not between 1 and 13
  or p_female_opponent_count is null or p_female_opponent_count not between 1 and 13
  or p_match_limit is null or p_match_limit not in(2,3) then raise invalid_parameter_value using message='Invalid session settings'; end if;
 chosen_settings:=jsonb_build_object('maleOpponentCount',p_male_opponent_count,'femaleOpponentCount',p_female_opponent_count,'matchLimit',p_match_limit);
 perform pg_advisory_xact_lock(hashtextextended('memo-batch/'||p_batch_id::text,0));
 result:=oneul_private.session_batch_plan(p_actor_id,p_event_date,p_start_time,p_batch_id,p_request_hash);
 if result->>'completed'='true' then
  if result->'settings' is distinct from chosen_settings then raise serialization_failure using message='Batch settings changed'; end if;
  return result; -- A retry must never overwrite a later cohort configuration.
 end if;
 -- Same lock order as note/choice saves: application, page, matching rule.
 perform 1 from public.oneul_applications where event_date=p_event_date and start_time=p_start_time order by id for update;
 result:=oneul_private.session_batch_issue(p_actor_id,p_event_date,p_start_time,p_batch_id,p_request_hash,p_expected,p_hashes,p_replace);
 perform 1 from oneul_private.memo_pages where event_date=p_event_date and start_time=p_start_time order by id for update;
 perform pg_advisory_xact_lock(hashtextextended(p_event_date::text||'/'||p_start_time||'/matching',0));
 if exists(select 1 from oneul_private.memo_pages m join public.oneul_applications a on a.id=m.application_id
   where a.event_date=p_event_date and a.start_time=p_start_time and a.status='confirmed' and a.payment_status='paid' and a.expires_at>now()
   and m.participant_number>case when a.gender='남성' then p_female_opponent_count else p_male_opponent_count end) then
  raise invalid_parameter_value using message='Opponent range excludes assigned participants';
 end if;
 if exists(select 1 from oneul_private.memo_entries e join oneul_private.memo_pages m on m.id=e.page_id
   where m.event_date=p_event_date and m.start_time=p_start_time and (e.body<>'' or e.hearts>0)
    and e.opponent_number>case when m.gender='남성' then p_male_opponent_count else p_female_opponent_count end)
  or exists(select 1 from oneul_private.matching_submissions s join oneul_private.memo_pages m on m.id=s.page_id
   where m.event_date=p_event_date and m.start_time=p_start_time and
    (cardinality(s.numbers)>p_match_limit or exists(select 1 from unnest(s.numbers) n where n>case when m.gender='남성' then p_male_opponent_count else p_female_opponent_count end))) then
  raise serialization_failure using message='Session settings would hide notes or choices';
 end if;
 insert into oneul_private.matching_rules(event_date,start_time,choice_limit,male_opponent_count,female_opponent_count)
  values(p_event_date,p_start_time,p_match_limit,p_male_opponent_count,p_female_opponent_count)
  on conflict(event_date,start_time) do update set choice_limit=excluded.choice_limit,male_opponent_count=excluded.male_opponent_count,
   female_opponent_count=excluded.female_opponent_count,updated_at=clock_timestamp();
 update oneul_private.memo_pages m set opponent_count=case when m.gender='남성' then p_male_opponent_count else p_female_opponent_count end,updated_at=clock_timestamp()
  from public.oneul_applications a where a.id=m.application_id and a.event_date=p_event_date and a.start_time=p_start_time
   and a.status='confirmed' and a.payment_status='paid' and a.expires_at>now();
 update oneul_private.memo_issue_batches set settings=chosen_settings where id=p_batch_id;
 return oneul_private.session_batch_plan(p_actor_id,p_event_date,p_start_time,p_batch_id,p_request_hash);
end; $$;

create function public.oneul_session_batch_issue_configured(
 p_actor_id uuid,p_event_date date,p_start_time text,p_batch_id uuid,p_request_hash text,p_expected jsonb,p_hashes jsonb,p_replace boolean,
 p_male_opponent_count integer,p_female_opponent_count integer,p_match_limit integer
) returns jsonb language sql security invoker set search_path='' as $$
 select oneul_private.session_batch_issue_configured(p_actor_id,p_event_date,p_start_time,p_batch_id,p_request_hash,p_expected,p_hashes,p_replace,p_male_opponent_count,p_female_opponent_count,p_match_limit);
$$;
revoke all on function oneul_private.session_batch_issue_configured(uuid,date,text,uuid,text,jsonb,jsonb,boolean,integer,integer,integer),public.oneul_session_batch_issue_configured(uuid,date,text,uuid,text,jsonb,jsonb,boolean,integer,integer,integer) from public,anon,authenticated;
grant execute on function oneul_private.session_batch_issue_configured(uuid,date,text,uuid,text,jsonb,jsonb,boolean,integer,integer,integer),public.oneul_session_batch_issue_configured(uuid,date,text,uuid,text,jsonb,jsonb,boolean,integer,integer,integer) to service_role;
notify pgrst,'reload schema';
commit;
