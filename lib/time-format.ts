/** 분 단위 숫자를 화면 글로. 0분은 0분으로 보인다(말투: 숫자를 숨기지 않는다, D-141). */
export function formatMinutes(minutes: number): string {
  const safe = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

/** 부호가 붙은 바뀐 시간. 예: +1시간 30분 */
export function formatDeltaMinutes(minutes: number): string {
  const sign = minutes < 0 ? "−" : "+";
  return `${sign}${formatMinutes(Math.abs(minutes))}`;
}

/** 0~1439분을 '오전 7:30' 꼴로 */
export function formatClock(minuteOfDay: number): string {
  const safe = Math.min(1439, Math.max(0, Math.round(minuteOfDay)));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  const period = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${period} ${h12}:${String(m).padStart(2, "0")}`;
}

/** mm:ss */
export function formatTimer(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}
