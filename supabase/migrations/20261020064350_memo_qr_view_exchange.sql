begin;
create function oneul_private.memo_exchange_qr(p_qr_hash text,p_session_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare canonical text;
begin
 select m.qr_hash into canonical from oneul_private.memo_qr_retrievals r join oneul_private.memo_pages m on m.id=r.page_id
 where r.token_hash=p_qr_hash and r.canonical_qr_hash=m.qr_hash;
 return oneul_private.memo_exchange(coalesce(canonical,p_qr_hash),p_session_hash);
end; $$;
create function public.oneul_memo_exchange_qr(p_qr_hash text,p_session_hash text) returns jsonb
language sql security invoker set search_path='' as $$ select oneul_private.memo_exchange_qr(p_qr_hash,p_session_hash); $$;
revoke all on function oneul_private.memo_exchange_qr(text,text),public.oneul_memo_exchange_qr(text,text) from public,anon,authenticated;
grant execute on function oneul_private.memo_exchange_qr(text,text),public.oneul_memo_exchange_qr(text,text) to service_role;
notify pgrst,'reload schema';
commit;
