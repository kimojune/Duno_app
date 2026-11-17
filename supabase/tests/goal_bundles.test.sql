-- pgTAP: 지난 목표 기록(goal_bundles)과 save_goal_bundle (마이그레이션 20261117100000_goal_bundles.sql).
-- **미실행**: 이 컴퓨터에 Docker·psql이 없어 돌려 보지 못했다. 어떤 원격 DB(duno-dev 포함)에도 돌리지 않는다.
-- 적용 뒤 창구가 로컬 또는 개발 전용 DB에서 `supabase test db`로 돌린다. begin … rollback으로 감싸 아무것도 남기지 않는다.
-- 층 둘: 구조(policies_are·table_privs_are·function_privs_are) + 행동(사용자 흉내 + 양성 대조).
-- 흉내: set local role authenticated + request.jwt.claims. 흉내 직후 가드(current_user·auth.uid()).

begin;
select no_plan();

-- 고정 값 ------------------------------------------------------------------
-- 사용자 A·B·C, 분야 id, 암호문 모양 값(형식만 맞는다)
create temp table const (k text primary key, v text);
grant all on const to public;
insert into const values
  ('A', '00000000-0000-4000-8000-00000000000a'),
  ('B', '00000000-0000-4000-8000-00000000000b'),
  ('C', '00000000-0000-4000-8000-00000000000c'),
  ('D', '00000000-0000-4000-8000-00000000000d'),
  ('D1', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1'),
  ('A1', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  ('A2', 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2'),
  ('A3', 'a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3'),
  ('N1', 'v1:AAAAAAAAAAAAAAAA:bmFtZTE:AAAAAAAAAAAAAAAAAAAAAA'),
  ('N2', 'v1:BBBBBBBBBBBBBBBB:bmFtZTI:BBBBBBBBBBBBBBBBBBBBBB'),
  ('N3', 'v1:CCCCCCCCCCCCCCCC:bmFtZTM:CCCCCCCCCCCCCCCCCCCCCC'),
  ('G1', 'v1:DDDDDDDDDDDDDDDD:Z29hbDE:DDDDDDDDDDDDDDDDDDDDDD'),
  ('G2', 'v1:EEEEEEEEEEEEEEEE:Z29hbDI:EEEEEEEEEEEEEEEEEEEEEE'),
  ('OP1', '11111111-1111-4111-8111-111111111111'),
  ('OP2', '22222222-2222-4222-8222-222222222222'),
  ('OP3', '33333333-3333-4333-8333-333333333333'),
  ('OP4', '44444444-4444-4444-8444-444444444444'),
  ('OP5', '55555555-5555-4555-8555-555555555555'),
  ('OP6', '66666666-6666-4666-8666-666666666666');

-- 구조 -----------------------------------------------------------------------
select has_table('public', 'goal_bundles', 'goal_bundles 표가 있다');
select ok((select relrowsecurity from pg_class where oid = 'public.goal_bundles'::regclass), 'goal_bundles는 RLS가 켜져 있다');
select policies_are('public', 'goal_bundles', array['goal_bundles_select_own'], 'goal_bundles 정책은 select 하나뿐');
select table_privs_are('public', 'goal_bundles', 'anon', array[]::text[], 'anon은 goal_bundles 권한이 없다');
select table_privs_are('public', 'goal_bundles', 'authenticated', array['SELECT'], 'authenticated는 goal_bundles select만');
select ok(not has_any_column_privilege('authenticated', 'public.categories', 'UPDATE'), 'categories는 update 권한(열 단위 포함)이 없다');
select ok(not has_table_privilege('authenticated', 'public.categories', 'DELETE'), 'categories는 delete 권한이 없다');
select function_privs_are('public', 'save_goal_bundle', array['uuid', 'integer', 'text', 'boolean', 'text', 'smallint', 'jsonb', 'boolean', 'boolean'], 'authenticated', array['EXECUTE'], 'save_goal_bundle execute는 authenticated');
select function_privs_are('public', 'save_goal_bundle', array['uuid', 'integer', 'text', 'boolean', 'text', 'smallint', 'jsonb', 'boolean', 'boolean'], 'anon', array[]::text[], 'save_goal_bundle execute는 anon에 없다');
select ok(not has_function_privilege('public', 'public.save_goal_bundle(uuid,integer,text,boolean,text,smallint,jsonb,boolean,boolean)', 'EXECUTE'), 'save_goal_bundle execute는 PUBLIC에서 거뒀다');
select function_privs_are('public', 'set_restart_requested', array['boolean'], 'anon', array[]::text[], 'set_restart_requested execute는 anon에 없다');
select function_privs_are('public', 'set_restart_requested', array['boolean'], 'authenticated', array['EXECUTE'], 'set_restart_requested execute는 authenticated');
select is((select prosecdef from pg_proc where oid = 'public.save_goal_bundle(uuid,integer,text,boolean,text,smallint,jsonb,boolean,boolean)'::regprocedure), true, 'save_goal_bundle은 security definer');
select ok((select proconfig::text from pg_proc where oid = 'public.save_goal_bundle(uuid,integer,text,boolean,text,smallint,jsonb,boolean,boolean)'::regprocedure) like '%search_path=""%', 'save_goal_bundle search_path는 빈 값');

-- 자료 심기(postgres 권한) -------------------------------------------------------
insert into auth.users (id, aud, role, email) values
  ((select v::uuid from const where k = 'D'), 'authenticated', 'authenticated', 'd@example.test'),
  ((select v::uuid from const where k = 'A'), 'authenticated', 'authenticated', 'a@example.test'),
  ((select v::uuid from const where k = 'B'), 'authenticated', 'authenticated', 'b@example.test'),
  ((select v::uuid from const where k = 'C'), 'authenticated', 'authenticated', 'c@example.test');

-- A: 분야 둘(60/40), 사흘 전에 처음 설정을 마침, 할 일·저녁 기록·이번 주 목표 한 줄씩
insert into public.categories (id, user_id, name_encrypted) values
  ((select v::uuid from const where k = 'A1'), (select v::uuid from const where k = 'A'), (select v from const where k = 'N1')),
  ((select v::uuid from const where k = 'A2'), (select v::uuid from const where k = 'A'), (select v from const where k = 'N2'));
insert into public.user_settings (user_id, goal_encrypted, onboarding_done_at)
  values ((select v::uuid from const where k = 'A'), (select v from const where k = 'G1'), now() - interval '3 days');
insert into public.category_ratios (user_id, category_id, percent) values
  ((select v::uuid from const where k = 'A'), (select v::uuid from const where k = 'A1'), 60),
  ((select v::uuid from const where k = 'A'), (select v::uuid from const where k = 'A2'), 40);
insert into public.todos (user_id, day, text_encrypted) values ((select v::uuid from const where k = 'A'), '2026-11-10', (select v from const where k = 'G1'));
insert into public.evening_logs (user_id, target_day, total_minutes, save_mode) values ((select v::uuid from const where k = 'A'), '2026-11-10', 60, 'edited');
insert into public.weekly_goals (user_id, week_start, items) values ((select v::uuid from const where k = 'A'), '2026-11-09', '[{"categoryId":"x","minutes":60}]');

select is((select color_order from public.categories where id = (select v::uuid from const where k = 'A1')), 0::smallint, '새 분야의 color_order는 그 사용자 분야 수(첫째 0)');
select is((select color_order from public.categories where id = (select v::uuid from const where k = 'A2')), 1::smallint, '둘째는 1');

-- 양성 대조용 A의 지난 묶음 한 줄(함수가 아니라 postgres가 직접)
insert into public.goal_bundles (user_id, started_at, ended_at, reason, goal_encrypted, categories, ratios)
values ((select v::uuid from const where k = 'A'), now() - interval '10 days', now() - interval '9 days', 'edit', (select v from const where k = 'G1'),
  '[]'::jsonb, '[{"category_id":null,"percent":100}]'::jsonb);

-- 행동 1: B가 A 판을 못 읽고, A는 자기 판이 읽힌다(양성 대조) ----------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from const where k = 'A'), 'role', 'authenticated')::text, true);
select is(current_user::text, 'authenticated', '흉내 가드: A로 흉내 중 — current_user');
select is(auth.uid(), (select v::uuid from const where k = 'A'), '흉내 가드: auth.uid()가 A');
select is((select count(*)::int from public.goal_bundles), 1, '양성 대조: A는 자기 지난 묶음이 읽힌다');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from const where k = 'B'), 'role', 'authenticated')::text, true);
select is(current_user::text, 'authenticated', '흉내 가드: B로 흉내 중 — current_user');
select is(auth.uid(), (select v::uuid from const where k = 'B'), '흉내 가드: auth.uid()가 B');
select is((select count(*)::int from public.goal_bundles), 0, 'B는 A의 지난 묶음을 못 읽는다');

