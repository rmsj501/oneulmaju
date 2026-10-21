begin;

-- Real events are added by the operator after prices, time and refund terms are set.
create table public.oneul_events (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  start_time text,
  age_label text,
  male_price integer not null check (male_price > 0),
  female_price integer not null check (female_price > 0),
  status text not null default 'preparing' check (status in ('preparing','open','closed')),
  visible boolean not null default false,
  refund_policy text,
  created_at timestamptz not null default now(),
  check (status <> 'open' or (coalesce(btrim(start_time),'') <> '' and coalesce(btrim(refund_policy),'') <> ''))
);
create table public.oneul_payment_customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  customer_key uuid not null unique default gen_random_uuid()
);
create table public.oneul_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.oneul_events(id),
  gender text not null check (gender in ('남성','여성')),
  amount integer not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending','paid','canceled')),
  payment_key text unique,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  attended_at timestamptz,
  check (status <> 'paid' or (payment_key is not null and paid_at is not null))
);
create table public.oneul_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.oneul_orders(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  content text not null check (char_length(btrim(content)) between 10 and 1000),
  author_label text not null,
  created_at timestamptz not null default now()
);
create table public.oneul_points_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  review_id uuid not null unique references public.oneul_reviews(id),
  order_id uuid not null unique references public.oneul_orders(id),
  amount integer not null check (amount = 1000),
  reason text not null default 'review' check (reason = 'review'),
  created_at timestamptz not null default now()
);
create index oneul_orders_user_idx on public.oneul_orders(user_id,created_at desc);
create index oneul_orders_event_idx on public.oneul_orders(event_id);
create index oneul_reviews_user_idx on public.oneul_reviews(user_id);
create index oneul_ledger_user_idx on public.oneul_points_ledger(user_id,created_at desc);
alter table public.oneul_events enable row level security;
alter table public.oneul_payment_customers enable row level security;
alter table public.oneul_orders enable row level security;
alter table public.oneul_reviews enable row level security;
alter table public.oneul_points_ledger enable row level security;
revoke all on public.oneul_events, public.oneul_payment_customers, public.oneul_orders, public.oneul_reviews, public.oneul_points_ledger from public,anon,authenticated;
grant all on public.oneul_events, public.oneul_payment_customers, public.oneul_orders, public.oneul_reviews, public.oneul_points_ledger to service_role;
grant select on public.oneul_events to anon,authenticated;
grant select (id,user_id,event_id,gender,amount,status,created_at,paid_at,attended_at) on public.oneul_orders to authenticated;
grant select on public.oneul_reviews,public.oneul_points_ledger to authenticated;
create policy visible_events on public.oneul_events for select to anon,authenticated using (visible);
create policy own_orders on public.oneul_orders for select to authenticated using ((select auth.uid()) = user_id);
create policy own_reviews on public.oneul_reviews for select to authenticated using ((select auth.uid()) = user_id);
create policy own_points on public.oneul_points_ledger for select to authenticated using ((select auth.uid()) = user_id);

create function oneul_private.oneul_create_order(p_event_id uuid,p_gender text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); event public.oneul_events%rowtype; new_order public.oneul_orders%rowtype; customer uuid; price integer;
begin
  if uid is null or not oneul_private.verified_user() then raise exception 'Verified account required'; end if;
  if p_gender is null or p_gender not in ('남성','여성') then raise exception 'Gender required'; end if;
  select * into event from public.oneul_events where id = p_event_id and visible and status = 'open' for share;
  if not found or event.event_date < (now() at time zone 'Asia/Seoul')::date then raise exception 'Event is not available'; end if;
  price := case when p_gender = '남성' then event.male_price else event.female_price end;
  insert into public.oneul_payment_customers(user_id) values(uid) on conflict (user_id) do nothing;
  select customer_key into customer from public.oneul_payment_customers where user_id = uid;
  insert into public.oneul_orders(user_id,event_id,gender,amount) values(uid,event.id,p_gender,price) returning * into new_order;
  return jsonb_build_object('id',new_order.id,'event_id',event.id,'event_date',event.event_date,'gender',new_order.gender,'amount',new_order.amount,'customer_key',customer);
end; $$;
revoke all on function oneul_private.oneul_create_order(uuid,text) from public,anon,authenticated,service_role;
grant execute on function oneul_private.oneul_create_order(uuid,text) to authenticated;

