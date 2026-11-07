-- 원샷 v2 ④: 타이머와 먼저 한 기록. PRD 7-6, 8절(D-092, D-110).
-- 새 표 하나(focus_sessions). 기존 표·열은 건드리지 않는다.
-- 타이머를 시작하는 순간 한 행이 생긴다(5분 하고 끝내도, 건넨 할 일이 아닌 할 일로 켜도 남는다 = 「먼저 한 기록」).
-- 행마다 그 분야가 두 기준(이번 주 목표·처음 정한 비율)에서 반대편이었는지를 함께 남긴다(D-110). 끝낼 때 끝난 시각과 진행한 시간(초)만 고친다.

create table public.focus_sessions (
  -- 화면이 만든 uuid(같은 시작을 다시 보내도 새 행을 만들지 않으려고)
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null default auth.uid()
    constraint focus_sessions_user_id_fkey references auth.users (id) on delete restrict,

  -- 서버 시계(기록 위조 막기). 기기 시계는 따로 남긴다.
  started_at timestamptz not null default now(),
  client_started_at timestamptz null,

  -- 시작한 두노 하루(앱이 서버 시계로 새벽 4시 기준으로 정한다)
  day date not null,

  -- 정한 길이(분). 이번 판 30분.
  planned_minutes smallint not null default 30,

  -- 끝낸 시각(서버 시계)과 진행한 시간(초). 끝내기 전에는 null. 정한 길이를 넘기지 않는다(앱이 자른다).
  ended_at timestamptz null,
  elapsed_seconds integer null,

  -- 무엇으로 켰나. 할 일을 지워도 기록은 남기려고 할 일은 번호만 둔다(외래 키 없음). 분야 null은 기타.
  todo_id uuid null,
  category_id uuid null,

  -- 건넨 것(제시 기록, ⑤)으로 켰으면 그 번호. null이면 건넨 것이 아니다.
  offer_id uuid null,

  -- 어디서 켰나: card = 「오늘 먼저 할 일」 카드의 「30분 시작」, timer_tab = 타이머 탭에서 앱이 추천한 것, manual = 직접 고른 것
  surface text not null,

  -- 두 기준에서 반대편이었나(D-110). 이번 주 목표가 없는 주는 goal이 null.
  opposite_by_goal boolean null,
  opposite_by_ratio boolean null,

  constraint focus_sessions_planned_range check (planned_minutes between 1 and 240),
  constraint focus_sessions_elapsed_range check (elapsed_seconds is null or elapsed_seconds between 0 and 14400),
  constraint focus_sessions_surface_values check (surface in ('card', 'timer_tab', 'manual')),
  -- 분야는 같은 사용자의 것만(categories의 (id, user_id) 고유 제약). category_id가 null이면 검사하지 않는다.
  constraint focus_sessions_category_owner_fkey foreign key (category_id, user_id)
    references public.categories (id, user_id) on delete restrict
);

comment on table public.focus_sessions is '타이머 한 번(PRD 7-6). 시작할 때 한 행 = 먼저 한 기록. 사용자는 자기 행만(RLS). 끝낼 때 ended_at·elapsed_seconds만 고친다.';

create index focus_sessions_user_day_idx on public.focus_sessions (user_id, day, started_at);

revoke all on table public.focus_sessions from public;
revoke all on table public.focus_sessions from anon;
revoke all on table public.focus_sessions from authenticated;

grant select on table public.focus_sessions to authenticated;
-- started_at은 기본값(서버 시계)만 쓴다: 넣는 열에 없다. delete는 주지 않는다.
grant insert (id, user_id, client_started_at, day, planned_minutes, todo_id, category_id, offer_id, surface, opposite_by_goal, opposite_by_ratio)
  on table public.focus_sessions to authenticated;
grant update (ended_at, elapsed_seconds) on table public.focus_sessions to authenticated;

alter table public.focus_sessions enable row level security;

create policy focus_sessions_select_own on public.focus_sessions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy focus_sessions_insert_own on public.focus_sessions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy focus_sessions_update_own on public.focus_sessions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- 한 사용자 행 수 상한. 임시, 결정 필요: 50000.
create function private.focus_sessions_enforce_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  session_limit constant integer := 50000; -- 임시, 결정 필요
  existing integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('focus_sessions:' || new.user_id::text, 0));
  select pg_catalog.count(*) into existing from public.focus_sessions s where s.user_id = new.user_id;
  if existing >= session_limit then
    raise exception 'focus session limit reached' using errcode = 'P0001', hint = 'focus_sessions_limit';
  end if;
  return new;
end;
$$;

revoke all on function private.focus_sessions_enforce_limit() from public;
revoke all on function private.focus_sessions_enforce_limit() from anon;
revoke all on function private.focus_sessions_enforce_limit() from authenticated;

create trigger focus_sessions_enforce_limit
  before insert on public.focus_sessions
  for each row execute function private.focus_sessions_enforce_limit();
