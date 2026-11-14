/**
 * 컨트롤바 버튼 삽입 공용 헬퍼 (FR-03 · FR-09.2 · FR-14 공통).
 *
 * 실측 근거 (2026-08-12, `chzzk-dom-19-layout-1920.json`)
 * - 삽입 지점은 `div.pzp-pc__bottom-buttons-right` 의 firstChild 앞이다.
 * - 삽입하면 **우측 끝(1548)이 고정되고 그룹이 왼쪽으로 44px 씩 자란다. 네이티브 버튼은 전혀
 *   밀리지 않는다** (220 → 308, x 1328 → 1240, 네이티브 1336/1380/1424/1468/1512 불변).
 * - ⚠️ **삽입 노드는 컨트롤바 자동 숨김을 따라가지 않는다** (네이티브 opacity 0 / 우리 1).
 *   `pzp-button` 클래스를 붙여도 해결되지 않았다.
 * - ✅ **자동 숨김 신호는 플레이어 루트의 `pzp-pc--controls` modifier 다**
 *   (실측 2026-08-12, `chzzk-dom-24-widescreen-trace.json`: modifier 있음 ⇔ 네이티브 opacity 1,
 *   없음 ⇔ 0). opacity 는 그룹이 아니라 **각 버튼 자신**에 걸린다 — 그룹은 항상 1 이다.
 *   → JS 옵저버로 opacity 를 따라가지 않고 **같은 modifier 를 쓰는 CSS 규칙**으로 동기화한다.
 *   옵저버가 없어 항상 정확하고 비용도 0 이다.
 * - 버튼은 36×36, 피치 44px. 이 값은 뷰포트와 무관한 고정값이다.
 */

import { OURS, PLAYER } from '../constants/class';
import { qs, upsertStyle } from '../utils/dom';
import { keepMounted, type Disposer } from '../utils/observe';
import { createIconElement, type IconName } from '../ui/icons';
import { ACCENT, RADIUS, UI_STATE } from '../ui/tokens';

/** 네이티브 버튼 크기 (실측 고정값) */
export const NATIVE_BUTTON_PX = 36;
/** 버튼 간 피치 (실측 고정값) */
export const NATIVE_BUTTON_PITCH_PX = 44;

/** 우리 삽입 노드에 공통으로 붙이는 클래스. 자동 숨김 CSS 의 대상이다. */
export const CONTROL_ITEM_CLASS = 'cm-controlbar-item';
const AUTO_HIDE_STYLE_ID = 'cm-controlbar-autohide-style';

/**
 * 자동 숨김 + **좁은 화면 넘침 방지** CSS.
 *
 * 네이티브와 **같은 신호(`pzp-pc--controls`)** 를 쓰므로 페이드 타이밍이 정확히 일치한다.
 * FR-03 볼륨 컨트롤·FR-09.2 설정 버튼·FR-14 멀티 버튼이 모두 이 규칙을 공유한다.
 *
 * 🔴 삽입 항목이 문서 가로 스크롤을 만들지 않게 네이티브 버튼 그룹을 줄어들게 한다.
 *
 * 실측 2026-08-12 (모바일 세로 412×915, 데스크톱 사이트 모드): 플레이어 폭이 278px 인데
 * 우측 그룹은 네이티브 3개 + 설정(44) + 멀티(44) + 볼륨 컨트롤(136) 로 372px 가 되어
 * 문서 `scrollWidth` 472 > `clientWidth` 397 → **상시 가로 스크롤**이 생겼다.
 * FR-10 이 없애려는 바로 그 증상이므로 삽입하는 쪽에서 막는다.
 *
 * flex 항목의 기본값은 `min-width: auto` 라 축소가 막힌다 → 0 으로 풀고, 그래도 넘치면
 * 줄을 바꿔 **모든 버튼이 화면 안에 남게** 한다. 잘라내지 않는다 — 조작 요소는 도달 가능해야 한다.
 */
export const CONTROL_BAR_AUTO_HIDE_CSS = `
html[data-cm-auto-volume-lock] .cm-volume-button:disabled { opacity: 0.4; cursor: default; }
html[data-cm-auto-volume-lock] :is(.pzp-pc__volume-button, .pzp-pc__volume-slider, .pzp-mobile__volume-button, .pzp-mobile__volume-slider) { pointer-events: none; opacity: 0.4; }
.${CONTROL_ITEM_CLASS} { transition: opacity 200ms, background-color 140ms ease; border-radius: ${RADIUS.sm}; }
.${CONTROL_ITEM_CLASS}[aria-pressed='true'] { background: ${UI_STATE.selected} !important; }
.${CONTROL_ITEM_CLASS}:focus-visible { outline: 2px solid ${ACCENT}; outline-offset: 2px; }
@media (hover: hover) {
  .${CONTROL_ITEM_CLASS}:hover { background: ${UI_STATE.hover} !important; }
}
@media (prefers-reduced-motion: reduce) {
  .${CONTROL_ITEM_CLASS} { transition: none; }
}
.pzp-pc:not(.pzp-pc--controls) .${CONTROL_ITEM_CLASS} {
  opacity: 0 !important;
  pointer-events: none !important;
}
div.pzp-pc__bottom-buttons-right,
div.pzp-pc__bottom-buttons-left {
  min-width: 0 !important;
  flex-wrap: wrap !important;
}
div.pzp-pc__bottom-buttons-right { justify-content: flex-end !important; }
.${OURS.srOnlyClass} {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
`.trim();

/** 자동 숨김 규칙을 한 번만 주입한다. 여러 기능이 불러도 style 태그는 하나다. */
export function ensureControlBarAutoHideCss(): void {
  upsertStyle(AUTO_HIDE_STYLE_ID, CONTROL_BAR_AUTO_HIDE_CSS);
}

