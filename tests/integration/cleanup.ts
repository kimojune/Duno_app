import type { SupabaseClient } from "@supabase/supabase-js";

export type CleanupTarget = { label: string; client: SupabaseClient | undefined; ids: string[] };

/**
 * 계정마다 이번 실행에서 만든 행을 지우고 0행인지 확인한 뒤 로그아웃한다.
 * 한 계정이 실패해도 나머지 계정 정리와 로그아웃은 끝까지 돈다. 실패는 모아 마지막에 한 번 던진다.
 * 메시지에는 계정 이름표와 오류 코드만 담는다(값·토큰은 담지 않는다).
 */
export async function cleanupTodos(targets: CleanupTarget[]): Promise<void> {
  const failures: string[] = [];

  for (const { label, client, ids } of targets) {
    if (!client) continue;
    try {
      if (ids.length > 0) {
        const del = await client.from("todos").delete().in("id", ids);
        if (del.error) failures.push(`${label}: 지우기 실패 (code=${del.error.code ?? "?"})`);

        const left = await client.from("todos").select("id").in("id", ids);
        if (left.error) failures.push(`${label}: 남은 행 확인 실패 (code=${left.error.code ?? "?"})`);
        else if ((left.data ?? []).length !== 0) failures.push(`${label}: 이번 실행 행 ${left.data.length}개가 남음`);
      }
    } catch (e) {
      failures.push(`${label}: 정리 중 예외 (${(e as Error).name})`);
    } finally {
      try {
        await client.auth.signOut({ scope: "local" });
      } catch {
        failures.push(`${label}: 로그아웃 실패`);
      }
    }
  }

  if (failures.length > 0) throw new Error(`정리 실패: ${failures.join("; ")}`);
}
