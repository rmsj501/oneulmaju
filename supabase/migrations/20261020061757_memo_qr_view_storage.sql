begin;
-- A stable server-derived access QR can be displayed again without replacing
-- the original QR or revoking any participant's current browser session.
-- Only digests are stored; each retrieval is bound to the current original QR.
create table oneul_private.memo_qr_retrievals (
 token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
 page_id uuid not null references oneul_private.memo_pages(id) on delete cascade,
 canonical_qr_hash text not null check(canonical_qr_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now()
);
create index memo_qr_retrievals_page_idx on oneul_private.memo_qr_retrievals(page_id);
alter table oneul_private.memo_qr_retrievals enable row level security;
revoke all on oneul_private.memo_qr_retrievals from public,anon,authenticated;
grant all on oneul_private.memo_qr_retrievals to service_role;

create function oneul_private.memo_qr_page(p_application_id uuid,p_actor_id uuid) returns oneul_private.memo_pages
language plpgsql security invoker set search_path='' as $$
declare app public.oneul_applications; item oneul_private.memo_pages;
begin
 if not exists(select 1 from public.oneul_staff where user_id=p_actor_id) then raise insufficient_privilege using message='Operator required'; end if;
 select * into app from public.oneul_applications where id=p_application_id for share;
 if not found or app.status<>'confirmed' or app.payment_status<>'paid' or app.expires_at<=now() then raise invalid_authorization_specification using message='Memo QR unavailable'; end if;
 select * into item from oneul_private.memo_pages where application_id=app.id for share;
 if not found then raise no_data_found using message='Memo QR not issued'; end if;
 if item.expires_at<=now() then raise invalid_authorization_specification using message='Memo QR unavailable'; end if;
 if item.event_date<>app.event_date or item.start_time<>app.start_time or item.gender<>app.gender then raise sqlstate 'PT409' using message='Memo event changed'; end if;
 return item;
end; $$;

revoke all on function oneul_private.memo_qr_page(uuid,uuid) from public,anon,authenticated;
grant execute on function oneul_private.memo_qr_page(uuid,uuid) to service_role;
commit;
