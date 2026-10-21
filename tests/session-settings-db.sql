-- Synthetic cohort only. All changes roll back, including rules, QRs and notes.
begin;
do $qa$
declare actor uuid; g text; i integer; batch uuid:=gen_random_uuid(); next_batch uuid; failed_batch uuid;
 plan jsonb; result jsonb; hashes jsonb; male uuid; female uuid; male_app uuid; old_hash text; before_pages jsonb;
begin
 select user_id into actor from public.oneul_staff limit 1;
 if exists(select 1 from public.oneul_applications where event_date='2030-11-23' and start_time='13:00') then raise exception 'QA cohort occupied; aborting without touching existing participants'; end if;
 foreach g in array array['남성','여성'] loop
  for i in 1..case when g='남성' then 2 else 3 end loop
   insert into public.oneul_applications(source,external_order_no,name,phone,gender,event_date,start_time,amount,status,profile,submitted_at,confirmed_at,confirmed_by,expires_at)
   values('frip','__qa_settings_'||gen_random_uuid(),'설정 검증 '||g||i,'+821000000000',g,'2030-11-23','13:00',1000,'confirmed','{}',now(),now(),actor,now()+interval '30 days');
  end loop;
 end loop;
 execute 'set local role authenticated';
 begin
  perform public.oneul_session_batch_issue_configured(actor,'2030-11-23','13:00',batch,repeat('1',64),'[]','{}',false,3,2,3);
  raise exception using errcode='PZ002',message='Ordinary user changed cohort settings';
 exception when insufficient_privilege then null; end;
 execute 'reset role';execute 'set local role service_role';
 select jsonb_object_agg(id::text,md5(id::text)||md5(id::text||'qa')) into hashes from public.oneul_applications where event_date='2030-11-23' and start_time='13:00';
 plan:=public.oneul_session_batch_plan(actor,'2030-11-23','13:00',batch,repeat('1',64));
 result:=public.oneul_session_batch_issue_configured(actor,'2030-11-23','13:00',batch,repeat('1',64),plan->'expected',hashes,false,3,2,3);
 if jsonb_array_length(result->'items')<>5 or result->'settings'->>'maleOpponentCount'<>'3' then raise exception 'Configured batch missing settings or QR'; end if;
 if exists(select 1 from oneul_private.memo_pages where event_date='2030-11-23' and opponent_count<>case when gender='남성' then 3 else 2 end) then raise exception 'Unequal opponent counts wrong'; end if;
 select id,application_id,qr_hash into male,male_app,old_hash from oneul_private.memo_pages where event_date='2030-11-23' and gender='남성' and participant_number=1;
 select id into female from oneul_private.memo_pages where event_date='2030-11-23' and gender='여성' and participant_number=1;
 perform public.oneul_memo_exchange(old_hash,repeat('a',64));
 if oneul_private.matching_state(female)->>'limit'<>'2' then raise exception 'Effective limit exceeds female opponent count'; end if;
 -- Updating all pages must preserve existing QR hashes and live sessions.
 next_batch:=gen_random_uuid();plan:=public.oneul_session_batch_plan(actor,'2030-11-23','13:00',next_batch,repeat('2',64));
 result:=public.oneul_session_batch_issue_configured(actor,'2030-11-23','13:00',next_batch,repeat('2',64),plan->'expected',hashes,false,5,2,2);
 if result->>'skippedCount'<>'5' or (select qr_hash from oneul_private.memo_pages where id=male)<>old_hash then raise exception 'Settings update rotated an existing QR'; end if;
 result:=public.oneul_memo_read(repeat('a',64),male);
 if result->'page'->>'opponentCount'<>'5' or result->'matching'->>'limit'<>'2' then raise exception 'Live memo page did not receive settings'; end if;
 -- Replay the old batch after a later update: it must not restore old settings.
 result:=public.oneul_session_batch_issue_configured(actor,'2030-11-23','13:00',batch,repeat('1',64),'[]','{}',false,3,2,3);
 if (select opponent_count from oneul_private.memo_pages where id=male)<>5 or oneul_private.matching_state(male)->>'limit'<>'2' then raise exception 'Retry overwrote newer cohort settings'; end if;
 result:=public.oneul_session_detail(actor,'2030-11-23','13:00');
 if result->>'maleOpponentCount'<>'5' or result->>'femaleOpponentCount'<>'2' or result->>'matchLimit'<>'2' then raise exception 'Settings not persisted in cohort detail'; end if;
 perform public.oneul_memo_save(repeat('a',64),male,5,'5호 메모',2,0,gen_random_uuid());
 failed_batch:=gen_random_uuid();plan:=public.oneul_session_batch_plan(actor,'2030-11-23','13:00',failed_batch,repeat('3',64));
 begin
  perform public.oneul_session_batch_issue_configured(actor,'2030-11-23','13:00',failed_batch,repeat('3',64),plan->'expected',hashes,true,3,2,2);
  raise exception using errcode='PZ002',message='Shrinking range hid a written note';
 exception when sqlstate 'PT409' then null; end;
 if exists(select 1 from oneul_private.memo_issue_batches where id=failed_batch) or (select qr_hash from oneul_private.memo_pages where id=male)<>old_hash or (select opponent_count from oneul_private.memo_pages where id=male)<>5 then raise exception 'Failed settings batch partially changed data'; end if;
 -- Remove only the synthetic note, then save a selection that prevents a lower limit.
 perform public.oneul_memo_save(repeat('a',64),male,5,'',0,1,gen_random_uuid());
 perform public.oneul_matching_limit(male_app,actor,3);
 perform public.oneul_matching_save(repeat('a',64),male,array[1,2,3],0,3,gen_random_uuid());
 failed_batch:=gen_random_uuid();plan:=public.oneul_session_batch_plan(actor,'2030-11-23','13:00',failed_batch,repeat('4',64));
 begin
  perform public.oneul_session_batch_issue_configured(actor,'2030-11-23','13:00',failed_batch,repeat('4',64),plan->'expected',hashes,false,3,2,2);
  raise exception using errcode='PZ002',message='Lowered limit hid submitted choices';
 exception when sqlstate 'PT409' then null; end;
 -- Actual opponent seat numbers must fit in the configured range.
 begin
  perform public.oneul_session_batch_issue_configured(actor,'2030-11-23','13:00',failed_batch,repeat('4',64),plan->'expected',hashes,false,2,2,3);
  raise exception using errcode='PZ002',message='Range excluded an assigned opponent';
 exception when invalid_parameter_value then null; end;
 if (select numbers from oneul_private.matching_submissions where page_id=male)<>array[1,2,3] then raise exception 'Settings changed submitted choices'; end if;
 execute 'reset role';
end $qa$;
rollback;
select jsonb_build_object('synthetic_applications',(select count(*) from public.oneul_applications where external_order_no like '__qa_settings_%'),'synthetic_rules',(select count(*) from oneul_private.matching_rules where event_date='2030-11-23')) as settings_rollback_verified;
