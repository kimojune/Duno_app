-- 두노 todos: 사용자별 전체 행 수 상한을 더한다(1단계 검토 고침).
-- 이유: day는 insert에서 사용자가 정하는 값이라, 날짜를 바꿔 가며 넣으면 하루 200행 상한만으로는
-- 행 대량 생성을 막지 못한다. 기획서 7-2가 지난 날짜·앞날 적기를 허용하므로 day 범위는 막지 않고,
-- 날짜와 상관없는 사용자별 전체 상한을 같은 트리거 함수에 함께 둔다.
-- 원본(20261104160723_create_todos.sql)의 트리거·함수 이름을 그대로 쓰고 함수 몸만 바꾼다.

create or replace function private.todos_enforce_daily_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  daily_limit constant integer := 200;   -- 임시, 결정 필요
  total_limit constant integer := 10000; -- 임시, 결정 필요
  existing_day integer;
  existing_total integer;
begin
  -- 같은 사용자의 동시 insert가 상한을 넘지 않게 사용자 단위 트랜잭션 잠금으로 줄 세운다
  -- (날짜가 달라도 같은 잠금이라 하루 상한과 전체 상한을 함께 지킨다).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('todos:' || new.user_id::text, 0)
  );

  -- 전체 상한: day 조건 없이 그 사용자의 모든 행을 센다(날짜를 바꿔 가며 넣어도 걸린다).
  select pg_catalog.count(*) into existing_total
  from public.todos t
  where t.user_id = new.user_id;

  if existing_total >= total_limit then
    raise exception 'total todo limit reached'
      using errcode = 'P0001', hint = 'todos_total_limit';
  end if;

  select pg_catalog.count(*) into existing_day
  from public.todos t
  where t.user_id = new.user_id
    and t.day = new.day;

  if existing_day >= daily_limit then
    raise exception 'daily todo limit reached'
      using errcode = 'P0001', hint = 'todos_daily_limit';
  end if;

  return new;
end;
$$;

-- create or replace는 권한을 그대로 두지만, 노출되지 않게 다시 거둔다.
revoke all on function private.todos_enforce_daily_limit() from public;
revoke all on function private.todos_enforce_daily_limit() from anon;
revoke all on function private.todos_enforce_daily_limit() from authenticated;
