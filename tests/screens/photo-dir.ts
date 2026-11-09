import path from "node:path";

/**
 * 화면 시험 사진을 둘 폴더(고침9 K, 22 팀장): 기본은 git이 무시하는 test-results/photos/<폴더>다.
 * 환경 변수 SAVE_PHOTOS=1을 줄 때만 커밋하는 자리 docs/oneshot-v2/<폴더>에 쓴다.
 * 까닭: npm run screens를 돌릴 때마다 지난 바퀴의 커밋된 사진이 다시 찍혀 작업 폴더가 「바뀜」으로 남았다
 * (되돌리기는 사람 손이 필요했다). 시험의 단언(치수·글·계산값)은 폴더와 무관하게 그대로 돈다.
 * PM에게 낼 사진을 새로 찍을 때: SAVE_PHOTOS=1 npm run screens
 */
export function photoDir(folder: string): string {
  const root = process.env.SAVE_PHOTOS === "1" ? "docs/oneshot-v2" : "test-results/photos";
  return path.resolve(__dirname, "../..", root, folder);
}
