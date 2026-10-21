begin;

-- Private, server-controlled policy. Missing settings fail closed to phone-only.
create table oneul_private.auth_policy (
  singleton boolean primary key default true check (singleton),
  phone_required boolean not null default true
);
alter table oneul_private.auth_policy enable row level security;
revoke all on oneul_private.auth_policy from public, anon, authenticated;
-- Email-only testing is explicitly enabled; production must restore true.
insert into oneul_private.auth_policy(singleton,phone_required) values(true,false);
alter table public.oneul_profiles add column phone_verified boolean not null default false;

create or replace function oneul_private.verified_user() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from auth.users u where u.id = (select auth.uid()) and (
      (u.phone_confirmed_at is not null and coalesce(u.phone,'') <> '') or
      (not coalesce((select p.phone_required from oneul_private.auth_policy p where p.singleton),true)
       and u.email_confirmed_at is not null and coalesce(u.email,'') <> '')
    )
  );
$$;
revoke all on function oneul_private.verified_user() from public, anon;
grant execute on function oneul_private.verified_user() to authenticated;

create or replace function oneul_private.normalize_profile() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare actual_phone text; actual_email text; phone_ok boolean; attachment text; slot text;
begin
  if new.user_id is distinct from (select auth.uid()) or not oneul_private.verified_user() then
    raise exception 'Verified profile owner is required';
  end if;
  select u.phone, u.email, u.phone_confirmed_at is not null and coalesce(u.phone,'') <> ''
    into actual_phone, actual_email, phone_ok from auth.users u where u.id = (select auth.uid());
  if phone_ok then
    new.phone := '+' || ltrim(actual_phone,'+');
  else
    -- An entered contact is not Auth phone verification, regardless of input flags.
    new.phone := regexp_replace(coalesce(new.phone,''),'[^0-9+]','','g');
    if new.phone ~ '^01[016789][0-9]{7,8}$' then new.phone := '+82' || substr(new.phone,2); end if;
    if new.phone ~ '^82' then new.phone := '+' || new.phone; end if;
    if new.phone !~ '^\+821[016789][0-9]{7,8}$' then raise exception 'Valid contact phone is required'; end if;
  end if;
  new.phone_verified := phone_ok;
  foreach slot in array array['face','fullbody','employment'] loop
    attachment := case slot when 'face' then new.face_path when 'fullbody' then new.fullbody_path else new.employment_path end;
    if attachment is not null then
      if split_part(attachment,'/',1) <> new.user_id::text or split_part(attachment,'/',2) <> slot or
         not exists (select 1 from storage.objects o where o.bucket_id = 'oneul-verification' and o.name = attachment) then
        raise exception 'Owned attachment is required';
      end if;
    end if;
  end loop;
  new.kind := case when coalesce(actual_email,'') = '' then 'guest' else 'member' end;
  new.updated_at := now();
  new.expires_at := now() + interval '1 year';
  if tg_op = 'UPDATE' then new.created_at := old.created_at; end if;
  return new;
end;
$$;
revoke all on function oneul_private.normalize_profile() from public, anon, authenticated;
commit;
