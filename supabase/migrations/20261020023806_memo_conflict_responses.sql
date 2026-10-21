begin;
-- PostgREST 14 retries SQLSTATE 40001 indefinitely. These are intentional
-- application conflicts, not retryable database serialization failures.
-- Replace only this private memo/matching/cohort module, preserving signatures,
-- ownership, privileges, SECURITY attributes and search_path of each function.
do $migration$
declare fn record; definition text;
begin
 for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='oneul_private' and p.prokind='f'
   and (p.proname like 'memo\_%' escape '\' or p.proname like 'matching\_%' escape '\' or p.proname like 'session\_%' escape '\')
   and position('raise serialization_failure' in p.prosrc)>0 loop
  definition:=replace(pg_get_functiondef(fn.oid),'raise serialization_failure','raise sqlstate ''PT409''');
  execute definition;
 end loop;
end $migration$;

-- Read the concurrency token together with QR state, rather than reusing a
-- participant-detail snapshot taken before a confirmation/notice update.
create or replace function oneul_private.memo_admin(p_application_id uuid,p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item oneul_private.memo_pages; app public.oneul_applications; allowed integer;
begin
 if not exists(select 1 from public.oneul_staff where user_id=p_actor_id) then raise insufficient_privilege using message='Operator required'; end if;
 select * into app from public.oneul_applications where id=p_application_id;
 if not found then raise no_data_found using message='Application not found'; end if;
 select coalesce((select choice_limit from oneul_private.matching_rules where event_date=app.event_date and start_time=app.start_time),3) into allowed;
 select * into item from oneul_private.memo_pages where application_id=p_application_id;
 if not found then return jsonb_build_object('issued',false,'matchLimit',allowed,'applicationUpdatedAt',app.updated_at); end if;
 return jsonb_build_object('issued',true,'matchLimit',allowed,'applicationUpdatedAt',app.updated_at,'pageId',item.id,'participantNumber',item.participant_number,
  'opponentCount',item.opponent_count,'expiresAt',item.expires_at,'eventDate',item.event_date,'startTime',item.start_time,'gender',item.gender);
end; $$;
notify pgrst,'reload schema';
commit;
