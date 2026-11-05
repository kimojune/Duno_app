import { afterEach, describe, expect, it, vi } from "vitest";
import { getPublicEnv } from "../../lib/env";

afterEach(() => vi.unstubAllEnvs());

describe("getPublicEnv", () => {
  it("값이 없으면 null (터지지 않음)", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    expect(getPublicEnv()).toBeNull();
  });

  it("하나만 있어도 null", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    expect(getPublicEnv()).toBeNull();
  });

  it("URL 모양이 아니면 null", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not a url");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "k");
    expect(getPublicEnv()).toBeNull();
  });

  it("둘 다 있으면 값을 돌려줌", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "dummy-key");
    expect(getPublicEnv()).toEqual({ url: "https://example.supabase.co", key: "dummy-key" });
  });
});
