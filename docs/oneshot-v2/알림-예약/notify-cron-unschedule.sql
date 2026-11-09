-- 알림 예약 실행 되돌리기: duno-notify-tick 작업을 지운다. 운영 DB에서 PM이 SQL Editor로 한 번 돌린다(마이그레이션 아님).
-- 작업이 없어도 오류 없이 끝난다. Vault 비밀 둘(duno_notify_tick_url, duno_cron_secret)은 여기서 지우지 않는다 — PM 할 일 문서의 「되돌리기」를 본다.
-- 상태: SQL 미실행.
select cron.unschedule(jobid) from cron.job where jobname = 'duno-notify-tick';
