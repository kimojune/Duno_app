-- 원샷 v2 0-1번: 할 일마다 작업 기록(자유 글). PRD 7-2, G13-a.
-- 새 표 하나(todo_notes). 기존 표·열은 건드리지 않는다. 20261107100000_todo_manage.sql 뒤에 적용한다(todos의 (id, user_id) 고유 제약을 쓴다).
-- 작업 기록 글은 할 일 글·분야 이름과 같은 키로 암호화한 값만 들어온다(AAD 용도 todo_note).

create table public.todo_notes (
  id uuid primary key default gen_random_uuid(),

  -- 임시, 결정 필요: 탈퇴 때 처리는 PM 결정이라 todos와 같이 restrict.
  user_id uuid not null default auth.uid()
    constraint todo_notes_user_id_fkey references auth.users (id) on delete restrict,

  -- 어느 할 일의 기록인가. 같은 사용자의 할 일만 가리킬 수 있다. 할 일을 지우면 그 기록도 지워진다(임시, 결정 필요).
  todo_id uuid not null,
  constraint todo_notes_todo_owner_fkey foreign key (todo_id, user_id)
    references public.todos (id, user_id) on delete cascade,

  -- 기록한 두노 하루(앱이 새벽 4시 기준으로 정한다). 분야 페이지가 날짜별로 모은다.
  day date not null,

  -- 암호화된 글. 형식은 todos.text_encrypted와 같다.
  note_encrypted text not null,
  created_at timestamptz not null default now(),

  constraint todo_notes_note_encrypted_format check (
    note_encrypted ~ '^v[1-9][0-9]{0,2}:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{22}$'
  ),
  -- 임시, 결정 필요: 글 2000자(UTF-8 최대 8000바이트) → 암호문 약 10800자. 상한은 16000자로 둔다.
  constraint todo_notes_note_encrypted_length check (char_length(note_encrypted) <= 16000)
);

comment on table public.todo_notes is '할 일마다 작업 기록(PRD 7-2). 사용자는 자기 행만(RLS). note_encrypted는 v<n>:<iv>:<ct>:<tag> 암호문.';

create index todo_notes_user_todo_idx on public.todo_notes (user_id, todo_id, created_at);
create index todo_notes_user_day_idx on public.todo_notes (user_id, day);

revoke all on table public.todo_notes from public;
revoke all on table public.todo_notes from anon;
revoke all on table public.todo_notes from authenticated;

grant select, delete on table public.todo_notes to authenticated;
-- id는 화면이 만든 uuid(재시도에 새 행을 만들지 않으려고). user_id는 기본값 auth.uid(), 다른 값은 WITH CHECK가 거절.
grant insert (id, user_id, todo_id, day, note_encrypted) on table public.todo_notes to authenticated;

alter table public.todo_notes enable row level security;

create policy todo_notes_select_own on public.todo_notes
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy todo_notes_insert_own on public.todo_notes
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy todo_notes_delete_own on public.todo_notes
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- 한 사용자 작업 기록 개수 상한. 임시, 결정 필요: 20000. 남용으로 DB가 불어나는 것을 막는 보수적 값(todos와 같은 꼴).
create function private.todo_notes_enforce_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  note_limit constant integer := 20000; -- 임시, 결정 필요
  existing integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('todo_notes:' || new.user_id::text, 0));
  select pg_catalog.count(*) into existing from public.todo_notes n where n.user_id = new.user_id;
  if existing >= note_limit then
    raise exception 'todo note limit reached' using errcode = 'P0001', hint = 'todo_notes_limit';
  end if;
  return new;
end;
$$;

revoke all on function private.todo_notes_enforce_limit() from public;
revoke all on function private.todo_notes_enforce_limit() from anon;
revoke all on function private.todo_notes_enforce_limit() from authenticated;

create trigger todo_notes_enforce_limit
  before insert on public.todo_notes
  for each row execute function private.todo_notes_enforce_limit();
