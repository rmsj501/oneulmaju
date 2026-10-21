-- Rollback-only integration QA; never change a real participant or memo.
begin;
do $qa$
declare actor uuid; a public.oneul_applications; b public.oneul_applications; info jsonb; other_info jsonb;
  page_a uuid; page_b uuid; saved jsonb; result jsonb; mutation uuid:=gen_random_uuid(); total integer;
begin
  select user_id into actor from public.oneul_staff limit 1;
  if actor is null then raise exception 'QA operator required'; end if;
  insert into public.oneul_applications(source,external_order_no,name,phone,gender,event_date,start_time,amount,status,profile,submitted_at,confirmed_at,confirmed_by,expires_at)
  values('frip','__qa_memo_'||gen_random_uuid(),'메모 검증 A','+821000000000','여성','2026-10-31','13:00',0,'confirmed','{"name":"메모 검증 A"}',now(),now(),actor,now()+interval '30 days') returning * into a;
  insert into public.oneul_applications(source,external_order_no,name,phone,gender,event_date,start_time,amount,status,profile,submitted_at,confirmed_at,confirmed_by,expires_at)
  values('munto','__qa_memo_'||gen_random_uuid(),'메모 검증 B','+821000000000','여성','2026-10-31','13:00',0,'confirmed','{"name":"메모 검증 B"}',now(),now(),actor,now()+interval '30 days') returning * into b;
  execute 'set local role authenticated';
  begin
    perform public.oneul_memo_issue(a.id,actor,repeat('1',64),3,null,a.updated_at,false);
    raise exception using errcode='PZ002',message='Member could issue memo QR';
  exception when insufficient_privilege then null; end;
  begin
    select count(*) into total from oneul_private.memo_entries;
    raise exception using errcode='PZ002',message='Member could read memo table';
  exception when insufficient_privilege then null; end;
  begin
    perform public.oneul_memo_admin_read(a.id,actor);
    raise exception using errcode='PZ002',message='Member could invoke operator memo review';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  execute 'set local role service_role';
  begin
    perform public.oneul_memo_admin_read(a.id,gen_random_uuid());
    raise exception using errcode='PZ002',message='Unlisted operator read a memo';
  exception when insufficient_privilege then null; end;
  if public.oneul_memo_admin_read(a.id,actor)->>'issued'<>'false' then raise exception 'Unissued memo state mismatch'; end if;
  begin
    perform public.oneul_memo_issue(a.id,gen_random_uuid(),repeat('1',64),3,null,a.updated_at,false);
    raise exception using errcode='PZ002',message='Unlisted operator issued QR';
  exception when insufficient_privilege then null; end;
  begin
    perform public.oneul_memo_issue(a.id,actor,repeat('1',64),3,null,a.updated_at-interval '1 second',false);
    raise exception using errcode='PZ002',message='Stale applicant version issued QR';
  exception when sqlstate 'PT409' then null; end;
  info:=public.oneul_memo_issue(a.id,actor,repeat('1',64),3,null,a.updated_at,false);page_a:=(info->>'pageId')::uuid;
  other_info:=public.oneul_memo_issue(b.id,actor,repeat('2',64),3,null,b.updated_at,false);page_b:=(other_info->>'pageId')::uuid;
  if info->>'participantNumber'<>'1' or other_info->>'participantNumber'<>'2' then raise exception 'Auto numbering collided'; end if;
  if info ? 'entries' or info ? 'qr_hash' then raise exception 'Admin metadata exposed private content'; end if;
  begin
    perform public.oneul_memo_issue(b.id,actor,repeat('2',64),3,1,b.updated_at,true);
    raise exception using errcode='PZ002',message='Same event/side reused participant number';
  exception when unique_violation then null; end;
  begin
    perform public.oneul_memo_issue(a.id,actor,repeat('3',64),3,null,a.updated_at,false);
    raise exception using errcode='PZ002',message='Existing QR replaced without confirmation';
  exception when sqlstate 'PT409' then null; end;
  perform public.oneul_memo_exchange(repeat('1',64),repeat('a',64));
  perform public.oneul_memo_exchange(repeat('1',64),repeat('c',64)); -- Repeated scan remains valid.
  perform public.oneul_memo_exchange(repeat('2',64),repeat('b',64));
  result:=public.oneul_memo_read(repeat('a',64),page_a);
  if result->'page'->>'gender'<>'여성' or result->'entries'<>'[]'::jsonb or result::text like '%phone%' or result::text like '%application_id%' or result::text like '%qr_hash%' then raise exception 'Private page payload mismatch'; end if;
  begin
    perform public.oneul_memo_read(repeat('a',64),page_b);
    raise exception using errcode='PZ002',message='QR could choose another owner page';
  exception when sqlstate 'PT409' then null; end;
  saved:=public.oneul_memo_save(repeat('a',64),page_a,1,'친절한 대화 <script>text only</script>',2,0,mutation);
  if saved->>'saved'<>'true' or saved->'entry'->>'version'<>'1' then raise exception 'First memo save failed'; end if;
  result:=public.oneul_memo_admin_read(a.id,actor);
  if result->>'applicationId'<>a.id::text or result->'page'->>'id'<>page_a::text
    or result->'entries'->0->>'text'<>'친절한 대화 <script>text only</script>' or result->'entries'->0->>'hearts'<>'2'
    or result::text like '%qr_hash%' or result::text like '%session_hash%' or result::text like '%qrToken%' then raise exception 'Operator read payload mismatch'; end if;
  if not exists(select 1 from public.oneul_application_audit where application_id=a.id and actor_id=actor and action='memo_admin_viewed') then raise exception 'Operator view was not audited'; end if;
  if (select qr_hash from oneul_private.memo_pages where id=page_a)<>repeat('1',64)
    or (select count(*) from oneul_private.memo_sessions where page_id=page_a)<>2
    or (select version from oneul_private.memo_entries where page_id=page_a and opponent_number=1)<>1 then raise exception 'Operator review mutated QR, sessions or notes'; end if;
  if public.oneul_memo_admin_read(b.id,actor)->'entries'<>'[]'::jsonb then raise exception 'Operator read selected the wrong participant'; end if;
  if public.oneul_memo_save(repeat('a',64),page_a,1,'친절한 대화 <script>text only</script>',2,0,mutation)<>saved then raise exception 'Lost-response retry duplicated save'; end if;
  begin
    perform public.oneul_memo_save(repeat('a',64),page_a,1,'다른 내용',3,0,mutation);
    raise exception using errcode='PZ002',message='Same mutation changed content';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform public.oneul_memo_save(repeat('c',64),page_a,1,'이전 화면',1,0,gen_random_uuid());
    raise exception using errcode='PZ002',message='Stale screen overwrote memo';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform public.oneul_memo_save(repeat('a',64),page_a,4,'범위 밖',1,0,gen_random_uuid());
    raise exception using errcode='PZ002',message='Out of range opponent accepted';
  exception when raise_exception then null; end;
  begin
    perform public.oneul_memo_save(repeat('a',64),page_a,2,'하트 오류',4,0,gen_random_uuid());
    raise exception using errcode='PZ002',message='Invalid heart accepted';
  exception when raise_exception then null; end;
  begin
    perform public.oneul_memo_save(repeat('a',64),page_a,2,repeat('가',501),1,0,gen_random_uuid());
    raise exception using errcode='PZ002',message='Oversized note accepted';
  exception when raise_exception then null; end;
  if public.oneul_memo_read(repeat('b',64),page_b)->'entries'<>'[]'::jsonb then raise exception 'Private memo leaked to another participant'; end if;
  perform public.oneul_memo_save(repeat('a',64),page_a,3,'세 번째 상대',3,0,gen_random_uuid());
  begin
    perform public.oneul_memo_issue(a.id,actor,repeat('3',64),2,null,a.updated_at,true);
    raise exception using errcode='PZ002',message='Reducing range hid written note';
  exception when raise_exception then null; end;
  perform public.oneul_memo_save(repeat('a',64),page_a,3,'',0,1,gen_random_uuid());
  perform public.oneul_memo_issue(a.id,actor,repeat('3',64),2,null,a.updated_at,true);
  begin
    perform public.oneul_memo_read(repeat('a',64),page_a);
    raise exception using errcode='PZ002',message='Rotation retained old browser credential';
  exception when invalid_authorization_specification then null; end;
  begin
    perform public.oneul_memo_exchange(repeat('1',64),repeat('d',64));
    raise exception using errcode='PZ002',message='Rotation retained original QR';
  exception when invalid_authorization_specification then null; end;
  perform public.oneul_memo_exchange(repeat('3',64),repeat('d',64));
  result:=public.oneul_memo_read(repeat('d',64),page_a);
  if result->'entries'->0->>'text'<>'친절한 대화 <script>text only</script>' then raise exception 'Reissue lost existing note'; end if;
  update public.oneul_applications set status='canceled',payment_status='canceled',confirmed_at=null,confirmed_by=null where id=a.id;
  begin
    perform public.oneul_memo_admin_read(a.id,actor);
    raise exception using errcode='PZ002',message='Canceled application exposed an operator memo view';
  exception when raise_exception then null; end;
  begin
    perform public.oneul_memo_read(repeat('d',64),page_a);
    raise exception using errcode='PZ002',message='Canceled attendee still read memo';
  exception when invalid_authorization_specification then null; end;
  begin
    perform public.oneul_memo_exchange(repeat('3',64),repeat('e',64));
    raise exception using errcode='PZ002',message='Canceled QR could create another session';
  exception when invalid_authorization_specification then null; end;
  update oneul_private.memo_pages set expires_at=now()-interval '1 second' where id=page_b;
  if public.oneul_memo_admin_read(b.id,actor)->>'issued'<>'true' then raise exception 'QR expiry incorrectly ended operator review'; end if;
  begin
    perform public.oneul_memo_read(repeat('b',64),page_b);
    raise exception using errcode='PZ002',message='Expired QR session read permitted';
  exception when invalid_authorization_specification then null; end;
  delete from public.oneul_applications where id=b.id;
  begin
    perform public.oneul_memo_admin_read(b.id,actor);
    raise exception using errcode='PZ002',message='Deleted application exposed an operator memo view';
  exception when no_data_found then null; end;
  if exists(select 1 from oneul_private.memo_pages where id=page_b) or exists(select 1 from oneul_private.memo_sessions where page_id=page_b) then raise exception 'Parent deletion left orphan memo data'; end if;
  execute 'reset role';
  execute 'set local role anon';
  begin
    perform public.oneul_memo_admin_read(a.id,actor);
    raise exception using errcode='PZ002',message='Anonymous operator read permitted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.oneul_memo_read(repeat('d',64),null);
    raise exception using errcode='PZ002',message='Anonymous direct RPC read permitted';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
end $qa$;
rollback;
select jsonb_build_object('test_applications',(select count(*) from public.oneul_applications where external_order_no like '__qa_memo_%'),
  'memo_pages',(select count(*) from oneul_private.memo_pages),'memo_entries',(select count(*) from oneul_private.memo_entries),
  'public_definers',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'oneul_memo_%' and p.prosecdef)) as rollback_verification;
