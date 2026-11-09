-- 되돌림: 20261109150000_category_ratio_history.sql(마이그레이션 11번)이 더한 것을 거꾸로 되돌린다.
--
-- 언제 쓰나: 마이그레이션 11번을 되돌릴 때만 쓴다. 다른 때는 돌리지 않는다.
-- 이 폴더(supabase/rollback/)는 supabase/migrations/ 밖이라 `supabase db push`가 올리지 않는다. 손으로만 돌린다.
--
-- 돌리면: category_ratio_history 표와 그 안의 기록(목표 비율이 바뀐 기록)이 모두 사라진다. 되살릴 수 없다.
-- 코드를 먼저 뺄 필요는 없다: 앱은 표가 없으면 기록 쓰기만 실패하고 비율 저장은 성공으로 돌려준다(lib/settings/ratio-history.ts).
--
-- 이력 표: 이 SQL은 이력 표(supabase_migrations.schema_migrations)를 고치지 않는다. 손으로 돌린 뒤에는
--   `supabase migration repair --status reverted 20261109150000`으로 이력도 맞춘다. repair는 이력 표만 고치고 SQL은 돌리지 않는다.
--
-- 여러 번 돌려도 오류가 나지 않는다(if exists). 표를 지우면 정책 둘·인덱스·권한·제약·comment도 함께 사라진다
-- (정책을 따로 지우지 않는다: 표가 이미 없으면 drop policy가 오류를 낼 수 있다).

drop table if exists public.category_ratio_history;
