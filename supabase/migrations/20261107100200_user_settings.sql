-- 원샷 v2 ①: 처음 설정(목표 글·처음 정한 비율·알림 설정). PRD 7-1, 7-8.
-- 새 표 둘(user_settings, category_ratios). 기존 표·열은 건드리지 않는다.
-- user_settings: 사용자당 한 행. 목표 글은 할 일 글과 같은 키로 암호화한 값만 들어온다(AAD 용도 goal_text).
-- category_ratios: 분야마다 「시간을 몇 %씩 쓰고 싶은지」 처음 정한 값(흐릿한 출발점, 나중에 고칠 수 있다). 기타는 두지 않는다(임시).

create table public.user_settings (
  user_id uuid primary key default auth.uid()
    constraint user_settings_user_id_fkey references auth.users (id) on delete restrict,

  -- 처음 설정에서 적은 목표 한 문장(암호문). 비어 있을 수 있다.
  goal_encrypted text null,

  -- 처음 설정을 마친 시각(서버 시계). null이면 아직 안 마침 → 앱이 처음 설정을 보여 준다.
  onboarding_done_at timestamptz null,

  -- 알림 설정. 시각은 자정부터의 분(0~1439), 서울 시각 기준. 기본: 저녁 19:30, 아침 10:00. 허락하기 전에는 꺼 둔다.
  notify_evening_enabled boolean not null default false,
  notify_evening_minute smallint not null default 1170,
  notify_morning_enabled boolean not null default false,
  notify_morning_minute smallint not null default 600,

  created_at timestamptz not null default now(),

  constraint user_settings_goal_format check (
    goal_encrypted is null
    or goal_encrypted ~ '^v[1-9][0-9]{0,2}:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{22}$'
  ),
  constraint user_settings_goal_length check (goal_encrypted is null or char_length(goal_encrypted) <= 1024),
  constraint user_settings_notify_evening_range check (notify_evening_minute between 0 and 1439),
  constraint user_settings_notify_morning_range check (notify_morning_minute between 0 and 1439)
);

comment on table public.user_settings is '사용자 설정(처음 설정·알림). 사용자는 자기 행만(RLS). goal_encrypted는 v<n>:<iv>:<ct>:<tag> 암호문.';

create table public.category_ratios (
  user_id uuid not null default auth.uid()
    constraint category_ratios_user_id_fkey references auth.users (id) on delete restrict,
  category_id uuid not null,
  -- 처음 정한 비율(%). 합이 100이 아니어도 된다(앱이 비율로 맞춰 읽는다, 임시).
  percent smallint not null,
  created_at timestamptz not null default now(),

  constraint category_ratios_pkey primary key (user_id, category_id),
  constraint category_ratios_percent_range check (percent between 0 and 100),
  -- 같은 사용자의 분야만 가리킬 수 있다(categories의 (id, user_id) 고유 제약)
  constraint category_ratios_category_owner_fkey foreign key (category_id, user_id)
    references public.categories (id, user_id) on delete restrict
);

comment on table public.category_ratios is '분야별 처음 정한 비율(%). 사용자는 자기 행만(RLS).';

revoke all on table public.user_settings from public;
revoke all on table public.user_settings from anon;
revoke all on table public.user_settings from authenticated;
revoke all on table public.category_ratios from public;
revoke all on table public.category_ratios from anon;
revoke all on table public.category_ratios from authenticated;

grant select on table public.user_settings to authenticated;
grant insert (user_id, goal_encrypted, onboarding_done_at, notify_evening_enabled, notify_evening_minute, notify_morning_enabled, notify_morning_minute)
  on table public.user_settings to authenticated;
grant update (goal_encrypted, onboarding_done_at, notify_evening_enabled, notify_evening_minute, notify_morning_enabled, notify_morning_minute)
  on table public.user_settings to authenticated;

grant select, delete on table public.category_ratios to authenticated;
grant insert (user_id, category_id, percent) on table public.category_ratios to authenticated;
grant update (percent) on table public.category_ratios to authenticated;

alter table public.user_settings enable row level security;
alter table public.category_ratios enable row level security;

create policy user_settings_select_own on public.user_settings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy user_settings_insert_own on public.user_settings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy user_settings_update_own on public.user_settings
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy category_ratios_select_own on public.category_ratios
  for select to authenticated using ((select auth.uid()) = user_id);
create policy category_ratios_insert_own on public.category_ratios
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy category_ratios_update_own on public.category_ratios
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy category_ratios_delete_own on public.category_ratios
  for delete to authenticated using ((select auth.uid()) = user_id);
