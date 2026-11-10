-- 체험 코드 부하 시험 뒤 정리 SQL (22 팀장 지시 · PM d-229 가 · d-230 가). 실행은 PM이 Supabase SQL 편집기에서 한다. 개발 에이전트는 돌리지 않는다.
--
-- ⚠ 위험(먼저 읽기)
--   이 파일은 「익명(is_anonymous = true) 사용자 중 만든 때가 시험 시간 범위 안인 사용자」를 모두 지운다.
--   시험 시간 범위에 진짜 체험 방문자가 체험 코드로 들어오면 그 사람도 같은 조건이라 함께 지워진다(그 사람의 할 일·기록 포함).
--   그래서 (1) 범위는 스크립트 결과의 단계 시작·끝 시각에 앞뒤 1분만 더한 좁은 범위로 쓰고, (2) 지우기 전에 아래 「1. 먼저 세기」의 수가
--   시험이 만든 사용자 수(스크립트 결과의 성공 수 합 + 실패했어도 만들어졌을 수 있는 수)와 크게 다르지 않은지 PM이 눈으로 본다.
--   (3) 수가 이상하면 지우지 않는다. 지운 것은 되돌릴 수 없다(아래 3번은 한 번 실행으로 끝나며, 검사가 어긋나면 전체가 되돌려지고, 맞으면 끝의 commit으로 확정된다).
--
-- 자리표시자(실행 전에 바꾼다)
--   〈시작 UTC〉 : 결과 JSON의 첫 단계 startedAtUtc (예: 2026-11-10T01:30:00.000Z)
--   〈끝 UTC〉   : 결과 JSON의 마지막으로 돈 단계 endedAtUtc
--   여유: 앞뒤 1분(아래 SQL에 interval '1 minute'로 들어 있음). 시계 어긋남과 단계 사이 지연을 덮고, 진짜 방문자를 덜 끌어들이게 짧게 잡았다(임시, 결정 필요).
--   〈센 수〉 : 1번(먼저 세기)이 낸 숫자
--   바꿀 곳(SQL 문 안, 주석 제외): 〈시작 UTC〉 3곳(1번 세기 · 1번 훑어보기 · 3번 지우기 DO 블록) · 〈끝 UTC〉 3곳(같은 세 문장) · 〈센 수〉 1곳(3번 DO 블록의 expected 줄, 숫자 하나로). 모두 7곳.
--   자리표시자가 남은 채 실행하면 문법 오류로 멈춘다(지워지지 않음). 주석의 표기는 〈 〉(꺾쇠 모양이 다름)라 검색에 안 걸린다. 주석 밖 실행문(begin~commit 사이와 1번 세기)에 꺾쇠로 감싼 자리표시자(시작 · 끝 · 센 수)가 하나도 안 남았는지 눈으로 본다.
--   오류가 나면 먼저 `rollback;` 을 한 번 실행한다(begin 뒤에서 멈춘 트랜잭션을 닫는다). 그 뒤 자리표시자를 다시 확인해 3번을 처음부터 한 덩어리로 다시 돌린다.
--
-- 순서: 세기(1번) → 수 확인(2번) → 지우기 한 번 실행(3번: begin · do 블록 · commit이 한 덩어리). 3번은 반드시 한 번에 선택해 실행한다.
--   SQL 편집기는 실행마다 연결을 돌려줄 수 있어 따로 친 commit이 듣지 않을 수 있다. 그래서 3번의 검사(지우기 전 수 · 지운 수 · 남은 수)는 do 블록 안에서 하고,
--   어긋나면 예외로 전체가 되돌려지며, 맞으면 같은 덩어리 끝의 commit으로 확정한다.
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
-- 3. 지우기 (한 번 실행). 같은 조건만 지운다. 아래 begin부터 commit까지를 한꺼번에 선택해 실행한다.
--    do 블록 안에서: 지우기 전 수 = 〈센 수〉 확인 → 의존 순서대로 지움 → 지운 사용자 수 = 〈센 수〉 확인 → 남은 수 0 확인.
--    하나라도 어긋나면 예외 → 트랜잭션 전체 롤백(commit에 닿지 않음).
-- =====================================================================
begin;

do $$
declare
  expected bigint := <센 수>;           -- 바꿀 곳: 1번이 낸 숫자
  ids uuid[];
  n bigint;
  remaining bigint;
begin
  select coalesce(array_agg(u.id), '{}') into ids
  from auth.users u
  where u.is_anonymous = true
    and u.created_at >= timestamptz '<시작 UTC>' - interval '1 minute'
    and u.created_at <= timestamptz '<끝 UTC>' + interval '1 minute';

  if coalesce(array_length(ids, 1), 0) <> expected then
    raise exception '센 수(%)와 지금 조건에 맞는 수(%)가 달라요. 지우지 않고 멈춰요.', expected, coalesce(array_length(ids, 1), 0);
  end if;

  -- 사용자를 가리키는 표(의존 순서: 자식 → 부모)
  delete from public.todo_notes             where user_id = any(ids);
  delete from public.focus_sessions         where user_id = any(ids);
  delete from public.todo_offers            where user_id = any(ids);
  delete from public.category_ratios        where user_id = any(ids);
  delete from public.category_ratio_history where user_id = any(ids);
  delete from public.todos                  where user_id = any(ids);
  delete from public.evening_logs           where user_id = any(ids);
  delete from public.view_events            where user_id = any(ids);
  delete from public.weekly_goals           where user_id = any(ids);
  delete from public.user_settings          where user_id = any(ids);
  delete from public.push_subscriptions     where user_id = any(ids);
  delete from public.categories             where user_id = any(ids);

  delete from auth.users where id = any(ids);
  get diagnostics n = row_count;
  if n <> expected then
    raise exception '지운 사용자 수(%)가 센 수(%)와 달라요. 되돌려요.', n, expected;
  end if;

  select count(*) into remaining from auth.users where id = any(ids);
  if remaining <> 0 then
    raise exception '지운 뒤에도 남은 수가 %예요. 되돌려요.', remaining;
  end if;
end $$;

commit;
