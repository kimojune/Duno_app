# duno-app 진입 지침

두노 앱 코드다. Next.js 16 · React 19 · Supabase.

## 브랜치

- `main`은 배포판이다. Vercel이 여기를 배포한다. 직접 커밋하지 않는다
- 작업은 `dev`에 모은다. Orca 작업 브랜치는 `dev`에서 갈라 `dev`로 합친 뒤 지운다. GitHub에는 `main`과 `dev`만 올린다
- `dev`를 `main`에 합치는 것과 push는 사용자 승인으로만 한다. 순서: 검사 통과 → 운영 DB 마이그레이션 → 합치기 → 배포 확인

## 검사

- `npm run typecheck` · `npm run lint` · `npm test` · `npm run test:rls`(DB 권한) · `npm run e2e`
- 돌려보지 않은 것은 「미검증」이라 적는다

## 비밀값과 DB

- `.env.local`은 개발 DB를 가리킨다. 읽거나 출력하지 않는다
- 커밋 전에 비밀 검사 훅(`.githooks`)이 돈다. `--no-verify`로 우회하지 않는다
- 운영 DB에 닿는 명령(마이그레이션, reset)은 사용자가 직접 한다

## 기록

- 실행·검사 방법은 `README.md`, 원샷 v2 시험 기록은 `docs/oneshot-v2/`
