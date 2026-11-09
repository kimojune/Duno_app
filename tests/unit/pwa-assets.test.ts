import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../../app/manifest";

/** 고침10 K: PWA 아이콘 v2(Figma 149:87 · 149:91 · 149:96) · manifest 이름 「두노」(d-179) · 오프라인 화면 워드마크(149:105) */

const root = path.join(__dirname, "../..");
const pub = (name: string) => fs.readFileSync(path.join(root, "public", name));
/** PNG 머리글(IHDR)에서 가로×세로를 읽는다 */
function pngSize(buf: Buffer): [number, number] {
  expect(buf.subarray(1, 4).toString("latin1")).toBe("PNG");
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

describe("manifest", () => {
  const m = manifest();
  it("이름·짧은 이름은 「두노」, id·시작 주소·보이기·색은 그대로", () => {
    expect(m).toMatchObject({ name: "두노", short_name: "두노", id: "/", start_url: "/", display: "standalone", background_color: "#FAF7F2", theme_color: "#1C2340" });
  });
  it("아이콘: 192 any · 512 any · 512 maskable(따로 선언), 새 이름", () => {
    expect(m.icons).toEqual([
      { src: "/icon-v2-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-v2-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-v2-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
  });
  it("manifest가 가리키는 파일이 public/에 있고 크기(가로×세로)가 선언과 같다", () => {
    for (const icon of m.icons ?? []) {
      const [w, h] = String(icon.sizes).split("x").map(Number);
      expect(pngSize(pub(String(icon.src).slice(1))), String(icon.src)).toEqual([w, h]);
    }
  });
  it("이미 설치된 앱을 위해 옛 아이콘 파일도 public/에 남아 있다", () => {
    for (const name of ["icon-192.png", "icon-512.png", "icon-maskable-512.png"]) expect(fs.existsSync(path.join(root, "public", name)), name).toBe(true);
  });
});

describe("proxy.ts는 아이콘·manifest를 로그인 없이 읽게 둔다", () => {
  it("matcher의 제외 규칙이 icon-v2-*.png와 manifest.webmanifest를 잡는다", () => {
    const src = fs.readFileSync(path.join(root, "proxy.ts"), "utf8");
    const matcher = src.match(/"\/\(\(\?!([^"]+)\)\.\*\)"/)?.[1] ?? "";
    expect(matcher).not.toBe("");
    const excluded = new RegExp("^/(?:" + matcher.replace(/\\\\/g, "\\") + ")");
    for (const p of ["/icon-v2-192.png", "/icon-v2-512.png", "/icon-v2-maskable-512.png", "/manifest.webmanifest", "/offline.html", "/sw.js"]) {
      expect(excluded.test(p), p).toBe(true);
    }
    expect(excluded.test("/api/notify/next")).toBe(false);
  });
});

describe("offline.html", () => {
  const html = pub("offline.html").toString("utf8");
  it("맨 위는 고리(인라인 SVG, 먹남색 고리 + 살구 조각) + 「duno」 — 화면 워드마크와 같은 경로", () => {
    const wordmark = fs.readFileSync(path.join(root, "components/wordmark.tsx"), "utf8");
    const ring = wordmark.match(/RING_PATH =\s*"([^"]+)"/)?.[1];
    const piece = wordmark.match(/PIECE_PATH = "([^"]+)"/)?.[1];
    expect(ring && piece).toBeTruthy();
    expect(html).toContain(`d="${ring}"`);
    expect(html).toContain(`d="${piece}"`);
    expect(html).toMatch(/<h1[^>]*>\s*<svg[\s\S]*?<\/svg>\s*<span[^>]*>duno<\/span>\s*<\/h1>/);
    expect(html).toMatch(/\.piece\{fill:var\(--color-accent\)\}/);
  });
  it("악용: 바깥 파일·글꼴·주소를 부르지 않는다(http 0개, link·@import·@font-face·src 0개)", () => {
    expect(html).not.toMatch(/https?:/i);
    expect(html).not.toMatch(/<link\b|@import|@font-face|url\(|<img\b|\ssrc=|<iframe/i);
  });
});
