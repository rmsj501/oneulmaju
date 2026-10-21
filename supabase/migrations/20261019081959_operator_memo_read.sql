begin;
-- Service-only read path. The Edge Function validates Auth and canonical staff
-- membership; the database rechecks the operator before returning any memo.
create function oneul_private.memo_admin_read(p_application_id uuid,p_actor_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare app public.oneul_applications; item oneul_private.memo_pages;
begin
  if not exists(select 1 from public.oneul_staff where user_id=p_actor_id) then
    raise insufficient_privilege using message='Operator required';
  end if;
  select * into app from public.oneul_applications where id=p_application_id for share;
  if not found then raise no_data_found using message='Application not found'; end if;
  if app.status<>'confirmed' or app.payment_status<>'paid' or app.expires_at<=now() then
    raise exception 'Confirmed paid application required';
  end if;
  select * into item from oneul_private.memo_pages where application_id=app.id;
  if not found then return jsonb_build_object('issued',false,'applicationId',app.id); end if;
  if item.event_date<>app.event_date or item.start_time<>app.start_time or item.gender<>app.gender then
    raise serialization_failure using message='Memo event changed';
  end if;
  -- The QR lifetime only controls participant access. Operator review follows
  -- the existing application retention; it never renews a QR or browser session.
  insert into public.oneul_application_audit(application_id,actor_id,action)
    values(app.id,p_actor_id,'memo_admin_viewed');
  return jsonb_build_object('issued',true,'applicationId',app.id,
    'page',jsonb_build_object('id',item.id,'eventDate',item.event_date,'startTime',item.start_time,
      'gender',item.gender,'participantNumber',item.participant_number,'opponentCount',item.opponent_count,'expiresAt',item.expires_at),
    'entries',coalesce((select jsonb_agg(jsonb_build_object('opponentNumber',e.opponent_number,
      'text',e.body,'hearts',e.hearts,'updatedAt',e.updated_at) order by e.opponent_number)
      from oneul_private.memo_entries e where e.page_id=item.id and e.opponent_number<=item.opponent_count),'[]'::jsonb));
end; $$;
create function public.oneul_memo_admin_read(p_application_id uuid,p_actor_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select oneul_private.memo_admin_read(p_application_id,p_actor_id);
$$;
revoke all on function oneul_private.memo_admin_read(uuid,uuid),public.oneul_memo_admin_read(uuid,uuid) from public,anon,authenticated;
grant execute on function oneul_private.memo_admin_read(uuid,uuid),public.oneul_memo_admin_read(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
