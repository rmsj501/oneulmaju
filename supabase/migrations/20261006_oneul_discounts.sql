begin;

-- Apply after the profile and commerce migrations. No coupons or points are seeded.
-- Coupons are issued to a specific account by the operator. 1P = 1 KRW.
create table public.oneul_coupons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  discount_amount integer not null check (discount_amount > 0),
  min_amount integer not null default 0 check (min_amount >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (id,user_id)
);
create index oneul_coupons_user_idx on public.oneul_coupons(user_id,expires_at);
alter table public.oneul_coupons enable row level security;
revoke all on public.oneul_coupons from public,anon,authenticated;
grant all on public.oneul_coupons to service_role;
grant select on public.oneul_coupons to authenticated;
create policy own_coupons on public.oneul_coupons for select to authenticated using ((select auth.uid()) = user_id);

alter table public.oneul_orders add column gross_amount integer;
update public.oneul_orders set gross_amount = amount;
alter table public.oneul_orders alter column gross_amount set not null;
alter table public.oneul_orders add column coupon_id uuid;
alter table public.oneul_orders add column coupon_discount integer not null default 0;
alter table public.oneul_orders add column points_used integer not null default 0;
alter table public.oneul_orders add column payment_kind text not null default 'toss';
alter table public.oneul_orders add constraint oneul_orders_coupon_owner foreign key (coupon_id,user_id) references public.oneul_coupons(id,user_id);
alter table public.oneul_orders drop constraint oneul_orders_amount_check;
alter table public.oneul_orders drop constraint oneul_orders_status_check;
alter table public.oneul_orders drop constraint oneul_orders_check;
alter table public.oneul_orders add constraint oneul_orders_amount_check check (amount >= 0);
alter table public.oneul_orders add constraint oneul_orders_status_check check (status in ('pending','confirming','paid','canceled'));
alter table public.oneul_orders add constraint oneul_orders_discount_check check (
  gross_amount > 0 and coupon_discount >= 0 and points_used >= 0
  and gross_amount::bigint = amount::bigint + coupon_discount::bigint + points_used::bigint
  and (coupon_id is not null or coupon_discount = 0)
);
alter table public.oneul_orders add constraint oneul_orders_paid_check check (
  payment_kind in ('toss','benefits')
  and (payment_kind <> 'benefits' or (amount = 0 and payment_key is null))
  and (status <> 'paid' or (paid_at is not null and ((amount > 0 and payment_kind = 'toss' and payment_key is not null) or (amount = 0 and payment_kind = 'benefits'))))
);
create unique index oneul_coupon_once on public.oneul_orders(coupon_id) where coupon_id is not null and status in ('pending','confirming','paid');
grant select (gross_amount,coupon_discount,points_used,payment_kind) on public.oneul_orders to authenticated;

alter table public.oneul_points_ledger alter column review_id drop not null;
alter table public.oneul_points_ledger drop constraint oneul_points_ledger_order_id_key;
alter table public.oneul_points_ledger drop constraint oneul_points_ledger_amount_check;
alter table public.oneul_points_ledger drop constraint oneul_points_ledger_reason_check;
alter table public.oneul_points_ledger add constraint oneul_ledger_order_reason unique (order_id,reason);
alter table public.oneul_points_ledger add constraint oneul_ledger_entry_check check (
  (reason = 'review' and amount = 1000 and review_id is not null)
  or (reason = 'spend' and amount < 0 and review_id is null)
);

-- Pending and confirming orders reserve points. Reservations never expire silently:
-- only an explicit cancellation of an unconfirmed order releases them.
create function oneul_private.available_points(p_user_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select least(2147483647,greatest(0,
    coalesce((select sum(l.amount) from public.oneul_points_ledger l where l.user_id = p_user_id),0)
    - coalesce((select sum(o.points_used) from public.oneul_orders o where o.user_id = p_user_id and o.status in ('pending','confirming')),0)
  ))::integer;
$$;
revoke all on function oneul_private.available_points(uuid) from public,anon,authenticated;

create function public.oneul_my_benefits() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not oneul_private.verified_user() then raise exception 'Verified account required'; end if;
  return jsonb_build_object('points',oneul_private.available_points(uid),'coupons',coalesce((
    select jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'discount_amount',c.discount_amount,'min_amount',c.min_amount,'expires_at',c.expires_at) order by c.expires_at,c.id)
    from public.oneul_coupons c where c.user_id = uid and c.expires_at > now()
      and not exists(select 1 from public.oneul_orders o where o.coupon_id = c.id and o.status in ('pending','confirming','paid'))
  ),'[]'::jsonb));
