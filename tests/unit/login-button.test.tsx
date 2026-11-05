// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginButton } from "../../components/login-button";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("LoginButton", () => {
  it("설정 값이 없으면 누를 때 분명한 안내를 보여 준다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    render(<LoginButton />);
    fireEvent.click(screen.getByRole("button", { name: "Google로 로그인" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("설정 값이 없어요"));
  });
});
