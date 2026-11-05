-- 두노 방향 C 1단계: 분야 표(categories)와 할 일의 분야 번호(todos.category_id). D-135·D-125.
-- 덧붙이기만 한다: 새 표 하나, todos에 null 열 하나·복합 외래 키 하나·인덱스 하나, 새 grant, 새 트리거.
-- 이미 있는 표·열의 뜻은 바꾸지 않는다(휴대폰 시범판이 같은 개발 DB를 쓴다). 이 파일을 먼저 적용하고 앱을 배포한다.
-- 되돌림은 down 파일이 없으므로 새 마이그레이션으로 한다(제거는 코드 먼저).
--
-- 지금 만들지 않는 것(D-135 「나중 칸」): 어디서 나뉘었나, 처음 비율, 이번 주 목표. 보관 기능(update)도 아직 없다.
-- 「기타」는 행으로 만들지 않는다: todos.category_id가 null이면 기타로 본다.

-- ---------------------------------------------------------------------------
-- 1. 표
-- ---------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),

  -- 임시, 결정 필요: 탈퇴 때 분야 데이터를 어떻게 할지는 PM 결정이라, todos와 같이
  -- 데이터를 잃지 않는 restrict를 둔다. 바꿀 때는 새 마이그레이션에서 제약을 다시 만든다.
  user_id uuid not null default auth.uid()
    constraint categories_user_id_fkey references auth.users (id) on delete restrict,

  -- 암호화된 분야 이름. 할 일 글(todos.text_encrypted)과 같은 형식: v<판 번호>:<IV>:<암호문>:<태그>, base64url(패딩 없음).
  -- 앱은 같은 키·같은 함수로 암호화하되 추가 인증 데이터의 용도가 달라, 할 일 글 암호문을 옮겨 넣어도 풀리지 않는다.
  name_encrypted text not null,

  -- 보관 표시. null이면 쓰는 분야. 분야는 지우지 않고 보관한다(D-135). 보관하는 길(update)은 아직 열지 않는다.
  archived_at timestamptz null,

  created_at timestamptz not null default now(),

  -- publishable 키로 REST에 평문 이름을 직접 넣는 것을 막는다(todos_text_encrypted_format과 같은 식).
  constraint categories_name_encrypted_format check (
    name_encrypted ~ '^v[1-9][0-9]{0,2}:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{22}$'
  ),
  -- 임시, 결정 필요: 암호문 전체 길이 상한 512자. 이름 상한(앱, 임시 20 코드 포인트)은 UTF-8로 많아야 80바이트라
  -- 암호문은 150자 안팎이다. 이름 상한을 크게 늘리면 이 값도 새 마이그레이션으로 늘린다.
  constraint categories_name_encrypted_length check (char_length(name_encrypted) <= 512),

  -- todos가 (category_id, user_id)로 가리킬 수 있게 둔다(아래 3절). id가 이미 기본 키라 뜻은 같고, 외래 키의 대상이 된다.
  constraint categories_id_user_id_key unique (id, user_id)
);

comment on table public.categories is
  '할 일 분야(D-135). 사용자는 자기 행만(RLS). name_encrypted는 v<n>:<iv>:<ct>:<tag> 형식의 암호문. 지우지 않고 archived_at으로 보관한다.';

-- 목록(보관 안 한 내 분야, created_at 오름차순)과 RLS가 거르는 user_id
create index categories_user_id_created_at_idx on public.categories (user_id, created_at);

-- ---------------------------------------------------------------------------
-- 2. 권한(grant). 2026-10-30 뒤 새 표는 grant가 없으면 Data API에 보이지 않으므로 명시한다.
--    update·delete는 주지 않는다(보관 기능이 생기면 그때 새 마이그레이션으로 덧붙인다). anon에는 아무것도 없다.
-- ---------------------------------------------------------------------------
revoke all on table public.categories from public;
revoke all on table public.categories from anon;
revoke all on table public.categories from authenticated;

