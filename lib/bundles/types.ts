/**
 * 목표 묶음(MO-46)의 화면·보낼 줄 쪽 모양. 서버 비밀·암호화 코드 없음 — 화면 코드도 import해도 된다.
 * 묶음 = 목표 글 + 분야 목록(이름·비율·보관 여부) + 기타 비율. 서버 함수 save_goal_bundle이 한 트랜잭션으로 저장한다.
 */

/** 새 묶음의 분야 한 칸 */
export type BundleItem = {
  /** 기존 분야 id 또는 새 분야 id(화면이 만든 uuid) */
  id: string;
  /** true면 새 분야(name 필요). 아니면 내 분야여야 한다 */
  isNew?: boolean;
  /** 새 분야이거나 이름을 바꿀 때만(바꾸지 않으면 싣지 않는다). 평문, 서버가 암호화한다 */
  name?: string;
  /** 0~100 정수 */
  percent: number;
  /** 안 실으면 보관 상태 그대로, true면 보관(그 분야의 비율 몫은 기타로 감), false면 되살림 */
  archived?: boolean;
};

export type BundleReason = "edit" | "restart";

/** 보낼 줄 op bundle.apply가 싣는 것 */
export type BundleApplyInput = {
  /** 보낼 줄 op id(같은 id 재전송은 서버가 한 번만 반영한다) */
  id: string;
  /** 기대 고침 번호(기기 거울의 bundle.revision). 서버의 지금 값과 다르면 bundle_conflict */
  expectedRevision: number;
  reason: BundleReason;
  /** 목표 글. 없으면 null */
  goal: string | null;
  /**
   * 기타 몫(%). 보관하는 분야의 저장된 몫을 옮기기 **전** 값이다(서버가 더한다).
   * 분야 칸(보관한 것 포함)의 percent 합 + other = 100.
   */
  other: number;
  items: BundleItem[];
  /** 처음 설정을 이 저장으로 마친다 */
  completeOnboarding?: boolean;
};

/** 지금 묶음의 상태(기기 사본) */
export type BundleState = {
  /** 저장마다 1씩 오르는 고침 번호 */
  revision: number;
  /** 지금 묶음이 시작한 때(ISO). 옛 사용자는 null */
  startedAt: string | null;
  /** 다시 시작을 눌렀으면 그 시각(ISO), 아니면 null */
  restartRequestedAt: string | null;
};

export const EMPTY_BUNDLE_STATE: BundleState = { revision: 0, startedAt: null, restartRequestedAt: null };

export type BundleErrorCode =
  | "unauthenticated"
  | "invalid_input"
  | "empty"
  | "too_long"
  | "reserved"
  | "duplicate" // 쓰는 분야와 이름이 겹침(existing)
  | "archived_exists" // 보관한 같은 이름 분야가 있음(existing)
  | "not_found"
  | "conflict"
  | "category_limit"
  | "bundle_conflict" // 기대 고침 번호가 다름(다른 기기가 먼저 고쳤다)
  | "config"
  | "unavailable";

/** 저장 결과: pastSkipped=true면 저장은 됐지만 지난 목표 기록을 남기지 못했다(상한 닿음, 화면이 알린다) */
export type BundleApplyResult =
  | { ok: true; data: { revision: number; pastSkipped: boolean } }
  | { ok: false; error: BundleErrorCode; existing?: { id: string; name: string } };
