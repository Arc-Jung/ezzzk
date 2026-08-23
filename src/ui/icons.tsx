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
 * 이 path/rect 데이터를 React 컴포넌트와 `createIconElement` DOM 헬퍼가 함께 참조한다 —
 * 복붙하면 한쪽만 고쳐져 갈라진다(이 저장소에서 화질 폴백이 정확히 그렇게 재발했다).
 *
 * 값은 `string`(단일 path의 `d`) 이거나 `IconShape[]`(사각형을 곁들이는 아이콘) 다.
 * `path` 만으로 억지로 그리면 모양이 미묘하게 달라지므로 `rect` 를 그대로 표현한다.
 */
export type IconShape =
  | { tag: 'path'; d: string }
  | { tag: 'rect'; x: number; y: number; width: number; height: number; rx?: number }
  | { tag: 'circle'; cx: number; cy: number; r: number };

export const ICON_PATHS = {
  plus: 'M8 3v10M3 8h10',
  minus: 'M3 8h10',
  close: 'M3.5 3.5l9 9M12.5 3.5l-9 9',
  target: 'M11 8a3 3 0 1 1-6 0a3 3 0 1 1 6 0M8 1v2M8 13v2M1 8h2M13 8h2',
  chatBubble:
    'M2.5 3.5h11a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1h-7L2.5 13.5V11a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z',
  fullscreen: 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10',
  resizeHorizontal: 'M2.5 8h11M5 5l-2.5 3L5 11M11 5l2.5 3L11 11',
  chevronRight: 'M6 3.5l5 4.5-5 4.5',
  chevronLeft: 'M10 3.5L5 8l5 4.5',
  layoutRight: [
    { tag: 'rect', x: 2.5, y: 3, width: 11, height: 10, rx: 1.5 },
    { tag: 'path', d: 'M9.5 3v10' },
  ],
  layoutBottom: [
    { tag: 'rect', x: 2.5, y: 3, width: 11, height: 10, rx: 1.5 },
    { tag: 'path', d: 'M2.5 9.5h11' },
  ],
  slots: [
    { tag: 'rect', x: 2, y: 2, width: 5, height: 5, rx: 1 },
    { tag: 'rect', x: 9, y: 2, width: 5, height: 5, rx: 1 },
    { tag: 'rect', x: 2, y: 9, width: 5, height: 5, rx: 1 },
    { tag: 'rect', x: 9, y: 9, width: 5, height: 5, rx: 1 },
  ],
  gear: [
    { tag: 'circle', cx: 8, cy: 8, r: 2.25 },
    {
      tag: 'path',
      d: 'M8 2.5v1.6M8 11.9v1.6M13.5 8h-1.6M4.1 8H2.5M11.66 4.34l-1.13 1.13M5.47 10.53l-1.13 1.13M11.66 11.66l-1.13-1.13M5.47 5.47L4.34 4.34',
    },
  ],
  /**
   * 멀티뷰 스테이지의 설정 버튼 전용 (2026-08-23). 톱니(gear)는 이미 치지직 순정 설정
   * 아이콘과 같은 모양이라 헷갈린다는 지적으로, 망치 모양으로 구분했다.
   */
  hammer: 'M9.2 6.8L3 13M7.6 3.4L9 2l3 3-1.4 1.4zM8.3 4.1l2.6 2.6',
  compressor: [
    { tag: 'path', d: 'M2 6.3h2.2L7.7 3.2v9.6L4.2 9.7H2z' },
    { tag: 'path', d: 'M9.6 5.6a3.2 3.2 0 0 1 0 4.8' },
    { tag: 'path', d: 'M9.3 3.2h4.4M9.3 12.8h4.4' },
  ],
} as const satisfies Record<string, string | readonly IconShape[]>;

/** 단일 문자열 path 도 `IconShape[]` 로 정규화한다 — React·DOM 렌더러가 같은 목록을 순회한다. */
function iconShapes(spec: string | readonly IconShape[]): readonly IconShape[] {
  return typeof spec === 'string' ? [{ tag: 'path', d: spec }] : spec;
}
/**
 * React 렌더러용 — `IconShape[]` 를 `<path>`/`<rect>` JSX 목록으로 바꾼다.
 *
 * `key` 로 인덱스를 쓴다. `ICON_PATHS` 는 정적 상수라 순서가 바뀌거나 항목이 끼어들지 않는다.
 */
