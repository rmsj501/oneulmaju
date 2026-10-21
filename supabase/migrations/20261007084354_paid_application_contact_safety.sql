begin;
create or replace function oneul_private.paid_order_application() returns trigger
language plpgsql security definer set search_path='' as $$
declare event public.oneul_events; account auth.users;
begin
  if new.status='paid' and (tg_op='INSERT' or old.status is distinct from 'paid') then
    select * into event from public.oneul_events where id=new.event_id;
    select * into account from auth.users where id=new.user_id;
    insert into public.oneul_applications(source,external_order_no,order_id,member_user_id,name,phone,gender,event_date,start_time,amount,expires_at)
    values('website',new.id::text,new.id,new.user_id,left(coalesce(nullif(btrim(account.raw_user_meta_data->>'name'),''),'참가자'),30),case when '+'||ltrim(coalesce(account.phone,''),'+') ~ '^\+821[016789][0-9]{7,8}$' then '+'||ltrim(account.phone,'+') else '' end,new.gender,event.event_date,left(coalesce(nullif(btrim(event.start_time),''),'시간 확인 중'),50),new.amount,(event.event_date+interval '30 days')::timestamptz)
    on conflict(order_id) do nothing;
  elsif new.status='canceled' then
    update public.oneul_applications set status='canceled',payment_status='canceled',confirmed_at=null,confirmed_by=null,updated_at=now() where order_id=new.id;
  end if;
  return null;
end; $$;
commit;
