begin;
-- Guest/member-neutral capabilities, separate from profile invitations and Auth.
create table oneul_private.memo_pages (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.oneul_applications(id) on delete cascade,
  event_date date not null,
  start_time text not null,
  gender text not null check (gender in ('남성','여성')),
  participant_number integer not null check (participant_number between 1 and 13),
  opponent_count integer not null check (opponent_count between 1 and 13),
  qr_hash text not null unique check (qr_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_date,start_time,gender,participant_number)
);
create table oneul_private.memo_sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  page_id uuid not null references oneul_private.memo_pages(id) on delete cascade,
  expires_at timestamptz not null
);
create index memo_sessions_page_idx on oneul_private.memo_sessions(page_id);
create table oneul_private.memo_entries (
  page_id uuid not null references oneul_private.memo_pages(id) on delete cascade,
  opponent_number integer not null check (opponent_number between 1 and 13),
  body text not null default '' check (char_length(body)<=500),
  hearts integer not null default 0 check (hearts between 0 and 3),
  version integer not null check (version>0),
  mutation_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key(page_id,opponent_number)
);
alter table oneul_private.memo_pages enable row level security;
alter table oneul_private.memo_sessions enable row level security;
alter table oneul_private.memo_entries enable row level security;
revoke all on oneul_private.memo_pages,oneul_private.memo_sessions,oneul_private.memo_entries from public,anon,authenticated;
grant all on oneul_private.memo_pages,oneul_private.memo_sessions,oneul_private.memo_entries to service_role;

