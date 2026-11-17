-- 되돌림: 20261117100000_goal_bundles.sql(마이그레이션 12번)이 더한 것을 거꾸로 되돌린다.
--
-- **먼저 dump하라.** 돌리면 goal_bundles(지난 목표 기록)가 모두 사라지고 되살릴 수 없다. user_settings의 새 칸 네 개와
-- categories.color_order 값도 사라진다(백업이 유일한 복구). 판 기록을 남기려면 돌리기 전에
--   pg_dump --data-only --table=public.goal_bundles 로 받아 둔다.
-- 앱을 먼저 되돌린다(앱이 save_goal_bundle·새 칸을 쓴다). 이 폴더는 supabase/migrations/ 밖이라 `supabase db push`가 올리지 않는다. 손으로만 돌린다.
-- 이력 표는 고치지 않는다: 돌린 뒤 `supabase migration repair --status reverted 20261117100000`.
-- 여러 번 돌려도 오류가 나지 않는다(if exists). 순서: 함수 → 트리거 → 표 → 새 칸 → 도우미.
-- 이 SQL은 어느 DB에도 돌리지 않았다.

drop function if exists public.save_goal_bundle(uuid, integer, text, boolean, text, smallint, jsonb, boolean, boolean);
drop function if exists public.set_restart_requested(boolean);

drop trigger if exists categories_assign_color_order on public.categories;
drop function if exists private.categories_assign_color_order();

-- 표(정책·인덱스·권한·제약 포함). check 제약이 도우미 함수를 쓰므로 표를 먼저 지운다.
drop table if exists public.goal_bundles;

drop function if exists private.goal_bundle_ratios_sum(jsonb);
drop function if exists private.doono_day(timestamptz);

alter table public.categories drop constraint if exists categories_color_order_range;
alter table public.categories drop column if exists color_order;

alter table public.user_settings drop constraint if exists user_settings_bundle_op_ids_size;
alter table public.user_settings drop constraint if exists user_settings_bundle_revision_range;
alter table public.user_settings drop column if exists bundle_op_ids;
alter table public.user_settings drop column if exists bundle_revision;
alter table public.user_settings drop column if exists restart_requested_at;
alter table public.user_settings drop column if exists bundle_started_at;
