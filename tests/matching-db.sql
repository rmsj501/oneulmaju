-- Transactional integration QA only; all synthetic participants and choices roll back.
begin;
do $qa$
declare actor uuid; a public.oneul_applications; b public.oneul_applications; c public.oneul_applications;
 info jsonb; page_a uuid; page_b uuid; choice jsonb; result jsonb; mutation uuid:=gen_random_uuid();
begin
 select user_id into actor from public.oneul_staff limit 1;
 insert into public.oneul_applications(source,external_order_no,name,phone,gender,event_date,start_time,amount,status,profile,submitted_at,confirmed_at,confirmed_by,expires_at)
 values('frip','__qa_matching_'||gen_random_uuid(),'매칭 검증 A','+821000000000','여성','2026-10-31','16:00',0,'confirmed','{"name":"매칭 검증 A"}',now(),now(),actor,now()+interval '30 days') returning * into a;
 insert into public.oneul_applications(source,external_order_no,name,phone,gender,event_date,start_time,amount,status,profile,submitted_at,confirmed_at,confirmed_by,expires_at)
 values('frip','__qa_matching_'||gen_random_uuid(),'매칭 검증 B','+821000000000','여성','2026-10-31','16:00',0,'confirmed','{"name":"매칭 검증 B"}',now(),now(),actor,now()+interval '30 days') returning * into b;
 insert into public.oneul_applications(source,external_order_no,name,phone,gender,event_date,start_time,amount,status,profile,submitted_at,confirmed_at,confirmed_by,expires_at)
 values('frip','__qa_matching_'||gen_random_uuid(),'매칭 검증 C','+821000000000','여성','2026-11-07','16:00',0,'confirmed','{"name":"매칭 검증 C"}',now(),now(),actor,now()+interval '30 days') returning * into c;
 execute 'set local role authenticated';
 begin
  perform public.oneul_matching_limit(a.id,actor,2);
  raise exception using errcode='PZ002',message='Member changed matching limit';
 exception when insufficient_privilege then null; end;
 begin
  perform public.oneul_matching_save(repeat('a',64),gen_random_uuid(),array[1],0,3,mutation);
  raise exception using errcode='PZ002',message='Member called matching RPC directly';
 exception when insufficient_privilege then null; end;
 execute 'reset role';execute 'set local role service_role';
 begin
  perform public.oneul_matching_limit(a.id,gen_random_uuid(),2);
  raise exception using errcode='PZ002',message='Unknown operator set limit';
 exception when insufficient_privilege then null; end;
 info:=public.oneul_memo_issue(a.id,actor,repeat('4',64),4,null,a.updated_at,false);page_a:=(info->>'pageId')::uuid;
 info:=public.oneul_memo_issue(b.id,actor,repeat('5',64),4,null,b.updated_at,false);page_b:=(info->>'pageId')::uuid;
 perform public.oneul_memo_exchange(repeat('4',64),repeat('6',64));
 perform public.oneul_memo_exchange(repeat('5',64),repeat('7',64));
 result:=public.oneul_memo_read(repeat('6',64),page_a);
 if result->'matching'->>'limit'<>'3' or result->'matching'->>'version'<>'0' then raise exception 'Initial matching state mismatch'; end if;
 begin
  perform public.oneul_matching_save(repeat('6',64),page_b,array[1],0,3,mutation);
  raise exception using errcode='PZ002',message='Other owner page received matching choice';
 exception when sqlstate 'PT409' then null; end;
 choice:=public.oneul_matching_save(repeat('6',64),page_a,array[3,1,2],0,3,mutation);
 if choice->>'submitted'<>'true' or choice->'matching'->'numbers'<>'[1,2,3]'::jsonb or choice->'matching'->>'version'<>'1' then raise exception 'Matching submission mismatch'; end if;
 if public.oneul_matching_save(repeat('6',64),page_a,array[1,2,3],0,3,mutation)<>choice then raise exception 'Retry duplicated matching submission'; end if;
 begin
  perform public.oneul_matching_save(repeat('6',64),page_a,array[1],0,3,gen_random_uuid());
  raise exception using errcode='PZ002',message='Stale matching selection overwrote data';
 exception when sqlstate 'PT409' then null; end;
 begin
  perform public.oneul_matching_limit(a.id,actor,2);
  raise exception using errcode='PZ002',message='Limit silently discarded submitted choices';
 exception when sqlstate 'PT409' then null; end;
 if public.oneul_memo_admin_read(a.id,actor)->'matching'->'numbers'<>'[1,2,3]'::jsonb then raise exception 'Operator could not read submitted matching choices'; end if;
 if public.oneul_memo_read(repeat('7',64),page_b)->'matching'->>'version'<>'0' then raise exception 'Matching choices leaked to another participant'; end if;
 perform public.oneul_matching_save(repeat('6',64),page_a,'{}'::integer[],1,3,gen_random_uuid());
 perform public.oneul_matching_limit(a.id,actor,2);
 if public.oneul_memo_read(repeat('7',64),page_b)->'matching'->>'limit'<>'2' or public.oneul_memo_admin(c.id,actor)->>'matchLimit'<>'3' then raise exception 'Session matching limit scope mismatch'; end if;
 begin
  perform public.oneul_matching_save(repeat('6',64),page_a,array[1,2,3],2,2,gen_random_uuid());
  raise exception using errcode='PZ002',message='Three choices accepted with two-person limit';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.oneul_matching_save(repeat('6',64),page_a,array[1],2,3,gen_random_uuid());
  raise exception using errcode='PZ002',message='Stale matching limit accepted';
 exception when sqlstate 'PT409' then null; end;
 begin
  perform public.oneul_matching_save(repeat('6',64),page_a,array[1,1],2,2,gen_random_uuid());
  raise exception using errcode='PZ002',message='Duplicate opponent accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.oneul_matching_save(repeat('6',64),page_a,array[5],2,2,gen_random_uuid());
  raise exception using errcode='PZ002',message='Nonexistent opponent number accepted';
 exception when invalid_parameter_value then null; end;
 perform public.oneul_matching_save(repeat('6',64),page_a,array[2],2,2,gen_random_uuid());
 begin
  perform public.oneul_memo_issue(a.id,actor,repeat('8',64),1,null,a.updated_at,true);
  raise exception using errcode='PZ002',message='QR maintenance hid submitted matching number';
 exception when sqlstate 'PT409' then null; end;
 perform public.oneul_memo_issue(a.id,actor,repeat('8',64),4,null,a.updated_at,true);
 perform public.oneul_memo_exchange(repeat('8',64),repeat('9',64));
 if public.oneul_memo_read(repeat('9',64),page_a)->'matching'->'numbers'<>'[2]'::jsonb then raise exception 'QR reissue lost matching submission'; end if;
 begin
  perform public.oneul_matching_save(repeat('6',64),page_a,array[1],3,2,gen_random_uuid());
  raise exception using errcode='PZ002',message='Revoked QR session submitted matching';
 exception when invalid_authorization_specification then null; end;
 perform public.oneul_matching_save(repeat('7',64),page_b,array[1],0,2,gen_random_uuid());
 update public.oneul_applications set status='canceled',payment_status='canceled',confirmed_at=null,confirmed_by=null where id=a.id;
 begin
  perform public.oneul_matching_save(repeat('9',64),page_a,array[1],3,2,gen_random_uuid());
  raise exception using errcode='PZ002',message='Canceled participant submitted matching';
 exception when invalid_authorization_specification then null; end;
 delete from public.oneul_applications where id=b.id;
 if exists(select 1 from oneul_private.matching_submissions where page_id=page_b) then raise exception 'Application deletion retained choices'; end if;
 execute 'reset role';
end $qa$;
rollback;
select jsonb_build_object('test_applications',(select count(*) from public.oneul_applications where external_order_no like '__qa_matching_%'),
 'matching_submissions',(select count(*) from oneul_private.matching_submissions)) as matching_rollback_verified;