-- 행동 2: B가 함수로 A의 분야 id를 넣어도 A 행이 안 바뀐다 -------------------------------
select throws_ok(
  format($q$ select public.save_goal_bundle(null, 0, 'edit', false, null, 0::smallint,
    '[{"id":"%s","name_encrypted":"%s","percent":100,"archived":true}]'::jsonb) $q$,
    (select v from const where k = 'A1'), (select v from const where k = 'N3')),
  'P0002', null, 'B가 A의 분야 id를 넣으면 bundle_not_found로 거절');
select throws_ok(
  format($q$ select public.save_goal_bundle(null, 0, 'edit', false, null, 0::smallint,
    '[{"id":"%s","new":true,"name_encrypted":"%s","percent":100}]'::jsonb) $q$,
    (select v from const where k = 'A1'), (select v from const where k = 'N3')),
  '23505', null, 'B가 A의 분야 id로 새 분야를 만들려 해도 기본 키 위반으로 거절');
-- anon(로그인 없음)은 함수를 못 부른다
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok($q$ select public.save_goal_bundle(null, 0, 'edit', false, null, 0::smallint, null) $q$, '42501', null, 'anon은 save_goal_bundle execute 권한이 없다(42501)');
reset role;
select is((select name_encrypted from public.categories where id = (select v::uuid from const where k = 'A1')), (select v from const where k = 'N1'), 'A의 분야 이름은 그대로');
select is((select archived_at is null from public.categories where id = (select v::uuid from const where k = 'A1')), true, 'A의 분야는 보관되지 않았다');
select is((select bundle_revision from public.user_settings where user_id = (select v::uuid from const where k = 'A')), 0, 'A의 고침 번호는 그대로');

