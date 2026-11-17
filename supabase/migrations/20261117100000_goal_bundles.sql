-- MO-46 목표 묶음 1단계: 지난 목표 기록(goal_bundles) + 저장 함수 save_goal_bundle + 분야 색 칸.
-- 더하기만 한다: 새 표 하나, 새 칸 넷(user_settings 4, categories 1), 새 함수·트리거, 새 grant.
-- 기존 행을 바꾸는 것은 아래 「분야 색 칸 채우기」 하나뿐이다. 기존 마이그레이션 파일은 건드리지 않는다.
-- **어느 DB에도 아직 적용하지 않았다.** 적용 순서: 이 파일 먼저, 앱 다음. 되돌림: supabase/rollback/20261117100000_goal_bundles.down.sql
-- 앞 파일에 기대는 것: categories(20261106003000), user_settings·category_ratios(20261107100200), ratio_other_percent(20261107110000),
--   category_ratio_history(20261109150000, 없어도 함수는 돈다 — 기록만 건너뛴다), private 스키마(20261104160723).
--
-- 규칙(PM 11-17 승인 + 23 명세 6절):
--  - goal_bundles는 「지난 묶음」만 쌓는다(지금 묶음 행은 없다). 쓰기는 save_goal_bundle 함수만 한다(grant 없음).
--  - 같은 두노 하루(서울 새벽 4시 경계, 서버 시계)에 여러 번 고치면 지난 묶음은 그날 처음 고치기 직전의 것 하나다.
--  - 분야 이름 바꾸기·보관·되살리기는 이 함수로만 한다. categories에 update grant를 열지 않는다.
--  - 충돌 검사: user_settings.bundle_revision(저장마다 1씩 오름). 같은 op id 재전송은 충돌 검사보다 먼저 보고 그대로 성공(멱등).
--  - category_ratio_history는 계속 쓴다(같은 트랜잭션 안, 실패해도 저장 전체는 성공 — 표시만).
--  - 다시 시작 뒤에도 todos·evening_logs·weekly_goals 행은 건드리지 않는다.

-- ---------------------------------------------------------------------------
-- 1. 새 칸
-- ---------------------------------------------------------------------------
-- 지금 묶음이 시작한 때. 옛 사용자는 null(채우지 않는다: null이면 onboarding_done_at을 시작으로 본다).
alter table public.user_settings add column bundle_started_at timestamptz null;
-- 다시 시작을 눌렀는지(1단계 표시). 표시는 지금 표를 바꾸지 않는다.
alter table public.user_settings add column restart_requested_at timestamptz null;
-- 저장마다 1씩 오르는 충돌 검사용 고침 번호
alter table public.user_settings add column bundle_revision integer not null default 0;
alter table public.user_settings add constraint user_settings_bundle_revision_range check (bundle_revision >= 0);
-- 멱등용: 최근에 반영한 op id(최대 20개)
alter table public.user_settings add column bundle_op_ids uuid[] not null default '{}';
alter table public.user_settings add constraint user_settings_bundle_op_ids_size check (cardinality(bundle_op_ids) <= 20);
-- 이 네 칸은 insert·update grant에 넣지 않는다(함수만 쓴다). select는 표 단위 grant로 이미 읽힌다.

-- 분야 색 순서: 보관한 분야까지 포함한 만든 순서(0부터). 색 번호는 앱의 categoryColorNumber(color_order).
alter table public.categories add column color_order smallint null;
alter table public.categories add constraint categories_color_order_range check (color_order is null or color_order >= 0);

-- 기존 행 채우기(이 파일이 기존 행을 바꾸는 유일한 곳): user_id별 created_at, id 순서 row_number - 1.
update public.categories c
set color_order = r.n
from (
  select id, (row_number() over (partition by user_id order by created_at, id) - 1)::smallint as n
  from public.categories
) r
where c.id = r.id and c.color_order is null;

comment on column public.categories.color_order is
  '분야 색 순서(보관 포함 만든 순서, 0부터). 앱이 categoryColorNumber로 색 번호를 만든다. 새 행은 트리거가 정한다(앱은 못 넣는다).';

