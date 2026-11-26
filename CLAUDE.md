# duno-app 진입 지침

두노 앱 코드다. Next.js 16 · React 19 · Supabase.

## 브랜치

- `main`은 배포판이다. Vercel이 여기를 배포한다. 직접 커밋하지 않는다
- 작업은 `dev`에 모은다. 작업 브랜치는 `dev`에서 따고, GitHub PR로 `dev`에 squash merge한다. 이 PC에서 `dev`로 바로 합치지 않는다
- 작업 브랜치는 따로 만든 작업 폴더(Orca worktree, `orca worktree create`)에서 연다. 본 폴더 `duno-app`은 늘 `dev`에 두고, 본 폴더에서 브랜치를 바꾸지 않는다
- 작업 브랜치는 PR을 여는 동안만 GitHub에 둔다. 합칠 때 `--delete-branch`로 지운다(GitHub 자동 삭제는 꺼 두었다. 켜면 배포 PR 때 `dev`가 지워진다)
- `dev`를 `main`에 합치는 배포 PR은 squash가 아니라 `gh pr merge --merge`로 합친다. squash로 합치면 두 가지의 이력이 갈라진다
- `dev`를 `main`에 합치는 것과 push는 사용자 승인으로만 한다. 순서: 검사 통과 → DB 마이그레이션(개발 DB, 배포 사이트도 이 DB를 본다) → 합치기 → 배포 확인

## 검사

- `npm run typecheck` · `npm run lint` · `npm test` · `npm run test:rls`(DB 권한) · `npm run e2e`
- 돌려보지 않은 것은 「미검증」이라 적는다

## 비밀값과 DB

- `.env.local`은 개발 DB를 가리킨다. 읽거나 출력하지 않는다
- 커밋 전에 비밀 검사 훅(`.githooks`)이 돈다. `--no-verify`로 우회하지 않는다
- 운영 DB에 닿는 명령(마이그레이션, reset)은 사용자가 직접 한다

## 마이그레이션 적용

- 두노는 개발 DB(duno-dev, ref `tkowlkdkghhmdhhyyhwg`) 하나만 쓴다. 배포 사이트도 개발 DB를 본다. 운영 DB(duno-prod, ref `nsucccmnrnkkuyvjnvyw`)는 쓰지 않고 그대로 둔다(2026-11-27 결정, DU-d16)
- 개발 DB 연결은 Supabase MCP로 한다(DU-d31). 서버는 `.mcp.json`의 `duno-dev`다. 주소의 `project_ref`가 개발 DB(`tkowlkdkghhmdhhyyhwg`)로 묶여 있다. 이 주소를 바꾸지 않는다
- 사용자가 처음 한 번 허락한다. 일반 터미널에서 `claude`를 열고 `/mcp` → `duno-dev` → 「Authenticate」를 고르면 브라우저가 열린다. Supabase에 로그인하고 개발 DB가 든 org를 고른다
- AI는 개발 DB에만 적용한다. MCP 서버 `duno-dev`만 쓴다. 운영 DB(`nsucccmnrnkkuyvjnvyw`)에는 붙지 않는다. 그 ref를 어디에도 쓰지 않는다
- 적용하는 법
  1. `supabase/migrations`의 새 파일이 「더하기만」(새 표·열·정책 추가)인지 본다. 기존 표·열·정책을 바꾸거나 지우는 마이그레이션, 데이터를 지우는 SQL은 사용자에게 묻는다
  2. MCP `list_migrations`로 원격 기록을 보고, 이미 적용된 파일은 건너뛴다
  3. 파일 내용을 MCP `apply_migration`으로 적용한다. `name`은 파일 이름에서 앞 숫자와 `.sql`을 뺀 것이다
  4. 적용 뒤 `list_migrations`로 기록이 생겼는지 본다
- 원격 기록과 파일 이름이 어긋날 수 있다. `apply_migration`은 `name`과 `query`만 받고 version(파일 이름 앞 숫자)을 받지 않는다. 원격 version은 서버가 정한다[미확인: 어떤 값으로 정하는지 문서에 없다]. 적용 뒤 `list_migrations`의 version이 파일 앞 숫자와 다르면, 아직 `dev`에 합치지 않은 그 파일의 이름 앞 숫자를 원격 version으로 바꿔 맞춘다
- MCP의 SQL 실행 도구(`execute_sql`)는 읽기에만 쓴다. 이 도구로 데이터를 바꾸거나 지우지 않는다
- 진짜 데이터가 쌓인 뒤에는 적용 전에 백업한다
- MCP 도구 호출은 shell-guard와 홈 deny가 보지 못한다. 위 규칙은 AI가 스스로 지킨다
- 적용한 뒤 `npm run test:rls`와 관련 시험으로 확인한다
- Supabase 연결(MCP)을 두지 않는다던 2026-11-26 결정(WS-d32)은 DU-d31 가로 되살림. 승인이 org 단위라 토큰이 운영 DB에도 닿는 위험은 사용자가 알고 골랐다

## 기록

- 실행·검사 방법은 `README.md`, 원샷 v2 시험 기록은 `docs/oneshot-v2/`
