-- 되돌림: 20261107110000_ratio_other.sql(마이그레이션 10번)이 더한 것을 거꾸로 되돌린다.
--
-- 언제 쓰나: 마이그레이션 10번을 되돌릴 때만 쓴다. 다른 때는 돌리지 않는다.
-- 이 폴더(supabase/rollback/)는 supabase/migrations/ 밖이라 `supabase db push`가 올리지 않는다. 손으로만 돌린다.
--
-- 돌리면: user_settings.ratio_other_percent 열의 값(처음 정한 비율의 기타 몫)이 모두 사라진다. 되살릴 수 없다.
-- 먼저 할 것: 그 열을 쓰는 코드를 먼저 뺀다. (앱은 열이 없으면 기타 몫 없음으로 읽는다. 하지만 기타를 쓰는 저장은
--   열이 없으면 실패한다.)
--
-- 이력 표: 이 SQL은 이력 표(supabase_migrations.schema_migrations)를 고치지 않는다. 손으로 돌린 뒤에는
--   `supabase migration repair --status reverted 20261107110000`으로 이력도 맞춘다. repair는 이력 표만 고치고 SQL은 돌리지 않는다.
--
-- 여러 번 돌려도 오류가 나지 않는다(if exists). 되돌리는 순서: 권한 회수 → check 제약 → 열.

-- 1) 그 열의 insert·update 권한 회수. 열이 이미 없으면 revoke가 오류가 나므로 열이 있을 때만 한다.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_settings'
      and column_name = 'ratio_other_percent'
  ) then
    revoke insert (ratio_other_percent) on table public.user_settings from authenticated;
    revoke update (ratio_other_percent) on table public.user_settings from authenticated;
  end if;
end
$$;

-- 2) check 제약 지우기
alter table if exists public.user_settings
  drop constraint if exists user_settings_ratio_other_range;

-- 3) 열 지우기(열의 comment도 함께 사라진다)
alter table if exists public.user_settings
  drop column if exists ratio_other_percent;
