-- Rollback-only QA. No real invitation, account, SMS or Storage bytes change.
begin;
do $qa$
declare item public.oneul_applications; opened public.oneul_applications; after_reopen public.oneul_applications;
  invite text:=encode(extensions.gen_random_bytes(32),'hex'); replacement text:=encode(extensions.gen_random_bytes(32),'hex');
  first_session text:=encode(extensions.gen_random_bytes(32),'hex'); second_session text:=encode(extensions.gen_random_bytes(32),'hex');
  operator_id uuid; result uuid; session_count integer;
begin
  select user_id into operator_id from public.oneul_staff limit 1;
  if operator_id is null then raise exception 'QA requires an existing operator'; end if;
  insert into public.oneul_applications(source,external_order_no,name,phone,gender,event_date,start_time,amount,expires_at,invitation_hash,invitation_expires_at)
  values('frip','__qa_reopen_'||gen_random_uuid()::text,'재접속 검증용 임시 신청','+821000000000','여성','2026-10-24','18:00',0,now()+interval '30 days',invite,now()+interval '1 day') returning * into item;
  execute 'set local role anon';
  begin
    perform public.oneul_exchange_application_invite(invite,first_session);
    raise exception using errcode='PZ002',message='Anonymous role could exchange directly';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  execute 'set local role authenticated';
  begin
    perform public.oneul_exchange_application_invite(invite,first_session);
    raise exception using errcode='PZ002',message='Member role could exchange directly';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  execute 'set local role service_role';
  result:=public.oneul_exchange_application_invite(invite,first_session);
  if result<>item.id then raise exception 'First open returned a different application'; end if;
  -- Simulate a saved submission and a later first-use timestamp to prove that
  -- reopening does not reset data, membership, review state or lifetime.
  update public.oneul_applications set invitation_used_at=now()-interval '1 hour',
    member_user_id=operator_id,profile=jsonb_build_object('name','보존할 제출본'),status='submitted',
    submitted_at=now()-interval '30 minutes' where id=item.id returning * into opened;
  result:=public.oneul_exchange_application_invite(invite,second_session);
  select * into after_reopen from public.oneul_applications where id=item.id;
  if result<>item.id or after_reopen is distinct from opened then raise exception 'Reopen changed the application or returned another ID'; end if;
  select count(*) into session_count from public.oneul_application_sessions where application_id=item.id;
  if session_count<>2 or exists(select 1 from public.oneul_application_sessions where application_id=item.id and expires_at>opened.invitation_expires_at) then raise exception 'Scoped sessions or expiry invalid'; end if;
  perform public.oneul_rotate_application_invite(item.id,operator_id,replacement);
  if exists(select 1 from public.oneul_application_sessions where application_id=item.id) then raise exception 'Reissue left old sessions active'; end if;
  begin
    perform public.oneul_exchange_application_invite(invite,encode(extensions.gen_random_bytes(32),'hex'));
    raise exception using errcode='PZ002',message='Replaced invitation still worked';
  exception when sqlstate 'P0001' then if sqlerrm<>'Invitation unavailable' then raise; end if; end;
  perform public.oneul_exchange_application_invite(replacement,encode(extensions.gen_random_bytes(32),'hex'));
  update public.oneul_applications set invitation_expires_at=now()-interval '1 second' where id=item.id;
  begin
    perform public.oneul_exchange_application_invite(replacement,encode(extensions.gen_random_bytes(32),'hex'));
    raise exception using errcode='PZ002',message='Expired invitation worked';
  exception when sqlstate 'P0001' then if sqlerrm<>'Invitation unavailable' then raise; end if; end;
  update public.oneul_applications set invitation_expires_at=now()+interval '7 days',expires_at=now()-interval '1 second' where id=item.id;
  begin
    perform public.oneul_exchange_application_invite(replacement,encode(extensions.gen_random_bytes(32),'hex'));
    raise exception using errcode='PZ002',message='Expired application worked';
  exception when sqlstate 'P0001' then if sqlerrm<>'Invitation unavailable' then raise; end if; end;
  update public.oneul_applications set expires_at=now()+interval '30 days',status='canceled',payment_status='canceled' where id=item.id;
  begin
    perform public.oneul_exchange_application_invite(replacement,encode(extensions.gen_random_bytes(32),'hex'));
    raise exception using errcode='PZ002',message='Canceled application worked';
  exception when sqlstate 'P0001' then if sqlerrm<>'Invitation unavailable' then raise; end if; end;
  delete from public.oneul_applications where id=item.id;
  begin
    perform public.oneul_exchange_application_invite(replacement,encode(extensions.gen_random_bytes(32),'hex'));
    raise exception using errcode='PZ002',message='Deleted application worked';
  exception when sqlstate 'P0001' then if sqlerrm<>'Invitation unavailable' then raise; end if; end;
  execute 'reset role';
end $qa$;
rollback;
select jsonb_build_object('reopen_same_application',true,'submission_preserved',true,'original_expiry_preserved',true,'first_use_preserved',true,'reissue_revokes_old_access',true,'expiry_cancel_delete_guards',true,'service_only',true,'qa_changes_rolled_back',true) as result;
