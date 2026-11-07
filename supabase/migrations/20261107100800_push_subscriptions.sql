-- 원샷 v2 ⑦: 알림 둘(저녁 기록 알림·아침 알림)의 푸시 구독. PRD 7-8, 기획서 9절(푸시 구독 표도 RLS).
-- 새 표 하나(push_subscriptions). 기존 표·열은 건드리지 않는다. 사용자는 자기 구독만 읽고 쓴다.
-- 알림을 실제로 보내는 일(예약 실행, 푸시 서명 키)은 앱 밖 설정이 필요해 이 파일 밖에 있다(docs/oneshot-v2/임시값.md ⑦ 참고).

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null default auth.uid()
    constraint push_subscriptions_user_id_fkey references auth.users (id) on delete restrict,

  -- 브라우저가 알려 주는 푸시 주소와 키(구독 한 번마다 하나). 같은 사용자가 같은 주소를 두 번 넣을 수 없다.
  endpoint text not null,
  p256dh text not null,
  auth text not null,

  created_at timestamptz not null default now(),

  constraint push_subscriptions_endpoint_https check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  constraint push_subscriptions_keys_length check (char_length(p256dh) between 1 and 200 and char_length(auth) between 1 and 100),
  constraint push_subscriptions_unique_endpoint unique (user_id, endpoint)
);

comment on table public.push_subscriptions is '웹 푸시 구독(PRD 7-8). 사용자는 자기 행만(RLS). endpoint·p256dh·auth는 브라우저가 준 값.';

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

revoke all on table public.push_subscriptions from public;
revoke all on table public.push_subscriptions from anon;
revoke all on table public.push_subscriptions from authenticated;

grant select, delete on table public.push_subscriptions to authenticated;
grant insert (id, user_id, endpoint, p256dh, auth) on table public.push_subscriptions to authenticated;

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 한 사용자 구독 개수 상한. 임시, 결정 필요: 20(기기·브라우저마다 하나).
create function private.push_subscriptions_enforce_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  sub_limit constant integer := 20; -- 임시, 결정 필요
  existing integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('push_subscriptions:' || new.user_id::text, 0));
  select pg_catalog.count(*) into existing from public.push_subscriptions s where s.user_id = new.user_id;
  if existing >= sub_limit then
    raise exception 'push subscription limit reached' using errcode = 'P0001', hint = 'push_subscriptions_limit';
  end if;
  return new;
end;
$$;

revoke all on function private.push_subscriptions_enforce_limit() from public;
revoke all on function private.push_subscriptions_enforce_limit() from anon;
revoke all on function private.push_subscriptions_enforce_limit() from authenticated;

create trigger push_subscriptions_enforce_limit
  before insert on public.push_subscriptions
  for each row execute function private.push_subscriptions_enforce_limit();
