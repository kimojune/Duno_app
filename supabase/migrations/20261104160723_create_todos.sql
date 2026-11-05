-- 두노 첫 조각: 할 일 표(todos)
-- 사용자는 자기 행만 읽고 쓴다(RLS). 할 일 글은 서버 쪽 모듈이 암호화한 값만 들어온다.
-- 되돌림은 down 파일이 없으므로 새 마이그레이션으로 한다.

-- ---------------------------------------------------------------------------
-- 1. 표
-- ---------------------------------------------------------------------------
create table public.todos (
  id uuid primary key default gen_random_uuid(),

  -- 임시, 결정 필요: 탈퇴 때 데이터 지우기는 PM 결정이라, 되돌릴 수 없는 cascade 대신
  -- 데이터를 잃지 않는 restrict를 둔다. 바꿀 때는 새 마이그레이션에서
  --   alter table public.todos drop constraint todos_user_id_fkey,
  --     add constraint todos_user_id_fkey foreign key (user_id)
  --     references auth.users (id) on delete cascade;
  user_id uuid not null default auth.uid()
    constraint todos_user_id_fkey references auth.users (id) on delete restrict,

  -- 하루 날짜(새벽 4시 기준 계산은 앱이 한다)
  day date not null,

  -- 암호화된 할 일 글. 형식: v<판 번호>:<IV>:<암호문>:<태그>, 세 조각은 base64url(패딩 없음).
  -- AES-256-GCM 기준 IV 12바이트 = 16자, 태그 16바이트 = 22자.
  text_encrypted text not null,

  done boolean not null default false,
  created_at timestamptz not null default now(),

  -- 임시, 결정 필요: 형식 표시(판 번호 접두)가 없는 값을 거절한다.
  -- publishable 키로 REST에 평문을 직접 넣는 것을 막으려는 것이다.
  constraint todos_text_encrypted_format check (
    text_encrypted ~ '^v[1-9][0-9]{0,2}:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{22}$'
  ),
  -- 임시, 결정 필요: 상한 4096자(암호문 전체 길이). 할 일 글 글자 수는 7-2절에서 아직 정하지 않았다.
  constraint todos_text_encrypted_length check (char_length(text_encrypted) <= 4096)
);

comment on table public.todos is '할 일. 사용자는 자기 행만(RLS). text_encrypted는 v<n>:<iv>:<ct>:<tag> 형식의 암호문.';

-- ---------------------------------------------------------------------------
-- 2. 인덱스
-- ---------------------------------------------------------------------------
create index todos_user_id_day_idx on public.todos (user_id, day);

-- ---------------------------------------------------------------------------
-- 3. 권한(grant). 2026-10-30 뒤로 새 표에 자동 grant가 붙지 않으므로 명시한다.
-- ---------------------------------------------------------------------------
revoke all on table public.todos from public;
revoke all on table public.todos from anon;
revoke all on table public.todos from authenticated;

grant select, delete on table public.todos to authenticated;
-- id·created_at은 기본값만 쓴다. user_id는 기본값이 auth.uid()이고, 다른 값은 WITH CHECK가 거절한다.
grant insert (user_id, day, text_encrypted, done) on table public.todos to authenticated;
-- 첫 조각에서 update로 바꿀 수 있는 것은 done뿐이다(user_id·id·day·created_at·text_encrypted는 못 바꾼다).
grant update (done) on table public.todos to authenticated;

-- ---------------------------------------------------------------------------
-- 4. 행 단위 보안(RLS). 마이그레이션으로 만든 표는 자동으로 켜지지 않는다.
-- ---------------------------------------------------------------------------
alter table public.todos enable row level security;

create policy todos_select_own on public.todos
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy todos_insert_own on public.todos
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy todos_update_own on public.todos
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy todos_delete_own on public.todos
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 5. 한 사용자 하루 행 수 상한
-- 임시, 결정 필요: 하루 200행. 남용(행 대량 생성)으로 DB가 불어나는 것을 막는 보수적 값.
-- 함수는 Data API에 노출되지 않는 private 스키마에 두고, execute를 모두 거둔다.
-- security invoker(기본)라 셈은 RLS 안에서 자기 행만 본다. 남의 user_id로 넣는 것은 WITH CHECK가 거절한다.
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create function private.todos_enforce_daily_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  daily_limit constant integer := 200; -- 임시, 결정 필요
  existing integer;
begin
  -- 같은 사용자·같은 날 동시 insert가 상한을 넘지 않게 트랜잭션 잠금으로 줄 세운다.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text || ':' || new.day::text, 0)
  );

  select pg_catalog.count(*) into existing
  from public.todos t
  where t.user_id = new.user_id
    and t.day = new.day;

  if existing >= daily_limit then
    raise exception 'daily todo limit reached'
      using errcode = 'P0001', hint = 'todos_daily_limit';
  end if;

  return new;
end;
$$;

revoke all on function private.todos_enforce_daily_limit() from public;
revoke all on function private.todos_enforce_daily_limit() from anon;
revoke all on function private.todos_enforce_daily_limit() from authenticated;

create trigger todos_enforce_daily_limit
  before insert on public.todos
  for each row execute function private.todos_enforce_daily_limit();