export type ControlBarButtonOptions = {
  id: string;
  /** 접근성 필수 (NFR-10). 네이티브 `설정` 과 구분되는 문구를 쓴다. */
  ariaLabel: string;
  /**
   * 버튼 안에 넣을 텍스트 (`멀티` 처럼 글자를 쓰는 버튼용).
   * 🔴 아이콘 버튼이면 `content` 가 아니라 `icon` 을 쓴다 — 문자·이모지는 폰트에 따라
   * 크기·정렬·색이 제각각이라 치지직 네이티브 버튼과 톤이 어긋난다
   * (계획 `docs/chzzk-tone-ui-plan.md` §4.3).
   */
  content?: string;
  /** 인라인 SVG 아이콘. `content` 와 함께 주면 아이콘이 이긴다. */
  icon?: IconName;
  iconSize?: number;
  /** 아이콘 오른쪽에 함께 표시할 이름. */
  iconLabel?: string;
  /** 지정한 네이티브 버튼 바로 앞에 삽입한다. 없으면 그룹 맨 앞에 둔다. */
  before?: string;
  onClick: () => void;
  /** 삽입·재삽입 시 최신 토글 상태 등을 반영한다. */
  onMount?: (button: HTMLButtonElement) => void;
  /** 터치 타겟 최소 크기. 기기 프로필의 touchTargetPx 를 넘긴다. */
  minTargetPx?: number;
  /** 확장 배지 표시 — 네이티브 설정 버튼과 혼동을 막는다 (§11 미결정 8) */
  badge?: boolean;
};

function buildButton(options: ControlBarButtonOptions): HTMLButtonElement {
  const size = Math.max(NATIVE_BUTTON_PX, options.minTargetPx ?? NATIVE_BUTTON_PX);
  const button = document.createElement('button');
  button.id = options.id;
  button.type = 'button';
  button.className = CONTROL_ITEM_CLASS;
  button.setAttribute('aria-label', options.ariaLabel);
  button.title = options.ariaLabel;
  if (options.icon) button.appendChild(createIconElement(options.icon, options.iconSize));
  else if (options.content !== undefined) button.textContent = options.content;
  button.style.cssText = [
    `width: ${size}px`,
    `height: ${size}px`,
    // 그룹에 flex-wrap 을 켰으므로 축소를 막아야 한다 — 기본 flex-shrink:1 이면
    // 좁은 화면에서 44px 버튼이 13px 로 찌그러져 터치 타겟이 무너진다 (실측 2026-08-12).
    'flex: 0 0 auto',
    'display: inline-flex',
    'align-items: center',
    'justify-content: center',
    'position: relative',
    'border: 0',
    'background: transparent',
    'color: #fff',
    'cursor: pointer',
    'font-size: 15px',
    'line-height: 1',
    'padding: 0',
  ].join('; ');

  if (options.icon && options.iconLabel) {
    const label = document.createElement('span');
    label.textContent = options.iconLabel;
    label.setAttribute('aria-hidden', 'true');
    button.appendChild(label);
    button.style.width = 'auto';
    button.style.minWidth = `${size}px`;
    button.style.padding = '0 8px';
    button.style.gap = '6px';
    button.style.whiteSpace = 'nowrap';
  }

  if (options.badge) {
    const badge = document.createElement('span');
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = '＊';
    badge.style.cssText = [
      'position: absolute',
      'top: 3px',
      'right: 3px',
      'font-size: 9px',
      'line-height: 1',
      'color: #00ffa3',
      'pointer-events: none',
    ].join('; ');
    button.appendChild(badge);
  }

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    options.onClick();
  });

  return button;
}

/**
 * 컨트롤바 우측 그룹에 버튼을 삽입하고 유지한다.
 * - 리렌더로 노드가 사라지면 다시 넣는다 (keepMounted).
 * - 네이티브 형제의 computed opacity 를 읽어 자동 숨김을 따라간다.
 * - ⚠️ 광고 재생 중에는 컨트롤바 DOM 이 아예 없다. 그때는 조용히 대기한다 (실패가 아니다).
 */
export function mountControlBarButton(options: ControlBarButtonOptions): Disposer {
  let node: HTMLButtonElement | null = null;

  ensureControlBarAutoHideCss();

  const host = (): Element | null => qs(PLAYER.bottomButtonsRight);

  const anchor = (container: Element): Element | null => {
    let target = options.before ? container.querySelector(options.before) : null;
    while (target && target.parentElement !== container) target = target.parentElement;
    return target;
  };
  const mount = () => {
    const container = host();
    if (!container) return;
    if (!node) node = buildButton(options);
    const before = anchor(container);
    if (node.parentElement !== container || (before && node.nextSibling !== before)) {
      container.insertBefore(node, before ?? container.firstChild);
      options.onMount?.(node);
    }
  };

  const isMounted = (): boolean => {
    const container = host();
    return (
      container !== null &&
      node !== null &&
      node.parentElement === container &&
      (!anchor(container) || node.nextSibling === anchor(container))
    );
  };

  /**
   * 리렌더로 노드가 사라지면 다시 넣는다.
   * ⚠️ 관찰 대상을 `document.documentElement` 로 두는 이유: 플레이어 루트는 이 시점에 아직
   * 없을 수 있고, 한 번 잡은 참조를 계속 쓰면 플레이어가 재생성될 때 감시가 끊긴다.
   * 자동 숨김은 CSS 가 맡으므로 여기서는 존재 여부만 본다.
   */
  const stopKeep = keepMounted(document.documentElement, isMounted, mount);

  return () => {
    stopKeep();
    node?.remove();
    node = null;
  };
}
