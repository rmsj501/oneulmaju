-- Rollback-only QA: no real application, payment, message or Storage object is created.
begin;
do $qa$
declare item public.oneul_applications; protected public.oneul_applications; changed integer; p text;
begin
  insert into public.oneul_applications(source,external_order_no,name,phone,gender,event_date,start_time,amount,expires_at)
  values('frip','__qa_delete_'||gen_random_uuid()::text,'삭제 검증용 임시 신청','+821000000000','여성','2026-10-24','18:00',0,now()+interval '30 days') returning * into item;
  update public.oneul_applications set profile=jsonb_build_object('face_path',item.id||'/face/22222222-2222-4222-8222-222222222222.png','fullbody_path',item.id||'/fullbody/22222222-2222-4222-8222-222222222222.png','employment_path',item.id||'/employment/22222222-2222-4222-8222-222222222222.png') where id=item.id returning * into item;
  insert into public.oneul_application_sessions(token_hash,application_id,expires_at) values(encode(extensions.gen_random_bytes(32),'hex'),item.id,now()+interval '1 day');
  insert into public.oneul_application_audit(application_id,action) values(item.id,'qa_delete');
  execute 'set local role authenticated';
  begin
    delete from public.oneul_applications where id=item.id;
    raise exception using errcode='PZ002',message='Member could delete an application';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  execute 'set local role service_role';
  delete from public.oneul_applications where id=item.id and source in ('frip','munto') and order_id is null and external_order_no=item.external_order_no and updated_at=item.updated_at-interval '1 second';
  get diagnostics changed=row_count;
  if changed<>0 then raise exception 'Stale deletion succeeded'; end if;
  delete from public.oneul_applications where id=item.id and source in ('frip','munto') and order_id is null and external_order_no=item.external_order_no and updated_at=item.updated_at;
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'Exact conditional deletion failed'; end if;
  if exists(select 1 from public.oneul_application_sessions where application_id=item.id) or exists(select 1 from public.oneul_application_audit where application_id=item.id) then raise exception 'Linked session/audit survived'; end if;
  foreach p in array array[item.profile->>'face_path',item.profile->>'fullbody_path',item.profile->>'employment_path'] loop
    if not exists(select 1 from public.oneul_file_cleanup where path=p) then raise exception 'Private file cleanup not queued'; end if;
  end loop;
  insert into public.oneul_applications(source,external_order_no,name,phone,gender,event_date,start_time,amount,expires_at)
  values('website','__qa_protected_'||gen_random_uuid()::text,'보호 검증용 임시 신청','','여성','2026-10-24','18:00',0,now()+interval '30 days') returning * into protected;
  delete from public.oneul_applications where id=protected.id and source in ('frip','munto') and order_id is null and updated_at=protected.updated_at;
  get diagnostics changed=row_count;
  if changed<>0 then raise exception 'Website record deletion succeeded'; end if;
  execute 'reset role';
end $qa$;
rollback;
select jsonb_build_object('conditional_delete_verified',true,'member_denied',true,'sessions_removed',true,'files_queued',true,'website_protected',true,'qa_changes_rolled_back',true) as result;