-- 직접 쓰기 위조(grant 없음) -------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from const where k = 'A'), 'role', 'authenticated')::text, true);
select throws_ok($q$ insert into public.goal_bundles (started_at, ended_at, reason, categories, ratios) values (now(), now(), 'edit', '[]', '[{"category_id":null,"percent":100}]') $q$, '42501', null, 'goal_bundles 직접 insert는 42501');
select throws_ok($q$ update public.goal_bundles set reason = 'restart' $q$, '42501', null, 'goal_bundles 직접 update는 42501');
select throws_ok($q$ delete from public.goal_bundles $q$, '42501', null, 'goal_bundles 직접 delete는 42501');
select throws_ok($q$ update public.categories set archived_at = now() $q$, '42501', null, 'categories 직접 update는 42501');

-- 행동 3: 충돌이면 아무것도 안 바뀐다 -------------------------------------------------------
select throws_ok(
  format($q$ select public.save_goal_bundle(%L::uuid, 99, 'edit', true, %L, 10::smallint, '[]'::jsonb) $q$,
    (select v from const where k = 'OP1'), (select v from const where k = 'G2')),
  'P0001', 'bundle conflict', '기대 고침 번호가 다르면 bundle_conflict');
reset role;
select is((select goal_encrypted from public.user_settings where user_id = (select v::uuid from const where k = 'A')), (select v from const where k = 'G1'), '충돌: 목표 글이 그대로');
select is((select count(*)::int from public.goal_bundles where user_id = (select v::uuid from const where k = 'A')), 1, '충돌: 지난 묶음이 늘지 않았다');
select is((select count(*)::int from public.category_ratios where user_id = (select v::uuid from const where k = 'A')), 2, '충돌: 비율 행이 그대로');
select is((select bundle_revision from public.user_settings where user_id = (select v::uuid from const where k = 'A')), 0, '충돌: 고침 번호가 그대로');

