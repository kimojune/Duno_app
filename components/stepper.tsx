"use client";

/**
 * 숫자 입력(−/+ 단추와 직접 쓰는 칸). 끌지 않고도 넣을 수 있다(WCAG 2.5.7). 저녁 기록의 시간·분야별 시간,
 * 이번 주 목표 시간이 같이 쓴다. 숫자를 숨기지 않는다. 글은 React 텍스트로만 그린다.
 * 모양(Figma 정합 A3 · 명세 ④-2): −/+ 는 보이는 원 32(1px 먹남색 테두리), 누름 틀은 48 그대로. 단위는 숫자 칸 테두리 안(「30분」 「6시간」, 칸 폭 80 · 높이 32).
 * 칸 밖 단위 글은 없다. 단위 글은 꾸밈이라 화면 읽기에서 숨기고, 칸·단추 접근 이름에 단위가 들어 있다.
 */
export function Stepper({
  id,
  label,
  value,
  min = 0,
  max,
  step,
  unit,
  onChange,
  disabled,
}: {
  id: string;
  /** 칸과 단추의 접근 이름에 쓴다(보이는 글자와 같게) */
  label: string;
  value: number;
  min?: number;
  max: number;
  step: number;
  /** 값 뒤에 붙는 단위 글(예: 시간, 분) */
  unit: string;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));
  return (
    <div className="stepper">
      <label htmlFor={id} className="stepper-label">
        {label}
      </label>
      <span className="stepper-control">
        <button
          type="button"
          className="step-btn stepper-btn"
          aria-label={`${label} ${step}${unit} 줄이기`}
          disabled={disabled || value <= min}
          onClick={() => onChange(clamp(value - step))}
        >
          <span className="step-btn-face" aria-hidden="true">
            −
          </span>
        </button>
        <span className="num-field">
          <input
            id={id}
            className="input stepper-input"
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={1}
            value={value}
            disabled={disabled}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onChange(clamp(n));
            }}
          />
          <span className="stepper-unit" aria-hidden="true">
            {unit}
          </span>
        </span>
        <button
          type="button"
          className="step-btn stepper-btn"
          aria-label={`${label} ${step}${unit} 늘리기`}
          disabled={disabled || value >= max}
          onClick={() => onChange(clamp(value + step))}
        >
          <span className="step-btn-face" aria-hidden="true">
            +
          </span>
        </button>
      </span>
    </div>
  );
}