function renderIconShapes(spec: string | readonly IconShape[]) {
  return iconShapes(spec).map((shape, index) => {
    if (shape.tag === 'rect') {
      return (
        <rect
          key={index}
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          rx={shape.rx}
        />
      );
    }
    if (shape.tag === 'circle') {
      return <circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} />;
    }
    return <path key={index} d={shape.d} />;
  });
}

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
  for (const shape of iconShapes(ICON_PATHS[name])) {
    if (shape.tag === 'rect') {
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(shape.x));
      rect.setAttribute('y', String(shape.y));
      rect.setAttribute('width', String(shape.width));
      rect.setAttribute('height', String(shape.height));
      if (shape.rx !== undefined) rect.setAttribute('rx', String(shape.rx));
      svg.appendChild(rect);
      continue;
    }
    if (shape.tag === 'circle') {
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', String(shape.cx));
      circle.setAttribute('cy', String(shape.cy));
      circle.setAttribute('r', String(shape.r));
      svg.appendChild(circle);
      continue;
    }
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', shape.d);
    svg.appendChild(path);
  }
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
    <svg {...strokeSvgProps(size, className)}>{renderIconShapes(ICON_PATHS.resizeHorizontal)}</svg>
  );
}

/** `⟩` 대체 — 오른쪽 쉐브론 (펼치기). */
export function ChevronRightIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...strokeSvgProps(size, className)}>{renderIconShapes(ICON_PATHS.chevronRight)}</svg>
  );
}

/** `⟨` 대체 — 왼쪽 쉐브론 (접기). */
export function ChevronLeftIcon({ size = 16, className }: IconProps) {
  return <svg {...strokeSvgProps(size, className)}>{renderIconShapes(ICON_PATHS.chevronLeft)}</svg>;
}

/** `▦` 대체 — 채팅이 오른쪽인 배치. 사각 프레임 + 세로 분할선(오른쪽 1/3). */
export function LayoutRightIcon({ size = 16, className }: IconProps) {
  return <svg {...strokeSvgProps(size, className)}>{renderIconShapes(ICON_PATHS.layoutRight)}</svg>;
}

/** `▤` 대체 — 채팅이 아래인 배치. 사각 프레임 + 가로 분할선(아래쪽 1/3). */
export function LayoutBottomIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...strokeSvgProps(size, className)}>{renderIconShapes(ICON_PATHS.layoutBottom)}</svg>
  );
}

/** 멀티뷰 조작 바 `구성` 버튼 대체 — 2×2 사각형(슬롯 배치를 표현). */
export function SlotsIcon({ size = 16, className }: IconProps) {
  return <svg {...strokeSvgProps(size, className)}>{renderIconShapes(ICON_PATHS.slots)}</svg>;
}

/** `⚙` 대체 — 설정. 원 + 톱니 6개. */
export function GearIcon({ size = 16, className }: IconProps) {
  return <svg {...strokeSvgProps(size, className)}>{renderIconShapes(ICON_PATHS.gear)}</svg>;
}

/** 멀티뷰 스테이지 설정 버튼 전용 — 치지직 순정 설정(톱니)과 구분하려고 망치 모양을 쓴다. */
export function HammerIcon({ size = 16, className }: IconProps) {
  return <svg {...strokeSvgProps(size, className)}>{renderIconShapes(ICON_PATHS.hammer)}</svg>;
}

/**
 * 음량 평탄화(컴프레서) 토글 — 스피커 + 음파 하나를 위아래 수평 막대(천장·바닥)가 감싸는 모양.
 * 소리가 그 사이로만 눌려 고르게 나온다는 뜻이다.
 *
 * 🔴 이전 버전은 음파 두 겹 위에 수평선 하나가 허공에 떠 있어(스피커·음파와 닿지 않음)
 * "잘못 그려진 것" 처럼 보였다(사용자 보고 2026-08-23). 막대를 음파 위아래에 하나씩 붙여
 * 실제로 감싸는 모양으로 바꿨다 — `etc/tmp/icon-preview*.html` 로 여러 후보를 렌더해 비교.
 */
export function CompressorIcon({ size = 16, className }: IconProps) {
  return <svg {...strokeSvgProps(size, className)}>{renderIconShapes(ICON_PATHS.compressor)}</svg>;
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

/** `🎯` 대체 — 초점(활성) 슬롯 표시. 원 + 바깥쪽 4방향 눈금(조준경). */
export function TargetIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...strokeSvgProps(size, className)}>
      <path d={ICON_PATHS.target} />
    </svg>
  );
}

/** `💬` 대체 — 채팅 켜기(꺼진 상태 표시). 말꼬리가 달린 말풍선. */
export function ChatBubbleIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...strokeSvgProps(size, className)}>
      <path d={ICON_PATHS.chatBubble} />
    </svg>
  );
}

/** `⛶` 대체 — 전체 화면 전환. 네 모서리 꺾쇠(뷰파인더).  */
export function FullscreenIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...strokeSvgProps(size, className)}>
      <path d={ICON_PATHS.fullscreen} />
    </svg>
  );
}