-- 행동 4: 다른 날이면 지난 묶음 한 줄(그때 이름 암호문·비율이 담긴다) -----------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from const where k = 'A'), 'role', 'authenticated')::text, true);
select is(current_user::text, 'authenticated', '흉내 가드(A): current_user');
select is(auth.uid(), (select v::uuid from const where k = 'A'), '흉내 가드(A): auth.uid()');
select is(
  (select public.save_goal_bundle((select v::uuid from const where k = 'OP1'), 0, 'edit', true, (select v from const where k = 'G2'), 0::smallint,
    format('[{"id":"%s","percent":60},{"id":"%s","percent":40}]', (select v from const where k = 'A1'), (select v from const where k = 'A2'))::jsonb) ->> 'past'),
  'written', '사흘 전에 시작한 묶음을 바꾸면 지난 묶음 한 줄을 남긴다');
select is((select count(*)::int from public.goal_bundles), 2, '다른 날: 지난 묶음이 한 줄 늘었다(전 1 → 2)');
select is((select goal_encrypted from public.goal_bundles order by ended_at desc limit 1), (select v from const where k = 'G1'), '판 행에 바꾸기 전 목표 글 암호문이 담긴다');
select is((select categories -> 0 ->> 'name_encrypted' from public.goal_bundles order by ended_at desc limit 1), (select v from const where k = 'N1'), '판 행에 그때 이름 암호문이 담긴다');
-- 주의: 이 구간은 authenticated 흉내 중이라 private 스키마 함수(goal_bundle_ratios_sum)를 못 부른다(42501). pg_catalog 함수로 합을 센다.
select is((select sum((e ->> 'percent')::int)::int from public.goal_bundles g, jsonb_array_elements(g.ratios) e where g.id = (select id from public.goal_bundles order by ended_at desc limit 1)), 100, '판 행의 비율 합은 100');

-- 행동 5: 같은 op 두 번이면 한 번만(멱등) ------------------------------------------------------
select is(
  (select public.save_goal_bundle((select v::uuid from const where k = 'OP1'), 0, 'edit', true, (select v from const where k = 'G2'), 0::smallint,
    format('[{"id":"%s","percent":60},{"id":"%s","percent":40}]', (select v from const where k = 'A1'), (select v from const where k = 'A2'))::jsonb) ->> 'idempotent'),
  'true', '같은 op id를 다시 보내면 그대로 성공(충돌로 거절하지 않는다)');
select is((select count(*)::int from public.goal_bundles), 2, '같은 op 두 번: 지난 묶음이 늘지 않았다');
reset role;
select is((select bundle_revision from public.user_settings where user_id = (select v::uuid from const where k = 'A')), 1, '같은 op 두 번: 고침 번호는 한 번만 올랐다');
select ok((select bundle_started_at is not null and private.doono_day(bundle_started_at) = private.doono_day(now()) from public.user_settings where user_id = (select v::uuid from const where k = 'A')), '묶음 시작 시각이 오늘로 바뀌었다');

-- 행동 6: 같은 날 두 번 고치면 지난 묶음 0줄(그날 처음 한 줄뿐) ----------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from const where k = 'A'), 'role', 'authenticated')::text, true);
select is(auth.uid(), (select v::uuid from const where k = 'A'), '흉내 가드(A, 같은 날): auth.uid()');
select is(
  (select public.save_goal_bundle((select v::uuid from const where k = 'OP2'), 1, 'edit', true, null, 0::smallint,
    format('[{"id":"%s","percent":50},{"id":"%s","percent":50}]', (select v from const where k = 'A1'), (select v from const where k = 'A2'))::jsonb) ->> 'past'),
  'same_day', '같은 날 두 번째 저장은 지난 묶음을 남기지 않는다');
select is((select count(*)::int from public.goal_bundles), 2, '같은 날 두 번: 지난 묶음 0줄 추가');
-- 같은 날이라도 충돌 검사는 한다: 두 기기가 같은 날 차례로 고쳐도 늦은 쪽(옛 번호)이 거절된다
select throws_ok(
  format($q$ select public.save_goal_bundle(%L::uuid, 1, 'edit', false, null, 0::smallint, '[]'::jsonb) $q$, (select v from const where k = 'OP3')),
  'P0001', 'bundle conflict', '같은 날에도 옛 고침 번호는 거절된다');
reset role;
select is((select bundle_revision from public.user_settings where user_id = (select v::uuid from const where k = 'A')), 2, '같은 날 저장도 고침 번호는 오른다');
select is((select count(*)::int from public.category_ratio_history where user_id = (select v::uuid from const where k = 'A') and ratios @> '[{"percent":50}]'), 1, '비율이 바뀐 기록에 한 줄 남았다(같은 트랜잭션)');

