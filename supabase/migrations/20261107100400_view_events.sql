-- 원샷 v2 ③: 화면 본 것(입구별) 기록. PRD 4절, 7-4, 8절(G8).
-- 새 표 하나(view_events). 기존 표·열은 건드리지 않는다. 쌓기만 한다(고쳐 쓰지도 지우지도 않는다).
-- 「봤다」의 뜻(임시): 화면이 실제로 그려진 때(서버 읽기 건수가 아니다, 22 4-2). 앱이 그린 뒤 한 번 남긴다.
-- 입구(entry, 임시): after_save = 저녁 기록 저장 직후의 한 줄을 눌러 열었다, self = 그 밖에 스스로 열었다(탭 등).

create table public.view_events (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null default auth.uid()
    constraint view_events_user_id_fkey references auth.users (id) on delete restrict,

  screen text not null,
  entry text not null,

  -- 본 두노 하루(앱이 서버 시계로 새벽 4시 기준으로 정한다)
  day date not null,
  viewed_at timestamptz not null default now(),

  constraint view_events_screen_values check (screen in ('growth', 'category')),
  constraint view_events_entry_values check (entry in ('after_save', 'self'))
);

comment on table public.view_events is '화면 본 것(PRD 8절). 사용자는 자기 행만(RLS). screen: growth=상태보기, category=분야 페이지. entry: after_save/self.';

create index view_events_user_day_idx on public.view_events (user_id, day, viewed_at);

revoke all on table public.view_events from public;
revoke all on table public.view_events from anon;
revoke all on table public.view_events from authenticated;

grant select on table public.view_events to authenticated;
-- viewed_at은 기본값(서버 시계)만 쓴다. update·delete는 주지 않는다.
grant insert (id, user_id, screen, entry, day) on table public.view_events to authenticated;

alter table public.view_events enable row level security;

create policy view_events_select_own on public.view_events
  for select to authenticated using ((select auth.uid()) = user_id);
create policy view_events_insert_own on public.view_events
  for insert to authenticated with check ((select auth.uid()) = user_id);

-- 한 사용자 행 수 상한. 임시, 결정 필요: 100000.
create function private.view_events_enforce_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  event_limit constant integer := 100000; -- 임시, 결정 필요
  existing integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('view_events:' || new.user_id::text, 0));
  select pg_catalog.count(*) into existing from public.view_events v where v.user_id = new.user_id;
  if existing >= event_limit then
    raise exception 'view event limit reached' using errcode = 'P0001', hint = 'view_events_limit';
  end if;
  return new;
end;
$$;

revoke all on function private.view_events_enforce_limit() from public;
revoke all on function private.view_events_enforce_limit() from anon;
revoke all on function private.view_events_enforce_limit() from authenticated;

create trigger view_events_enforce_limit
  before insert on public.view_events
  for each row execute function private.view_events_enforce_limit();
