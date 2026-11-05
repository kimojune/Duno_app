import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REQUIRED_ENV, loadIntegrationEnv } from "../integration/load-env";

let dir = "";
afterEach(() => {
  vi.unstubAllEnvs();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

function envFile(content: string) {
  dir = mkdtempSync(path.join(tmpdir(), "duno-env-"));
  const file = path.join(dir, ".env.local");
  writeFileSync(file, content);
  return file;
}

describe("loadIntegrationEnv", () => {
  it("값이 없으면 던지고, 메시지에는 이름만 있다", () => {
    for (const name of REQUIRED_ENV) vi.stubEnv(name, "");
    const file = envFile("NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co\nDUNO_TEST_A_PASSWORD=dummy-secret-value\n");
    let message = "";
    try {
      loadIntegrationEnv(file);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    expect(message).toContain("DUNO_TEST_B_PASSWORD");
    expect(message).not.toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(message).not.toContain("dummy-secret-value");
    expect(message).not.toContain("example.supabase.co");
  });

  it("파일이 없어도 던진다(건너뛰지 않음)", () => {
    for (const name of REQUIRED_ENV) vi.stubEnv(name, "");
    expect(() => loadIntegrationEnv(path.join(tmpdir(), "no-such-dir-duno", ".env.local"))).toThrow(
      /DUNO_TEST_A_EMAIL/,
    );
  });

  it("파일 값이 모두 있으면 돌려준다", () => {
    const file = envFile(REQUIRED_ENV.map((n) => `${n}=x-${n}`).join("\n"));
    const env = loadIntegrationEnv(file);
    expect(env.DUNO_TEST_B_EMAIL).toBe("x-DUNO_TEST_B_EMAIL");
  });
});
