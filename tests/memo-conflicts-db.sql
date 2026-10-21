-- Real notice workflow version change reproduced on one rollback-only applicant.
begin;
do $qa$
declare actor uuid; app public.oneul_applications; stale timestamptz; state jsonb; result jsonb; error_message text;
begin
 select user_id into actor from public.oneul_staff limit 1;
 insert into public.oneul_applications(source,external_order_no,name,phone,gender,event_date,start_time,amount,status,profile,submitted_at,confirmed_at,confirmed_by,expires_at)
 values('frip','__qa_memo_conflict_'||gen_random_uuid(),'버전 충돌 검증','+821000000000','남성','2030-12-21','13:00',1000,'confirmed','{}',now(),now(),actor,now()+interval '30 days') returning * into app;
 stale:=app.updated_at;
 update public.oneul_applications set updated_at=clock_timestamp() where id=app.id;
 execute 'set local role service_role';
 state:=public.oneul_memo_admin(app.id,actor);
 if (state->>'applicationUpdatedAt')::timestamptz=stale or state->>'issued'<>'false' then raise exception 'QR state did not read the new application version'; end if;
 begin
  perform public.oneul_memo_issue(app.id,actor,repeat('d',64),3,null,stale,false);
  raise exception using errcode='PZ002',message='Stale notice snapshot issued QR';
 exception when sqlstate 'PT409' then
  get stacked diagnostics error_message=message_text;
  if error_message<>'Application changed' then raise exception 'Unexpected conflict: %',error_message; end if;
 end;
 if exists(select 1 from oneul_private.memo_pages where application_id=app.id) then raise exception 'Stale request created a page'; end if;
 result:=public.oneul_memo_issue(app.id,actor,repeat('d',64),3,null,(state->>'applicationUpdatedAt')::timestamptz,false);
 if result->>'issued'<>'true' or result->>'applicationUpdatedAt' is distinct from state->>'applicationUpdatedAt' then raise exception 'Fresh QR request failed'; end if;
 begin
  perform public.oneul_memo_issue(app.id,actor,repeat('e',64),3,null,(state->>'applicationUpdatedAt')::timestamptz,false);
  raise exception using errcode='PZ002',message='Duplicate issuance changed existing QR';
 exception when sqlstate 'PT409' then null; end;
 if (select qr_hash from oneul_private.memo_pages where application_id=app.id)<>repeat('d',64) then raise exception 'Conflict rotated the existing QR'; end if;
 execute 'reset role';
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='oneul_private'
  and (p.proname like 'memo\_%' escape '\' or p.proname like 'matching\_%' escape '\' or p.proname like 'session\_%' escape '\')
  and position('raise serialization_failure' in p.prosrc)>0) then raise exception 'Intentional 40001 remains in memo module'; end if;
end $qa$;
rollback;
select count(*) as synthetic_records_remaining from public.oneul_applications where external_order_no like '__qa_memo_conflict_%';
