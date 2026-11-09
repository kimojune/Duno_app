import { afterEach, describe, expect, it, vi } from "vitest";

/** playwright.screens.config.ts 막음(21:32 .next 사고 재발 막기): playwright.release.config.ts와 같은 방식 */
async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const k of ["SCREENS_PORT", "SCREENS_DIST_DIR"]) {
    if (env[k] === undefined) vi.stubEnv(k, "");
    else vi.stubEnv(k, env[k]);
  }
  return (await import("../../playwright.screens.config")).default;
}
afterEach(() => vi.unstubAllEnvs());
const BS = String.fromCharCode(92); // 역슬래시(윈도 경로)

const OK = { SCREENS_PORT: "3301", SCREENS_DIST_DIR: "node_modules/.cache/ov10-pwa-screens" };

describe("playwright.screens.config.ts", () => {
  it("정상: 3300대 포트와 .next가 아닌 빌드 폴더를 주면 그 값으로 선다", async () => {
    const config = await load(OK);
    expect(config.use?.baseURL).toBe("http://localhost:3301");
    expect(config.webServer).toMatchObject({ command: "npx next dev -H localhost -p 3301", env: { DUNO_DIST_DIR: OK.SCREENS_DIST_DIR } });
  });
  it("악용: SCREENS_DIST_DIR가 없거나 .next · .next/ · ./.next · .next\ · .next/screens이면 서버를 띄우기 전에 throw", async () => {
    for (const dist of [undefined, "", ".next", ".next/", "./.next", ".next" + BS, ".next/screens", ".next" + BS + "screens"]) {
      const r = await load({ ...OK, SCREENS_DIST_DIR: dist }).then(() => "통과", (e: Error) => e.message);
      expect(r, `[${dist}]`).toMatch(/SCREENS_DIST_DIR/);
    }
  });
  it("악용: SCREENS_PORT가 없거나 3200·3100이면 throw", async () => {
    for (const port of [undefined, "", "3200", "3100", " 3200 "]) {
      await expect(load({ ...OK, SCREENS_PORT: port }), String(port)).rejects.toThrow(/SCREENS_PORT/);
    }
  });
});
