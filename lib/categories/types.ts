/**
 * 분야 서버 함수·Server Action·읽기 길(Route Handler)이 화면 쪽에 돌려주는 모양.
 * 화면 코드도 import해도 되는 타입만 둔다(서버 비밀·암호화 코드 없음).
 */

/**
 * 예상된 실패의 짧은 오류 코드(고정 목록, 디자인 명세 C-D12). 화면은 이 갈래로 문구를 고른다.
 * 내부 메시지·DB 오류 원문은 담지 않는다.
 */
export type CategoryErrorCode =
  | "unauthenticated" // 로그인 풀림: 세션이 없거나 만료·검증 실패
  | "invalid_input" // 형식 틀림: 이름이 문자열이 아님, id가 uuid가 아님
  | "empty" // 빈 이름(정규화하면 0자)
  | "too_long" // 글자 수 넘음: 정규화한 이름이 20자(코드 포인트, 임시)를 넘음
  | "reserved" // 「기타」(분야 번호가 비면 기타라 겹친다. 임시, 결정 필요)
  | "duplicate" // 같은 이름: 보관하지 않은 내 분야에 이미 있음. 실패 응답에 그 분야(existing)가 실린다(임시, 결정 필요)
  | "conflict" // id가 이미 쓰였는데 내 분야로 보이지 않음(화면이 만든 uuid가 남의 것과 겹침. 사실상 없다)
  | "category_limit" // 개수 상한: 한 사용자 분야 개수(DB, 임시 50)
  | "config" // 설정 오류: 암호화 키 없음·길이 틀림, Supabase 주소·키 없음
  | "unavailable"; // 일시 오류(네트워크·DB 등). 다시 해 볼 만한 것

export type CategoryResult<T> = { ok: true; data: T } | { ok: false; error: CategoryErrorCode };

/** 화면에 넘기는 분야 하나. 풀 수 없는 이름은 readable=false, name=null. createdAt은 ISO 문자열. */
export type CategoryItem =
  | { id: string; readable: true; name: string; createdAt: string }
  | { id: string; readable: false; name: null; createdAt: string };

export type CategoryList = { categories: CategoryItem[] };
export type AddedCategory = { category: CategoryItem };

/**
 * 분야 더하기(addCategory)의 응답. 성공은 분야 번호와 이름(category).
 * 같은 이름이면 새로 만들지 않고 duplicate와 함께 이미 있는 그 분야의 번호·이름(existing)을 돌려준다(C-D12).
 */
export type AddCategoryResult =
  | { ok: true; data: AddedCategory }
  | { ok: false; error: "duplicate"; existing: { id: string; name: string } }
  | { ok: false; error: Exclude<CategoryErrorCode, "duplicate"> };
