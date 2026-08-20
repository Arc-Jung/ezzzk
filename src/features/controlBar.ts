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

import { BETA_BADGE_TEXT, OURS, PLAYER } from '../constants/class';
import { qs, upsertStyle } from '../utils/dom';
import { keepMounted, type Disposer } from '../utils/observe';

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
.${CONTROL_ITEM_CLASS} { transition: opacity 200ms; }
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
/*
  BETA 뱃지 (FR-14 멀티뷰).
  🔴 position: absolute 로 띄워 **버튼의 레이아웃 상자를 전혀 늘리지 않는다.**
  버튼이 커지면 터치 타겟 피치(44px)가 어긋나고 좁은 화면에서 우측 그룹이 줄바꿈된다
  (위 flex-wrap 주석의 실측 사고와 같은 부류). 문구는 아래쪽 여백에 얹는다.
*/
.${CONTROL_ITEM_CLASS} .${OURS.betaBadgeClass} {
  position: absolute;
  left: 50%;
  bottom: 1px;
  transform: translateX(-50%);
  font-size: 7px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.02em;
  color: #00ffa3;
  pointer-events: none;
}
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
  /** 버튼 안에 넣을 내용 (텍스트 또는 SVG 문자열) */
  content: string;
  onClick: () => void;
  /** 터치 타겟 최소 크기. 기기 프로필의 touchTargetPx 를 넘긴다. */
  minTargetPx?: number;
  /** 확장 배지 표시 — 네이티브 설정 버튼과 혼동을 막는다 (§11 미결정 8) */
  badge?: boolean;
  /** BETA 뱃지 표시 — 아직 불안정한 기능임을 알린다 (FR-14 멀티뷰, 2026-08-16) */
  betaBadge?: boolean;
};

function buildButton(options: ControlBarButtonOptions): HTMLButtonElement {
  const size = Math.max(NATIVE_BUTTON_PX, options.minTargetPx ?? NATIVE_BUTTON_PX);
  const button = document.createElement('button');
  button.id = options.id;
  button.type = 'button';
  button.className = CONTROL_ITEM_CLASS;
  button.setAttribute('aria-label', options.ariaLabel);
  button.title = options.ariaLabel;
  button.innerHTML = options.content;
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

  /**
   * BETA 뱃지.
   *
   * 접근성 — **`aria-label` 은 그대로 두고 `aria-describedby` 로 알린다.**
   * ① 이름에 "베타"를 넣으면 스크린 리더가 포커스·낭독마다 조작 문구와 함께 읽어 방해가 되고,
   *    설명(description)은 스크린 리더의 상세도 설정으로 사용자가 끌 수 있다.
   * ② 하네스·테스트(`verify-ui-profiles`·`explore-ui`·`capture-demo`)가 `aria-label` 로 요소를
   *    찾으므로 이름을 바꾸면 조용히 깨진다. 뱃지는 **덧붙이는** 것이지 대체가 아니다.
   * 시각 뱃지 자체는 `aria-hidden` 으로 이중 낭독을 막는다.
   */
  if (options.betaBadge) {
    const beta = document.createElement('span');
    beta.className = OURS.betaBadgeClass;
    beta.setAttribute('aria-hidden', 'true');
    beta.textContent = BETA_BADGE_TEXT;
    button.appendChild(beta);

    const note = document.createElement('span');
    note.id = `${options.id}-beta-desc`;
    note.className = OURS.srOnlyClass;
    note.textContent = '베타 기능';
    button.appendChild(note);
    button.setAttribute('aria-describedby', note.id);
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

  const mount = () => {
    const container = host();
    if (!container) return;
    if (!node) node = buildButton(options);
    if (node.parentElement !== container) {
      // firstChild 앞에 넣는다 — 그룹이 왼쪽으로 자라고 네이티브 버튼은 밀리지 않는다.
      container.insertBefore(node, container.firstChild);
    }
  };

  const isMounted = (): boolean => {
    const container = host();
    return container !== null && node !== null && node.parentElement === container;
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
