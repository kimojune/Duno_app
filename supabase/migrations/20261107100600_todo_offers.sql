-- 원샷 v2 ⑤: 할 일 제시(오늘 먼저 할 일 건네기) 기록. PRD 7-5, 8절(22 4-1: 먼저 하기 비율의 분모).
-- 새 표 하나(todo_offers). 기존 표·열은 건드리지 않는다. 쌓기만 한다(제시를 고쳐 쓰지도 지우지도 않는다). 넘김은 dismissed_at 한 칸만 고친다(AI 공통 원칙 4: 반응을 기록).
-- 제시한 횟수(Q4, 임시): 같은 날·같은 자리·같은 분야·같은 할 일은 한 번만 센다(offer_key 고유). 화면을 다시 열어도 같은 제시는 늘지 않고, 건네는 분야나 할 일이 바뀌면 새 제시다.

create table public.todo_offers (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null default auth.uid()
    constraint todo_offers_user_id_fkey references auth.users (id) on delete restrict,

  -- 제시한 두노 하루(앱이 서버 시계로 새벽 4시 기준으로 정한다)
  day date not null,

  -- 어느 자리에서: card = 「오늘 먼저 할 일」 카드, timer_tab = 타이머 탭의 추천(22 2-9)
  surface text not null,

  -- 건넨 분야(같은 사용자의 것만. null은 기타지만 기타는 건네지 않으므로 보통 값이 있다)와 건넨 할 일(없으면 분야만 건넨 것). 할 일은 번호만 둔다(외래 키 없음).
  category_id uuid null,
  todo_id uuid null,

  -- 같은 제시 판별 열쇠: surface|분야|할 일. (user_id, day, offer_key)가 고유.
  offer_key text not null,

  offered_at timestamptz not null default now(),
  -- 사용자가 「넘기기」를 누른 시각(서버 시계). null이면 넘기지 않았다.
  dismissed_at timestamptz null,

  constraint todo_offers_surface_values check (surface in ('card', 'timer_tab')),
  constraint todo_offers_key_length check (char_length(offer_key) <= 128),
  constraint todo_offers_unique_per_day unique (user_id, day, offer_key),
  constraint todo_offers_category_owner_fkey foreign key (category_id, user_id)
    references public.categories (id, user_id) on delete restrict
);

comment on table public.todo_offers is '할 일 제시 기록(PRD 8절). 먼저 하기 비율의 분모. 사용자는 자기 행만(RLS). 같은 날·자리·분야·할 일은 한 번만(offer_key).';

create index todo_offers_user_day_idx on public.todo_offers (user_id, day, offered_at);

revoke all on table public.todo_offers from public;
revoke all on table public.todo_offers from anon;
revoke all on table public.todo_offers from authenticated;

grant select on table public.todo_offers to authenticated;
-- offered_at은 기본값(서버 시계)만 쓴다. delete는 주지 않는다. 고칠 수 있는 것은 넘긴 시각 하나뿐이다.
grant insert (id, user_id, day, surface, category_id, todo_id, offer_key) on table public.todo_offers to authenticated;
grant update (dismissed_at) on table public.todo_offers to authenticated;

alter table public.todo_offers enable row level security;

create policy todo_offers_select_own on public.todo_offers
  for select to authenticated using ((select auth.uid()) = user_id);
create policy todo_offers_insert_own on public.todo_offers
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy todo_offers_update_own on public.todo_offers
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- 한 사용자 행 수 상한. 임시, 결정 필요: 50000.
create function private.todo_offers_enforce_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  offer_limit constant integer := 50000; -- 임시, 결정 필요
  existing integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('todo_offers:' || new.user_id::text, 0));
  select pg_catalog.count(*) into existing from public.todo_offers o where o.user_id = new.user_id;
  if existing >= offer_limit then
    raise exception 'todo offer limit reached' using errcode = 'P0001', hint = 'todo_offers_limit';
  end if;
  return new;
end;
$$;

revoke all on function private.todo_offers_enforce_limit() from public;
revoke all on function private.todo_offers_enforce_limit() from anon;
revoke all on function private.todo_offers_enforce_limit() from authenticated;

create trigger todo_offers_enforce_limit
  before insert on public.todo_offers
  for each row execute function private.todo_offers_enforce_limit();
