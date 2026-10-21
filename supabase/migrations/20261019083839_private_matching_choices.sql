begin;
create table oneul_private.matching_rules (
  event_date date not null,
  start_time text not null,
  choice_limit integer not null check(choice_limit in(2,3)),
  updated_at timestamptz not null default now(),
  primary key(event_date,start_time)
);
create table oneul_private.matching_submissions (
  page_id uuid primary key references oneul_private.memo_pages(id) on delete cascade,
  numbers integer[] not null check(cardinality(numbers)<=3),
  version integer not null check(version>0),
  mutation_id uuid not null,
  submitted_at timestamptz not null default now()
);
alter table oneul_private.matching_rules enable row level security;
alter table oneul_private.matching_submissions enable row level security;
revoke all on oneul_private.matching_rules,oneul_private.matching_submissions from public,anon,authenticated;
grant all on oneul_private.matching_rules,oneul_private.matching_submissions to service_role;

create function oneul_private.matching_state(p_page_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('limit',least(coalesce(r.choice_limit,3),m.opponent_count),
   'numbers',coalesce(s.numbers,'{}'::integer[]),'version',coalesce(s.version,0),'submittedAt',s.submitted_at)
 from oneul_private.memo_pages m left join oneul_private.matching_rules r using(event_date,start_time)
 left join oneul_private.matching_submissions s on s.page_id=m.id where m.id=p_page_id;
$$;

create function oneul_private.matching_save(p_session_hash text,p_page_id uuid,p_numbers integer[],p_expected_version integer,p_expected_limit integer,p_mutation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item oneul_private.memo_pages; saved oneul_private.matching_submissions; chosen integer[]; allowed integer;
begin
 if p_page_id is null or p_numbers is null or coalesce(array_ndims(p_numbers),1)>1 or p_expected_version is null or p_expected_version<0
   or p_expected_limit is null or p_expected_limit not between 1 and 3 or p_mutation_id is null
   or exists(select 1 from unnest(p_numbers) n where n is null or n not between 1 and 13)
   or cardinality(p_numbers)<>(select count(distinct n) from unnest(p_numbers) n) then raise invalid_parameter_value using message='Invalid matching selection'; end if;
 item:=oneul_private.memo_page_for_session(p_session_hash,p_page_id);
 perform 1 from public.oneul_applications where id=item.application_id for share;
 perform 1 from oneul_private.memo_pages where id=item.id for update;
 item:=oneul_private.memo_page_for_session(p_session_hash,p_page_id);
 perform pg_advisory_xact_lock(hashtextextended(item.event_date::text||'/'||item.start_time||'/matching',0));
 select coalesce(array_agg(n order by n),'{}'::integer[]) into chosen from unnest(p_numbers) n;
 select least(coalesce((select choice_limit from oneul_private.matching_rules where event_date=item.event_date and start_time=item.start_time),3),item.opponent_count) into allowed;
 select * into saved from oneul_private.matching_submissions where page_id=item.id for update;
 if found and saved.mutation_id=p_mutation_id then
   if saved.numbers is distinct from chosen then raise serialization_failure using message='Matching request changed'; end if;
 else
   if coalesce(saved.version,0)<>p_expected_version or allowed<>p_expected_limit then raise serialization_failure using message='Matching selection or limit changed'; end if;
   if cardinality(chosen)>allowed or exists(select 1 from unnest(chosen) n where n>item.opponent_count) then raise invalid_parameter_value using message='Too many or invalid matching numbers'; end if;
   insert into oneul_private.matching_submissions(page_id,numbers,version,mutation_id,submitted_at)
     values(item.id,chosen,coalesce(saved.version,0)+1,p_mutation_id,clock_timestamp())
     on conflict(page_id) do update set numbers=excluded.numbers,version=excluded.version,mutation_id=excluded.mutation_id,submitted_at=excluded.submitted_at;
 end if;
 return jsonb_build_object('submitted',true,'pageId',item.id,'matching',oneul_private.matching_state(item.id));
end; $$;

create function oneul_private.matching_limit(p_application_id uuid,p_actor_id uuid,p_limit integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare app public.oneul_applications;
begin
 if not exists(select 1 from public.oneul_staff where user_id=p_actor_id) then raise insufficient_privilege using message='Operator required'; end if;
 if p_limit is null or p_limit not in(2,3) then raise invalid_parameter_value using message='Limit must be two or three'; end if;
 select * into app from public.oneul_applications where id=p_application_id for share;
 if not found or app.status<>'confirmed' or app.payment_status<>'paid' or app.expires_at<=now() then raise exception 'Confirmed paid application required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(app.event_date::text||'/'||app.start_time||'/matching',0));
 if exists(select 1 from oneul_private.matching_submissions s join oneul_private.memo_pages m on m.id=s.page_id
   where m.event_date=app.event_date and m.start_time=app.start_time and cardinality(s.numbers)>p_limit) then
   raise serialization_failure using message='Existing submissions exceed the new limit';
 end if;
 insert into oneul_private.matching_rules(event_date,start_time,choice_limit) values(app.event_date,app.start_time,p_limit)
   on conflict(event_date,start_time) do update set choice_limit=excluded.choice_limit,updated_at=clock_timestamp();
 insert into public.oneul_application_audit(application_id,actor_id,action) values(app.id,p_actor_id,'matching_limit_updated');
 return jsonb_build_object('updated',true,'applicationId',app.id,'limit',p_limit,'eventDate',app.event_date,'startTime',app.start_time);
end; $$;

-- Preserve the meaning of already-submitted participant numbers during QR maintenance.
create function oneul_private.matching_page_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(old.event_date::text||'/'||old.start_time||'/matching',0));
 if (new.participant_number<>old.participant_number or new.event_date<>old.event_date or new.start_time<>old.start_time or new.gender<>old.gender)
   and exists(select 1 from oneul_private.matching_submissions s join oneul_private.memo_pages m on m.id=s.page_id where m.event_date=old.event_date and m.start_time=old.start_time) then
   raise serialization_failure using message='Submitted participant numbers cannot change';
 end if;
 if exists(select 1 from oneul_private.matching_submissions s,unnest(s.numbers) n where s.page_id=old.id and n>new.opponent_count) then
   raise serialization_failure using message='Submitted selection exceeds opponent range';
 end if;
 return new;
end; $$;
create trigger matching_page_guard before update of participant_number,opponent_count,event_date,start_time,gender on oneul_private.memo_pages
for each row execute function oneul_private.matching_page_guard();

create function public.oneul_matching_save(p_session_hash text,p_page_id uuid,p_numbers integer[],p_expected_version integer,p_expected_limit integer,p_mutation_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select oneul_private.matching_save(p_session_hash,p_page_id,p_numbers,p_expected_version,p_expected_limit,p_mutation_id); $$;
create function public.oneul_matching_limit(p_application_id uuid,p_actor_id uuid,p_limit integer) returns jsonb
language sql security invoker set search_path='' as $$ select oneul_private.matching_limit(p_application_id,p_actor_id,p_limit); $$;
revoke all on function oneul_private.matching_state(uuid),oneul_private.matching_save(text,uuid,integer[],integer,integer,uuid),oneul_private.matching_limit(uuid,uuid,integer),oneul_private.matching_page_guard(),public.oneul_matching_save(text,uuid,integer[],integer,integer,uuid),public.oneul_matching_limit(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function oneul_private.matching_state(uuid),oneul_private.matching_save(text,uuid,integer[],integer,integer,uuid),oneul_private.matching_limit(uuid,uuid,integer),public.oneul_matching_save(text,uuid,integer[],integer,integer,uuid),public.oneul_matching_limit(uuid,uuid,integer) to service_role;

create or replace function oneul_private.memo_read(p_session_hash text,p_page_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare item oneul_private.memo_pages;
begin
  item:=oneul_private.memo_page_for_session(p_session_hash,p_page_id);
  return jsonb_build_object('page',jsonb_build_object('id',item.id,'eventDate',item.event_date,'startTime',item.start_time,
    'gender',item.gender,'participantNumber',item.participant_number,'opponentCount',item.opponent_count,'expiresAt',item.expires_at),
    'matching',oneul_private.matching_state(item.id),'entries',coalesce((select jsonb_agg(jsonb_build_object('opponentNumber',e.opponent_number,'text',e.body,'hearts',e.hearts,'version',e.version,'updatedAt',e.updated_at)
      order by e.opponent_number) from oneul_private.memo_entries e where e.page_id=item.id),'[]'::jsonb));
end; $$;

create or replace function oneul_private.memo_admin_read(p_application_id uuid,p_actor_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare app public.oneul_applications; item oneul_private.memo_pages;
begin
  if not exists(select 1 from public.oneul_staff where user_id=p_actor_id) then
    raise insufficient_privilege using message='Operator required';
  end if;
  select * into app from public.oneul_applications where id=p_application_id for share;
  if not found then raise no_data_found using message='Application not found'; end if;
  if app.status<>'confirmed' or app.payment_status<>'paid' or app.expires_at<=now() then
    raise exception 'Confirmed paid application required';
  end if;
  select * into item from oneul_private.memo_pages where application_id=app.id;
  if not found then return jsonb_build_object('issued',false,'applicationId',app.id); end if;
  if item.event_date<>app.event_date or item.start_time<>app.start_time or item.gender<>app.gender then
    raise serialization_failure using message='Memo event changed';
  end if;
  -- The QR lifetime only controls participant access. Operator review follows
  -- the existing application retention; it never renews a QR or browser session.
  insert into public.oneul_application_audit(application_id,actor_id,action)
    values(app.id,p_actor_id,'memo_admin_viewed');
  return jsonb_build_object('issued',true,'applicationId',app.id,
    'page',jsonb_build_object('id',item.id,'eventDate',item.event_date,'startTime',item.start_time,
      'gender',item.gender,'participantNumber',item.participant_number,'opponentCount',item.opponent_count,'expiresAt',item.expires_at),
    'matching',oneul_private.matching_state(item.id),'entries',coalesce((select jsonb_agg(jsonb_build_object('opponentNumber',e.opponent_number,
      'text',e.body,'hearts',e.hearts,'updatedAt',e.updated_at) order by e.opponent_number)
      from oneul_private.memo_entries e where e.page_id=item.id and e.opponent_number<=item.opponent_count),'[]'::jsonb));
end; $$;

create or replace function oneul_private.memo_admin(p_application_id uuid,p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item oneul_private.memo_pages; app public.oneul_applications; allowed integer;
begin
  if not exists(select 1 from public.oneul_staff where user_id=p_actor_id) then raise insufficient_privilege using message='Operator required'; end if;
  select * into app from public.oneul_applications where id=p_application_id;
  if not found then raise no_data_found using message='Application not found'; end if;
  select coalesce((select choice_limit from oneul_private.matching_rules where event_date=app.event_date and start_time=app.start_time),3) into allowed;
  select * into item from oneul_private.memo_pages where application_id=p_application_id;
  if not found then return jsonb_build_object('issued',false,'matchLimit',allowed); end if;
  return jsonb_build_object('issued',true,'matchLimit',allowed,'pageId',item.id,'participantNumber',item.participant_number,
    'opponentCount',item.opponent_count,'expiresAt',item.expires_at,'eventDate',item.event_date,'startTime',item.start_time,'gender',item.gender);
end; $$;

notify pgrst,'reload schema';
commit;
