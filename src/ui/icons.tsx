/**
 * 인라인 SVG 아이콘 세트 (계획: `docs/chzzk-tone-ui-plan.md` P2).
 *
 * 지금까지 문자·이모지(`↔ + − ⟩ ⟨ ▦ ▤ ⚙ ＋ ✕ 🔴 ⚫`)로 대체해 온 아이콘을 대체하기 위한
 * 컴포넌트만 만든다. **호출부 치환은 다음 단계(P3)** — 여기서는 정의만 한다.
 *
 * 공통 규약:
 * - `viewBox="0 0 16 16"`, `stroke="currentColor"` — 색은 CSS 가 정한다.
 * - `aria-hidden="true"` + `focusable="false"` — 접근성 이름은 감싸는 버튼의
 *   `aria-label` 이 담당한다. 아이콘 자체는 스크린리더에서 숨긴다.
 * - 스프라이트·아이콘 폰트·외부 파일은 쓰지 않는다 — 콘텐츠 스크립트가 치지직 페이지에
 *   주입되므로 외부 리소스 의존을 늘리지 않는다.
 */
import type { SVGProps } from 'react';

export type IconProps = {
  size?: number;
  className?: string;
};

/** 스트로크 계열 아이콘 공통 `<svg>` 속성. `LiveDotIcon` 은 채움 계열이라 따로 만든다. */
function strokeSvgProps(size: number, className: string | undefined): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: false,
    className,
  };
}

/**
 * `stage.ts`·`volume.ts` 는 바닐라 DOM 코드라 React 컴포넌트를 그대로 쓸 수 없다.
 * 이 path 데이터를 React 컴포넌트와 `createIconElement` DOM 헬퍼가 함께 참조한다 —
 * 복붙하면 한쪽만 고쳐져 갈라진다(이 저장소에서 화질 폴백이 정확히 그렇게 재발했다).
 */
export const ICON_PATHS = {
  plus: 'M8 3v10M3 8h10',
  minus: 'M3 8h10',
  close: 'M3.5 3.5l9 9M12.5 3.5l-9 9',
} as const;

export type IconName = keyof typeof ICON_PATHS;

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * `stage.ts`·`volume.ts` 전용 DOM 아이콘 생성기.
 * `document.createElement` 로 SVG 를 만들면 렌더되지 않으므로 반드시
 * `createElementNS` 를 쓴다. React 컴포넌트와 같은 `ICON_PATHS` 를 참조한다.
 */
export function createIconElement(name: IconName, size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICON_PATHS[name]);
  svg.appendChild(path);
  return svg;
}

/** `+` 대체 — 가로선 + 세로선 십자. */
export function PlusIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...strokeSvgProps(size, className)}>
      <path d={ICON_PATHS.plus} />
    </svg>
  );
}

/** `−` 대체 — 가로선 하나. */
export function MinusIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...strokeSvgProps(size, className)}>
      <path d={ICON_PATHS.minus} />
    </svg>
  );
}

/** `✕` 대체 — X 두 선. */
export function CloseIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...strokeSvgProps(size, className)}>
      <path d={ICON_PATHS.close} />
    </svg>
  );
}

/** `↔` 대체 — 좌우 화살표. */
export function ResizeHorizontalIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...strokeSvgProps(size, className)}>
      <path d="M2.5 8h11M5 5l-2.5 3L5 11M11 5l2.5 3L11 11" />
    </svg>
  );
}

/** `⟩` 대체 — 오른쪽 쉐브론 (펼치기). */
export function ChevronRightIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...strokeSvgProps(size, className)}>
      <path d="M6 3.5l5 4.5-5 4.5" />
    </svg>
  );
}

/** `⟨` 대체 — 왼쪽 쉐브론 (접기). */
export function ChevronLeftIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...strokeSvgProps(size, className)}>
      <path d="M10 3.5L5 8l5 4.5" />
    </svg>
  );
}

/** `▦` 대체 — 채팅이 오른쪽인 배치. 사각 프레임 + 세로 분할선(오른쪽 1/3). */
export function LayoutRightIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...strokeSvgProps(size, className)}>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M9.5 3v10" />
    </svg>
  );
}

/** `▤` 대체 — 채팅이 아래인 배치. 사각 프레임 + 가로 분할선(아래쪽 1/3). */
export function LayoutBottomIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...strokeSvgProps(size, className)}>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M2.5 9.5h11" />
    </svg>
  );
}

/** `⚙` 대체 — 설정. 원 + 톱니 6개. */
export function GearIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...strokeSvgProps(size, className)}>
      <circle cx="8" cy="8" r="2.25" />
      <path d="M8 2.5v1.6M8 11.9v1.6M13.5 8h-1.6M4.1 8H2.5M11.66 4.34l-1.13 1.13M5.47 10.53l-1.13 1.13M11.66 11.66l-1.13-1.13M5.47 5.47L4.34 4.34" />
    </svg>
  );
}

/** 음량 평탄화(컴프레서) 토글 — 높낮이가 제각각인 막대와 그 위 수평 상한선. 큰 소리를 눌러 고르게 만드는 모양. */
export function CompressorIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...strokeSvgProps(size, className)}>
      <path d="M2 3.5h12" />
      <rect x="2.5" y="8" width="2" height="5" />
      <rect x="5.5" y="5.5" width="2" height="7.5" />
      <rect x="8.5" y="4" width="2" height="9" />
      <rect x="11.5" y="7" width="2" height="6" />
    </svg>
  );
}

/** `🔴`/`⚫` 대체 — 방송 상태 점. 유일한 예외로 `fill="currentColor"` 를 쓴다. 색은 CSS 가 정한다. */
export function LiveDotIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <circle cx="8" cy="8" r="4" />
    </svg>
  );
}
