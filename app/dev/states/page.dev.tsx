import { StateGallery } from "./gallery.dev";

// 개발 서버에서만 생기는 길이다(next.config.ts의 pageExtensions). production 빌드에는 이 파일이 길로 잡히지 않는다.
// 서버 Action·DB를 부르지 않고, 진짜 화면과 같은 컴포넌트에 가짜 데이터만 넣어 한 상태씩 그린다.
// 사용: /dev/states            → 상태 목록
//       /dev/states?s=T4        → 방향 A로 T4
//       /dev/states?s=T3&d=B    → 방향 B(대표 화면)
export default async function Page({ searchParams }: { searchParams: Promise<{ s?: string; d?: string }> }) {
  const { s, d } = await searchParams;
  return <StateGallery id={s ?? ""} direction={d === "B" ? "B" : "A"} />;
}
