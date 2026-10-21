begin;
create table public.oneul_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.oneul_applications (
  id uuid primary key default gen_random_uuid(),
  source text not null check(source in ('frip','munto','website')),
  external_order_no text not null check(char_length(external_order_no) between 1 and 100),
  order_id uuid unique references public.oneul_orders(id),
  member_user_id uuid references auth.users(id) on delete set null,
  name text not null check(char_length(name) between 1 and 30),
  phone text not null check(phone ~ '^\+821[016789][0-9]{7,8}$' or (source='website' and phone='')),
  gender text not null check(gender in ('남성','여성')),
  event_date date not null,
  start_time text not null check(char_length(btrim(start_time)) between 1 and 50),
  amount integer not null check(amount >= 0),
  payment_status text not null default 'paid' check(payment_status in ('paid','canceled')),
  status text not null default 'draft' check(status in ('draft','submitted','changes_requested','confirmed','canceled')),
  venue text not null default '' check(char_length(venue)<=300),
  instructions text not null default '' check(char_length(instructions)<=2000),
  review_note text not null default '' check(char_length(review_note)<=1000),
  profile jsonb,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id),
  invitation_hash text unique,
  invitation_expires_at timestamptz,
  invitation_used_at timestamptz,
  notice_sent_at timestamptz,
  notice_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique(source,external_order_no),
  check(status<>'confirmed' or (profile is not null and payment_status='paid' and char_length(btrim(venue))>0 and confirmed_at is not null))
);
create index oneul_applications_member_idx on public.oneul_applications(member_user_id,created_at desc) where member_user_id is not null;
create index oneul_applications_event_idx on public.oneul_applications(event_date,status);
create index oneul_applications_expiry_idx on public.oneul_applications(expires_at);
create table public.oneul_application_sessions (
  token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
  application_id uuid not null references public.oneul_applications(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index oneul_application_sessions_application_idx on public.oneul_application_sessions(application_id);
create table public.oneul_application_audit (
  id bigint generated always as identity primary key,
  application_id uuid not null references public.oneul_applications(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  created_at timestamptz not null default now()
);
create index oneul_application_audit_application_idx on public.oneul_application_audit(application_id,created_at desc);
alter table public.oneul_staff enable row level security;
alter table public.oneul_applications enable row level security;
alter table public.oneul_application_sessions enable row level security;
alter table public.oneul_application_audit enable row level security;
revoke all on public.oneul_staff,public.oneul_applications,public.oneul_application_sessions,public.oneul_application_audit from public,anon,authenticated;
grant select,insert,update,delete on public.oneul_staff,public.oneul_applications,public.oneul_application_sessions,public.oneul_application_audit to service_role;
grant usage,select on sequence public.oneul_application_audit_id_seq to service_role;
-- The owner's previously verified Site test account is the initial operator.
-- Initial staff assignment is intentionally omitted from the public source. Configure an authorized user separately.

create function public.oneul_exchange_application_invite(invite_hash text,session_hash text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare item public.oneul_applications;
begin
  if session_hash !~ '^[a-f0-9]{64}$' or invite_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid invitation'; end if;
  update public.oneul_applications a set invitation_used_at=now(),updated_at=now()
    where a.invitation_hash=invite_hash and a.invitation_used_at is null and a.invitation_expires_at>now()
      and a.expires_at>now() and a.payment_status='paid' and a.status<>'canceled'
    returning a.* into item;
  if not found then raise exception 'Invitation unavailable'; end if;
  insert into public.oneul_application_sessions(token_hash,application_id,expires_at)
    values(session_hash,item.id,least(now()+interval '3 days',item.expires_at));
  return item.id;
end; $$;
create function public.oneul_submit_application(application_id uuid,actor_id uuid,submission jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare item public.oneul_applications; p text; slot text;
begin
  select a.* into item from public.oneul_applications a where a.id=application_id for update;
  if not found or item.expires_at<=now() or item.payment_status<>'paid' or item.status not in ('draft','submitted','changes_requested') or item.member_user_id is distinct from actor_id then raise exception 'Application unavailable'; end if;
  foreach slot in array array['face','fullbody','employment'] loop
    p:=submission->>(slot||'_path');
    if p is null or split_part(p,'/',1)<>item.id::text or split_part(p,'/',2)<>slot or
      not exists(select 1 from storage.objects o where o.bucket_id='oneul-verification' and o.name=p) then raise exception 'Required owned attachment missing'; end if;
  end loop;
  update public.oneul_applications set profile=submission,status='submitted',submitted_at=now(),review_note='',confirmed_at=null,confirmed_by=null,notice_sent_at=null,updated_at=now() where id=item.id;
  insert into public.oneul_application_audit(application_id,actor_id,action) values(item.id,actor_id,'submitted');
end; $$;
create function public.oneul_review_application(application_id uuid,actor_id uuid,decision text,note text,place text,preparation text) returns void
language plpgsql security invoker set search_path='' as $$
declare item public.oneul_applications;
begin
  if not exists(select 1 from public.oneul_staff s where s.user_id=actor_id) then raise exception 'Operator required'; end if;
  select a.* into item from public.oneul_applications a where a.id=application_id for update;
  if not found or item.expires_at<=now() or decision not in ('changes_requested','confirmed','canceled') then raise exception 'Invalid decision'; end if;
  if decision='confirmed' and (item.payment_status<>'paid' or item.profile is null or item.status not in ('submitted','confirmed') or char_length(btrim(place))=0) then raise exception 'Submitted paid profile and venue required'; end if;
  if decision='changes_requested' and (item.status not in ('submitted','confirmed','changes_requested') or char_length(btrim(note))=0) then raise exception 'Revision note required'; end if;
  update public.oneul_applications set status=decision,review_note=note,venue=place,instructions=preparation,
    payment_status=case when decision='canceled' then 'canceled' else payment_status end,
    confirmed_at=case when decision='confirmed' then now() else null end,
    confirmed_by=case when decision='confirmed' then actor_id else null end,
    notice_sent_at=null,updated_at=now() where id=item.id;
  insert into public.oneul_application_audit(application_id,actor_id,action) values(item.id,actor_id,decision);
end; $$;
revoke all on function public.oneul_exchange_application_invite(text,text),public.oneul_submit_application(uuid,uuid,jsonb),public.oneul_review_application(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.oneul_exchange_application_invite(text,text),public.oneul_submit_application(uuid,uuid,jsonb),public.oneul_review_application(uuid,uuid,text,text,text,text) to service_role;

create function oneul_private.queue_application_files() returns trigger
language plpgsql security definer set search_path='' as $$
declare slot text; p text;
begin
  foreach slot in array array['face','fullbody','employment'] loop
    p:=old.profile->>(slot||'_path');
    if p is not null and (tg_op='DELETE' or p is distinct from new.profile->>(slot||'_path')) then
      insert into public.oneul_file_cleanup(path) values(p) on conflict do nothing;
    end if;
  end loop;
  return null;
end; $$;
revoke all on function oneul_private.queue_application_files() from public,anon,authenticated;
create trigger oneul_application_file_cleanup after update or delete on public.oneul_applications for each row execute function oneul_private.queue_application_files();

create function oneul_private.paid_order_application() returns trigger
language plpgsql security definer set search_path='' as $$
declare event public.oneul_events; account auth.users;
begin
  if new.status='paid' and (tg_op='INSERT' or old.status is distinct from 'paid') then
    select * into event from public.oneul_events where id=new.event_id;
    select * into account from auth.users where id=new.user_id;
    insert into public.oneul_applications(source,external_order_no,order_id,member_user_id,name,phone,gender,event_date,start_time,amount,expires_at)
    values('website',new.id::text,new.id,new.user_id,coalesce(nullif(account.raw_user_meta_data->>'name',''),'참가자'),case when coalesce(account.phone,'')='' then '' else '+'||ltrim(account.phone,'+') end,new.gender,event.event_date,event.start_time,new.amount,(event.event_date+interval '30 days')::timestamptz)
    on conflict(order_id) do nothing;
  elsif new.status='canceled' then
    update public.oneul_applications set status='canceled',payment_status='canceled',confirmed_at=null,confirmed_by=null,updated_at=now() where order_id=new.id;
  end if;
  return null;
end; $$;
revoke all on function oneul_private.paid_order_application() from public,anon,authenticated;
create trigger oneul_paid_order_application after insert or update of status on public.oneul_orders for each row execute function oneul_private.paid_order_application();
commit;