-- 행동 7: 보관 분야 비율이 기타로 간다 + 이름 바꾸기·되살리기 --------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from const where k = 'A'), 'role', 'authenticated')::text, true);
select is(auth.uid(), (select v::uuid from const where k = 'A'), '흉내 가드(A, 보관): auth.uid()');
select lives_ok(
  format($q$ select public.save_goal_bundle(%L::uuid, 2, 'edit', false, null, 0::smallint,
    '[{"id":"%s","percent":50,"name_encrypted":"%s"},{"id":"%s","percent":50,"archived":true}]'::jsonb) $q$,
    (select v from const where k = 'OP4'), (select v from const where k = 'A1'), (select v from const where k = 'N3'), (select v from const where k = 'A2')),
  '이름 바꾸기와 보관을 한 번에');
reset role;
select is((select ratio_other_percent from public.user_settings where user_id = (select v::uuid from const where k = 'A')), 50::smallint, '보관한 분야의 몫(50)이 기타로 갔다');
select is((select archived_at is not null from public.categories where id = (select v::uuid from const where k = 'A2')), true, 'A2가 보관됐다');
select is((select name_encrypted from public.categories where id = (select v::uuid from const where k = 'A1')), (select v from const where k = 'N3'), 'A1 이름이 바뀌었다');
select is((select count(*)::int from public.category_ratios where user_id = (select v::uuid from const where k = 'A') and category_id = (select v::uuid from const where k = 'A2')), 0, '보관한 분야의 비율 행이 없다');
select is((select percent::int from public.category_ratios where user_id = (select v::uuid from const where k = 'A') and category_id = (select v::uuid from const where k = 'A1')), 50, '남은 분야 비율은 그대로');
select is((select color_order from public.categories where id = (select v::uuid from const where k = 'A1')), 0::smallint, '보관해도 다른 분야의 color_order는 그대로');
select is((select color_order from public.categories where id = (select v::uuid from const where k = 'A2')), 1::smallint, '보관한 분야의 color_order도 그대로');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from const where k = 'A'), 'role', 'authenticated')::text, true);
select lives_ok(
  -- 기타 50(앞 단계에서 보관한 A2 몫)을 그대로 보낸다: A1 50 + A2 0 + 기타 50 = 100. 기대 고침 번호 3(OP4 뒤)
  format($q$ select public.save_goal_bundle(%L::uuid, 3, 'edit', false, null, 50::smallint,
    '[{"id":"%s","percent":50},{"id":"%s","percent":0,"archived":false}]'::jsonb) $q$,
    (select v from const where k = 'OP5'), (select v from const where k = 'A1'), (select v from const where k = 'A2')),
  '보관한 분야를 되살린다(같은 id)');
reset role;
select is((select archived_at is null from public.categories where id = (select v::uuid from const where k = 'A2')), true, '되살아났다');
select is((select bundle_revision from public.user_settings where user_id = (select v::uuid from const where k = 'A')), 4, '되살린 뒤 고침 번호는 4(OP1·OP2·OP4·OP5)');

-- 행동 8: 다시 시작. 넘긴 묶음에 없는 분야는 보관되고, 할 일·저녁 기록·이번 주 목표 행은 줄지 않는다 ----------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from const where k = 'A'), 'role', 'authenticated')::text, true);
select lives_ok($q$ select public.set_restart_requested(true) $q$, '다시 시작 표시');
reset role;
select ok((select restart_requested_at is not null from public.user_settings where user_id = (select v::uuid from const where k = 'A')), '표시가 남았다');
select is((select count(*)::int from public.category_ratios where user_id = (select v::uuid from const where k = 'A')), 2, '표시는 지금 표를 바꾸지 않는다');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from const where k = 'A'), 'role', 'authenticated')::text, true);
select lives_ok(
  format($q$ select public.save_goal_bundle(%L::uuid, 4, 'restart', true, %L, 0::smallint,
    '[{"id":"%s","percent":100}]'::jsonb) $q$,
    (select v from const where k = 'OP6'), (select v from const where k = 'G2'), (select v from const where k = 'A1')),
  '다시 시작 끝: 새 묶음 저장');
