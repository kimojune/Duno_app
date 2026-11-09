-- 알림 예약 실행: 15분마다 /api/notify/tick을 부른다(Supabase Cron = pg_cron + pg_net).
--
-- 이 파일은 마이그레이션이 아니다. 운영 DB에서 PM이 SQL Editor로 한 번 돌린다.
-- 로컬·시험 DB에 예약이 생기지 않게 supabase/migrations에 두지 않는다.
-- 돌리기 전에 먼저 할 일:
--   1) pg_cron·pg_net 확장을 켠다(Supabase → Integrations → Cron, Database → Extensions).
--   2) Vault 비밀 둘을 넣는다: duno_notify_tick_url(https://<배포 주소>/api/notify/tick), duno_cron_secret(Vercel의 CRON_SECRET과 같은 값).
-- 주소와 비밀은 이 파일에 적지 않는다. 실행할 때마다 vault.decrypted_secrets에서 이름으로 읽는다.
-- 둘 중 하나라도 없거나 빈칸이면 요청을 보내지 않는다.
-- 다시 돌려도 같은 이름의 작업이 하나만 남는다(이름이 같으면 바꿔 쓴다).
-- 되돌리기: notify-cron-unschedule.sql
--
-- 식 1,16,31,46 * * * * = 매시 :01 :16 :31 :46(UTC 기준이지만 15분 간격이라 서울 시각과 같은 칸).
-- 코드의 창(NOTIFY_TICK_MINUTES 기본 15)과 맞다. 1분 늦춰 시계가 조금 일러도 정각 알림을 놓치지 않는다.
-- 상태: SQL 미실행(어느 DB에서도 돌려 보지 않았다).

select cron.schedule(
  'duno-notify-tick',
  '1,16,31,46 * * * *',
  $job$
  with s as (
    select
      (select decrypted_secret from vault.decrypted_secrets where name = 'duno_notify_tick_url' limit 1) as url,
      (select decrypted_secret from vault.decrypted_secrets where name = 'duno_cron_secret' limit 1) as secret
  )
  select net.http_post(
    url := s.url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || s.secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
  from s
  where nullif(btrim(s.url), '') is not null
    and nullif(btrim(s.secret), '') is not null;
  $job$
);
