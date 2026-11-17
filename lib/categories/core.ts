import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUserId } from "../session";
import { decryptCategoryName, encryptCategoryName, type TodoKey } from "../todos/crypto";
import type { AddCategoryResult, CategoryErrorCode, CategoryItem, CategoryList, CategoryResult } from "./types";
import { categoryIdSchema, checkCategoryName, sameCategoryName } from "./validation";

/**
 * 분야 데이터 접근의 핵심(서버 전용). lib/todos/core.ts와 같은 꼴이다.
 * - 함수마다 자기 안에서 세션을 확인한다(getClaims). user_id는 세션에서만 얻는다(호출자가 넘길 길이 없다).
 * - 예상된 실패는 던지지 않고 짧은 오류 코드로 돌려준다. DB 오류 원문·평문 이름·키를 로그나 반환값에 담지 않는다.
 * - 이름은 할 일 글과 같은 키(TODO_ENCRYPTION_KEY)·같은 v1 형식으로 암호화하되, AAD 용도는 category_name이다.
 */

export type CategoryDeps = {
  supabase: SupabaseClient;
  key: TodoKey | null;
};

/** DB check 제약(categories_name_encrypted_length, 임시 512자)과 같은 값 */
export const CATEGORY_CIPHERTEXT_MAX_LENGTH = 512;

const fail = <E extends CategoryErrorCode>(error: E) => ({ ok: false, error }) as const;

type DbError = { code?: string | null; hint?: string | null } | null | undefined;

/** DB 오류를 짧은 코드로. 원문은 버린다. */
function mapDbError(error: DbError): Exclude<CategoryErrorCode, "duplicate" | "archived_exists"> {
  if (!error) return "unavailable";
  if (error.code === "P0001" && error.hint === "categories_limit") return "category_limit";
  if (error.code === "23514") return "invalid_input"; // check 제약(형식·길이)
  if (error.code === "23505") return "conflict"; // 같은 id
  if (error.code === "PGRST301" || error.code === "PGRST303") return "unauthenticated"; // JWT 만료·검증 실패
  return "unavailable";
}

type CategoryRow = { id: string; name_encrypted: string; archived_at: string | null; created_at: string; color_order?: number | null };
const ROW_COLUMNS = "id, name_encrypted, archived_at, created_at, color_order";

function toItem(row: CategoryRow, userId: string, key: TodoKey): CategoryItem {
  const opened = decryptCategoryName(row.name_encrypted, userId, key);
  const color = typeof row.color_order === "number" ? { colorOrder: row.color_order } : {};
  return opened.ok
    ? { id: row.id, readable: true, name: opened.text, createdAt: row.created_at, ...color }
    : { id: row.id, readable: false, name: null, createdAt: row.created_at, ...color };
}

/**
 * 보관한 내 분야 목록(이름 찾기용, MO-46). created_at 오름차순, 같으면 id. 기기 사본이 지난 이름을 찾고,
 * 같은 이름의 새 분야를 만들려 할 때 「보관한 같은 이름이 있다」를 알리는 데 쓴다.
 */
export async function listArchivedCategoriesForUser(deps: CategoryDeps): Promise<CategoryResult<CategoryList>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    if (!deps.key) return fail("config");
    const key = deps.key;
    const { data, error } = await deps.supabase
      .from("categories")
      .select(ROW_COLUMNS)
      .eq("user_id", user.data)
      .not("archived_at", "is", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) return fail(mapDbError(error));
    return { ok: true, data: { categories: ((data ?? []) as CategoryRow[]).map((row) => toItem(row, user.data, key)) } };
  } catch {
    return fail("unavailable");
  }
}

/**
 * 같은 이름의 내 분야 찾기(암호문이라 서버가 푼다). 쓰는 분야가 먼저, 없으면 보관한 분야. skip에 든 id는 건너뛴다.
 * 풀 수 없는 이름은 건너뛴다.
 */
export function findSameNamedCategory(
  rows: { id: string; name_encrypted: string; archived_at: string | null }[],
  userId: string,
  key: TodoKey,
  name: string,
  skip: ReadonlySet<string> = new Set(),
): { active: { id: string; name: string } | null; archived: { id: string; name: string } | null } {
  let active: { id: string; name: string } | null = null;
  let archived: { id: string; name: string } | null = null;
  for (const row of rows) {
    if (skip.has(row.id)) continue;
    const opened = decryptCategoryName(row.name_encrypted, userId, key);
    if (!opened.ok || !sameCategoryName(opened.text, name)) continue;
    if (row.archived_at === null) active ??= { id: row.id, name: opened.text };
    else archived ??= { id: row.id, name: opened.text };
  }
  return { active, archived };
}