-- No private memo body is returned by admin functions.
create function oneul_private.memo_admin(p_application_id uuid,p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item oneul_private.memo_pages;
begin
  if not exists(select 1 from public.oneul_staff where user_id=p_actor_id) then raise insufficient_privilege using message='Operator required'; end if;
  select * into item from oneul_private.memo_pages where application_id=p_application_id;
  if not found then return jsonb_build_object('issued',false); end if;
  return jsonb_build_object('issued',true,'pageId',item.id,'participantNumber',item.participant_number,
    'opponentCount',item.opponent_count,'expiresAt',item.expires_at,'eventDate',item.event_date,'startTime',item.start_time,'gender',item.gender);
end; $$;
create function oneul_private.memo_issue(p_application_id uuid,p_actor_id uuid,p_qr_hash text,p_opponent_count integer,p_participant_number integer,p_expected_updated_at timestamptz,p_replace boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare app public.oneul_applications; item oneul_private.memo_pages; seat integer; existing boolean;
begin
  if not exists(select 1 from public.oneul_staff where user_id=p_actor_id) then raise insufficient_privilege using message='Operator required'; end if;
  if p_qr_hash is null or p_qr_hash !~ '^[a-f0-9]{64}$' or p_opponent_count is null or p_opponent_count not between 1 and 13
    or (p_participant_number is not null and p_participant_number not between 1 and 13) then raise exception 'Invalid memo options'; end if;
  select * into app from public.oneul_applications where id=p_application_id for update;
  if not found or app.status<>'confirmed' or app.payment_status<>'paid' or app.expires_at<=now() then raise exception 'Confirmed paid application required'; end if;
  if p_expected_updated_at is distinct from app.updated_at then raise serialization_failure using message='Application changed'; end if;
  if (app.event_date+8)::timestamp at time zone 'Asia/Seoul' <= now() then raise exception 'Memo event expired'; end if;
  -- Serialize numbering for the same session/side, then lock only this page.
  perform pg_advisory_xact_lock(hashtextextended(app.event_date::text||'/'||app.start_time||'/'||app.gender,0));
  select * into item from oneul_private.memo_pages where application_id=app.id for update;
  existing:=found;
  if existing and not coalesce(p_replace,false) then raise serialization_failure using message='Memo QR already issued'; end if;
  if existing and (item.event_date<>app.event_date or item.start_time<>app.start_time or item.gender<>app.gender) then raise exception 'Memo event changed'; end if;
  if existing and exists(select 1 from oneul_private.memo_entries e where e.page_id=item.id and e.opponent_number>p_opponent_count and (e.body<>'' or e.hearts>0)) then raise exception 'Existing memo exceeds opponent range'; end if;
  seat:=coalesce(p_participant_number,case when existing then item.participant_number end);
  if seat is null then
    select n into seat from generate_series(1,13) n where not exists(select 1 from oneul_private.memo_pages m
      where m.event_date=app.event_date and m.start_time=app.start_time and m.gender=app.gender and m.participant_number=n) order by n limit 1;
  end if;
  if seat is null or exists(select 1 from oneul_private.memo_pages m where m.event_date=app.event_date and m.start_time=app.start_time
    and m.gender=app.gender and m.participant_number=seat and m.application_id<>app.id) then raise unique_violation using message='Participant number taken'; end if;
  if existing then
    update oneul_private.memo_pages set participant_number=seat,opponent_count=p_opponent_count,qr_hash=p_qr_hash,updated_at=now() where id=item.id returning * into item;
    delete from oneul_private.memo_sessions where page_id=item.id;
  else
    insert into oneul_private.memo_pages(application_id,event_date,start_time,gender,participant_number,opponent_count,qr_hash,expires_at)
    values(app.id,app.event_date,app.start_time,app.gender,seat,p_opponent_count,p_qr_hash,least(app.expires_at,(app.event_date+8)::timestamp at time zone 'Asia/Seoul')) returning * into item;
  end if;
  insert into public.oneul_application_audit(application_id,actor_id,action) values(app.id,p_actor_id,case when existing then 'memo_qr_reissued' else 'memo_qr_issued' end);
  return oneul_private.memo_admin(app.id,p_actor_id);
end; $$;

-- Capability validation always rechecks live application status and event identity.
create function oneul_private.memo_page_for_session(p_session_hash text,p_page_id uuid default null) returns oneul_private.memo_pages
language plpgsql security definer set search_path='' as $$
declare item oneul_private.memo_pages;
begin
  if p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$' then raise invalid_authorization_specification using message='Memo session required'; end if;
  select m.* into item from oneul_private.memo_sessions s join oneul_private.memo_pages m on m.id=s.page_id
    join public.oneul_applications a on a.id=m.application_id
    where s.token_hash=p_session_hash and s.expires_at>now() and m.expires_at>now() and a.expires_at>now()
      and a.status='confirmed' and a.payment_status='paid' and a.event_date=m.event_date and a.start_time=m.start_time and a.gender=m.gender;
  if not found then raise invalid_authorization_specification using message='Memo session unavailable'; end if;
  if p_page_id is not null and p_page_id<>item.id then raise serialization_failure using message='Memo session changed'; end if;
  return item;
end; $$;
create function oneul_private.memo_exchange(p_qr_hash text,p_session_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item oneul_private.memo_pages;
begin
  if p_qr_hash is null or p_session_hash is null or p_qr_hash !~ '^[a-f0-9]{64}$' or p_session_hash !~ '^[a-f0-9]{64}$' then raise invalid_authorization_specification using message='Invalid memo QR'; end if;
  select m.* into item from oneul_private.memo_pages m join public.oneul_applications a on a.id=m.application_id
    where m.qr_hash=p_qr_hash and m.expires_at>now() and a.expires_at>now() and a.status='confirmed' and a.payment_status='paid'
      and a.event_date=m.event_date and a.start_time=m.start_time and a.gender=m.gender for update of m;
  if not found then raise invalid_authorization_specification using message='Memo QR unavailable'; end if;
  -- One persistent browser credential per scan; never return a database hash.
  delete from oneul_private.memo_sessions where page_id=item.id and expires_at<=now();
  insert into oneul_private.memo_sessions(token_hash,page_id,expires_at) values(p_session_hash,item.id,item.expires_at);
  return jsonb_build_object('pageId',item.id,'expiresAt',item.expires_at);
end; $$;
create function oneul_private.memo_read(p_session_hash text,p_page_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare item oneul_private.memo_pages;
begin
  item:=oneul_private.memo_page_for_session(p_session_hash,p_page_id);
  return jsonb_build_object('page',jsonb_build_object('id',item.id,'eventDate',item.event_date,'startTime',item.start_time,
    'gender',item.gender,'participantNumber',item.participant_number,'opponentCount',item.opponent_count,'expiresAt',item.expires_at),
    'entries',coalesce((select jsonb_agg(jsonb_build_object('opponentNumber',e.opponent_number,'text',e.body,'hearts',e.hearts,'version',e.version,'updatedAt',e.updated_at)
      order by e.opponent_number) from oneul_private.memo_entries e where e.page_id=item.id),'[]'::jsonb));
end; $$;
create function oneul_private.memo_save(p_session_hash text,p_page_id uuid,p_opponent_number integer,p_text text,p_hearts integer,p_expected_version integer,p_mutation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item oneul_private.memo_pages; entry oneul_private.memo_entries; exists_entry boolean;
begin
  if p_page_id is null or p_text is null or char_length(p_text)>500 or p_hearts is null or p_hearts not between 0 and 3
    or p_expected_version is null or p_expected_version<0 or p_mutation_id is null or p_opponent_number is null then raise exception 'Invalid memo'; end if;
  item:=oneul_private.memo_page_for_session(p_session_hash,p_page_id);
  perform 1 from public.oneul_applications where id=item.application_id for share;
  perform 1 from oneul_private.memo_pages where id=item.id for update;
  -- Recheck after waiting for a rotation/cancellation transaction.
  item:=oneul_private.memo_page_for_session(p_session_hash,p_page_id);
  if p_opponent_number not between 1 and item.opponent_count then raise exception 'Invalid opponent number'; end if;
  select * into entry from oneul_private.memo_entries where page_id=item.id and opponent_number=p_opponent_number for update;
  exists_entry:=found;
  if exists_entry and entry.mutation_id=p_mutation_id then
    if entry.body is distinct from p_text or entry.hearts<>p_hearts then raise serialization_failure using message='Memo request changed'; end if;
  else
    if coalesce(entry.version,0)<>p_expected_version then raise serialization_failure using message='Memo changed in another screen'; end if;
    if exists_entry then
      update oneul_private.memo_entries set body=p_text,hearts=p_hearts,version=version+1,mutation_id=p_mutation_id,updated_at=clock_timestamp()
        where page_id=item.id and opponent_number=p_opponent_number returning * into entry;
    else
      insert into oneul_private.memo_entries(page_id,opponent_number,body,hearts,version,mutation_id)
        values(item.id,p_opponent_number,p_text,p_hearts,1,p_mutation_id) returning * into entry;
    end if;
  end if;
  return jsonb_build_object('saved',true,'pageId',entry.page_id,'entry',jsonb_build_object('opponentNumber',entry.opponent_number,
    'text',entry.body,'hearts',entry.hearts,'version',entry.version,'updatedAt',entry.updated_at));
end; $$;

-- Public invoker wrappers are service-only. Browsers never call privileged SQL.
create function public.oneul_memo_admin(p_application_id uuid,p_actor_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select oneul_private.memo_admin(p_application_id,p_actor_id); $$;
create function public.oneul_memo_issue(p_application_id uuid,p_actor_id uuid,p_qr_hash text,p_opponent_count integer,p_participant_number integer,p_expected_updated_at timestamptz,p_replace boolean) returns jsonb language sql security invoker set search_path='' as $$ select oneul_private.memo_issue(p_application_id,p_actor_id,p_qr_hash,p_opponent_count,p_participant_number,p_expected_updated_at,p_replace); $$;
create function public.oneul_memo_exchange(p_qr_hash text,p_session_hash text) returns jsonb language sql security invoker set search_path='' as $$ select oneul_private.memo_exchange(p_qr_hash,p_session_hash); $$;
create function public.oneul_memo_read(p_session_hash text,p_page_id uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select oneul_private.memo_read(p_session_hash,p_page_id); $$;
create function public.oneul_memo_save(p_session_hash text,p_page_id uuid,p_opponent_number integer,p_text text,p_hearts integer,p_expected_version integer,p_mutation_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select oneul_private.memo_save(p_session_hash,p_page_id,p_opponent_number,p_text,p_hearts,p_expected_version,p_mutation_id); $$;
revoke all on function oneul_private.memo_admin(uuid,uuid),oneul_private.memo_issue(uuid,uuid,text,integer,integer,timestamptz,boolean),oneul_private.memo_page_for_session(text,uuid),oneul_private.memo_exchange(text,text),oneul_private.memo_read(text,uuid),oneul_private.memo_save(text,uuid,integer,text,integer,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function oneul_private.memo_admin(uuid,uuid),oneul_private.memo_issue(uuid,uuid,text,integer,integer,timestamptz,boolean),oneul_private.memo_exchange(text,text),oneul_private.memo_read(text,uuid),oneul_private.memo_save(text,uuid,integer,text,integer,integer,uuid) to service_role;
revoke all on function public.oneul_memo_admin(uuid,uuid),public.oneul_memo_issue(uuid,uuid,text,integer,integer,timestamptz,boolean),public.oneul_memo_exchange(text,text),public.oneul_memo_read(text,uuid),public.oneul_memo_save(text,uuid,integer,text,integer,integer,uuid) from public,anon,authenticated;
grant execute on function public.oneul_memo_admin(uuid,uuid),public.oneul_memo_issue(uuid,uuid,text,integer,integer,timestamptz,boolean),public.oneul_memo_exchange(text,text),public.oneul_memo_read(text,uuid),public.oneul_memo_save(text,uuid,integer,text,integer,integer,uuid) to service_role;
-- Memo access ends after seven days; application deletion cascades all memo data.
-- Existing application retention remains unchanged.
notify pgrst,'reload schema';
commit;
