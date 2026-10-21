-- Rollback-only QA: no actual applicant, payment, file or message is changed.
begin;
do $qa$
declare actor uuid; item public.oneul_applications; reviewed public.oneul_applications;
begin
  select user_id into actor from public.oneul_staff limit 1;
  if actor is null then raise exception 'QA requires an existing operator'; end if;
  insert into public.oneul_applications(source,external_order_no,name,phone,gender,event_date,start_time,amount,expires_at)
  values('frip','__qa_confirm_'||gen_random_uuid()::text,'확정 검증용 임시 신청','+821000000000','여성','2026-10-24','18:00',0,now()+interval '30 days') returning * into item;
  execute 'set local role authenticated';
  begin
    perform public.oneul_review_application(item.id,actor,'confirmed','','','',null);
    raise exception using errcode='PZ002',message='Member could confirm directly';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  execute 'set local role anon';
  begin
    perform public.oneul_review_application(item.id,actor,'confirmed','','','',null);
    raise exception using errcode='PZ002',message='Guest could confirm directly';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  execute 'set local role service_role';
  begin
    perform public.oneul_review_application(item.id,actor,'confirmed','','','',null);
    raise exception using errcode='PZ002',message='Unsubmitted profile was confirmed';
  exception when sqlstate 'P0001' then if sqlerrm<>'Submitted paid profile required' then raise; end if; end;
  update public.oneul_applications set profile=jsonb_build_object('name','보존할 제출본'),status='submitted',submitted_at=now() where id=item.id returning * into item;
  begin
    perform public.oneul_review_application(item.id,gen_random_uuid(),'confirmed','','','',item.submitted_at);
    raise exception using errcode='PZ002',message='Nonoperator actor confirmed';
  exception when sqlstate 'P0001' then if sqlerrm<>'Operator required' then raise; end if; end;
  begin
    perform public.oneul_review_application(item.id,actor,'confirmed','','','',item.submitted_at-interval '1 second');
    raise exception using errcode='PZ002',message='Changed submission was confirmed';
  exception when sqlstate 'P0001' then if sqlerrm<>'Submission changed; reload before review' then raise; end if; end;
  perform public.oneul_review_application(item.id,actor,'confirmed','','','신분증·휴대폰, 10분 전 도착',item.submitted_at);
  select * into reviewed from public.oneul_applications where id=item.id;
  if reviewed.status<>'confirmed' or reviewed.venue<>'' or reviewed.confirmed_by<>actor or reviewed.confirmed_at is null or reviewed.profile is distinct from item.profile or reviewed.submitted_at is distinct from item.submitted_at then raise exception 'Confirmation without venue failed'; end if;
  if not exists(select 1 from public.oneul_application_audit where application_id=item.id and actor_id=actor and action='confirmed') then raise exception 'Confirmation audit missing'; end if;
  perform public.oneul_review_application(item.id,actor,'changes_requested','자료를 다시 첨부해주세요.','','',item.submitted_at);
  update public.oneul_applications set status='submitted',venue='기존에 안내한 장소' where id=item.id;
  perform public.oneul_review_application(item.id,actor,'confirmed','','','',item.submitted_at);
  if (select venue from public.oneul_applications where id=item.id)<>'기존에 안내한 장소' then raise exception 'Omitted venue erased existing data'; end if;
  begin
    update public.oneul_applications set profile=null where id=item.id;
    raise exception using errcode='PZ002',message='Confirmed row allowed missing profile';
  exception when check_violation then null; end;
  begin
    update public.oneul_applications set payment_status='canceled' where id=item.id;
    raise exception using errcode='PZ002',message='Confirmed row allowed unpaid status';
  exception when check_violation then null; end;
  perform public.oneul_review_application(item.id,actor,'canceled','','','',item.submitted_at);
  begin
    perform public.oneul_review_application(item.id,actor,'confirmed','','','',item.submitted_at);
    raise exception using errcode='PZ002',message='Canceled application was confirmed';
  exception when sqlstate 'P0001' then if sqlerrm<>'Submitted paid profile required' then raise; end if; end;
  execute 'reset role';
end $qa$;
rollback;
select jsonb_build_object('confirmed_without_venue',true,'existing_venue_preserved',true,'submission_preserved',true,'operator_required',true,'paid_submitted_profile_required',true,'stale_review_denied',true,'confirmation_audit_verified',true,'qa_changes_rolled_back',true) as result;
