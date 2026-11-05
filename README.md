# Duno_app

두노(Duno) 앱의 개발 저장소입니다. 오늘 할 일을 적고 끝냈는지 표시하는 PWA로, Next.js와 Supabase로 만들었습니다.

## 실행

Node와 npm이 필요합니다(Node 24.18, npm 11.16에서 확인).

```bash
npm ci
cp .env.example .env.local   # 값을 채운다
npm run dev                  # http://localhost:3000
```

## 비밀값

앱이 쓰는 환경 변수 이름과 설명은 `.env.example`에 있습니다. 실제 값은 `.env.local`에 넣고, 이 파일은 커밋하지 않습니다(`.gitignore`에 들어 있음).

## 검사

```bash
npm test            # 단위 시험
npm run typecheck
npm run lint
npm run build
npm run test:rls    # Supabase RLS 시험. .env.local 필요
npm run e2e         # Playwright. .env.local과 설치된 Chrome 필요
```

## 비밀 검사 훅

커밋할 때마다 `.githooks/pre-commit`이 staged 변경에서 키처럼 보이는 문자열을 찾고, 걸리면 커밋을 막습니다. 클론할 때마다 한 번 켭니다.

```bash
git config core.hooksPath .githooks
```
