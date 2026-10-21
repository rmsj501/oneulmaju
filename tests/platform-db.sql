-- Run after the disposable physical-storage check; all state below rolls back.
begin;
do $qa$
declare actor uuid; item public.oneul_applications; total integer;
begin
  select user_id into actor from public.oneul_staff limit 1;
  select * into item from public.oneul_applications where left(external_order_no,5)='__qa_' and name='저장 검증용 임시 신청' and status='submitted' limit 1;
  if item.id is null then raise exception 'Run the disposable upload/submission check first'; end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  execute 'set local role authenticated';
  insert into public.oneul_profiles(user_id,kind,name,phone,gender,birth,height,region,district,job,privacy_consent_at)
  values(actor,'member','임시 카드 검증','01000000000','여성','1994-05-20',155,'서울','송파구','테스트',now());
  select count(*) into total from public.oneul_profiles where user_id=actor;
  if total<>1 then raise exception 'Own saved member profile missing'; end if;
  begin
    perform public.oneul_review_application(item.id,actor,'confirmed','','서울 테스트 장소','검증용 준비 안내',item.submitted_at);
    raise exception using errcode='PZ002',message='Customer could approve application';
  exception when insufficient_privilege then null; end;
  begin
    select count(*) into total from public.oneul_applications;
    raise exception using errcode='PZ002',message='Customer could bypass Edge access checks';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  execute 'set local role service_role';
  begin
    perform public.oneul_review_application(item.id,gen_random_uuid(),'confirmed','','서울 테스트 장소','',item.submitted_at);
    raise exception using errcode='PZ002',message='Nonoperator actor approved application';
  exception when raise_exception then if sqlstate='PZ002' then raise; end if; end;
  perform public.oneul_review_application(item.id,actor,'confirmed','','','신분증·휴대폰, 10분 전 도착',item.submitted_at);
  select * into item from public.oneul_applications where id=item.id;
  if item.status<>'confirmed' or item.confirmed_by<>actor or item.confirmed_at is null then raise exception 'Operator approval missing'; end if;
  begin
    perform public.oneul_submit_application(item.id,null,item.profile);
    raise exception using errcode='PZ002',message='Confirmed snapshot editable';
  exception when raise_exception then if sqlstate='PZ002' then raise; end if; end;
  perform public.oneul_review_application(item.id,actor,'changes_requested','직업 자료를 다시 확인해주세요.','서울 테스트 장소','',item.submitted_at);
  select * into item from public.oneul_applications where id=item.id;
  if item.status<>'changes_requested' or item.confirmed_at is not null then raise exception 'Revision state mismatch'; end if;
  perform public.oneul_submit_application(item.id,null,item.profile);
  perform public.oneul_review_application(item.id,actor,'canceled','','','',item.submitted_at);
  begin
    perform public.oneul_submit_application(item.id,null,item.profile);
    raise exception using errcode='PZ002',message='Canceled applicant could resubmit';
  exception when raise_exception then if sqlstate='PZ002' then raise; end if; end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  execute 'set local role authenticated';
  select count(*) into total from public.oneul_profiles;
  if total<>0 then raise exception 'Foreign profile exposed'; end if;
  execute 'reset role';
end;
$qa$;
rollback;
select jsonb_build_object('member_profiles',(select count(*) from public.oneul_profiles),'workflow_test_rolled_back',true);