-- 새 분야의 color_order = 그 사용자 분야 수(보관 포함). 상한 트리거와 같은 사용자 단위 잠금 안에서 센다(같은 트랜잭션 안에서 다시 잡는 잠금은 겹쳐도 된다).
create function private.categories_assign_color_order()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  existing integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('categories:' || new.user_id::text, 0)
  );
  select pg_catalog.count(*) into existing from public.categories c where c.user_id = new.user_id;
  new.color_order := existing; -- 보낸 값은 무시한다(insert grant에도 없다)
  return new;
end;
$$;

revoke all on function private.categories_assign_color_order() from public;
revoke all on function private.categories_assign_color_order() from anon;
revoke all on function private.categories_assign_color_order() from authenticated;

create trigger categories_assign_color_order
  before insert on public.categories
  for each row execute function private.categories_assign_color_order();

-- ---------------------------------------------------------------------------
-- 2. 도우미 함수(private 스키마, Data API에 노출되지 않는다. 호출은 아래 definer 함수만)
-- ---------------------------------------------------------------------------
-- 두노 하루: 서울 새벽 4시 경계(lib/todos/day.ts와 같은 규칙)
create function private.doono_day(p_at timestamptz)
returns date
language sql
immutable
set search_path = ''
as $$
  select ((p_at at time zone 'Asia/Seoul') - interval '4 hours')::date
$$;

-- 판 행의 ratios 합(배열이 아니면 -1)
create function private.goal_bundle_ratios_sum(p_ratios jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when pg_catalog.jsonb_typeof(p_ratios) = 'array'
      then (select coalesce(sum((e ->> 'percent')::integer), 0)::integer from pg_catalog.jsonb_array_elements(p_ratios) e)
    else -1
  end
$$;

revoke all on function private.doono_day(timestamptz) from public;
revoke all on function private.doono_day(timestamptz) from anon;
revoke all on function private.doono_day(timestamptz) from authenticated;
revoke all on function private.goal_bundle_ratios_sum(jsonb) from public;
revoke all on function private.goal_bundle_ratios_sum(jsonb) from anon;
revoke all on function private.goal_bundle_ratios_sum(jsonb) from authenticated;

-- ---------------------------------------------------------------------------
-- 3. 지난 묶음 표(goal_bundles). 한 행 = 지난 묶음 하나.
-- ---------------------------------------------------------------------------
create table public.goal_bundles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    constraint goal_bundles_user_id_fkey references auth.users (id) on delete restrict,
  -- 그 묶음이 시작한 때
  started_at timestamptz not null,
  -- 남긴 때(서버 시계)
  ended_at timestamptz not null,
  reason text not null,
  -- 그때의 목표 글 암호문(AAD goal_text 그대로)
  goal_encrypted text null,
  -- 그때의 쓰는 분야: [{category_id, name_encrypted}]
  categories jsonb not null,
  -- 그때의 비율: [{category_id 또는 null(기타), percent}], 합 100
  ratios jsonb not null,
  created_at timestamptz not null default now(),

  constraint goal_bundles_reason_check check (reason in ('edit', 'restart')),
  constraint goal_bundles_period_check check (ended_at >= started_at),
  constraint goal_bundles_goal_format check (
    goal_encrypted is null
    or goal_encrypted ~ '^v[1-9][0-9]{0,2}:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{22}$'
  ),
  constraint goal_bundles_goal_length check (goal_encrypted is null or char_length(goal_encrypted) <= 1024),
  constraint goal_bundles_categories_shape check (
    jsonb_typeof(categories) = 'array' and jsonb_array_length(categories) <= 50 and octet_length(categories::text) <= 32768
  ),
  constraint goal_bundles_ratios_shape check (
    jsonb_typeof(ratios) = 'array' and jsonb_array_length(ratios) <= 51 and octet_length(ratios::text) <= 8192
  ),
  constraint goal_bundles_ratios_sum check (private.goal_bundle_ratios_sum(ratios) = 100)
);

comment on table public.goal_bundles is
  '지난 목표 묶음(쌓기만). 사용자는 자기 행만 읽는다(RLS). 쓰기는 save_goal_bundle 함수만. 지금 묶음은 user_settings·categories·category_ratios에 있다.';

create index goal_bundles_user_ended_idx on public.goal_bundles (user_id, ended_at);

