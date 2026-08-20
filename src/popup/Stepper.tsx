/**
 * `−` / 현재 값 / `+` 스테퍼.
 * 공통 UI 규칙: 값이 있는 항목은 현재 값을 항상 숫자로 보여주고,
 * 범위 경계에서 버튼을 **비활성**한다 (클릭해도 아무 일이 없는 상태를 만들지 않는다 — FR-15).
 */

type Props = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (next: number) => void;
};

export function Stepper({ label, value, min, max, step = 1, unit = '', onChange }: Props) {
  const atMin = value <= min;
  const atMax = value >= max;
  return (
    <span className="cm-stepper">
      <button
        type="button"
        aria-label={`${label} 줄이기`}
        disabled={atMin}
        onClick={() => onChange(Math.max(min, value - step))}
      >
        −
      </button>
      <output aria-label={`${label} 현재 값`}>
        {value}
        {unit}
      </output>
      <button
        type="button"
        aria-label={`${label} 늘리기`}
        disabled={atMax}
        onClick={() => onChange(Math.min(max, value + step))}
      >
        +
      </button>
    </span>
  );
}
