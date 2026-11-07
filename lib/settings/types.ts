/** 처음 설정·알림 설정이 화면에 돌려주는 모양(서버 비밀 없음, 화면도 import해도 된다) */

export type NotifySettings = {
  eveningEnabled: boolean;
  /** 자정부터의 분(0~1439), 서울 시각 */
  eveningMinute: number;
  morningEnabled: boolean;
  morningMinute: number;
};

/**
 * 분야마다 처음 정한 비율(%). categoryId가 null이면 「기타」다(고침 3바퀴, PM 답 d-69 「기타 분야 넣어」).
 * 기타는 처음 정한 비율에 넣을 수 있고, 부족한 분야 계산·건넬 분야에도 든다. 목표(이번 주)에는 기타를 넣지 않는다(임시).
 */
export type RatioItem = { categoryId: string | null; percent: number };

export type SettingsData = {
  /** 목표 한 문장. 없으면 null. 풀 수 없는 글도 null(goalReadable=false) */
  goal: string | null;
  goalReadable: boolean;
  /** 처음 설정을 마쳤는가 */
  onboardingDone: boolean;
  notify: NotifySettings;
  ratios: RatioItem[];
};

/** 쓰기에서 바꿀 것(안 보낸 것은 그대로) */
export type SettingsPatch = {
  goal?: string | null;
  notify?: Partial<NotifySettings>;
  /** true면 처음 설정을 마친 것으로 표시한다(이미 마쳤으면 그대로) */
  completeOnboarding?: boolean;
};
