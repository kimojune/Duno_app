/**
 * 「오늘 할 일에 추가」로 만드는 오늘 사본의 id(고침 11, d-224~227). 같은 제시 → 늘 같은 uuid.
 * 식: 제시 id(uuid)의 버전 칸(세 번째 묶음의 첫 글자)을 5로 바꾼다. 나머지는 그대로(변종 칸 포함)라 형식이 맞는 uuid이고, 제시가 다르면 사본도 다르다.
 * 서버(lib/offers/core.ts)와 기기 먼저 저장 화면(lib/local)이 같은 값을 내야 해서 순수 함수 하나로 둔다. 비밀을 섞지 않는다(비밀이 아니다).
 * 사본 id는 todos 표의 id라 todo_offers의 제시 id와 부딪히지 않는다.
 */
const UUID = /^([0-9a-f]{8}-[0-9a-f]{4}-)[0-9a-f]([0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** 제시 id가 uuid 꼴이면 사본 id, 아니면 null */
export function offerCopyId(offerId: string): string | null {
  const m = UUID.exec(offerId);
  return m ? `${m[1].toLowerCase()}5${m[2].toLowerCase()}` : null;
}
