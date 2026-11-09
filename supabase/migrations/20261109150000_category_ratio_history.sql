-- 원샷 v2 고침 9바퀴: 목표 비율이 바뀐 기록(PM 「152 나」 — 이번에는 저장만, 보이기는 다음 판).
-- 새 표 하나(category_ratio_history). 기존 표·열·데이터는 건드리지 않는다. 쌓기만 한다(고쳐 쓰지도 지우지도 않는다).
-- 왜: category_ratios는 (사용자, 분야) 한 줄을 덮어써서 옛 값이 사라진다. 상태보기에서 기간별로 계획이 바뀐 것을 보여 주려면 바뀐 때의 묶음이 남아야 한다.
-- 한 행 = 목표 비율을 저장한 한 번: 언제(recorded_at, 서버 시계) · 무엇으로(ratios, 그때 저장한 분야별 % 묶음, 기타 포함).
-- 앱(lib/settings/ratio-history.ts)이 비율 저장(saveRatiosForUser)이 성공한 뒤 같은 요청에서 세션 클라이언트로 한 줄 넣는다. 직전 기록과 같은 묶음이면 넣지 않는다.
-- ratios 모양(배열, [{category_id: uuid|null(기타), percent: 0~100 정수}], 분야 중복 없음, 합 100)은 앱이 zod로 검사한다. DB는 가벼운 check만 둔다(무거운 트리거 없음).
-- 기존 사용자의 지금 비율을 첫 줄로 옮기지 않는다(backfill 없음). 다음 저장부터 쌓인다.
-- 앞 파일에 기대는 것: (없음). 이 표가 없어도 앱은 돈다(기록 쓰기만 실패하고 비율 저장은 성공으로 돌려준다).

create table public.category_ratio_history (
  id uuid primary key default gen_random_uuid(),

  -- category_ratios와 같은 참조·삭제 규칙(auth.users, on delete restrict)
  user_id uuid not null default auth.uid()
    constraint category_ratio_history_user_id_fkey references auth.users (id) on delete restrict,

  -- 저장한 때(서버 시계). 앱은 이 열을 보내지 못한다(insert 권한에 없음)
  recorded_at timestamptz not null default now(),

  -- 그때 저장한 묶음. 분야 번호는 외래 키로 묶지 않는다(분야가 나중에 보관돼도 기록은 그대로 남는다)
  ratios jsonb not null,

  constraint category_ratio_history_ratios_array check (jsonb_typeof(ratios) = 'array'),
  -- 분야 상한(50, 기타 포함)과 같은 개수 상한, 큰 값을 직접 넣는 것을 막는 크기 상한(가벼운 값 검사)
  constraint category_ratio_history_ratios_count check (jsonb_array_length(ratios) between 1 and 50),
  constraint category_ratio_history_ratios_size check (octet_length(ratios::text) <= 8192)
);

comment on table public.category_ratio_history is '목표 비율이 바뀐 기록(쌓기만). 사용자는 자기 행만 읽고 넣는다(RLS). ratios: [{category_id: uuid|null(기타), percent}], 합 100.';

-- 직전 기록 읽기(자기 행 최신 하나)와 기간별 읽기
create index category_ratio_history_user_recorded_idx on public.category_ratio_history (user_id, recorded_at);

revoke all on table public.category_ratio_history from public;
revoke all on table public.category_ratio_history from anon;
revoke all on table public.category_ratio_history from authenticated;

-- grant를 명시한다(새 표는 grant가 있어야 API에 보인다). authenticated에 select·insert만. anon에는 주지 않는다.
grant select on table public.category_ratio_history to authenticated;
-- id·recorded_at은 기본값만 쓴다(서버 시계를 앱이 바꾸지 못한다). update·delete는 주지 않는다.
grant insert (user_id, ratios) on table public.category_ratio_history to authenticated;

alter table public.category_ratio_history enable row level security;

create policy category_ratio_history_select_own on public.category_ratio_history
  for select to authenticated using ((select auth.uid()) = user_id);
create policy category_ratio_history_insert_own on public.category_ratio_history
  for insert to authenticated with check ((select auth.uid()) = user_id);
-- update·delete 정책은 두지 않는다(쌓기만 하는 기록: 남도 자기도 고치거나 지우지 못한다).
