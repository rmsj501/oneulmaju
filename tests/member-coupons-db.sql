-- Actual Postgres/RLS/trigger QA. All artificial accounts, orders and points roll back.
begin;
do $qa$
declare actor uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid(); guest_user uuid:=gen_random_uuid();
  event_id uuid; coupon_id uuid; other_coupon uuid; expired_coupon uuid; order_id uuid:=gen_random_uuid(); second_id uuid:=gen_random_uuid(); points_order uuid:=gen_random_uuid(); spent_order uuid:=gen_random_uuid();
  item jsonb; wallet jsonb; dashboard jsonb; history jsonb; start_at timestamptz:='2026-10-24 00:00:00+09'; end_at timestamptz:='2026-11-25 00:00:00+09'; total integer;
begin
  if oneul_private.coupon_valid_at(start_at,end_at,start_at-interval '1 microsecond')
    or not oneul_private.coupon_valid_at(start_at,end_at,start_at)
    or not oneul_private.coupon_valid_at(start_at,end_at,end_at-interval '1 microsecond')
    or oneul_private.coupon_valid_at(start_at,end_at,end_at) then raise exception 'Korea inclusive campaign boundary mismatch'; end if;
  insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values(actor,'authenticated','authenticated','coupon-qa-'||actor||'@example.test',now(),false,'{}','{}',now(),now()),
    (other_user,'authenticated','authenticated','coupon-qa-'||other_user||'@example.test',now(),false,'{}','{}',now(),now()),
    (guest_user,'authenticated','authenticated',null,null,true,'{}','{}',now(),now());
  update auth.users set email=email where id=actor;
  execute 'reset role';
  select id into coupon_id from public.oneul_coupons where user_id=actor and campaign_key='opening_2026';
  select id into other_coupon from public.oneul_coupons where user_id=other_user and campaign_key='opening_2026';
  if coupon_id is null or other_coupon is null then raise exception 'Auth signup failed to issue coupon'; end if;
  select count(*) into total from public.oneul_coupons where user_id=actor;
  if total<>1 then raise exception 'Signup/update issued duplicate coupons'; end if;
  if exists(select 1 from public.oneul_coupons where user_id=guest_user) then raise exception 'Anonymous guest received member coupon'; end if;
  update auth.users set is_anonymous=false,email='converted-'||guest_user||'@example.test',email_confirmed_at=now() where id=guest_user;
  if (select count(*) from public.oneul_coupons where user_id=guest_user)<>1 then raise exception 'Guest-to-member coupon missing'; end if;
  if not exists(select 1 from public.oneul_coupons where id=coupon_id and discount_type='percent' and discount_percent=30 and starts_at=start_at and expires_at=end_at) then raise exception 'Issued campaign data mismatch'; end if;
  insert into public.oneul_events(event_date,start_time,male_price,female_price,status,visible,refund_policy)
    values('2026-10-24','13:00',45000,35000,'open',true,'QA rollback only') returning id into event_id;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  execute 'set local role authenticated';
  wallet:=public.oneul_my_benefits();
  if jsonb_array_length(wallet->'coupons')<>1 or (wallet->'coupons'->0->>'valid_now')::boolean or wallet->>'server_time' is null then raise exception 'Future coupon should be visible but unavailable'; end if;
  select count(*) into total from public.oneul_coupons where user_id=other_user;
  if total<>0 then raise exception 'Another account coupon leaked through RLS'; end if;
  begin
    insert into public.oneul_coupons(user_id,title,discount_type,discount_percent,starts_at,expires_at) values(actor,'forged','percent',100,now(),now()+interval '1 day');
    raise exception using errcode='PZ002',message='Member could issue own coupon';
  exception when insufficient_privilege then null; end;
  begin
    perform public.oneul_create_order(event_id,'여성',order_id,coupon_id,0);
    raise exception using errcode='PZ002',message='Coupon used before campaign start';
  exception when raise_exception then null; end;
  begin
    perform public.oneul_create_order(event_id,'여성',order_id,other_coupon,0);
    raise exception using errcode='PZ002',message='Foreign coupon accepted';
  exception when raise_exception then null; end;
  begin
    perform oneul_private.coupon_wallet(other_user);
    raise exception using errcode='PZ002',message='Private wallet helper exposed';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  -- Simulate the open window only inside this rollback transaction.
  update public.oneul_coupons set starts_at=now()-interval '1 hour' where id=coupon_id;
  insert into public.oneul_coupons(user_id,title,discount_type,discount_percent,starts_at,expires_at)
    values(actor,'expired QA','percent',30,now()-interval '2 days',now()-interval '1 day') returning id into expired_coupon;
  execute 'set local role authenticated';
  begin
    perform public.oneul_create_order(event_id,'여성',order_id,expired_coupon,0);
    raise exception using errcode='PZ002',message='Expired coupon accepted';
  exception when raise_exception then null; end;
  item:=public.oneul_create_order(event_id,'남성',order_id,coupon_id,0);
  if (item->>'gross_amount')::integer<>45000 or (item->>'coupon_discount')::integer<>13500 or (item->>'amount')::integer<>31500 then raise exception 'Male regular/30 percent net mismatch'; end if;
  if public.oneul_create_order(event_id,'남성',order_id,coupon_id,0)<>item then raise exception 'Same order retry changed receipt'; end if;
  begin
    perform public.oneul_create_order(event_id,'여성',second_id,coupon_id,0);
    raise exception using errcode='PZ002',message='Coupon reserved twice';
  exception when raise_exception then null; end;
  begin
    perform public.oneul_create_order(event_id,'여성',order_id,coupon_id,0);
    raise exception using errcode='PZ002',message='Same request changed selection';
  exception when raise_exception then null; end;
  perform public.oneul_cancel_pending_order(order_id);
  item:=public.oneul_create_order(event_id,'여성',second_id,coupon_id,0);
  if (item->>'gross_amount')::integer<>35000 or (item->>'coupon_discount')::integer<>10500 or (item->>'amount')::integer<>24500 then raise exception 'Female regular/30 percent net mismatch'; end if;
  begin
    perform public.oneul_begin_payment_confirm(second_id,actor,24500);
    raise exception using errcode='PZ002',message='Customer could approve payment';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  update public.oneul_coupons set expires_at=now()-interval '1 second',starts_at=now()-interval '1 day' where id=coupon_id;
  execute 'set local role service_role';
  begin
    perform public.oneul_begin_payment_confirm(second_id,actor,24500);
    raise exception using errcode='PZ002',message='Expired pending coupon reached approval';
  exception when raise_exception then null; end;
  execute 'reset role';
  update public.oneul_coupons set expires_at=end_at where id=coupon_id;
  execute 'set local role service_role';
  perform public.oneul_begin_payment_confirm(second_id,actor,24500);
  execute 'reset role';
  execute 'set local role authenticated';
  begin
    perform public.oneul_cancel_pending_order(second_id);
    raise exception using errcode='PZ002',message='Confirming order released coupon';
  exception when raise_exception then null; end;
  execute 'reset role';
  execute 'set local role service_role';
  -- Simulated verified gateway receipt; this test never calls a payment provider.
  perform public.oneul_finalize_payment(second_id,'qa-coupon-'||second_id,24500);
  perform public.oneul_finalize_payment(second_id,'qa-coupon-'||second_id,24500);
  execute 'reset role';
  execute 'set local role authenticated';
  dashboard:=public.oneul_my_dashboard();
  select value into history from jsonb_array_elements(dashboard->'orders') where value->>'id'=second_id::text;
  if dashboard->'coupons'<>'[]'::jsonb or (history->>'coupon_discount')::integer<>10500 or history->>'paid_at' is null then raise exception 'Used coupon or discounted order history mismatch'; end if;
  begin
    perform public.oneul_create_order(event_id,'여성',gen_random_uuid(),coupon_id,0);
    raise exception using errcode='PZ002',message='Paid coupon used twice';
  exception when raise_exception then null; end;
  execute 'reset role';
  execute 'set local role service_role';
  update public.oneul_orders set attended_at=now()-interval '1 minute' where id=second_id;
  execute 'reset role';
  execute 'set local role authenticated';
  perform public.oneul_submit_review(second_id,5,'할인 주문의 포인트 사용 검증용 후기입니다.');
  item:=public.oneul_create_order(event_id,'남성',points_order,null,1000);
  if (item->>'amount')::integer<>44000 or (public.oneul_my_benefits()->>'points')::integer<>0 then raise exception 'Point reservation mismatch'; end if;
  begin
    perform public.oneul_create_order(event_id,'남성',gen_random_uuid(),null,1);
    raise exception using errcode='PZ002',message='Reserved points spent twice';
  exception when raise_exception then null; end;
  perform public.oneul_cancel_pending_order(points_order);
  if (public.oneul_my_benefits()->>'points')::integer<>1000 then raise exception 'Canceled reservation failed to return points'; end if;
  item:=public.oneul_create_order(event_id,'남성',spent_order,null,1000);
  execute 'reset role';
  execute 'set local role service_role';
  perform public.oneul_begin_payment_confirm(spent_order,actor,44000);
  perform public.oneul_finalize_payment(spent_order,'qa-points-'||spent_order,44000);
  perform public.oneul_finalize_payment(spent_order,'qa-points-'||spent_order,44000);
  execute 'reset role';
  execute 'set local role authenticated';
  dashboard:=public.oneul_my_dashboard();
  if (dashboard->>'points')::integer<>0 or jsonb_array_length(dashboard->'ledger')<>2 then raise exception 'Points debit missing or duplicated'; end if;
  select count(*) into total from public.oneul_points_ledger l where l.order_id=spent_order and l.reason='spend' and l.amount=-1000;
  if total<>1 then raise exception 'Payment retry duplicated point debit'; end if;
  perform set_config('request.jwt.claim.sub',other_user::text,true);
  if jsonb_array_length(public.oneul_my_dashboard()->'orders')<>0 then raise exception 'Another account read discounted order'; end if;
  execute 'reset role';
  execute 'set local role anon';
  begin
    perform public.oneul_my_benefits();
    raise exception using errcode='PZ002',message='Anonymous wallet read permitted';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
end
$qa$;
rollback;
select jsonb_build_object('campaign_coupons',(select count(*) from public.oneul_coupons),
  'orders',(select count(*) from public.oneul_orders),'point_records',(select count(*) from public.oneul_points_ledger),
  'qa_accounts',(select count(*) from auth.users where email like 'coupon-qa-%' or email like 'converted-%'),
  'public_wrappers_are_invokers',not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('oneul_my_benefits','oneul_create_order','oneul_my_dashboard','oneul_begin_payment_confirm','oneul_finalize_payment','oneul_cancel_pending_order') and p.prosecdef)) as rollback_verification;