end; $$;
revoke all on function public.oneul_my_benefits() from public,anon;
grant execute on function public.oneul_my_benefits() to authenticated;

-- All wallet writes lock the same customer row before the order row. This serializes
-- reservations, cancellation and settlement for an account without trusting a balance
-- or discount amount supplied by the browser.
drop function public.oneul_create_order(uuid,text);
create function public.oneul_create_order(p_event_id uuid,p_gender text,p_request_id uuid,p_coupon_id uuid default null,p_points_used integer default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); event public.oneul_events%rowtype; item public.oneul_orders%rowtype;
  coupon public.oneul_coupons%rowtype; customer uuid; price integer; discount integer := 0;
begin
  if uid is null or not oneul_private.verified_user() then raise exception 'Verified account required'; end if;
  if p_request_id is null or p_gender is null or p_gender not in ('남성','여성') or p_points_used is null or p_points_used < 0 then raise exception 'Invalid selection'; end if;
  insert into public.oneul_payment_customers(user_id) values(uid) on conflict (user_id) do nothing;
  select customer_key into customer from public.oneul_payment_customers where user_id = uid for update;
  select * into item from public.oneul_orders where id = p_request_id and user_id = uid for update;
  if found then
    if item.user_id <> uid or item.event_id is distinct from p_event_id or item.gender <> p_gender or item.coupon_id is distinct from p_coupon_id or item.points_used <> p_points_used or item.status not in ('pending','paid') then raise exception 'Request does not match'; end if;
    select * into event from public.oneul_events where id = item.event_id;
  else
    select * into event from public.oneul_events where id = p_event_id and visible and status = 'open' for share;
    if not found or event.event_date < (now() at time zone 'Asia/Seoul')::date then raise exception 'Event is not available'; end if;
    price := case when p_gender = '남성' then event.male_price else event.female_price end;
    if p_coupon_id is not null then
      select * into coupon from public.oneul_coupons where id = p_coupon_id and user_id = uid for update;
      if not found or coupon.expires_at <= now() or price < coupon.min_amount or exists(select 1 from public.oneul_orders o where o.coupon_id = coupon.id and o.status in ('pending','confirming','paid')) then raise exception 'Coupon is unavailable'; end if;
      discount := least(price,coupon.discount_amount);
    end if;
    if p_points_used > price - discount or p_points_used > oneul_private.available_points(uid) then raise exception 'Insufficient points'; end if;
    insert into public.oneul_orders(id,user_id,event_id,gender,gross_amount,coupon_id,coupon_discount,points_used,amount,payment_kind,status,paid_at)
      values(p_request_id,uid,event.id,p_gender,price,p_coupon_id,discount,p_points_used,price-discount-p_points_used,
        case when price-discount-p_points_used = 0 then 'benefits' else 'toss' end,
        case when price-discount-p_points_used = 0 then 'paid' else 'pending' end,
        case when price-discount-p_points_used = 0 then now() else null end) returning * into item;
    if item.status = 'paid' and item.points_used > 0 then
      insert into public.oneul_points_ledger(user_id,order_id,amount,reason) values(uid,item.id,-item.points_used,'spend');
    end if;
  end if;
  return jsonb_build_object('id',item.id,'event_id',event.id,'event_date',event.event_date,'gender',item.gender,
    'amount',item.amount,'gross_amount',item.gross_amount,'coupon_id',item.coupon_id,'coupon_discount',item.coupon_discount,
    'points_used',item.points_used,'status',item.status,'payment_kind',item.payment_kind,'customer_key',customer);
end; $$;
revoke all on function public.oneul_create_order(uuid,text,uuid,uuid,integer) from public,anon;
grant execute on function public.oneul_create_order(uuid,text,uuid,uuid,integer) to authenticated;

