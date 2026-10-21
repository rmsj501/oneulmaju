begin;
create schema if not exists oneul_private;
revoke all on schema oneul_private from public, anon;
grant usage on schema oneul_private to authenticated;

create table public.oneul_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  kind text not null check (kind in ('member','guest')),
  name text not null check (char_length(btrim(name)) between 1 and 30),
  phone text not null,
  gender text not null check (gender in ('여성','남성')),
  birth date not null,
  height numeric not null check (height between 120 and 230),
  weight numeric check (weight between 25 and 250),
  district text,
  face_path text,
  fullbody_path text,
  employment_path text,
  photo_consent_at timestamptz,
  employment_consent_at timestamptz,
  region text not null check (region in ('서울','경기','인천','그 외 지역')),
  mbti text check (mbti is null or mbti = '잘 모르겠어요' or mbti ~ '^[EI][SN][TF][JP]$'),
  job text not null check (char_length(btrim(job)) between 1 and 60),
  religion text,
  smoking text,
  drinking text,
  privacy_consent_at timestamptz not null,
  sensitive_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 year'),
  check (religion is null or sensitive_consent_at is not null),
  check ((face_path is null and fullbody_path is null) or photo_consent_at is not null),
  check (employment_path is null or employment_consent_at is not null),
  check ((region = '서울' and district in ('강남구','강동구','강북구','강서구','관악구','광진구','구로구','금천구','노원구','도봉구','동대문구','동작구','마포구','서대문구','서초구','성동구','성북구','송파구','양천구','영등포구','용산구','은평구','종로구','중구','중랑구') and district is not null) or (region <> '서울' and district is null))
);

create function oneul_private.verified_user() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from auth.users u where u.id = (select auth.uid()) and u.phone_confirmed_at is not null and coalesce(u.phone,'') <> ''); $$;
revoke all on function oneul_private.verified_user() from public, anon;
grant execute on function oneul_private.verified_user() to authenticated;

create function oneul_private.normalize_profile() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare actual_phone text; actual_email text; attachment text; slot text;
begin
  select u.phone, u.email into actual_phone, actual_email from auth.users u where u.id = new.user_id and u.phone_confirmed_at is not null;
  if actual_phone is null or actual_phone = '' then raise exception 'Verified phone is required'; end if;
  foreach slot in array array['face','fullbody','employment'] loop
    attachment := case slot when 'face' then new.face_path when 'fullbody' then new.fullbody_path else new.employment_path end;
    if attachment is not null then
      if split_part(attachment,'/',1) <> new.user_id::text or split_part(attachment,'/',2) <> slot or
         not exists (select 1 from storage.objects o where o.bucket_id = 'oneul-verification' and o.name = attachment) then
        raise exception 'Owned attachment is required';
      end if;
    end if;
  end loop;
  new.phone := '+' || ltrim(actual_phone, '+');
  new.kind := case when coalesce(actual_email,'') = '' then 'guest' else 'member' end;
  new.updated_at := now();
  new.expires_at := now() + interval '1 year';
  if tg_op = 'UPDATE' then new.created_at := old.created_at; end if;
  return new;
end;
$$;
revoke all on function oneul_private.normalize_profile() from public, anon, authenticated;
create trigger normalize_oneul_profile before insert or update on public.oneul_profiles for each row execute function oneul_private.normalize_profile();

alter table public.oneul_profiles enable row level security;
revoke all on public.oneul_profiles from public, anon;
grant select, insert, update, delete on public.oneul_profiles to authenticated;
create policy owner_read on public.oneul_profiles for select to authenticated using ((select auth.uid()) = user_id and (select oneul_private.verified_user()) and expires_at > now());
create policy owner_insert on public.oneul_profiles for insert to authenticated with check ((select auth.uid()) = user_id and (select oneul_private.verified_user()));
create policy owner_update on public.oneul_profiles for update to authenticated using ((select auth.uid()) = user_id and (select oneul_private.verified_user()) and expires_at > now()) with check ((select auth.uid()) = user_id and (select oneul_private.verified_user()));
create policy owner_delete on public.oneul_profiles for delete to authenticated using ((select auth.uid()) = user_id and (select oneul_private.verified_user()));
create index oneul_profiles_expiry_idx on public.oneul_profiles(expires_at);


-- Private bucket. File bytes are removed through the Storage API, never by SQL.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('oneul-verification','oneul-verification',false,8388608,array['image/jpeg','image/png','image/webp','application/pdf']);
create policy oneul_file_insert on storage.objects for insert to authenticated
with check (bucket_id = 'oneul-verification' and (storage.foldername(name))[1] = (select auth.uid())::text and
  (storage.foldername(name))[2] in ('face','fullbody','employment') and (select oneul_private.verified_user()) and
  (name ~ '/[0-9a-f-]{36}\.(jpg|png|webp)$' or ((storage.foldername(name))[2] = 'employment' and name ~ '/[0-9a-f-]{36}\.pdf$')));
create policy oneul_file_read on storage.objects for select to authenticated
using (bucket_id = 'oneul-verification' and (storage.foldername(name))[1] = (select auth.uid())::text and (select oneul_private.verified_user()));
create policy oneul_file_delete on storage.objects for delete to authenticated
using (bucket_id = 'oneul-verification' and (storage.foldername(name))[1] = (select auth.uid())::text and (select oneul_private.verified_user()));

-- Retry removed/replaced files and remove abandoned uploads after 24 hours.
create table public.oneul_file_cleanup (path text primary key, queued_at timestamptz not null default now());
alter table public.oneul_file_cleanup enable row level security;
revoke all on public.oneul_file_cleanup from public,anon,authenticated;
grant select,insert,delete on public.oneul_file_cleanup to service_role;
create function oneul_private.queue_removed_files() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p text;
begin
  foreach p in array array[old.face_path,old.fullbody_path,old.employment_path] loop
    if p is not null and (tg_op = 'DELETE' or not (p = any(array[coalesce(new.face_path,''),coalesce(new.fullbody_path,''),coalesce(new.employment_path,'')]))) then
      insert into public.oneul_file_cleanup(path) values(p) on conflict do nothing;
    end if;
  end loop;
  return null;
end; $$;
revoke all on function oneul_private.queue_removed_files() from public,anon,authenticated;
create trigger queue_oneul_files after update or delete on public.oneul_profiles for each row execute function oneul_private.queue_removed_files();
create function public.oneul_enqueue_expired() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.oneul_profiles where expires_at <= now();
  insert into public.oneul_file_cleanup(path)
  select o.name from storage.objects o where o.bucket_id = 'oneul-verification' and o.created_at < now() - interval '24 hours'
  and not exists (select 1 from public.oneul_profiles p where o.name in (p.face_path,p.fullbody_path,p.employment_path))
  on conflict do nothing;
end; $$;
revoke all on function public.oneul_enqueue_expired() from public,anon,authenticated;
grant execute on function public.oneul_enqueue_expired() to service_role;
-- Enable pg_cron/pg_net and invoke purge-verification daily using project secrets in Vault.
-- Do not enable PROFILE_STORAGE_ENABLED/FILE_STORAGE_ENABLED before this job is verified.
commit;
