begin;
-- A single staff-only lookup for the displayed application IDs. Memo bodies,
-- choice numbers and QR capabilities never enter this list response.
create function oneul_private.admin_application_memo_summaries(p_actor_id uuid,p_application_ids uuid[]) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.oneul_staff where user_id=p_actor_id) then raise insufficient_privilege using message='Operator required'; end if;
 if p_application_ids is null or cardinality(p_application_ids)>200 or array_position(p_application_ids,null) is not null then raise invalid_parameter_value using message='Invalid application IDs'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('applicationId',a.id,'participantNumber',m.participant_number,
  'submittedAt',case when a.status='confirmed' and a.payment_status='paid' then s.submitted_at else null end) order by a.id),'[]'::jsonb) into result
 from public.oneul_applications a left join oneul_private.memo_pages m on m.application_id=a.id
  and m.event_date=a.event_date and m.start_time=a.start_time and m.gender=a.gender
 left join oneul_private.matching_submissions s on s.page_id=m.id
 where a.id=any(p_application_ids);
 return result;
end; $$;
create function public.oneul_admin_application_memo_summaries(p_actor_id uuid,p_application_ids uuid[]) returns jsonb
language sql stable security invoker set search_path='' as $$ select oneul_private.admin_application_memo_summaries(p_actor_id,p_application_ids); $$;
revoke all on function oneul_private.admin_application_memo_summaries(uuid,uuid[]),public.oneul_admin_application_memo_summaries(uuid,uuid[]) from public,anon,authenticated;
grant execute on function oneul_private.admin_application_memo_summaries(uuid,uuid[]),public.oneul_admin_application_memo_summaries(uuid,uuid[]) to service_role;
notify pgrst,'reload schema';
commit;
