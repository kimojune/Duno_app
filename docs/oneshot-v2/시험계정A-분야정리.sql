-- 시험 계정 A 분야 정리 SQL (22 팀장 지시 · PM 결정 d-239 대기). 실행은 PM이 Supabase SQL 편집기에서, PM 결정(d-239) 뒤에만 한다.
-- 22 팀장과 개발 에이전트(워커 포함)는 돌리지 않는다. 이 파일은 미리 써 둔 것이고 아직 한 번도 실행하지 않았다.
--
-- 왜 필요한가(미확인 — 원인은 PM이 1번 세기로 확인한다)
--   e2e tests/e2e/todo-flow.spec.ts는 실행마다 시험 계정 A에 분야를 하나 만든다(이름 「e2e분야」+시각 접미사). categories 표에는 지우는 권한(delete grant)이 없어
--   시험이 못 지운다. 분야 한도는 사용자당 50(보관한 것 포함, lib/categories/validation.ts CATEGORY_LIMIT · DB 트리거 categories_enforce_limit)이라,
--   한도에 닿으면 「+ 분야」 칸이 안 열려 시험이 멈춘 것으로 본다. 통합 시험(categories-rls 「512자 통과」)도 실행마다 A에 분야를 하나씩 남긴다.
--   (categories-limit.test.ts는 DUNO_CATEGORY_LIMIT_TEST=1일 때 A를 한도 50까지 채운다.) 기존 안내: tests/integration/categories-rls.test.ts 머리 주석.
--
-- 대상 DB: duno-dev. 이 DB는 배포판(Vercel)도 쓰는 DB다. 「운영이 아니라 괜찮다」가 아니라 「시험 계정 A의 행만, 그것도 지킬 분야를 뺀 분야와 그 분야를 가리키는 행만 지운다」라서 괜찮다.
--   모든 delete에 user_id = 〈A 사용자 id〉 조건이 붙는다. 진짜 사용자·체험(익명) 사용자의 행은 그 조건으로 막는다.
--   게다가 do 블록이 시작할 때 그 사용자가 존재하고 익명 사용자가 아니며 메일이 PM이 넣은 시험 계정 A 메일과 같은지 확인하고, 다른 사용자의 분야 수가 지우기 전과 뒤에 같은지도 확인한다(어긋나면 예외 → 전체 되돌림).
--
-- 자리표시자(실행 전에 바꾼다). 주석의 표기는 〈 〉(꺾쇠 모양이 다름)라 검색에 안 걸린다. 실행문의 표기는 ASCII 꺾쇠 < > 다.
--   〈A 사용자 id〉 : Supabase 대시보드 Authentication → Users에서 시험 계정 A의 메일로 찾아 그 행의 User UID를 복사한다(메일 주소·키는 이 파일에 쓰지 않는다).
--   〈A 메일〉     : 시험 계정 A의 메일 주소(PM이 실행할 때 넣는다. 이 파일·커밋·보고에는 실값을 쓰지 않는다). 3번 DO 블록이 그 id의 메일과 다르면 지우기 전에 멈춘다.
--   〈센 전체〉    : 1번이 낸 「전체」 숫자
--   〈센 지울 수〉  : 1번이 낸 「지울 수」 숫자
--   〈지킬 새 것 수〉: 가장 최근 분야를 몇 개 더 지킬지(권장 11 — 아래 「지킬 분야」 참고). 1번과 3번이 같은 숫자여야 한다.
--   바꿀 곳(주석 제외): 〈A 사용자 id〉 3곳(1번 세기 · 1번 목록 · 3번 DO 블록) · 〈센 전체〉 1곳 · 〈센 지울 수〉 1곳(둘 다 3번 DO 블록) · 〈지킬 새 것 수〉 4곳(1번 세기 2곳 · 1번 목록 · 3번) · 〈A 메일〉 1곳(3번 DO 블록). 모두 10곳.
--   자리표시자가 남은 채 실행하면 문법 오류로 멈춘다(지워지지 않음). 실행문(begin~commit 사이와 1번)에 꺾쇠로 감싼 자리표시자가 하나도 안 남았는지 눈으로 본다.
--   오류가 나면 먼저 `rollback;` 을 한 번 실행한다(begin 뒤에서 멈춘 트랜잭션을 닫는다). 그 뒤 자리표시자를 다시 확인해 3번을 처음부터 한 덩어리로 다시 돌린다.
--
-- 지킬 분야(근거 — tests/integration·e2e·release를 읽은 결과)
--   분야 이름은 암호문(name_encrypted)이다. 그래서 SQL로 「e2e분야…」 이름 꼴을 고를 수 없다. 이름으로 못 고르니 「A의 분야 가운데 지킬 분야를 뺀 나머지」를 지운다.
--   지킬 분야는 둘이다.
--   (1) 가장 먼저 만든 분야 1개 = created_at 오름차순(같으면 id 오름차순)의 첫 행.
--       근거: v2-rls · categories-rls · category-page-minutes · ratio-history-rls 통합 시험이 모두 「order created_at asc limit 1」로 「시험 기준 분야」를 찾아 다시 쓴다.
--       ratio-history-rls는 기준 분야가 없으면 「v2-rls를 먼저 돌린다」며 멈춘다. 이 분야를 지우면 다음 통합 시험이 새 기준 분야를 만들어 되살아나므로
--       (ratio-history-rls만 예외) 치명적이지는 않지만, 지키는 쪽이 시험 순서 의존을 피한다.
--   (2) 가장 최근에 만든 분야 〈지킬 새 것 수〉개(권장 11, 합쳐 12개).
--       근거: release 시나리오가 「시험 계정 A는 분야가 많다」를 전제로 한다. tests/release/scenarios.spec.ts S-10(칩 「+n」: 칩 줄이 두 줄에서 접히고 「분야 n개 더 보기」가 보여야 함),
--       오늘 기록 나누기·타이머의 「+n」 단언(약 270·671·689행)이 그렇다. release는 분야를 만들어 주지 않으니 분야를 다 지우면 S-10이 실패한다.
--       12개면 360px 폭 두 줄을 넘길 것으로 본다[추정 — 칩 폭은 이름 길이에 달려 있어 확인하지 않았다. 모자라면 숫자를 키운다].
--       최근 것을 고르는 까닭: 앱으로 만든 읽을 수 있는 분야(e2e분야…)가 최근 실행에 쌓이고(release S-01이 첫 칩의 글자를 읽어 단언한다), 통합 시험이 넣은 가짜 암호문 분야는 읽을 수 없다.
--       다만 둘이 섞여 있어 읽을 수 있는 분야가 몇 개 남는지는 SQL로 가를 수 없다[미확인].
--   그래서 「전부 지우고 시험이 다시 만든다」안은 쓰지 않았다. 그 안이라면: ratio-history-rls는 기준 분야를 못 찾아 멈추고(v2-rls를 먼저 돌려야 함),
--   v2-rls · categories-rls · category-page-minutes가 첫 실행에 기준 분야를 하나씩 만들며(실제로는 먼저 도는 시험이 만든 하나를 나머지가 다시 씀),
--   e2e todo-flow는 분야 하나를 만들고, release S-10은 분야가 모자라 「+n」이 안 보여 실패한다(release는 분야를 만들지 않음).
--
-- 외래 키(supabase/migrations/*.sql을 읽은 결과). categories를 가리키는 키는 모두 복합 키 (category_id, user_id) → categories (id, user_id), on delete RESTRICT 다:
--   표                 | 키 이름                                | 규칙     | 여기서 하는 일
--   todos              | todos_category_owner_fkey              | restrict | 지울 분야를 가리키는 할 일을 지움(할 일은 시험 데이터)
--   category_ratios    | category_ratios_category_owner_fkey    | restrict | 지울 분야의 행을 지움
--   focus_sessions     | focus_sessions_category_owner_fkey     | restrict | 지울 분야의 행을 지움(category_id는 null 가능, null은 건드리지 않음)
--   todo_offers        | todo_offers_category_owner_fkey        | restrict | 지울 분야의 행을 지움(category_id는 null 가능)
--   todo_notes → todos | todo_notes_todo_owner_fkey (todo_id, user_id) | cascade | 할 일을 지우면 따라 지워진다. 그래도 한 번 더 명시로 지운다
--   (category_ratio_history · evening_logs · weekly_goals는 외래 키가 없다 — 아래 json 칸)
--   지우는 순서: todo_notes → focus_sessions → todo_offers → category_ratios → todos → categories. 모두 user_id = 〈A 사용자 id〉 조건.
--   focus_sessions.todo_id · todo_offers.todo_id는 todos를 가리키는 외래 키가 아니라(마이그레이션에 없음) 지운 할 일을 가리키는 값이 남을 수 있다. 지울 분야의 행은 이미 지우므로 대개 남지 않는다.
--
-- json 칸에 들어 있는 분야 id(외래 키 없음 — 이 SQL은 그대로 둔다):
--   evening_logs.items [{categoryId, minutes}] · weekly_goals.items [{categoryId, minutes}] · category_ratio_history.ratios [{category_id, percent}].
--   지운 분야의 id가 이 칸들에 남는다. 외래 키가 없어 DB는 막지 않는다. 그대로 두는 까닭: 이 표들은 시험이 쓰고 다시 덮어쓰며(release가 이번 주 목표를 세우고 오늘 기록을 남긴다),
--   칸 안을 고치면 합 100 · 1~50개 같은 검사 제약을 깰 위험이 있다. 앱이 목록에 없는 분야 id를 어떻게 보이는지는 확인하지 않았다[미검증 — 정리 뒤 A로 상태보기를 한 번 열어 본다].
--   앱에서 거슬리면 A의 weekly_goals · evening_logs · category_ratio_history를 통째로 지우는 길이 있다(이 파일은 하지 않음 — 결정이 필요하면 따로).
--
-- 순서: 세기(1번) → 수 확인(2번) → 지우기 한 번 실행(3번: begin · do 블록 · commit이 한 덩어리). 3번은 반드시 한 번에 선택해 실행한다.
--   do 블록 안에서 지우기 전 수 · 지운 수 · 남은 수를 검사하고, 어긋나면 예외로 전체가 되돌려지며, 맞으면 같은 덩어리 끝의 commit으로 확정한다(docs/oneshot-v2/부하시험-정리.sql과 같은 꼴).
--
-- 정리 뒤 확인(5): A의 분야 수 = min(전체, 1 + 〈지킬 새 것 수〉). 권장값이면 전체가 12 이상일 때 12개. 1번 세기를 다시 돌려 「전체」가 그 수이고 「지울 수」가 0인지 본다.
--   그 뒤 e2e todo-flow를 다시 돌리면 e2e분야<접미사> 하나가 새로 생겨 13개가 된다(한 번에 +1). 통합 시험 categories-rls를 돌리면 「512자 통과」 행이 하나 더 쌓인다(+1). 오래 돌리면 다시 쌓이니 이 파일을 다시 쓴다.
--   categories-limit(DUNO_CATEGORY_LIMIT_TEST=1)을 돌렸으면 A가 50개까지 차 있으니 그 뒤에 다시 정리한다.
--
-- 다음 판 후보(앱·권한 변경이 필요할 수 있어 여기서는 하지 않음)
--   - 시험이 자기가 만든 분야를 지우거나 다시 쓰게 하기: 지금은 categories에 delete grant가 없다. (a) e2e todo-flow가 접미사 분야를 새로 만들지 않고 기준 분야를 다시 쓰게 고친다(앱 코드 변경 없이 시험만 고칠 수 있음, 가장 안전).
--     (b) 시험 전용 DB 함수(security definer)로 시험 계정 분야 지우기 — 새 권한이라 PM 결정이 필요하다. (c) 한도를 시험 계정에서만 올린다 — 같은 까닭으로 비권장.
--   - 이 파일을 시험 계정 이름·역할로 자동 고르게 하려면 분야 이름 암호문 말고 쓸 표시(예: 시험 계정 표시 열)가 필요하다.

-- =====================================================================
-- 1. 먼저 세기 (읽기만 한다)
-- =====================================================================
-- 1-1. 수: 전체(보관 포함) · 보관 제외 · 보관된 것 · 지킬 수 · 지울 수
with mine as (
  select c.id, c.created_at, c.archived_at,
         row_number() over (order by c.created_at asc,  c.id asc)  as oldest_rank,
         row_number() over (order by c.created_at desc, c.id desc) as newest_rank
  from public.categories c
  where c.user_id = '<A 사용자 id>'::uuid
)
select
  count(*)                                              as 전체,
  count(*) filter (where archived_at is null)           as 보관_제외,
  count(*) filter (where archived_at is not null)       as 보관됨,
  count(*) filter (where oldest_rank = 1 or newest_rank <= <지킬 새 것 수>)      as 지킬_수,
  count(*) filter (where not (oldest_rank = 1 or newest_rank <= <지킬 새 것 수>)) as 지울_수
from mine;

-- 1-2. (선택) 지울 분야를 훑어보기: 번호와 만든 때만(분야 이름은 암호문이라 못 읽는다)
with mine as (
  select c.id, c.created_at, c.archived_at,
         row_number() over (order by c.created_at asc,  c.id asc)  as oldest_rank,
         row_number() over (order by c.created_at desc, c.id desc) as newest_rank
  from public.categories c
  where c.user_id = '<A 사용자 id>'::uuid
)
select id, created_at, archived_at,
       case when oldest_rank = 1 or newest_rank <= <지킬 새 것 수> then '지킴' else '지움' end as 처리
from mine
order by created_at asc, id asc;

-- 1-3. (선택) 지울 분야를 가리키는 다른 표 행 수가 예상 범위인지 보기는 3번의 do 블록이 지우기 전에 알려 준다(notice).

-- =====================================================================
-- 2. 센 수를 눈으로 확인한 뒤에만 3번으로 간다
--    · 전체가 50에 가깝거나 50이고, 지울 수가 전체 − 지킬 수와 맞는지
--    · 보관(archived) 분야 = 0인지(1-1의 「보관됨」). 0이 아니면 지울 분야에 보관한 것이 섞이니 이유를 먼저 본다
--    · 〈A 사용자 id〉가 정말 시험 계정 A인지(Authentication → Users에서 같은 메일로 다시 확인)
-- =====================================================================

-- =====================================================================
-- 3. 지우기 (한 번 실행). 아래 begin부터 commit까지를 한꺼번에 선택해 실행한다.
-- =====================================================================
begin;

do $$
declare
  a_id         uuid   := '<A 사용자 id>'::uuid;
  keep_newest  int    := <지킬 새 것 수>;   -- 바꿀 곳: 1번과 같은 숫자
  exp_total    bigint := <센 전체>;          -- 바꿀 곳: 1-1이 낸 전체
  exp_delete   bigint := <센 지울 수>;       -- 바꿀 곳: 1-1이 낸 지울 수
  a_email      text   := '<A 메일>';        -- 바꿀 곳: 시험 계정 A의 메일(PM이 넣는다)
  is_anon      boolean;
  real_email   text;
  total_before bigint;
  others_before bigint;
  del_ids      uuid[];
  keep_ids     uuid[];
  n            bigint;
  n_cat        bigint;
  total_after  bigint;
  others_after bigint;
  left_over    bigint;
begin
  -- 지키는 장치 1: 그 사용자가 있고, 익명(체험) 사용자가 아니고, 메일이 넣은 시험 계정 A 메일과 같다
  select u.is_anonymous, u.email into is_anon, real_email from auth.users u where u.id = a_id;
  if not found then
    raise exception '그 사용자 id가 없어요. 지우지 않고 멈춰요.';
  end if;
  if is_anon then
    raise exception '익명(체험) 사용자예요. 시험 계정 A가 아니에요. 지우지 않고 멈춰요.';
  end if;
  -- 지키는 장치 1-2: 그 id의 메일이 PM이 넣은 시험 계정 A 메일과 같아야 한다(id를 잘못 붙여 진짜 사용자를 지우지 않게)
  if real_email is null or lower(real_email) <> lower(a_email) then
    raise exception '그 id의 메일이 넣은 시험 계정 A 메일과 달라요. 지우지 않고 멈춰요.';
  end if;

  select count(*) into total_before from public.categories where user_id = a_id;
  select count(*) into others_before from public.categories where user_id <> a_id;
  if total_before <> exp_total then
    raise exception '센 전체(%)와 지금 분야 수(%)가 달라요. 지우지 않고 멈춰요.', exp_total, total_before;
  end if;

  -- 지킬 분야: 가장 먼저 만든 1개 + 가장 최근 keep_newest개
  select coalesce(array_agg(t.id), '{}') into keep_ids
  from (
    select c.id,
           row_number() over (order by c.created_at asc,  c.id asc)  as oldest_rank,
           row_number() over (order by c.created_at desc, c.id desc) as newest_rank
    from public.categories c
    where c.user_id = a_id
  ) t
  where t.oldest_rank = 1 or t.newest_rank <= keep_newest;

  select coalesce(array_agg(c.id), '{}') into del_ids
  from public.categories c
  where c.user_id = a_id and not (c.id = any(keep_ids));

  if coalesce(array_length(del_ids, 1), 0) <> exp_delete then
    raise exception '센 지울 수(%)와 지금 조건에 맞는 수(%)가 달라요. 지우지 않고 멈춰요.', exp_delete, coalesce(array_length(del_ids, 1), 0);
  end if;
  if coalesce(array_length(keep_ids, 1), 0) + coalesce(array_length(del_ids, 1), 0) <> total_before then
    raise exception '지킬 수와 지울 수의 합이 전체와 달라요. 되돌려요.';
  end if;

  -- 지울 분야를 가리키는 행(자식 → 부모). 모두 user_id = a_id 조건
  delete from public.todo_notes
   where user_id = a_id
     and todo_id in (select t.id from public.todos t where t.user_id = a_id and t.category_id = any(del_ids));
  get diagnostics n = row_count;
  raise notice 'todo_notes 지움: %', n;

  delete from public.focus_sessions where user_id = a_id and category_id = any(del_ids);
  get diagnostics n = row_count;
  raise notice 'focus_sessions 지움: %', n;

  delete from public.todo_offers where user_id = a_id and category_id = any(del_ids);
  get diagnostics n = row_count;
  raise notice 'todo_offers 지움: %', n;

  delete from public.category_ratios where user_id = a_id and category_id = any(del_ids);
  get diagnostics n = row_count;
  raise notice 'category_ratios 지움: %', n;

  delete from public.todos where user_id = a_id and category_id = any(del_ids);
  get diagnostics n = row_count;
  raise notice 'todos 지움: %', n;

  -- 분야(맨 마지막)
  delete from public.categories where user_id = a_id and id = any(del_ids);
  get diagnostics n_cat = row_count;
  if n_cat <> exp_delete then
    raise exception '지운 분야 수(%)가 센 지울 수(%)와 달라요. 되돌려요.', n_cat, exp_delete;
  end if;

  -- 지운 뒤 검사
  select count(*) into total_after from public.categories where user_id = a_id;
  if total_after <> total_before - exp_delete then
    raise exception '남은 분야 수(%)가 예상(%)과 달라요. 되돌려요.', total_after, total_before - exp_delete;
  end if;

  select count(*) into left_over from public.categories where id = any(del_ids);
  if left_over <> 0 then
    raise exception '지운 분야가 % 개 남아 있어요. 되돌려요.', left_over;
  end if;

  select count(*) into left_over from public.categories where user_id = a_id and id = any(keep_ids);
  if left_over <> coalesce(array_length(keep_ids, 1), 0) then
    raise exception '지키기로 한 분야가 줄었어요. 되돌려요.';
  end if;

  select count(*) into others_after from public.categories where user_id <> a_id;
  if others_after <> others_before then
    raise exception '다른 사용자의 분야 수가 바뀌었어요(% → %). 되돌려요.', others_before, others_after;
  end if;
end $$;

commit;
