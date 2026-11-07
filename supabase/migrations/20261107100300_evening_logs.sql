-- 원샷 v2 ②: 저녁 기록. PRD 7-3, 8절(저장 방식·대상 날·저장 시각 기록, G9).
-- 새 표 하나(evening_logs). 기존 표·열은 건드리지 않는다.
-- 저장할 때마다 한 행이 쌓인다(고쳐 쓰지도 지우지도 않는다: 계측이 「저장할 때마다」 남기므로). 그 날의 현재 기록은 가장 늦게 저장한 행이다.
-- 시각은 서버 시계(saved_at)와 기기 시계(client_saved_at)를 둘 다 남긴다(기록 위조 막기와 오프라인 저장을 맞추는 방법, PRD 10절).

create table public.evening_logs (
  -- 화면이 만든 uuid(같은 저장을 다시 보내도 새 행을 만들지 않으려고)
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null default auth.uid()
    constraint evening_logs_user_id_fkey references auth.users (id) on delete restrict,

  -- 대상 날(그 기록이 가리키는 두노 하루, 새벽 4시 기준은 앱이 정한다). 저장한 날과 다를 수 있다(어제 것 기록).
  target_day date not null,

  -- 그날 쓴 시간(분). 항목 시간의 합과 같다(앱이 검사한다).
  total_minutes integer not null,

  -- 분야마다 쓴 시간: [{ "categoryId": uuid 또는 null(기타), "minutes": 분 }]. 같은 분야는 한 번만.
  items jsonb not null default '[]'::jsonb,

  -- 저장 방식: 미리 채운 그대로(prefilled), 고침(edited), 나누지 않음(not_split)
  save_mode text not null,

  -- 서버가 저장한 시각(기록 위조 막기). 기기 시계는 따로 남긴다.
  saved_at timestamptz not null default now(),
  client_saved_at timestamptz null,

  constraint evening_logs_total_range check (total_minutes between 0 and 1440),
  constraint evening_logs_items_shape check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 51),
  constraint evening_logs_save_mode_values check (save_mode in ('prefilled', 'edited', 'not_split'))
);

comment on table public.evening_logs is '저녁 기록(PRD 7-3). 저장할 때마다 한 행(쌓기만 한다). 그 날의 현재 값은 target_day별 가장 늦은 saved_at 행.';

create index evening_logs_user_day_idx on public.evening_logs (user_id, target_day, saved_at);

revoke all on table public.evening_logs from public;
revoke all on table public.evening_logs from anon;
revoke all on table public.evening_logs from authenticated;

grant select on table public.evening_logs to authenticated;
-- saved_at은 기본값(서버 시계)만 쓴다: 넣는 열에 없다. update·delete는 주지 않는다.
grant insert (id, user_id, target_day, total_minutes, items, save_mode, client_saved_at)
  on table public.evening_logs to authenticated;

alter table public.evening_logs enable row level security;

create policy evening_logs_select_own on public.evening_logs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy evening_logs_insert_own on public.evening_logs
  for insert to authenticated with check ((select auth.uid()) = user_id);

-- 한 사용자 행 수 상한. 임시, 결정 필요: 20000(하루 몇 번 고쳐 저장해도 수십 년 치).
create function private.evening_logs_enforce_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  log_limit constant integer := 20000; -- 임시, 결정 필요
  existing integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('evening_logs:' || new.user_id::text, 0));
  select pg_catalog.count(*) into existing from public.evening_logs l where l.user_id = new.user_id;
  if existing >= log_limit then
    raise exception 'evening log limit reached' using errcode = 'P0001', hint = 'evening_logs_limit';
  end if;
  return new;
end;
$$;

revoke all on function private.evening_logs_enforce_limit() from public;
revoke all on function private.evening_logs_enforce_limit() from anon;
revoke all on function private.evening_logs_enforce_limit() from authenticated;

create trigger evening_logs_enforce_limit
  before insert on public.evening_logs
  for each row execute function private.evening_logs_enforce_limit();
