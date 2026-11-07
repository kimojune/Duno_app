-- 원샷 v2 0번: 할 일 기본 기능(고치기·순서). PRD 6절 G12-a.
-- 덧붙이기만 한다: todos에 null 열 하나(position)와 고유 제약 하나, update 권한 열 셋. 기존 열·데이터는 바꾸지 않는다.
-- 이 파일을 먼저 적용하고 앱을 배포한다(앱이 position 열을 읽는다).
-- 되돌림은 down 파일이 없으므로 새 마이그레이션으로 한다(제거는 코드 먼저).

-- 1. 순서. null이면 순서를 정하지 않은 행(앞서 정한 행 뒤에 적은 순서대로). 앱이 0, 1, 2…를 매긴다.
alter table public.todos add column position integer null;
alter table public.todos
  add constraint todos_position_range check (position is null or (position >= 0 and position <= 100000));
comment on column public.todos.position is '화면 순서(0부터). null이면 정하지 않음 — 정한 행 뒤에 created_at 순.';

-- 2. 다른 표(작업 기록 등)가 (할 일 id, 소유자)로 가리킬 수 있게 한다. id가 이미 기본 키라 뜻은 같다.
alter table public.todos add constraint todos_id_user_id_key unique (id, user_id);

-- 3. 고치기: 글과 분야, 순서를 바꿀 수 있다. user_id·id·day·created_at·done 말고 이 셋만 더한다(done은 이미 있다).
-- text_encrypted의 형식·길이 check, 분야의 소유자 외래 키(todos_category_owner_fkey), update RLS 정책(자기 행만)은 그대로 걸린다.
grant update (text_encrypted, category_id, position) on table public.todos to authenticated;
