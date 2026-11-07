-- 원샷 v2 ⑥: 이번 주 목표. PRD 7-7, D-084·D-085·D-113·D-114.
-- 새 표 하나(weekly_goals). 기존 표·열은 건드리지 않는다.
-- 이번 주 목표 = 한 주(월~일) 동안 분야마다 쓰려는 시간. 사용자·주마다 한 행, items에 분야별 분(1시간 단위)을 담는다.
-- 이번 주 목표가 없어도 앱을 쓰는 데 막히지 않는다(행이 없으면 목표가 없는 주). 목표를 세운 주는 검증에서 집중 기간으로 따로 나눠 본다(G7을 Q1로 좁힘).

create table public.weekly_goals (
  user_id uuid not null default auth.uid()
    constraint weekly_goals_user_id_fkey references auth.users (id) on delete restrict,

  -- 그 주의 월요일(앱이 서버 시계로 두노 하루 기준 월요일을 정한다)
  week_start date not null,

  -- 분야별 목표: [{ "categoryId": uuid, "minutes": 분 }]. 같은 분야는 한 번만(앱이 검사한다). 기타는 두지 않는다(임시).
  items jsonb not null,

  created_at timestamptz not null default now(),

  constraint weekly_goals_pkey primary key (user_id, week_start),
  constraint weekly_goals_monday check (extract(isodow from week_start) = 1),
  constraint weekly_goals_items_shape check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 50)
);

comment on table public.weekly_goals is '이번 주 목표(PRD 7-7). 사용자·주마다 한 행. 사용자는 자기 행만(RLS). items는 [{categoryId, minutes}].';

revoke all on table public.weekly_goals from public;
revoke all on table public.weekly_goals from anon;
revoke all on table public.weekly_goals from authenticated;

grant select, delete on table public.weekly_goals to authenticated;
grant insert (user_id, week_start, items) on table public.weekly_goals to authenticated;
-- 키 열(user_id, week_start)도 update 권한에 넣는다: 앱의 upsert가 보낸 열을 모두 DO UPDATE SET에 싣는데 권한 없는 열이 있으면 42501로 막히기 때문이다.
-- user_id는 update 정책 with check((select auth.uid()) = user_id)가 자기 것으로 고정하고, week_start는 월요일 check(weekly_goals_monday)가 지킨다.
grant update (user_id, week_start, items) on table public.weekly_goals to authenticated;

alter table public.weekly_goals enable row level security;

create policy weekly_goals_select_own on public.weekly_goals
  for select to authenticated using ((select auth.uid()) = user_id);
create policy weekly_goals_insert_own on public.weekly_goals
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy weekly_goals_update_own on public.weekly_goals
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy weekly_goals_delete_own on public.weekly_goals
  for delete to authenticated using ((select auth.uid()) = user_id);
