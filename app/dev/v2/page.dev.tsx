import { V2Gallery } from "./gallery.dev";

// 개발 서버에서만 생기는 길이다(next.config.ts의 pageExtensions). production 빌드에는 이 파일이 길로 잡히지 않는다.
// 서버 Action·DB를 부르지 않고, 진짜 화면 컴포넌트에 가짜 데이터만 넣어 한 상태씩 그린다(원샷 v2 화면 사진용, B10).
// 사용: /dev/v2 → 목록 · /dev/v2?s=tabbar | growth-empty | goal | evening | category | detail
export default async function Page({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const { s } = await searchParams;
  return <V2Gallery id={s ?? ""} />;
}
