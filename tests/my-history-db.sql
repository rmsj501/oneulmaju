-- Run as project administrator. All simulated orders, reviews and awards roll back.
begin;
do $qa$
declare actor uuid; event_id uuid; item jsonb; dashboard jsonb; award jsonb; total integer; order_id uuid;
begin
  select id into actor from auth.users where email_confirmed_at is not null and deleted_at is null limit 1;
  if actor is null then raise exception 'A confirmed test account is required'; end if;
  insert into public.oneul_events(event_date,start_time,male_price,female_price,status,visible,refund_policy)
    values((now() at time zone 'Asia/Seoul')::date+1,'10:00',31500,24500,'open',true,'QA rollback only') returning id into event_id;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  execute 'set local role authenticated';
  item := public.oneul_create_order(event_id,'여성');
  order_id := (item->>'id')::uuid;
  dashboard := public.oneul_my_dashboard();
  if dashboard->'orders'->0->>'status' <> 'pending' or (dashboard->>'points')::integer <> 0 then raise exception 'Pending order or empty balance mismatch'; end if;
  begin
    perform public.oneul_finalize_payment(order_id,'qa-rollback-'||order_id,24500);
    raise exception using errcode='PZ002',message='A customer could finalize payment';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.oneul_orders set attended_at=now() where id=order_id;
    raise exception using errcode='PZ002',message='A customer could set attendance';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  execute 'set local role service_role';
  -- This isolated DB simulation tests storage only; it does not call a gateway.
  perform public.oneul_begin_payment_confirm(order_id,actor,24500);
  perform public.oneul_finalize_payment(order_id,'qa-rollback-'||order_id,24500);
  perform public.oneul_finalize_payment(order_id,'qa-rollback-'||order_id,24500);
  update public.oneul_orders set attended_at=now()-interval '5 minutes' where id=order_id;
  execute 'reset role';
  execute 'set local role authenticated';
  dashboard := public.oneul_my_dashboard();
  if dashboard->'orders'->0->>'status' <> 'paid' or dashboard->'orders'->0->>'paid_at' is null then raise exception 'Confirmed payment missing from dashboard'; end if;
  if dashboard::text like '%payment_key%' or dashboard::text like '%customer_key%' then raise exception 'Private payment fields exposed'; end if;
  award := public.oneul_submit_review(order_id,5,'검증용 후기입니다. 저장하지 않습니다.');
  if (award->>'points_awarded')::integer <> 1000 then raise exception 'Review award mismatch'; end if;
  begin
    perform public.oneul_submit_review(order_id,5,'중복 검증용 후기입니다. 저장하지 않습니다.');
    raise exception using errcode='PZ002',message='Duplicate review was accepted';
  exception when raise_exception then null;
  end;
  dashboard := public.oneul_my_dashboard();
  if (dashboard->>'points')::integer <> 1000 or jsonb_array_length(dashboard->'ledger') <> 1 or jsonb_array_length(dashboard->'orders') <> 1 then raise exception 'Award duplicated or missing'; end if;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  dashboard := public.oneul_my_dashboard();
  if (dashboard->>'points')::integer <> 0 or dashboard->'orders' <> '[]'::jsonb or dashboard->'ledger' <> '[]'::jsonb then raise exception 'Another account could read history'; end if;
  select count(*) into total from public.oneul_orders where id=order_id;
  if total <> 0 then raise exception 'Order ownership policy failed'; end if;
  execute 'reset role';
  execute 'set local role anon';
  begin
    perform public.oneul_my_dashboard();
    raise exception using errcode='PZ002',message='Anonymous dashboard access accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    select count(*) into total from public.oneul_points_ledger;
    raise exception using errcode='PZ002',message='Anonymous point access accepted';
  exception when insufficient_privilege then null;
  end;
  if jsonb_array_length(public.oneul_public_reviews()) <> 1 then raise exception 'Public review wrapper failed'; end if;
  execute 'reset role';
end
$qa$;
rollback;
select jsonb_build_object(
  'orders',(select count(*) from public.oneul_orders),
  'reviews',(select count(*) from public.oneul_reviews),
  'point_records',(select count(*) from public.oneul_points_ledger),
  'public_wrappers_are_invokers',not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('oneul_create_order','oneul_finalize_payment','oneul_submit_review','oneul_my_dashboard','oneul_public_reviews') and p.prosecdef)
) as rollback_verification;
