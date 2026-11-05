import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnv } from "../../../lib/env";
import { safeNextPath } from "../../../lib/safe-next";
import { createClient } from "../../../lib/supabase/server";

// 돌아오는 주소에는 짧은 코드만 붙인다(login·config·cancelled). 오류 상세·내부 메시지는 화면에도 URL에도 내지 않는다.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));
  const fail = (reason: "login" | "config" | "cancelled") =>
    NextResponse.redirect(new URL(`/?error=${reason}`, origin));

  if (!getPublicEnv()) return fail("config");

  // D2: Google 창에서 취소하면 error=access_denied로 돌아온다. 취소(L4)와 그 밖의 실패(L3)를 가른다.
  const providerError = searchParams.get("error");
  if (providerError !== null) return fail(providerError === "access_denied" ? "cancelled" : "login");

  if (!code) return fail("login");

  try {
    const supabase = await createClient();
    if (!supabase) return fail("config");
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return fail("login");
  } catch {
    return fail("login");
  }
  return NextResponse.redirect(new URL(next, origin));
}
