# Duno_app

두노(Duno) 앱의 개발 저장소입니다. 오늘 할 일을 적고 끝냈는지 표시하는 PWA로, Next.js와 Supabase로 만들었습니다.

## 실행

Node와 npm이 필요합니다(Node 24.18, npm 11.16에서 확인).

```bash
npm ci
cp .env.example .env.local   # 값을 채운다
npm run dev                  # http://localhost:3000 (이 컴퓨터에서만 듣는다. 127.0.0.1이 아니라 localhost로 연다:
                             #  Supabase 로그인 돌아오는 주소가 http://localhost:3000/... 이다)
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

## 원샷 v2 틀(2026-11-07)

전체 틀(할 일 기본 기능·처음 설정·저녁 기록·상태보기·타이머·먼저 할 일 건네기·이번 주 목표·알림 자리·오프라인 할 일 적기)을 한 번 이어 만든 판이다. 문서는 `docs/oneshot-v2/`에 있다.

- `임시값.md` — 열린 질문을 임시로 정한 값 목록(다음 고침 바퀴의 입력)
- `기록-장치.md` — 검증을 재려고 처음부터 남기는 기록(무엇을 어디에)
- `마이그레이션.md` — 새 마이그레이션 9개와 적용 순서. **마이그레이션을 먼저 적용하고 앱을 배포한다**

알림을 실제로 보내려면 서버 설정(푸시 서명 키 등)이 필요하다. 이름은 `.env.example`에 있고 값은 서버 설정에 둔다.
