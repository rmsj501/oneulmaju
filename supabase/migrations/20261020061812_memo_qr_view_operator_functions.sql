begin;
create function oneul_private.memo_qr_info(p_application_id uuid,p_actor_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item oneul_private.memo_pages;
begin
 item:=oneul_private.memo_qr_page(p_application_id,p_actor_id);
 return oneul_private.memo_admin(p_application_id,p_actor_id)||jsonb_build_object('applicationId',p_application_id,'qrHash',item.qr_hash);
end; $$;

create function oneul_private.memo_qr_register(p_application_id uuid,p_actor_id uuid,p_qr_hash text,p_expected_qr_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item oneul_private.memo_pages;
begin
 item:=oneul_private.memo_qr_page(p_application_id,p_actor_id);
 if p_qr_hash is null or p_expected_qr_hash is null or p_qr_hash !~ '^[a-f0-9]{64}$' or p_expected_qr_hash !~ '^[a-f0-9]{64}$' then raise invalid_authorization_specification using message='Invalid memo QR'; end if;
 if item.qr_hash<>p_expected_qr_hash then raise sqlstate 'PT409' using message='Memo QR changed'; end if;
 insert into oneul_private.memo_qr_retrievals(token_hash,page_id,canonical_qr_hash)
 values(p_qr_hash,item.id,item.qr_hash) on conflict(token_hash) do nothing;
 if not exists(select 1 from oneul_private.memo_qr_retrievals where token_hash=p_qr_hash and page_id=item.id and canonical_qr_hash=item.qr_hash) then raise sqlstate 'PT409' using message='Memo QR changed'; end if;
 return oneul_private.memo_admin(p_application_id,p_actor_id)||jsonb_build_object('retrieved',true,'applicationId',p_application_id);
end; $$;

create function public.oneul_memo_qr_info(p_application_id uuid,p_actor_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select oneul_private.memo_qr_info(p_application_id,p_actor_id); $$;
create function public.oneul_memo_qr_register(p_application_id uuid,p_actor_id uuid,p_qr_hash text,p_expected_qr_hash text) returns jsonb
language sql security invoker set search_path='' as $$ select oneul_private.memo_qr_register(p_application_id,p_actor_id,p_qr_hash,p_expected_qr_hash); $$;
revoke all on function oneul_private.memo_qr_page(uuid,uuid),oneul_private.memo_qr_info(uuid,uuid),oneul_private.memo_qr_register(uuid,uuid,text,text),public.oneul_memo_qr_info(uuid,uuid),public.oneul_memo_qr_register(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function oneul_private.memo_qr_page(uuid,uuid),oneul_private.memo_qr_info(uuid,uuid),oneul_private.memo_qr_register(uuid,uuid,text,text),public.oneul_memo_qr_info(uuid,uuid),public.oneul_memo_qr_register(uuid,uuid,text,text) to service_role;

notify pgrst,'reload schema';
commit;
