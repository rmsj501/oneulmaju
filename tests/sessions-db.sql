-- Rollback-only, synthetic 13:13 cohort, one-way/cross-session selection and retry QA.
begin;
do $qa$
declare actor uuid; app public.oneul_applications; info jsonb; plan jsonb; result jsonb; detail jsonb; hashes jsonb;
 batch uuid:=gen_random_uuid(); second_batch uuid:=gen_random_uuid(); failed_batch uuid:=gen_random_uuid(); stale_batch uuid:=gen_random_uuid();
 male uuid; female uuid; female2 uuid; male_app uuid; first_app uuid; old_hash text; session_hash text:=repeat('b',64); total integer; g text; i integer;
begin
 select user_id into actor from public.oneul_staff limit 1;
 foreach g in array array['남성','여성'] loop
  for i in 1..13 loop
   insert into public.oneul_applications(source,external_order_no,name,phone,gender,event_date,start_time,amount,status,profile,submitted_at,confirmed_at,confirmed_by,expires_at)
   values('frip','__qa_sessions_'||gen_random_uuid(),'회차 검증 '||g||i,'+821000000000',g,'2026-11-14','13:00',1000,'confirmed','{}',now(),now(),actor,now()+interval '30 days');
  end loop;
 end loop;
 execute 'set local role authenticated';
 begin
  perform public.oneul_session_list(actor);
  raise exception using errcode='PZ002',message='Ordinary user listed sessions';
 exception when insufficient_privilege then null; end;
 execute 'reset role';execute 'set local role service_role';
 begin
  perform public.oneul_session_detail(gen_random_uuid(),'2026-11-14','13:00');
  raise exception using errcode='PZ002',message='Non-staff read results';
 exception when insufficient_privilege then null; end;
 detail:=public.oneul_session_detail(actor,'2026-11-14','13:00');
 if detail->>'paidCount'<>'26' or detail->>'confirmedCount'<>'26' or detail->'pairs'<>'[]'::jsonb then raise exception 'Session roster mismatch'; end if;
 plan:=public.oneul_session_batch_plan(actor,'2026-11-14','13:00',batch,repeat('1',64));
 select jsonb_object_agg(id::text,md5(id::text)||md5(id::text||'qa')) into hashes from public.oneul_applications where event_date='2026-11-14' and start_time='13:00';
 result:=public.oneul_session_batch_issue(actor,'2026-11-14','13:00',batch,repeat('1',64),plan->'expected',hashes,false);
 if result->>'completed'<>'true' or jsonb_array_length(result->'items')<>26 then raise exception '13:13 batch did not issue all 26'; end if;
 if (select count(distinct qr_hash) from oneul_private.memo_issue_batch_items where batch_id=batch)<>26 then raise exception 'Batch QR tokens collided'; end if;
 if exists(select 1 from oneul_private.memo_pages m join public.oneul_applications a on a.id=m.application_id where a.event_date='2026-11-14' and a.start_time='13:00' and m.opponent_count<>13) then raise exception 'Opponent counts did not match roster'; end if;
 if public.oneul_session_batch_issue(actor,'2026-11-14','13:00',batch,repeat('1',64),plan->'expected',hashes,false)<>result then raise exception 'Batch retry changed QR result'; end if;
 plan:=public.oneul_session_batch_plan(actor,'2026-11-14','13:00',second_batch,repeat('2',64));
 result:=public.oneul_session_batch_issue(actor,'2026-11-14','13:00',second_batch,repeat('2',64),plan->'expected',hashes,false);
 if result->>'skippedCount'<>'26' or result->'items'<>'[]'::jsonb then raise exception 'Existing QR batch rotated without approval'; end if;
 plan:=public.oneul_session_batch_plan(actor,'2026-11-14','13:00',stale_batch,repeat('3',64));
 begin
  perform public.oneul_session_batch_issue(actor,'2026-11-14','13:00',stale_batch,repeat('3',64),'[]',hashes,true);
  raise exception using errcode='PZ002',message='Stale roster issued QR';
 exception when sqlstate 'PT409' then null; end;
 select a.id,m.qr_hash into first_app,old_hash from public.oneul_applications a join oneul_private.memo_pages m on m.application_id=a.id where a.event_date='2026-11-14' and a.start_time='13:00' order by a.gender,a.created_at,a.id limit 1;
 plan:=public.oneul_session_batch_plan(actor,'2026-11-14','13:00',failed_batch,repeat('4',64));
 begin
  perform public.oneul_session_batch_issue(actor,'2026-11-14','13:00',failed_batch,repeat('4',64),plan->'expected',jsonb_build_object(first_app::text,repeat('e',64)),true);
  raise exception using errcode='PZ002',message='Incomplete batch hash list succeeded';
 exception when invalid_parameter_value then null; end;
 if exists(select 1 from oneul_private.memo_issue_batches where id=failed_batch) or (select qr_hash from oneul_private.memo_pages where application_id=first_app)<>old_hash then raise exception 'Failed batch partially changed QR state'; end if;
 select m.id,m.application_id into male,male_app from oneul_private.memo_pages m join public.oneul_applications a on a.id=m.application_id where a.event_date='2026-11-14' and a.start_time='13:00' and a.gender='남성' and m.participant_number=1;
 select m.id into female from oneul_private.memo_pages m join public.oneul_applications a on a.id=m.application_id where a.event_date='2026-11-14' and a.start_time='13:00' and a.gender='여성' and m.participant_number=1;
 select m.id into female2 from oneul_private.memo_pages m join public.oneul_applications a on a.id=m.application_id where a.event_date='2026-11-14' and a.start_time='13:00' and a.gender='여성' and m.participant_number=2;
 perform public.oneul_memo_exchange((select qr_hash from oneul_private.memo_pages where id=male),repeat('6',64));
 perform public.oneul_memo_exchange((select qr_hash from oneul_private.memo_pages where id=female),repeat('7',64));
 perform public.oneul_memo_exchange((select qr_hash from oneul_private.memo_pages where id=female2),repeat('8',64));
 perform public.oneul_matching_save(repeat('6',64),male,array[1],0,3,gen_random_uuid());
 perform public.oneul_matching_save(repeat('7',64),female,array[1],0,3,gen_random_uuid());
 perform public.oneul_matching_save(repeat('8',64),female2,array[1],0,3,gen_random_uuid());
 insert into public.oneul_applications(source,external_order_no,name,phone,gender,event_date,start_time,amount,status,profile,submitted_at,confirmed_at,confirmed_by,expires_at)
 values('frip','__qa_sessions_'||gen_random_uuid(),'다른 회차','+821000000000','여성','2026-11-14','16:00',1000,'confirmed','{}',now(),now(),actor,now()+interval '30 days') returning * into app;
 info:=public.oneul_memo_issue(app.id,actor,repeat('9',64),13,1,app.updated_at,false);
 perform public.oneul_memo_exchange(repeat('9',64),repeat('a',64));
 perform public.oneul_matching_save(repeat('a',64),(info->>'pageId')::uuid,array[1],0,3,gen_random_uuid());
 detail:=public.oneul_session_detail(actor,'2026-11-14','13:00');
 if jsonb_array_length(detail->'pairs')<>1 or detail->>'submittedCount'<>'3' or detail->'pairs'->0->'male'->>'applicationId'<>male_app::text then raise exception 'Mutual matching mixed one-way or another session'; end if;
 -- Explicit cohort reissue keeps choices and participant numbers.
 plan:=public.oneul_session_batch_plan(actor,'2026-11-14','13:00',failed_batch,repeat('5',64));
 select jsonb_object_agg(id::text,md5(id::text||'new')||md5(id::text||'qa2')) into hashes from public.oneul_applications where event_date='2026-11-14' and start_time='13:00';
 result:=public.oneul_session_batch_issue(actor,'2026-11-14','13:00',failed_batch,repeat('5',64),plan->'expected',hashes,true);
 if jsonb_array_length(result->'items')<>26 or (select numbers from oneul_private.matching_submissions where page_id=male)<>array[1] then raise exception 'Bulk reissue lost matching choices'; end if;
 result:=public.oneul_session_batch_plan(actor,'2026-11-14','13:00',batch,repeat('1',64));
 if exists(select 1 from jsonb_array_elements(result->'items') x where (x->>'valid')::boolean) then raise exception 'Old batch reported stale QR tokens as valid'; end if;
 delete from public.oneul_applications where id=male_app;
 if exists(select 1 from oneul_private.memo_issue_batch_items where application_id=male_app) then raise exception 'Deletion left participant batch item'; end if;
 execute 'reset role';
end $qa$;
rollback;
select jsonb_build_object('test_applications',(select count(*) from public.oneul_applications where external_order_no like '__qa_sessions_%'),'batch_receipts',(select count(*) from oneul_private.memo_issue_batches)) as session_rollback_verified;