/** 보관하지 않은 내 분야 목록. created_at 오름차순, 같으면 id. 풀 수 없는 이름은 그 행만 readable=false. */
export async function listCategoriesForUser(deps: CategoryDeps): Promise<CategoryResult<CategoryList>> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    if (!deps.key) return fail("config");
    const key = deps.key;

    const { data, error } = await deps.supabase
      .from("categories")
      .select(ROW_COLUMNS)
      .eq("user_id", user.data)
      .is("archived_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) return fail(mapDbError(error));

    return { ok: true, data: { categories: ((data ?? []) as CategoryRow[]).map((row) => toItem(row, user.data, key)) } };
  } catch {
    return fail("unavailable");
  }
}

/**
 * 분야 하나를 더한다. 받는 것은 화면이 만든 uuid와 이름뿐이다(user_id는 받지 않는다).
 * - 같은 id로 다시 오면(재시도) 새 행을 만들지 않고 그 행으로 성공한다(할 일 적기와 같은 방식). 처음 저장된 이름을 돌려준다.
 * - 이름은 정규화(NFC, 이어진 공백 하나로, 앞뒤 공백 없음)해 그 꼴을 암호화해 저장한다(디자인 명세 12-7).
 * - 보관하지 않은 내 분야와 이름이 같으면(정규화 뒤, 로마자만 대소문자 무시) 새로 만들지 않고 duplicate와 함께
 *   그 분야의 번호·이름(existing)을 돌려준다(C-D12, 임시, 결정 필요). 「기타」는 reserved(임시, 결정 필요).
 * - id가 남의 행과 겹치면 conflict. 상한(DB 트리거, 임시 50)에 걸리면 category_limit.
 * 같은 이름 검사는 암호문이라 DB가 아니라 여기서 한다. 같은 이름 두 개가 동시에 오면 둘 다 들어갈 수 있다(인계에 적음).
 */
export async function createCategoryForUser(
  deps: CategoryDeps,
  id: unknown,
  name: unknown,
): Promise<AddCategoryResult> {
  try {
    const user = await requireUserId(deps.supabase);
    if (!user.ok) return user;
    const parsedId = categoryIdSchema.safeParse(id);
    if (!parsedId.success) return fail("invalid_input");
    const checked = checkCategoryName(name);
    if (!checked.ok) return fail(checked.error);
    if (!deps.key) return fail("config");
    const key = deps.key;

    // 내 분야를 모두 읽는다(상한 50이라 적다). 같은 id 재시도와 같은 이름을 한 번에 본다.
    const mine = await deps.supabase.from("categories").select(ROW_COLUMNS).eq("user_id", user.data);
    if (mine.error) return fail(mapDbError(mine.error));
    const rows = (mine.data ?? []) as CategoryRow[];

    const sameId = rows.find((row) => row.id === parsedId.data);
    if (sameId) return { ok: true, data: { category: toItem(sameId, user.data, key) } };

    // 같은 이름: 서버가 보관 안 한 내 분야 이름을 풀어 비교한다(최대 50개). 풀 수 없는 이름은 건너뛴다.
    const same = findSameNamedCategory(rows, user.data, key, checked.name);
    if (same.active) return { ok: false, error: "duplicate", existing: same.active };
    // 보관한 같은 이름이 있으면 새로 만들지 않고 그 분야를 알린다(되살리기를 권하는 것은 화면 몫, MO-46 규칙 11)
    if (same.archived) return { ok: false, error: "archived_exists", existing: same.archived };

    const nameEncrypted = encryptCategoryName(checked.name, user.data, key);
    if (nameEncrypted.length > CATEGORY_CIPHERTEXT_MAX_LENGTH) return fail("too_long");

    const { data, error } = await deps.supabase
      .from("categories")
      .insert({ id: parsedId.data, user_id: user.data, name_encrypted: nameEncrypted })
      .select(ROW_COLUMNS);

    if (error) {
      // 같은 id(23505)나, 그 사이 같은 id로 먼저 들어간 재시도가 상한에 걸린 경우(P0001)는 내 행이 있는지 다시 본다.
      if (error.code === "23505" || error.code === "P0001") {
        const existing = await deps.supabase
          .from("categories")
          .select(ROW_COLUMNS)
          .eq("id", parsedId.data)
          .eq("user_id", user.data);
        if (existing.error) return fail("unavailable");
        const row = ((existing.data ?? []) as CategoryRow[])[0];
        if (row) return { ok: true, data: { category: toItem(row, user.data, key) } };
      }
      return fail(mapDbError(error));
    }

    const row = ((data ?? []) as CategoryRow[])[0];
    if (!row) return fail("unavailable");
    return { ok: true, data: { category: { id: row.id, readable: true, name: checked.name, createdAt: row.created_at } } };
  } catch {
    return fail("unavailable");
  }
}