-- Only the Worker may invoke this after independently checking the gateway receipt.
create function oneul_private.oneul_finalize_payment(p_order_id uuid,p_payment_key text,p_amount integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare item public.oneul_orders%rowtype;
begin
  select * into item from public.oneul_orders where id = p_order_id for update;
  if not found or p_amount is distinct from item.amount or coalesce(p_payment_key,'') = '' then raise exception 'Payment mismatch'; end if;
  if item.status = 'paid' and item.payment_key = p_payment_key then return jsonb_build_object('id',item.id,'status','paid'); end if;
  if item.status <> 'pending' then raise exception 'Order is not pending'; end if;
  update public.oneul_orders set status = 'paid', payment_key = p_payment_key, paid_at = now() where id = item.id;
  return jsonb_build_object('id',item.id,'status','paid');
end; $$;
revoke all on function oneul_private.oneul_finalize_payment(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function oneul_private.oneul_finalize_payment(uuid,text,integer) to service_role;

-- Attendance is recorded by the operator. One order creates one review and one award.
create function oneul_private.oneul_submit_review(p_order_id uuid,p_rating integer,p_content text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); item public.oneul_orders%rowtype; review uuid; author text;
begin
  if uid is null or not oneul_private.verified_user() then raise exception 'Verified account required'; end if;
  if p_rating is null or p_rating not between 1 and 5 or p_content is null or char_length(btrim(p_content)) not between 10 and 1000 then raise exception 'Review is invalid'; end if;
  select * into item from public.oneul_orders where id = p_order_id and user_id = uid for update;
  if not found or item.status <> 'paid' or item.attended_at is null or item.attended_at > now() then raise exception 'Completed attendance required'; end if;
  if exists(select 1 from public.oneul_reviews where order_id = item.id) then raise exception 'Review already submitted'; end if;
  select coalesce(nullif(btrim(u.raw_user_meta_data->>'name'),''),'마주') into author from auth.users u where u.id = uid;
  insert into public.oneul_reviews(order_id,user_id,rating,content,author_label)
    values(item.id,uid,p_rating,btrim(p_content),left(author,1)||'**') returning id into review;
  insert into public.oneul_points_ledger(user_id,review_id,order_id,amount) values(uid,review,item.id,1000);
  return jsonb_build_object('review_id',review,'points_awarded',1000);
end; $$;
revoke all on function oneul_private.oneul_submit_review(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function oneul_private.oneul_submit_review(uuid,integer,text) to authenticated;

create function oneul_private.oneul_my_dashboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); result jsonb;
begin
  if uid is null then raise exception 'Account required'; end if;
  select jsonb_build_object(
    'points',coalesce((select sum(l.amount) from public.oneul_points_ledger l where l.user_id = uid),0),
    'orders',coalesce((select jsonb_agg(x.payload order by x.created_at desc) from (
      select o.created_at,jsonb_build_object('id',o.id,'event_date',e.event_date,'gender',o.gender,'amount',o.amount,'status',o.status,'attended_at',o.attended_at,'review_written',exists(select 1 from public.oneul_reviews r where r.order_id = o.id)) payload
      from public.oneul_orders o join public.oneul_events e on e.id = o.event_id where o.user_id = uid
    ) x),'[]'::jsonb),
    'ledger',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'amount',l.amount,'reason',l.reason,'created_at',l.created_at) order by l.created_at desc) from public.oneul_points_ledger l where l.user_id = uid),'[]'::jsonb)
  ) into result;
  return result;
end; $$;
revoke all on function oneul_private.oneul_my_dashboard() from public,anon,authenticated,service_role;
grant execute on function oneul_private.oneul_my_dashboard() to authenticated;

create function oneul_private.oneul_public_reviews() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.payload order by x.created_at desc),'[]'::jsonb) from (
    select r.created_at,jsonb_build_object('id',r.id,'author_label',r.author_label,'rating',r.rating,'content',r.content,'event_date',e.event_date,'created_at',r.created_at) payload
    from public.oneul_reviews r join public.oneul_orders o on o.id = r.order_id join public.oneul_events e on e.id = o.event_id order by r.created_at desc limit 100
  ) x;
$$;
revoke all on function oneul_private.oneul_public_reviews() from public,anon,authenticated,service_role;
grant execute on function oneul_private.oneul_public_reviews() to anon,authenticated;
-- Only narrowly granted invoker wrappers are exposed through the Data API.
-- Schema usage does not grant access to private tables or other functions.
grant usage on schema oneul_private to anon,authenticated,service_role;
create function public.oneul_create_order(p_event_id uuid,p_gender text) returns jsonb
language sql security invoker set search_path = '' as $$
  select oneul_private.oneul_create_order(p_event_id,p_gender);
$$;
revoke all on function public.oneul_create_order(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.oneul_create_order(uuid,text) to authenticated;

create function public.oneul_finalize_payment(p_order_id uuid,p_payment_key text,p_amount integer) returns jsonb
language sql security invoker set search_path = '' as $$
  select oneul_private.oneul_finalize_payment(p_order_id,p_payment_key,p_amount);
$$;
revoke all on function public.oneul_finalize_payment(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.oneul_finalize_payment(uuid,text,integer) to service_role;

create function public.oneul_submit_review(p_order_id uuid,p_rating integer,p_content text) returns jsonb
language sql security invoker set search_path = '' as $$
  select oneul_private.oneul_submit_review(p_order_id,p_rating,p_content);
$$;
revoke all on function public.oneul_submit_review(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.oneul_submit_review(uuid,integer,text) to authenticated;

create function public.oneul_my_dashboard() returns jsonb
language sql security invoker set search_path = '' as $$
  select oneul_private.oneul_my_dashboard();
$$;
revoke all on function public.oneul_my_dashboard() from public,anon,authenticated,service_role;
grant execute on function public.oneul_my_dashboard() to authenticated;

create function public.oneul_public_reviews() returns jsonb
language sql security invoker set search_path = '' as $$
  select oneul_private.oneul_public_reviews();
$$;
revoke all on function public.oneul_public_reviews() from public,anon,authenticated,service_role;
grant execute on function public.oneul_public_reviews() to anon,authenticated;
commit;
