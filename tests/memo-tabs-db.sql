-- Isolated rollback-only cohort: two QR sessions and a submitted choice revision.
begin;
do $qa$
declare actor uuid; app public.oneul_applications; g text; qr text; info jsonb; female uuid; male uuid; female_app uuid; result jsonb;
begin
 select user_id into actor from public.oneul_staff limit 1;
 if exists(select 1 from public.oneul_applications where event_date='2030-12-28' and start_time='13:00') then raise exception 'QA cohort occupied'; end if;
 foreach g in array array['여성','남성'] loop
  insert into public.oneul_applications(source,external_order_no,name,phone,gender,event_date,start_time,amount,status,profile,submitted_at,confirmed_at,confirmed_by,expires_at)
  values('frip','__qa_memo_tabs_'||gen_random_uuid(),'QR 탭 검증','+821000000000',g,'2030-12-28','13:00',1000,'confirmed','{}',now(),now(),actor,now()+interval '30 days') returning * into app;
  qr:=case when g='여성' then repeat('1',64) else repeat('2',64) end;
  info:=public.oneul_memo_issue(app.id,actor,qr,13,1,app.updated_at,false);
  perform public.oneul_memo_exchange(qr,case when g='여성' then repeat('6',64) else repeat('7',64) end);
  if g='여성' then female:=(info->>'pageId')::uuid;female_app:=app.id;else male:=(info->>'pageId')::uuid;end if;
 end loop;
 execute 'set local role service_role';
 result:=public.oneul_matching_save(repeat('6',64),female,array[8,10,13],0,3,gen_random_uuid());
 if result->'matching'->>'version'<>'1' then raise exception 'Initial choice not saved'; end if;
 begin
  perform public.oneul_matching_save(repeat('7',64),female,array[1,10,13],1,3,gen_random_uuid());
  raise exception using errcode='PZ002',message='Another participant session overwrote choices';
 exception when sqlstate 'PT409' then null; end;
 result:=public.oneul_matching_save(repeat('6',64),female,array[1,10,13],1,3,gen_random_uuid());
 if result->'matching'->>'version'<>'2' or result->'matching'->'numbers'<>'[1,10,13]'::jsonb then raise exception 'Resubmission did not update saved choices'; end if;
 result:=public.oneul_memo_admin_read(female_app,actor);
 if result->'matching'->'numbers'<>'[1,10,13]'::jsonb then raise exception 'Operator memo review did not see new choices'; end if;
 result:=public.oneul_session_detail(actor,'2030-12-28','13:00');
 if not exists(select 1 from jsonb_array_elements(result->'attendees') p where p->>'applicationId'=female_app::text and p->'selection'='[1,10,13]'::jsonb) then raise exception 'Operator roster still shows old selection'; end if;
 perform public.oneul_matching_save(repeat('7',64),male,array[1],0,3,gen_random_uuid());
 result:=public.oneul_session_detail(actor,'2030-12-28','13:00');
 if jsonb_array_length(result->'pairs')<>1 then raise exception 'Mutual results did not use the amended choice'; end if;
 execute 'reset role';
end $qa$;
rollback;
select count(*) as synthetic_records_remaining from public.oneul_applications where external_order_no like '__qa_memo_tabs_%';