grant select on table public.categories to authenticated;
-- id는 화면이 만든 uuid(같은 id 재시도에 새 행을 만들지 않으려고), user_id는 기본값 auth.uid()이고 다른 값은 WITH CHECK가 거절.
-- archived_at·created_at은 넣지 못한다(새 분야는 보관 안 한 상태, 시각은 DB가 정한다).
grant insert (id, user_id, name_encrypted) on table public.categories to authenticated;

-- ---------------------------------------------------------------------------
-- 3. todos에 분야 번호. null이면 「기타」. 기존 열은 바꾸지 않는다.
-- ---------------------------------------------------------------------------
alter table public.todos add column category_id uuid null;

-- 남의 분야를 가리키지 못하게 한다. 외래 키 검사는 RLS를 거치지 않으므로(표 주인 권한으로 본다) 정책만으로는 막히지 않는다.
-- 그래서 (category_id, user_id)를 categories (id, user_id)에 묶는다: 할 일의 user_id(= RLS WITH CHECK로 auth.uid())와
-- 같은 user_id의 분야만 가리킬 수 있다. category_id가 null이면 검사하지 않는다(MATCH SIMPLE 기본).
-- on delete restrict: 분야는 지우지 않는다(지우는 권한도 없다).
alter table public.todos
  add constraint todos_category_owner_fkey foreign key (category_id, user_id)
  references public.categories (id, user_id) on delete restrict;

comment on column public.todos.category_id is '분야(categories.id). null이면 기타. 같은 user_id의 분야만(todos_category_owner_fkey).';

-- 외래 키 쪽 인덱스(분야로 할 일을 찾을 때, 분야 행을 바꿀 때의 검사)
create index todos_category_id_user_id_idx on public.todos (category_id, user_id) where category_id is not null;

-- 할 일을 적을 때 분야 번호를 함께 넣을 수 있게 한다. update 권한은 그대로 done뿐이다(분야를 바꾸는 길은 아직 없다).
grant insert (category_id) on table public.todos to authenticated;

-- ---------------------------------------------------------------------------
-- 4. 행 단위 보안(RLS). 마이그레이션으로 만든 표는 자동으로 켜지지 않는다. 정책은 소유자 select·insert만.
-- ---------------------------------------------------------------------------
alter table public.categories enable row level security;

create policy categories_select_own on public.categories
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy categories_insert_own on public.categories
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 5. 한 사용자 분야 개수 상한
-- 임시, 결정 필요: 50개. 분야 대량 생성으로 DB가 불어나는 것을 막는 보수적 값. 보관한 분야도 행이므로 함께 센다.
-- todos 상한(private.todos_enforce_daily_limit)과 같은 꼴: Data API에 노출되지 않는 private 스키마,
-- search_path 고정, execute는 모두 거둔다. security invoker(기본)라 셈은 RLS 안에서 자기 행만 본다.
-- 남의 user_id로 넣는 것은 WITH CHECK가 거절한다(BEFORE 트리거 뒤에 검사된다).
-- ---------------------------------------------------------------------------
create function private.categories_enforce_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  category_limit constant integer := 50; -- 임시, 결정 필요
  existing integer;
begin
  -- 같은 사용자의 동시 insert가 상한을 넘지 않게 사용자 단위 트랜잭션 잠금으로 줄 세운다.
  -- (read committed라 잠금을 얻은 뒤의 count는 앞선 트랜잭션이 커밋한 행을 본다.)
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('categories:' || new.user_id::text, 0)
  );

  select pg_catalog.count(*) into existing
  from public.categories c
  where c.user_id = new.user_id;

  if existing >= category_limit then
    raise exception 'category limit reached'
      using errcode = 'P0001', hint = 'categories_limit';
  end if;

  return new;
end;
$$;

revoke all on function private.categories_enforce_limit() from public;
revoke all on function private.categories_enforce_limit() from anon;
revoke all on function private.categories_enforce_limit() from authenticated;

create trigger categories_enforce_limit
  before insert on public.categories
  for each row execute function private.categories_enforce_limit();
