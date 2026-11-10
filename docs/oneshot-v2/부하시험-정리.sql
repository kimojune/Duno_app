-- 체험 코드 부하 시험 뒤 정리 SQL (22 팀장 지시 · PM d-229 가 · d-230 가). 실행은 PM이 Supabase SQL 편집기에서 한다. 개발 에이전트는 돌리지 않는다.
--
-- ⚠ 위험(먼저 읽기)
--   이 파일은 「익명(is_anonymous = true) 사용자 중 만든 때가 시험 시간 범위 안인 사용자」를 모두 지운다.
--   시험 시간 범위에 진짜 체험 방문자가 체험 코드로 들어오면 그 사람도 같은 조건이라 함께 지워진다(그 사람의 할 일·기록 포함).
--   그래서 (1) 범위는 스크립트 결과의 단계 시작·끝 시각에 앞뒤 1분만 더한 좁은 범위로 쓰고, (2) 지우기 전에 아래 「1. 먼저 세기」의 수가
--   시험이 만든 사용자 수(스크립트 결과의 성공 수 합 + 실패했어도 만들어졌을 수 있는 수)와 크게 다르지 않은지 PM이 눈으로 본다.
--   (3) 수가 이상하면 지우지 않는다. 지운 것은 되돌릴 수 없다(트랜잭션을 commit하기 전까지만 되돌릴 수 있다).
--
-- 자리표시자(실행 전에 바꾼다)
--   <시작 UTC> : 결과 JSON의 첫 단계 startedAtUtc (예: 2026-11-10T01:30:00.000Z)
--   <끝 UTC>   : 결과 JSON의 마지막으로 돈 단계 endedAtUtc
--   여유: 앞뒤 1분(아래 SQL에 interval '1 minute'로 들어 있음). 시계 어긋남과 단계 사이 지연을 덮고, 진짜 방문자를 덜 끌어들이게 짧게 잡았다(임시, 결정 필요).
--   <센 수> : 1번(먼저 세기)이 낸 숫자
--
-- 순서: 1. 먼저 세기 → 2. 수 확인 → 3. 지우기(트랜잭션, 수가 다르면 스스로 되돌림) → 4. 결과 확인 뒤 commit 또는 rollback
--
-- 외래 키 확인(supabase/migrations/*.sql을 읽은 결과): auth.users를 가리키는 키는 아래 12개 표 모두 on delete RESTRICT다(cascade 표 없음).
--   그래서 사용자를 지우기 전에 이 표들의 행을 같은 사용자 조건으로 먼저 지워야 한다. 표 사이 순서는 다음 키가 정한다:
--   todo_notes → todos (복합 키 todo_owner, on delete cascade: todos를 지우면 todo_notes도 따라 지워지지만 todo_notes도 user_id가 restrict라 명시로 지운다)
--   todos · category_ratios · focus_sessions · todo_offers → categories (복합 키 category_owner, on delete restrict) : categories는 맨 마지막
--   (category_ratio_history · evening_logs · view_events · weekly_goals · user_settings · push_subscriptions 는 다른 표를 가리키지 않는다)
--   지우는 순서: todo_notes, focus_sessions, todo_offers, category_ratios, category_ratio_history, todos, evening_logs, view_events,
--                weekly_goals, user_settings, push_subscriptions, categories, auth.users
--   auth.users를 지우면 Supabase 인증 쪽(auth.identities · auth.sessions · auth.refresh_tokens 등)은 그쪽 키(cascade)로 같이 지워진다(Supabase 기본 스키마, 이 저장소 밖 — 미검증).
--   이 저장소의 표에는 지우기를 막는 트리거가 없다(트리거는 모두 insert 상한). SQL 편집기는 소유자 권한이라 RLS와 delete 권한 없음(grant)에 걸리지 않는다.

-- =====================================================================
-- 1. 먼저 세기 (읽기만 한다)
-- =====================================================================
select count(*) as 센_수
from auth.users u
where u.is_anonymous = true
  and u.created_at >= timestamptz '<시작 UTC>' - interval '1 minute'
  and u.created_at <= timestamptz '<끝 UTC>' + interval '1 minute';

-- (선택) 범위 안 사용자가 언제 만들어졌는지 훑어보기: 진짜 방문자가 섞였는지 보는 용도. 사용자 번호만, 이메일 없음.
select u.created_at, u.id
from auth.users u
where u.is_anonymous = true
  and u.created_at >= timestamptz '<시작 UTC>' - interval '1 minute'
  and u.created_at <= timestamptz '<끝 UTC>' + interval '1 minute'
order by u.created_at;

-- =====================================================================
-- 2. 센 수를 눈으로 확인한 뒤에만 3번으로 간다
-- =====================================================================

-- =====================================================================
-- 3. 지우기 (한 트랜잭션). 같은 조건만 지운다. 지운 사용자 수가 <센 수>와 다르면 오류로 멈춰 모두 되돌려진다.
-- =====================================================================
begin;

create temp table load_test_users on commit drop as
select u.id
from auth.users u
where u.is_anonymous = true
  and u.created_at >= timestamptz '<시작 UTC>' - interval '1 minute'
  and u.created_at <= timestamptz '<끝 UTC>' + interval '1 minute';

-- 지우기 전에, 조건에 맞는 수가 1번에서 센 수와 같은지 확인(다르면 여기서 멈춤)
do $$
declare n bigint;
begin
  select count(*) into n from load_test_users;
  if n <> <센 수> then
    raise exception '센 수(<센 수>)와 지금 조건에 맞는 수(%)가 달라요. 지우지 않고 멈춰요.', n;
  end if;
end $$;

-- 사용자를 가리키는 표(의존 순서: 자식 → 부모)
delete from public.todo_notes            where user_id in (select id from load_test_users);
delete from public.focus_sessions        where user_id in (select id from load_test_users);
delete from public.todo_offers           where user_id in (select id from load_test_users);
delete from public.category_ratios       where user_id in (select id from load_test_users);
delete from public.category_ratio_history where user_id in (select id from load_test_users);
delete from public.todos                 where user_id in (select id from load_test_users);
delete from public.evening_logs          where user_id in (select id from load_test_users);
delete from public.view_events           where user_id in (select id from load_test_users);
delete from public.weekly_goals          where user_id in (select id from load_test_users);
delete from public.user_settings         where user_id in (select id from load_test_users);
delete from public.push_subscriptions    where user_id in (select id from load_test_users);
delete from public.categories            where user_id in (select id from load_test_users);

-- 마지막으로 사용자. 지운 수가 <센 수>와 다르면 오류로 멈춘다.
do $$
declare deleted bigint;
begin
  delete from auth.users where id in (select id from load_test_users);
  get diagnostics deleted = row_count;
  if deleted <> <센 수> then
    raise exception '지운 사용자 수(%)가 센 수(<센 수>)와 달라요. 되돌려요.', deleted;
  end if;
end $$;

-- =====================================================================
-- 4. 결과 확인 — 남은 수가 0이어야 한다. 맞으면 commit, 아니면 rollback.
-- =====================================================================
select count(*) as 남은_수
from auth.users u
where u.is_anonymous = true
  and u.created_at >= timestamptz '<시작 UTC>' - interval '1 minute'
  and u.created_at <= timestamptz '<끝 UTC>' + interval '1 minute';

-- commit;     -- 남은 수 0, 지운 수 = 센 수면 이 줄의 앞 「--」를 지우고 실행
-- rollback;   -- 이상하면 이 줄의 앞 「--」를 지우고 실행(트랜잭션이 열려 있는 동안만 되돌릴 수 있다)
