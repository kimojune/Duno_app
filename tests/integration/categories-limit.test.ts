import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { loadIntegrationEnv } from "./load-env";

/**
 * 악용 5: 사용자별 분야 개수 상한(DB 트리거 private.categories_enforce_limit, 임시 50)과 동시 insert.
 * 분야는 지우는 권한이 없어 이 시험이 넣은 행을 시험이 지울 수 없다. 돌리면 A 계정이 상한(50)까지 차서,
 * 그 뒤로는 categories-rls.test.ts의 「512자 통과」 시험이 상한 때문에 실패한다.
 * 그래서 이 파일은 DUNO_CATEGORY_LIMIT_TEST=1일 때만 돈다(평소 test:rls에서는 건너뛴다. 밤에는 돌리지 않는다).
 * 돌린 뒤에는 사람이 SQL 편집기에서 A의 시험 분야를 지운다(categories-rls.test.ts 머리 주석의 정리 SQL).
 * 상한 경계 근처만 본다: 상한 바로 앞까지 하나씩 채운 뒤, 남은 자리보다 많은 insert를 동시에 보낸다.
 */

const LIMIT = 50; // 마이그레이션의 임시 값과 같다
const EXTRA = 4; // 남은 자리보다 더 보내는 동시 insert 수

const fakeCiphertext = () =>
  `v1:${randomBytes(12).toString("base64url")}:${randomBytes(24).toString("base64url")}:${randomBytes(16).toString("base64url")}`;

describe.runIf(process.env.DUNO_CATEGORY_LIMIT_TEST === "1")("분야 개수 상한 (임시 50, 동시 insert)", () => {
  it("상한까지만 들어가고, 넘는 동시 insert는 categories_limit로 거절된다", async () => {
    const env = loadIntegrationEnv();
    const a: SupabaseClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { error: loginError } = await a.auth.signInWithPassword({
      email: env.DUNO_TEST_A_EMAIL,
      password: env.DUNO_TEST_A_PASSWORD,
    });
    expect(loginError).toBeNull();

    const count = async () => {
      const { count: n, error } = await a.from("categories").select("id", { count: "exact", head: true });
      expect(error).toBeNull();
      return n ?? 0;
    };

    // 상한보다 둘 적게까지 하나씩 채운다(정상 insert 통과 = 양성 대조)
    let have = await count();
    while (have < LIMIT - 2) {
      const { error } = await a.from("categories").insert({ name_encrypted: fakeCiphertext() });
      expect(error).toBeNull();
      have += 1;
    }
    expect(await count()).toBe(Math.max(have, LIMIT - 2));
    const room = LIMIT - (await count());

    // 남은 자리(room)보다 EXTRA개 더 동시에 보낸다
    const results = await Promise.all(
      Array.from({ length: room + EXTRA }, () => a.from("categories").insert({ name_encrypted: fakeCiphertext() })),
    );
    const ok = results.filter((r) => r.error === null).length;
    const limited = results.filter((r) => r.error?.code === "P0001" && r.error.hint === "categories_limit").length;
    expect(ok).toBe(room);
    expect(limited).toBe(EXTRA);
    expect(await count()).toBe(LIMIT); // 동시에 보내도 상한을 넘지 않았다

    // 상한에서 하나 더도 거절
    const one = await a.from("categories").insert({ name_encrypted: fakeCiphertext() });
    expect(one.error?.hint).toBe("categories_limit");
    await a.auth.signOut({ scope: "local" });
  });
});
