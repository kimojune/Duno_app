import "server-only";

/**
 * 알림(웹 푸시) 설정 이름과 읽는 곳(PRD 7-8, ⑦). 비밀값은 코드에 쓰지 않고 환경 변수로만 읽는다(기획서 9절).
 *
 * 환경 변수 이름(저장소에는 이름만 적는다. 값은 Vercel·Supabase 설정에 PM이 둔다):
 *  - NEXT_PUBLIC_VAPID_PUBLIC_KEY : 푸시 서명 공개 키(화면이 구독할 때 쓴다. 공개해도 되는 값)
 *  - VAPID_PRIVATE_KEY            : 푸시 서명 비밀 키(서버 전용)
 *  - VAPID_SUBJECT                : 푸시 서비스에 알리는 연락처(mailto: 또는 https:// 주소, 서버 전용)
 *  - SUPABASE_SERVICE_ROLE_KEY    : 예약 실행이 모든 사용자의 알림 설정·구독을 읽을 때만 쓰는 서버 키(서버 전용, 화면에 싣지 않는다)
 *  - CRON_SECRET                  : 예약 실행 주소(/api/notify/tick)를 부르는 쪽이 보내는 비밀(서버 전용)
 *
 * 이 값들이 없으면 알림은 켜지지 않고 앱은 그대로 돈다(AI 없이도 돌고, 알림 없이도 돈다).
 * 서버 전용(server-only): 비밀을 읽는 코드가 브라우저 번들에 들어가지 못하게 한다. 화면이 읽는 공개 키는 lib/push/public-config.ts에 따로 있다.
 */

/** 환경 변수 모음(process.env나 시험용 평범한 객체) */
export type EnvLike = Record<string, string | undefined>;

export type PushServerConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

/** 서버가 푸시를 보낼 때 쓰는 설정. 하나라도 없거나 이상하면 null(보내지 않는다) */
export function getPushServerConfig(env: EnvLike = process.env): PushServerConfig | null {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  if (!/^(mailto:|https:\/\/)/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

/** 예약 실행에 필요한 서버 설정(서비스 키·예약 비밀). 없으면 null */
export function getTickConfig(env: EnvLike = process.env): { supabaseUrl: string; serviceRoleKey: string; cronSecret: string } | null {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const cronSecret = env.CRON_SECRET?.trim();
  if (!supabaseUrl || !serviceRoleKey || !cronSecret) return null;
  return { supabaseUrl, serviceRoleKey, cronSecret };
}
