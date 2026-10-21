begin;
-- Only the three profile summary fields needed by the operator roster.
create or replace function oneul_private.session_detail(p_actor_id uuid,p_event_date date,p_start_time text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.oneul_staff where user_id=p_actor_id) then raise insufficient_privilege using message='Operator required'; end if;
 with attendees as (
  select a.id,a.name,a.phone,a.gender,a.source,a.status,a.updated_at,a.profile->'height' as height,a.profile->>'job' as job,a.profile->>'mbti' as mbti,m.id as page_id,m.participant_number,m.opponent_count,
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
  'attendees',coalesce((select jsonb_agg(jsonb_build_object('applicationId',a.id,'name',a.name,'phone',a.phone,'gender',a.gender,'source',a.source,'status',a.status,'height',a.height,'job',a.job,'mbti',a.mbti,
    'pageId',a.page_id,'participantNumber',a.participant_number,'opponentCount',a.opponent_count,'updatedAt',a.updated_at,
    'selection',case when a.eligible then to_jsonb(a.numbers) else null end,'submittedAt',case when a.eligible then a.submitted_at else null end)
    order by a.gender,a.participant_number nulls last,a.name,a.id) from attendees a),'[]'::jsonb),
  'pairs',coalesce((select jsonb_agg(pair order by male_no,female_no) from pairs),'[]'::jsonb)) into result;
 return result;
end; $$;
notify pgrst,'reload schema';
commit;
