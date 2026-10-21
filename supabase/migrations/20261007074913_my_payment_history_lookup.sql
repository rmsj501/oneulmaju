begin;
-- Include receipt timestamps so MY distinguishes completed payments from pending applications.
create or replace function oneul_private.oneul_my_dashboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); result jsonb;
begin
  if uid is null then raise exception 'Account required'; end if;
  select jsonb_build_object(
    'points',coalesce((select sum(l.amount) from public.oneul_points_ledger l where l.user_id = uid),0),
    'orders',coalesce((select jsonb_agg(x.payload order by x.created_at desc) from (
      select o.created_at,jsonb_build_object('id',o.id,'event_date',e.event_date,'gender',o.gender,'amount',o.amount,'status',o.status,'paid_at',o.paid_at,'created_at',o.created_at,'start_time',e.start_time,'attended_at',o.attended_at,'review_written',exists(select 1 from public.oneul_reviews r where r.order_id = o.id)) payload
      from public.oneul_orders o join public.oneul_events e on e.id = o.event_id where o.user_id = uid
    ) x),'[]'::jsonb),
    'ledger',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'amount',l.amount,'reason',l.reason,'created_at',l.created_at) order by l.created_at desc) from public.oneul_points_ledger l where l.user_id = uid),'[]'::jsonb)
  ) into result;
  return result;
end; $$;
commit;
