# duno-app 진입 지침

두노 앱 코드다. Next.js 16 · React 19 · Supabase.

## 브랜치

- `main`은 배포판이다. Vercel이 여기를 배포한다. 직접 커밋하지 않는다
- 작업은 `dev`에 모은다. 작업 브랜치는 `dev`에서 따고, GitHub PR로 `dev`에 squash merge한다. 이 PC에서 `dev`로 바로 합치지 않는다
- 작업 브랜치는 따로 만든 작업 폴더(Orca worktree, `orca worktree create`)에서 연다. 본 폴더 `duno-app`은 늘 `dev`에 두고, 본 폴더에서 브랜치를 바꾸지 않는다
- 작업 브랜치는 PR을 여는 동안만 GitHub에 둔다. 합칠 때 `--delete-branch`로 지운다(GitHub 자동 삭제는 꺼 두었다. 켜면 배포 PR 때 `dev`가 지워진다)
- `dev`를 `main`에 합치는 배포 PR은 squash가 아니라 `gh pr merge --merge`로 합친다. squash로 합치면 두 가지의 이력이 갈라진다
- `dev`를 `main`에 합치는 것과 push는 사용자 승인으로만 한다. 순서: 검사 통과 → 운영 DB 마이그레이션 → 합치기 → 배포 확인

## 검사

- `npm run typecheck` · `npm run lint` · `npm test` · `npm run test:rls`(DB 권한) · `npm run e2e`
- 돌려보지 않은 것은 「미검증」이라 적는다

## 비밀값과 DB

- `.env.local`은 개발 DB를 가리킨다. 읽거나 출력하지 않는다
- 커밋 전에 비밀 검사 훅(`.githooks`)이 돈다. `--no-verify`로 우회하지 않는다
- 운영 DB에 닿는 명령(마이그레이션, reset)은 사용자가 직접 한다

## 마이그레이션 적용

- AI는 개발 DB에만 적용한다. 연결은 `.mcp.json`의 `duno-dev`다. 주소의 `project_ref`가 개발 DB(`tkowlkdkghhmdhhyyhwg`)로 묶여 있다. 이 주소를 바꾸지 않는다
- 적용한 뒤 `npm run test:rls`와 관련 시험으로 확인한다
- AI는 `supabase link`와 `--linked`가 붙은 명령을 돌리지 않는다. 연결된 프로젝트가 운영 DB다
- 운영 DB는 사용자가 적용한다. 처음 한 번 `supabase link --project-ref <운영 ref>`로 연결한다
  1. `supabase db push --linked --dry-run`으로 적용될 파일을 본다
  2. `supabase db push --linked`로 적용한다

## 기록

- 실행·검사 방법은 `README.md`, 원샷 v2 시험 기록은 `docs/oneshot-v2/`