reset role;
select is((select archived_at is not null from public.categories where id = (select v::uuid from const where k = 'A2')), true, '넘긴 묶음에 없는 옛 분야는 보관됐다');
select is((select archived_at is null from public.categories where id = (select v::uuid from const where k = 'A1')), true, '고른 옛 분야는 같은 id로 이어졌다');
select is((select restart_requested_at is null from public.user_settings where user_id = (select v::uuid from const where k = 'A')), true, 'restart_requested_at이 비었다');
select ok((select onboarding_done_at is not null from public.user_settings where user_id = (select v::uuid from const where k = 'A')), 'onboarding_done_at은 지워지지 않았다');
select is((select count(*)::int from public.todos where user_id = (select v::uuid from const where k = 'A')), 1, '다시 시작 뒤 할 일 행 수가 그대로');
select is((select count(*)::int from public.evening_logs where user_id = (select v::uuid from const where k = 'A')), 1, '다시 시작 뒤 저녁 기록 행 수가 그대로');
select is((select count(*)::int from public.weekly_goals where user_id = (select v::uuid from const where k = 'A')), 1, '다시 시작 뒤 이번 주 목표 행 수가 그대로');
select is((select ratio_other_percent from public.user_settings where user_id = (select v::uuid from const where k = 'A')), null::smallint, '새 묶음 기타는 0이라 비었다');

-- 행동 9: 상한 1000이면 저장은 되고 줄은 안 늘고 표시가 온다 ------------------------------------------
insert into public.user_settings (user_id, onboarding_done_at, bundle_started_at, goal_encrypted)
  values ((select v::uuid from const where k = 'C'), now() - interval '5 days', now() - interval '5 days', (select v from const where k = 'G1'));
insert into public.categories (id, user_id, name_encrypted) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', (select v::uuid from const where k = 'C'), (select v from const where k = 'N1'));
insert into public.category_ratios (user_id, category_id, percent) values ((select v::uuid from const where k = 'C'), 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 100);
insert into public.goal_bundles (user_id, started_at, ended_at, reason, categories, ratios)
  select (select v::uuid from const where k = 'C'), now() - interval '100 days', now() - interval '99 days', 'edit', '[]'::jsonb, '[{"category_id":null,"percent":100}]'::jsonb
  from generate_series(1, 1000);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from const where k = 'C'), 'role', 'authenticated')::text, true);
select is(auth.uid(), (select v::uuid from const where k = 'C'), '흉내 가드(C): auth.uid()');
select is(
  (select public.save_goal_bundle(null, 0, 'edit', true, (select v from const where k = 'G2'), 0::smallint,
    '[{"id":"c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1","percent":100}]'::jsonb) ->> 'past'),
  'limit', '상한(1000)에서도 저장은 성공하고 「남기지 못함」 표시가 온다');
reset role;
select is((select count(*)::int from public.goal_bundles where user_id = (select v::uuid from const where k = 'C')), 1000, '상한: 줄이 늘지 않았다(오래된 행을 밀어내지 않는다)');
select is((select goal_encrypted from public.user_settings where user_id = (select v::uuid from const where k = 'C')), (select v from const where k = 'G2'), '상한: 새 목표 글은 저장됐다');

-- 입력 검사: 칸 수·크기·형식 ----------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from const where k = 'C'), 'role', 'authenticated')::text, true);
select throws_ok(
  format($q$ select public.save_goal_bundle(null, 1, 'edit', false, null, 0::smallint, (select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'percent', 0)) from generate_series(1, 51))) $q$),
  '22023', null, '분야 목록이 50칸을 넘으면 거절');
select throws_ok($q$ select public.save_goal_bundle(null, 1, 'edit', true, 'not-a-ciphertext', 0::smallint, null) $q$, '22023', null, '암호문 형식이 아닌 목표 글은 거절');
select throws_ok($q$ select public.save_goal_bundle(null, 1, 'bogus', false, null, 0::smallint, null) $q$, '22023', null, '모르는 까닭은 거절');
select throws_ok(
  $q$ select public.save_goal_bundle(null, 1, 'edit', false, null, 0::smallint, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'new', true, 'name_encrypted', 'x', 'percent', 100))) $q$,
  '22023', null, '암호문 형식이 아닌 분야 이름은 거절');
