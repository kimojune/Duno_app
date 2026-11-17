# 운영 DB 분리(MO-23) — PM이 붙여 쓰는 명령과 확인 쿼리

**결론**: 새 Supabase 프로젝트(운영)에 마이그레이션 1~11번을 적용하고, Vercel Production 값만 그쪽으로 바꿔 다시 배포한다. 데이터는 옮기지 않는다. duno-dev는 개발·시험 전용으로 남는다. 이 문서의 명령은 **22가 돌려 보지 않았다(미실행)**. 값은 적지 않는다 — `<…>` 자리에 PM이 넣는다.

PM 결정(11-17 「추천대로 진행해」): ① 데이터 안 옮김 ② 무료 + 주 1회 손 dump, 실사용 날 Pro ③ 지금 Google OAuth 클라이언트에 새 콜백 주소만 더함 ④ 운영 이메일 로그인 끔 ⑤ 운영용 새 암호화 키 ⑥ 분리 때 1~11번만, 12번(MO-46)은 검토 통과 뒤 duno-dev 먼저 → 운영

전체 순서: 1 새 프로젝트 → **2 마이그레이션(이 문서)** → 3 Auth 설정 → 4 값 만들기 → 5 Vercel Production 값·다시 배포 → 6 알림 예약 → **7 확인(이 문서)**

---

## 2. 마이그레이션 1~11번 적용

**어디서**: Duno_app 메인 작업 폴더의 터미널(이 저장소 루트)
**먼저 볼 것**: `supabase/migrations/`에 1~11번(20261104160723 … 20261109150000)만 있는 판인지 본다. 12번(`20261117100000_goal_bundles.sql`)이 있는 판이면 이번에는 적용하지 않는다(결정 ⑥) — 그 파일이 없는 main에서 한다.

```bash
# 2-1. 새 프로젝트에 잇는다(로그인이 필요하면 supabase login 먼저)
supabase link --project-ref <새 운영 project ref>

# 2-2. 무엇이 적용될지만 본다. 1~11번이 시각 순서대로 11줄 나와야 한다
supabase db push --dry-run

# 2-3. 적용한다
supabase db push

# 2-4. 로컬·원격 열이 1~11번 모두 같은지 본다
supabase migration list

# 2-5. 끝나면 반드시 끊는다. 안 끊으면 다음 supabase 명령이 운영으로 간다
supabase unlink
```

- **연결이 안 되면**(직접 연결은 IPv6): 대시보드 Connect → Session pooler 연결 문자열을 환경 변수에 넣고 `--db-url "$PROD_DB_URL"`로 준다. 비밀번호가 든 문자열을 명령줄에 직접 치지 않는다.
- **11번**(category_ratio_history)도 같이 적용한다. 빼면 뒤 번호가 꼬인다.
- **확인**: 2-2가 11줄, 2-4에서 1~11번이 로컬·원격 둘 다에 있다.
- **되돌리기**: 빈 새 프로젝트라 지우고 1단계부터 다시 하는 것이 가장 쉽다.

### 2-6. 적용 직후 SQL Editor(새 프로젝트)에서

```sql
-- RLS가 꺼진 public 표: 0행이어야 한다
select c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','p') and not c.relrowsecurity and n.nspname = 'public';

-- anon에 준 표 권한: 0행이어야 한다
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public';

-- 표 목록: todos, categories, todo_notes, user_settings, category_ratios, evening_logs,
-- view_events, focus_sessions, todo_offers, weekly_goals, push_subscriptions, category_ratio_history 12개
select table_name from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
order by table_name;
```

---

## 7. 전환 뒤 확인

**순서**: 5(다시 배포)와 6(알림 예약)을 마친 뒤.

### 7-1. 브라우저(운영 주소)
- Google 로그인 → 운영 주소로 돌아온다(localhost나 프리뷰로 가면 3단계 URL Configuration을 다시 본다)
- 처음 설정 → 할 일 하나 적기 → 체험 시작이 된다
- 개발자 도구 Network에서 Supabase 요청 주소의 ref가 **새 운영 ref**다. 프리뷰 주소에서는 **duno-dev ref**다

### 7-2. SQL Editor(새 운영 프로젝트)

```sql
-- 로그인한 만큼만 사용자가 있다(PM 본인 + 체험). 수십 이상이면 duno-dev를 보고 있는지 의심
select count(*) as users, count(*) filter (where is_anonymous) as anonymous_users
from auth.users;

-- 막 적은 할 일이 들어왔다(글은 암호문이라 보지 않고 개수만)
select count(*) from public.todos;

-- 이메일 로그인이 꺼졌다면(결정 ④) 이메일·비밀번호로 만든 계정이 없다: 0이어야 한다
select count(*) from auth.users u
where not u.is_anonymous
  and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'google');

-- 알림 예약이 하나 있다
select jobname, schedule from cron.job;

-- 15분쯤 뒤: 최근 예약 실행 응답이 200이다(401 = 비밀 불일치, 503 = Vercel 값 빠짐)
-- 칼럼 이름이 다르면 먼저 select * from net._http_response limit 1; 로 본다
select status_code, created from net._http_response order by created desc limit 3;
```

### 7-3. 터미널
- 비밀 없이 부르기: `curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<운영 주소>/api/notify/tick` → `401`
- Vercel 값 이름이 환경마다 있다(값은 화면에 안 나온다): `vercel env ls production` · `vercel env ls preview`

### 7-4. duno-dev(개발 DB) 쪽
- 거기 알림 예약을 걸었었다면 `docs/oneshot-v2/알림-예약/notify-cron-unschedule.sql`을 duno-dev SQL Editor에서 돌려 지운다. 확인: duno-dev에서 `select count(*) from cron.job where jobname = 'duno-notify-tick';` → 0
- 대시보드 이름을 「개발·시험 전용」으로 바꾼다. 로컬 `.env.local`은 계속 duno-dev를 가리킨다

**되돌리기**: Vercel → Deployments에서 바로 전 운영 배포로 Instant Rollback. 그 배포는 duno-dev 값을 박은 채라 곧바로 옛 상태로 돌아간다.

---

## 주 1회 손 dump(결정 ②)

**어디서**: PM 컴퓨터 터미널. 결과 파일은 저장소 밖의 개인 폴더에 둔다(커밋 금지).
**먼저**: `supabase db dump --help`로 옵션 이름을 확인한다(22 미실행).

```bash
# PROD_DB_URL: 대시보드 Connect의 Session pooler 문자열(환경 변수로만)
supabase db dump --db-url "$PROD_DB_URL" -f <날짜>-roles.sql --role-only
supabase db dump --db-url "$PROD_DB_URL" -f <날짜>-schema.sql
supabase db dump --db-url "$PROD_DB_URL" -f <날짜>-data.sql --use-copy --data-only
```

- **확인**: 세 파일이 생기고 비어 있지 않다. data 파일에 `COPY public.todos`가 있다.
- dump 속 할 일·분야·목표 글은 암호문이다. 되살리려면 **운영 TODO_ENCRYPTION_KEY를 따로 보관**해야 한다(결정 ⑤의 새 키).
- 무료 프로젝트는 1주 활동이 없으면 멈춘다. 멈추면 알림도 선다. 실사용자를 받는 날 Pro로 바꾼다.
