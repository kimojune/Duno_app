# 알림 예약 켜기 — PM 할 일 (d-214 가)

**결론**: 아침 10:00·저녁 19:30 알림이 오게 하려면 PM이 값을 5곳에 넣고 SQL을 한 번 돌린다. 저장소 쪽(SQL·키 스크립트·시험)은 준비됐다. **SQL 미실행**, 실제 기기 알림 **미검증**.

**왜 Supabase Cron인가** (공식 문서 11-10 확인): Vercel Hobby Cron은 작업마다 하루 한 번이고 시각이 최대 59분 늦다(vercel.com/docs/cron-jobs/usage-and-pricing, 갱신 2026-07-15). Vercel Schedules는 베타이고 Hobby는 15분 흔들림이 붙는다(vercel.com/docs/schedules/limits). 그래서 `vercel.json`을 만들지 않는다. 만들면 두 곳에서 불러 알림이 두 번 갈 수 있다.

**값 이름 (값은 여기에 적지 않는다)**
- 채팅·문서·커밋에 값을 붙이지 않는다.

---

## 0) 키 만들기
**어디에**: PM 자기 컴퓨터, 이 저장소 폴더의 터미널
**할 일**: `npm run notify:keys` 를 돌린다. 값 셋이 화면에만 나온다(파일에 저장 안 함).
**이름**: NEXT_PUBLIC_VAPID_PUBLIC_KEY · VAPID_PRIVATE_KEY · CRON_SECRET
**확인**: 값 셋이 나오고 서로 다르다.
**주의**: 서명 키(앞 둘)는 한 번 만들어 계속 쓴다. 바꾸면 모든 기기가 알림을 다시 켜야 한다.
**되돌리기**: 화면을 닫으면 사라진다. 다시 돌리면 새 값이 나온다(이미 넣은 값과 섞지 않는다).

## 1) Vercel 값 넣기
**어디에**: Vercel → 프로젝트 → Settings → Environment Variables (Production)
**이름**:
- NEXT_PUBLIC_VAPID_PUBLIC_KEY
- VAPID_PRIVATE_KEY (Sensitive)
- VAPID_SUBJECT (mailto: 꼴. 연락처는 PM이 정한다)
- SUPABASE_SERVICE_ROLE_KEY (Sensitive)
- CRON_SECRET (Sensitive)
- NOTIFY_TICK_MINUTES = 15

**SUPABASE_SERVICE_ROLE_KEY 자리**: 이름은 그대로 두고 새 secret 키(sb_secret_로 시작)를 넣기를 권한다. 옛 service_role 키는 2026년 말 폐기 예정이다(Supabase 문서). 새 키로 이 코드가 도는지는 **미검증**이다.
**넣은 뒤**: 다시 배포한다(NEXT_PUBLIC_ 값은 빌드 때 박힌다).
**확인**:
- 비밀 없이 `https://<배포 주소>/api/notify/tick` 을 부르면 401이 나와야 한다.
- 응답이 503 not_configured면 값이 빠진 것이다.
- 비밀을 넣어 부르는 확인은 PM이 원할 때만 한다. 그 순간 알림 보낼 때가 된 사용자가 있으면 실제로 알림이 간다.
**되돌리기**: 값을 지우고 다시 배포한다.

## 2) Supabase 확장 켜기
**어디에**: Supabase → Integrations → Cron 에서 pg_cron 켜기 · Database → Extensions 에서 pg_net 켜기
**확인**: Extensions 목록에서 둘 다 켜짐.
**되돌리기**: 둘을 끈다(되돌리기 SQL을 먼저 돌린다).

## 3) Vault 비밀 넣기
**어디에**: Supabase → Vault
**이름**:
- duno_notify_tick_url = `https://<배포 주소>/api/notify/tick`
- duno_cron_secret = Vercel의 CRON_SECRET과 같은 값
**확인**: Vault 목록에 이름 둘이 보인다.
**되돌리기**: Vault에서 그 비밀 둘을 지운다(손으로).

## 4) 예약 SQL 돌리기
**어디에**: Supabase → SQL Editor. 파일: `docs/oneshot-v2/알림-예약/notify-cron-schedule.sql` (한 번만. 다시 돌려도 작업은 하나만 남는다)
**이름**: 작업 duno-notify-tick, 식 `1,16,31,46 * * * *`
**확인**:
- `select * from cron.job;` 에 작업이 하나 있다.
- 15분쯤 뒤 `cron.job_run_details` 의 최근 줄이 succeeded 다.
- `net._http_response` 의 최근 status_code 가 200이다. 401은 비밀 불일치, 503은 Vercel 값 빠짐. 칼럼 이름은 먼저 `select * from net._http_response limit 1;` 로 본다.
- 기기 확인: 홈 화면에 설치한 앱에서 알림을 켜고, 내 정보에서 아침 시각을 다음 30분 칸으로 바꿔 기다린다.
**되돌리기**: 아래 「되돌리기」.

---

## 되돌리기 (순서대로)
1. SQL Editor에서 `docs/oneshot-v2/알림-예약/notify-cron-unschedule.sql` 을 돌린다(작업 지우기).
2. Supabase → Vault에서 duno_notify_tick_url · duno_cron_secret 을 지운다.
3. Vercel 값을 지우고 다시 배포한다.

## 위험 (모두 미검증)
- Supabase 무료 프로젝트는 7일 쉬면 멈추고, 그러면 예약도 멈춘다고 한다(제3자 글, 공식 확인 못 함).
- Vercel Attack Mode를 켜면 바깥(pg_net) 호출이 막힐 수 있다(Vercel 자기 Cron만 통과).
- 실제 기기에 알림이 오는지는 PM이 값을 넣은 뒤에야 확인된다.
- pg_net은 비동기이고 재시도·전달 보장이 문서에 없다. 한 번 놓치면 그 15분 칸 알림은 안 간다.
- 비밀이 새면 같은 창 안에서 반복 호출하는 대로 같은 알림이 반복된다. 막는 장치는 아직 없다(보낸 기록 표는 DB 변경이라 이번 범위 밖).
- Supabase Cron이 무료 요금제에 드는지는 제3자 글로만 확인했다.

## 비밀 하나 더
pg_net은 요청을 보내기 전까지 비밀을 DB 대기열에 풀어 둔다(Supabase 공식 경고). DB에 로그인하는 역할만 읽는다.

## 결정이 필요한 것 (PM)
- VAPID_SUBJECT에 넣을 연락처
- 배포 주소
- 무료/유료 요금제