-- 빠진 키는 모두 bundle_invalid(null에 안전한 검사). 기존 분야 id(C의 분야)로 시험한다
select throws_ok($q$ select public.save_goal_bundle(null, 1, 'edit', false, null, 100::smallint, '[{"percent":0}]'::jsonb) $q$, '22023', null, 'id가 빠진 칸은 거절');
select throws_ok($q$ select public.save_goal_bundle(null, 1, 'edit', false, null, 0::smallint, '[{"id":"c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1"}]'::jsonb) $q$, '22023', null, 'percent가 빠진 칸은 거절');
select throws_ok($q$ select public.save_goal_bundle(null, 1, 'edit', false, null, 0::smallint, '[{"id":"c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1","archived":true}]'::jsonb) $q$, '22023', null, 'archived:true인 기존 분야도 percent가 없으면 거절');
select throws_ok($q$ select public.save_goal_bundle(null, 1, 'edit', false, null, 0::smallint, '[{"id":null,"percent":100}]'::jsonb) $q$, '22023', null, 'id가 null인 칸은 거절');
select throws_ok($q$ select public.save_goal_bundle(null, 1, 'edit', false, null, 0::smallint, '["문자열 칸"]'::jsonb) $q$, '22023', null, '객체가 아닌 칸은 거절');
reset role;
select is((select bundle_revision from public.user_settings where user_id = (select v::uuid from const where k = 'C')), 1, '거절된 입력은 C의 고침 번호를 올리지 않았다');
select is((select archived_at is null from public.categories where id = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1'), true, '거절된 archived:true는 분야를 보관하지 않았다');

-- 비율 바뀐 기록 예외 블록: 기록 표가 상한(1000)에 닿아도 save_goal_bundle은 성공하고 묶음·비율은 바뀌고 기록만 안 는다 --------
insert into public.user_settings (user_id, onboarding_done_at, goal_encrypted)
  values ((select v::uuid from const where k = 'D'), now(), (select v from const where k = 'G1'));
insert into public.categories (id, user_id, name_encrypted) values ((select v::uuid from const where k = 'D1'), (select v::uuid from const where k = 'D'), (select v from const where k = 'N1'));
insert into public.category_ratios (user_id, category_id, percent) values ((select v::uuid from const where k = 'D'), (select v::uuid from const where k = 'D1'), 100);
insert into public.category_ratio_history (user_id, ratios)
  select (select v::uuid from const where k = 'D'), '[{"category_id":null,"percent":100}]'::jsonb from generate_series(1, 1000);
select is((select count(*)::int from public.category_ratio_history where user_id = (select v::uuid from const where k = 'D')), 1000, '준비: D의 기록 표가 상한(1000)에 찼다');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from const where k = 'D'), 'role', 'authenticated')::text, true);
select is(auth.uid(), (select v::uuid from const where k = 'D'), '흉내 가드(D): auth.uid()');
select is(
  (select public.save_goal_bundle(null, 0, 'edit', true, (select v from const where k = 'G2'), 40::smallint,
    format('[{"id":"%s","percent":60}]', (select v from const where k = 'D1'))::jsonb) ->> 'history'),
  'skipped', '기록 표가 상한이어도 저장은 성공하고 기록만 skipped로 알린다');
reset role;
select is((select percent::int from public.category_ratios where user_id = (select v::uuid from const where k = 'D') and category_id = (select v::uuid from const where k = 'D1')), 60, '상한: 비율은 바뀌었다');
select is((select ratio_other_percent from public.user_settings where user_id = (select v::uuid from const where k = 'D')), 40::smallint, '상한: 기타는 바뀌었다');
select is((select goal_encrypted from public.user_settings where user_id = (select v::uuid from const where k = 'D')), (select v from const where k = 'G2'), '상한: 목표 글은 바뀌었다');
select is((select bundle_revision from public.user_settings where user_id = (select v::uuid from const where k = 'D')), 1, '상한: 고침 번호는 올랐다');
select is((select count(*)::int from public.category_ratio_history where user_id = (select v::uuid from const where k = 'D')), 1000, '상한: 기록은 늘지 않았다');
-- (표가 없는 경우는 트랜잭션 안에서 표를 지울 수 없어 이 시험에서 덮지 않는다: 같은 when others 갈래다)

select * from finish();
rollback;