revoke all on table public.goal_bundles from public;
revoke all on table public.goal_bundles from anon;
revoke all on table public.goal_bundles from authenticated;
-- select만. insert·update·delete grant는 없다(위조·삭제 불가).
grant select on table public.goal_bundles to authenticated;

alter table public.goal_bundles enable row level security;

create policy goal_bundles_select_own on public.goal_bundles
  for select to authenticated
  using ((select auth.uid()) = user_id);
-- insert·update·delete 정책은 두지 않는다.

-- ---------------------------------------------------------------------------
-- 4. 다시 시작 표시·취소: 표시는 지금 표를 바꾸지 않는다
-- ---------------------------------------------------------------------------
create function public.set_restart_requested(p_requested boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if auth.uid() is null or v_uid is null then
    raise exception 'not authenticated' using errcode = '28000', hint = 'unauthenticated';
  end if;
  if p_requested is null then
    raise exception 'invalid input' using errcode = '22023', hint = 'bundle_invalid';
  end if;

  insert into public.user_settings (user_id, restart_requested_at)
  values (v_uid, case when p_requested then pg_catalog.now() else null end)
  on conflict (user_id) do update set restart_requested_at = excluded.restart_requested_at;
end;
$$;

revoke all on function public.set_restart_requested(boolean) from public;
revoke all on function public.set_restart_requested(boolean) from anon;
grant execute on function public.set_restart_requested(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. 저장 함수 save_goal_bundle (한 트랜잭션)
--  p_op_id: 보낼 줄 op id(같은 op 재전송은 그대로 성공). 옛 op는 null.
--  p_expected_revision: 기대 고침 번호(옛 op는 p_legacy=true로 검사를 건너뛴다)
--  p_reason: 'edit' | 'restart'
--  p_set_goal / p_goal_encrypted: false면 목표 글을 그대로 둔다
--  p_other: 기타 몫(%). p_items가 null이면 분야·비율·기타를 그대로 둔다.
--  p_items: [{id, new?: bool, name_encrypted?: text, percent: 0~100, archived?: bool}] (최대 50칸, 16KB — 임시, 결정 필요)
--    new=true면 새 분야(name_encrypted 필요), 아니면 내 분야여야 한다(없으면 bundle_not_found).
--    archived가 없으면 보관 상태를 그대로, true면 보관(그 분야의 저장된 비율 몫은 기타로 감), false면 되살림.
--    restart면 넘긴 목록에 없는 쓰는 분야는 보관한다(몫 이동 없음).
--  반환: {revision, past: written|same_day|none|limit|invalid, history: written|unchanged|skipped|none, idempotent}
--    past가 limit이면 지난 묶음 남기기만 건너뛰고 저장은 성공(사용자당 1000행 — 임시, 결정 필요).
-- 오류(예외, hint): unauthenticated(28000) · bundle_invalid(22023) · bundle_conflict(P0001) · bundle_not_found(P0002)
-- ---------------------------------------------------------------------------
create function public.save_goal_bundle(
  p_op_id uuid,
  p_expected_revision integer,
  p_reason text,
  p_set_goal boolean,
  p_goal_encrypted text,
  p_other smallint,
  p_items jsonb,
  p_complete_onboarding boolean default false,
  p_legacy boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_cipher_re constant text := '^v[1-9][0-9]{0,2}:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{22}$';
  c_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  c_past_limit constant integer := 1000;  -- 임시, 결정 필요: 사용자당 지난 묶음 행 수
  c_items_max constant integer := 50;     -- 임시, 결정 필요: 분야 목록 칸 수
  c_items_bytes constant integer := 16384; -- 임시, 결정 필요: 입력 jsonb 크기
  v_uid uuid := auth.uid();
  s public.user_settings%rowtype;
  v_now timestamptz := pg_catalog.now();
  v_completing boolean := false;
  v_ref timestamptz;
  v_past text := 'none';
  v_hist text := 'none';
  v_count integer;
  v_snap_cats jsonb;
  v_snap_ratios jsonb;
  v_item jsonb;
  v_id uuid;
  v_new boolean;
  v_name text;
  v_pct integer;
  v_arch jsonb;
  v_cat public.categories%rowtype;
  v_active boolean;
  v_ids uuid[] := '{}';
  v_pcts integer[] := '{}';
  v_seen uuid[] := '{}';
  v_moved integer := 0;
  v_old integer;
  v_other integer := 0;
  v_total integer;
  v_hist_ratios jsonb;
  v_last jsonb;
begin
  if auth.uid() is null or v_uid is null then
    raise exception 'not authenticated' using errcode = '28000', hint = 'unauthenticated';
  end if;

  -- 입력 검사
  if p_reason is null or p_reason not in ('edit', 'restart')
     or p_set_goal is null or p_complete_onboarding is null or p_legacy is null
     or (p_expected_revision is null and not p_legacy)
     or p_expected_revision < 0
     or (p_other is not null and (p_other < 0 or p_other > 100)) then
    raise exception 'invalid input' using errcode = '22023', hint = 'bundle_invalid';
  end if;
  if p_set_goal and p_goal_encrypted is not null
     and (p_goal_encrypted !~ c_cipher_re or pg_catalog.char_length(p_goal_encrypted) > 1024) then
    raise exception 'invalid goal' using errcode = '22023', hint = 'bundle_invalid';
  end if;
  if p_items is not null then
    if pg_catalog.jsonb_typeof(p_items) <> 'array'
       or pg_catalog.jsonb_array_length(p_items) > c_items_max
       or pg_catalog.octet_length(p_items::text) > c_items_bytes then
      raise exception 'invalid items' using errcode = '22023', hint = 'bundle_invalid';
    end if;
  end if;

  -- 내 설정 행을 잠근다(같은 사용자의 동시 저장을 줄 세운다)
  insert into public.user_settings (user_id) values (v_uid) on conflict (user_id) do nothing;
  select * into s from public.user_settings u where u.user_id = v_uid for update;

  -- 같은 op 재전송: 충돌 검사보다 먼저 본다(이미 반영된 줄이 거절되지 않게)
  if p_op_id is not null and p_op_id = any (s.bundle_op_ids) then
    return pg_catalog.jsonb_build_object('revision', s.bundle_revision, 'past', 'none', 'history', 'none', 'idempotent', true);
  end if;

  -- 충돌 검사: 아무것도 바꾸기 전에
  if not p_legacy and p_expected_revision <> s.bundle_revision then
    raise exception 'bundle conflict' using errcode = 'P0001', hint = 'bundle_conflict';
  end if;

  -- 처음 설정을 처음 마칠 때
  if p_complete_onboarding and s.onboarding_done_at is null then
    update public.user_settings u set onboarding_done_at = v_now where u.user_id = v_uid;
    s.onboarding_done_at := v_now;
    v_completing := true;
  end if;

  -- 지난 묶음 남기기(바꾸기 전 지금 묶음). 같은 두노 하루면 남기지 않는다.
  v_ref := coalesce(s.bundle_started_at, s.onboarding_done_at);
  if v_ref is not null and not v_completing then
    if private.doono_day(v_ref) = private.doono_day(v_now) then
      v_past := 'same_day';
    else
      select pg_catalog.count(*) into v_count from public.goal_bundles g where g.user_id = v_uid;
      if v_count >= c_past_limit then
        v_past := 'limit'; -- 저장은 성공, 남기기만 건너뜀. 오래된 행을 밀어내지 않는다
      else
        select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('category_id', c.id, 'name_encrypted', c.name_encrypted) order by c.created_at, c.id), '[]'::jsonb)
          into v_snap_cats
          from public.categories c where c.user_id = v_uid and c.archived_at is null;
        select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('category_id', r.category_id, 'percent', r.percent) order by r.category_id), '[]'::jsonb)
          into v_snap_ratios
          from public.category_ratios r
          join public.categories c on c.id = r.category_id and c.user_id = r.user_id and c.archived_at is null
          where r.user_id = v_uid;
        if s.ratio_other_percent is not null and s.ratio_other_percent > 0 then
          v_snap_ratios := v_snap_ratios || pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('category_id', null::uuid, 'percent', s.ratio_other_percent));
        end if;
        if private.goal_bundle_ratios_sum(v_snap_ratios) <> 100 then
          v_past := 'invalid'; -- 옛 데이터(합이 100이 아님): 판 행 규칙을 못 지켜 남기지 않는다
        else
          insert into public.goal_bundles (user_id, started_at, ended_at, reason, goal_encrypted, categories, ratios)
          values (v_uid, least(v_ref, v_now), v_now, p_reason, s.goal_encrypted, v_snap_cats, v_snap_ratios);
          v_past := 'written';
        end if;
      end if;
    end if;
  end if;

  -- 지금 표 반영: 분야·비율·기타
  if p_items is not null then
    for v_item in select e.value from pg_catalog.jsonb_array_elements(p_items) e loop
      -- null에 안전한 검사: 키가 없으면 jsonb_typeof가 null이라 일반 비교는 null(if를 건너뜀)이 된다.
      -- is distinct from·coalesce로 빠진 키(id·percent)를 모두 거절한다. 있어도 되는 키(new·archived·name_encrypted)는 있으면 타입을 본다.
      if pg_catalog.jsonb_typeof(v_item) is distinct from 'object'
         or pg_catalog.jsonb_typeof(v_item -> 'id') is distinct from 'string'
         or coalesce((v_item ->> 'id') !~ c_uuid_re, true)
         or pg_catalog.jsonb_typeof(v_item -> 'percent') is distinct from 'number'
         or coalesce((v_item ->> 'percent') !~ '^[0-9]{1,3}$', true)
         or (v_item ? 'new' and pg_catalog.jsonb_typeof(v_item -> 'new') <> all (array['boolean', 'null']))
         or (v_item ? 'archived' and pg_catalog.jsonb_typeof(v_item -> 'archived') <> all (array['boolean', 'null']))
         or (v_item ? 'name_encrypted' and pg_catalog.jsonb_typeof(v_item -> 'name_encrypted') <> all (array['string', 'null'])) then
        raise exception 'invalid item' using errcode = '22023', hint = 'bundle_invalid';
      end if;
      v_id := (v_item ->> 'id')::uuid;
      v_pct := (v_item ->> 'percent')::integer;
      v_new := coalesce((v_item -> 'new') = 'true'::jsonb, false);
      v_name := v_item ->> 'name_encrypted';
      v_arch := case when pg_catalog.jsonb_typeof(v_item -> 'archived') = 'boolean' then v_item -> 'archived' else null end;
      if v_pct > 100 or v_id = any (v_seen)
         or (v_name is not null and (v_name !~ c_cipher_re or pg_catalog.char_length(v_name) > 512)) then
        raise exception 'invalid item' using errcode = '22023', hint = 'bundle_invalid';
      end if;
      v_seen := v_seen || v_id;

      -- 내 분야만 본다(user_id = auth.uid()). 남의 분야 id는 「없음」과 같게 보인다.
      select * into v_cat from public.categories c where c.id = v_id and c.user_id = v_uid for update;
      if not found then
        if not v_new then
          raise exception 'category not found' using errcode = 'P0002', hint = 'bundle_not_found';
        end if;
        if v_name is null or v_arch = 'true'::jsonb then
          raise exception 'invalid item' using errcode = '22023', hint = 'bundle_invalid';
        end if;
        -- 남의 행과 id가 겹치면 기본 키 위반(23505)으로 거절된다. 남의 행은 바뀌지 않는다.
        insert into public.categories (id, user_id, name_encrypted) values (v_id, v_uid, v_name);
        v_active := true;
      else
        if v_name is not null and v_name <> v_cat.name_encrypted then
          update public.categories c set name_encrypted = v_name where c.id = v_id and c.user_id = v_uid;
        end if;
        if v_arch = 'true'::jsonb and v_cat.archived_at is null then
          select r.percent into v_old from public.category_ratios r where r.user_id = v_uid and r.category_id = v_id;
          v_moved := v_moved + coalesce(v_old, 0);
          update public.categories c set archived_at = v_now where c.id = v_id and c.user_id = v_uid;
          v_active := false;
        elsif v_arch = 'false'::jsonb and v_cat.archived_at is not null then
          update public.categories c set archived_at = null where c.id = v_id and c.user_id = v_uid;
          v_active := true;
        else
          v_active := (v_cat.archived_at is null);
        end if;
      end if;

      if v_active then
        v_ids := v_ids || v_id;
        v_pcts := v_pcts || v_pct;
      end if;
    end loop;

    -- 다시 시작: 넘긴 묶음에 없는 쓰는 분야는 보관(몫은 새 비율에 이미 들어 있어 옮기지 않는다)
    if p_reason = 'restart' then
      update public.categories c set archived_at = v_now
      where c.user_id = v_uid and c.archived_at is null and c.id <> all (v_seen);
    end if;

    -- 비율 통째 바꾸기
    delete from public.category_ratios r where r.user_id = v_uid and r.category_id <> all (v_ids);
    insert into public.category_ratios (user_id, category_id, percent)
    select v_uid, x.id, x.p from unnest(v_ids, v_pcts) as x (id, p)
    on conflict (user_id, category_id) do update set percent = excluded.percent;

    -- 기타: 받은 몫 + 보관한 분야의 저장된 몫
    v_other := coalesce(p_other, 0) + v_moved;
    select coalesce(sum(x.p), 0)::integer + v_other into v_total from unnest(v_ids, v_pcts) as x (id, p);
    if not p_legacy and v_total <> 100 then
      raise exception 'ratios must sum to 100' using errcode = '22023', hint = 'bundle_invalid';
    end if;
    if v_other > 100 then v_other := 100; end if; -- 옛 op만 여기까지 온다
  end if;

  -- 목표 비율이 바뀐 기록(category_ratio_history): 같은 트랜잭션, 실패해도 저장은 성공(표시만)
  if p_items is not null and v_total = 100 and pg_catalog.cardinality(v_ids) + (case when v_other > 0 then 1 else 0 end) between 1 and 50 then
    begin
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('category_id', x.id, 'percent', x.p) order by x.id), '[]'::jsonb)
        into v_hist_ratios from unnest(v_ids, v_pcts) as x (id, p);
      if v_other > 0 then
        v_hist_ratios := v_hist_ratios || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('category_id', null::uuid, 'percent', v_other));
      end if;
      select h.ratios into v_last from public.category_ratio_history h
        where h.user_id = v_uid order by h.recorded_at desc, h.id desc limit 1;
      if found and v_last = v_hist_ratios then
        v_hist := 'unchanged';
      else
        insert into public.category_ratio_history (user_id, ratios) values (v_uid, v_hist_ratios);
        v_hist := 'written';
      end if;
    exception when others then
      v_hist := 'skipped'; -- 표 없음·상한 등. 저장 전체는 실패시키지 않는다
    end;
  end if;

  -- 설정 행 갱신
  update public.user_settings u set
    goal_encrypted = case when p_set_goal then p_goal_encrypted else u.goal_encrypted end,
    ratio_other_percent = case when p_items is not null then (case when v_other > 0 then v_other::smallint else null end) else u.ratio_other_percent end,
    bundle_started_at = case when v_completing or v_past in ('written', 'limit', 'invalid') then v_now else u.bundle_started_at end,
    restart_requested_at = case when p_reason = 'restart' then null else u.restart_requested_at end,
    bundle_revision = u.bundle_revision + 1,
    bundle_op_ids = case
      when p_op_id is null then u.bundle_op_ids
      else (pg_catalog.array_append(u.bundle_op_ids, p_op_id))[
        greatest(pg_catalog.cardinality(u.bundle_op_ids) - 18, 1) : pg_catalog.cardinality(u.bundle_op_ids) + 1]
    end
  where u.user_id = v_uid;

  return pg_catalog.jsonb_build_object('revision', s.bundle_revision + 1, 'past', v_past, 'history', v_hist, 'idempotent', false);
end;
$$;

-- execute는 PUBLIC에서 온다. 스키마 revoke로는 안 빠지므로 함수마다 public·anon을 거두고 authenticated에만 준다.
revoke all on function public.save_goal_bundle(uuid, integer, text, boolean, text, smallint, jsonb, boolean, boolean) from public;
revoke all on function public.save_goal_bundle(uuid, integer, text, boolean, text, smallint, jsonb, boolean, boolean) from anon;
grant execute on function public.save_goal_bundle(uuid, integer, text, boolean, text, smallint, jsonb, boolean, boolean) to authenticated;
