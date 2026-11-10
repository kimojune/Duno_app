// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/** 알림을 눌러 들어온 주소(/?open=…)가 앱 틀에 어떻게 넘어가는가 — 앱 틀은 가짜로 바꿔 넘긴 값만 본다 */
vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } } }) } }),
}));
vi.mock("../../lib/home-dal", () => ({ readHome: async () => ({ today: {}, settings: {} }) }));
vi.mock("../../lib/deps", () => ({ getDeps: async () => null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("../../components/app-shell", () => ({ AppShell: (p: { initialOpen: string | null }) => <div data-testid="shell" data-open={p.initialOpen ?? ""} /> }));
vi.mock("../../components/local-app-shell", () => ({ LocalAppShell: (p: { initialOpen: string | null }) => <div data-testid="shell" data-open={p.initialOpen ?? ""} /> }));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

async function openOf(open: string | string[] | undefined, localFirst: "on" | "off") {
  vi.stubEnv("DUNO_LOCAL_FIRST", localFirst);
  const { default: Home } = await import("../../app/page");
  render(await Home({ searchParams: Promise.resolve(open === undefined ? {} : { open }) }));
  return screen.getByTestId("shell").getAttribute("data-open");
}

describe("첫 화면(app/page.tsx) — /?open=…", () => {
  for (const mode of ["on", "off"] as const) {
    it(`(기기 먼저 저장 ${mode === "on" ? "켜짐" : "꺼짐"}) ?open=offer는 offer, ?open=evening은 evening, 그 밖은 열지 않는다`, async () => {
      expect(await openOf("offer", mode)).toBe("offer");
      cleanup();
      expect(await openOf("evening", mode)).toBe("evening");
      cleanup();
      for (const other of [undefined, "", "OFFER", "timer", ["offer", "evening"]]) {
        expect(await openOf(other, mode)).toBe("");
        cleanup();
      }
    });
  }
});