create function public.oneul_cancel_pending_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); item public.oneul_orders%rowtype;
begin
  if uid is null or not oneul_private.verified_user() then raise exception 'Verified account required'; end if;
  perform 1 from public.oneul_payment_customers where user_id = uid for update;
  select * into item from public.oneul_orders where id = p_order_id and user_id = uid for update;
  if not found or item.status not in ('pending','canceled') then raise exception 'Only an unconfirmed order can be canceled'; end if;
  if item.status = 'pending' then update public.oneul_orders set status = 'canceled' where id = item.id; end if;
  return jsonb_build_object('id',item.id,'status','canceled');
end; $$;
revoke all on function public.oneul_cancel_pending_order(uuid) from public,anon;
grant execute on function public.oneul_cancel_pending_order(uuid) to authenticated;

-- Only the Worker may enter confirming or finalize. A provider timeout holds the
-- reservation until same-order recovery; cancellation cannot race gateway approval.
create function public.oneul_begin_payment_confirm(p_order_id uuid,p_user_id uuid,p_amount integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare owner uuid; item public.oneul_orders%rowtype;
begin
  select user_id into owner from public.oneul_orders where id = p_order_id;
  if owner is distinct from p_user_id then raise exception 'Order mismatch'; end if;
  perform 1 from public.oneul_payment_customers where user_id = owner for update;
  select * into item from public.oneul_orders where id = p_order_id for update;
  if not found or item.amount is distinct from p_amount or item.amount <= 0 or item.status not in ('pending','confirming','paid') then raise exception 'Order cannot be confirmed'; end if;
  if item.status = 'pending' then update public.oneul_orders set status = 'confirming' where id = item.id returning * into item; end if;
  return jsonb_build_object('id',item.id,'status',item.status);
end; $$;
revoke all on function public.oneul_begin_payment_confirm(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.oneul_begin_payment_confirm(uuid,uuid,integer) to service_role;

create or replace function public.oneul_finalize_payment(p_order_id uuid,p_payment_key text,p_amount integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare owner uuid; item public.oneul_orders%rowtype;
begin
  select user_id into owner from public.oneul_orders where id = p_order_id;
  perform 1 from public.oneul_payment_customers where user_id = owner for update;
  select * into item from public.oneul_orders where id = p_order_id for update;
  if not found or p_amount is distinct from item.amount or item.amount <= 0 or coalesce(p_payment_key,'') = '' then raise exception 'Payment mismatch'; end if;
  if item.status = 'paid' and item.payment_key = p_payment_key then return jsonb_build_object('id',item.id,'status','paid'); end if;
  if item.status <> 'confirming' then raise exception 'Order is not confirming'; end if;
  -- The debit and receipt are committed together. A retry cannot create another debit.
  if item.points_used > 0 then
    insert into public.oneul_points_ledger(user_id,order_id,amount,reason) values(item.user_id,item.id,-item.points_used,'spend');
  end if;
  update public.oneul_orders set status = 'paid',payment_key = p_payment_key,paid_at = now() where id = item.id;
  return jsonb_build_object('id',item.id,'status','paid');
end; $$;
revoke all on function public.oneul_finalize_payment(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.oneul_finalize_payment(uuid,text,integer) to service_role;

create or replace function public.oneul_my_dashboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Account required'; end if;
  return jsonb_build_object(
    'points',oneul_private.available_points(uid),
    'reservedPoints',coalesce((select sum(o.points_used) from public.oneul_orders o where o.user_id = uid and o.status in ('pending','confirming')),0),
    'orders',coalesce((select jsonb_agg(x.payload order by x.created_at desc) from (
      select o.created_at,jsonb_build_object('id',o.id,'event_date',e.event_date,'gender',o.gender,'amount',o.amount,'gross_amount',o.gross_amount,
        'coupon_discount',o.coupon_discount,'points_used',o.points_used,'payment_kind',o.payment_kind,'status',o.status,'attended_at',o.attended_at,
        'review_written',exists(select 1 from public.oneul_reviews r where r.order_id = o.id)) payload
      from public.oneul_orders o join public.oneul_events e on e.id = o.event_id where o.user_id = uid
    ) x),'[]'::jsonb),
    'ledger',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'amount',l.amount,'reason',l.reason,'created_at',l.created_at) order by l.created_at desc)
      from public.oneul_points_ledger l where l.user_id = uid),'[]'::jsonb)
  );
end; $$;
revoke all on function public.oneul_my_dashboard() from public,anon;
grant execute on function public.oneul_my_dashboard() to authenticated;
commit;
