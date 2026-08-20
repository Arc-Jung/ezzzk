/**
 * FR-13 치트키 구매 팝업 가리기.
 *
 * 숨김 대상은 **DOM 위치가 완전히 다른 두 종류**다 (실측 2026-08-11).
 *  ① 우하단 광고 배너 — `body` **직계 자식** (`#root` 밖). 실측 `div._container_1l6oy_2`,
 *     394×113, x=763 y=887 (1920×1080). 문구에 `치트키` 포함.
 *  ② 플레이어 컨트롤바 툴팁 — `#live_player_layout` 안
 *     (`div.pzp-pc__bottom-buttons-left > div.tooltip`).
 *
 * 🔴 오탐 실증: `body > div` 를 **텍스트만으로** 걸렀더니 `div#root`(1920×1080, textLen 4801)가
 * 매칭돼 **페이지 전체가 사라졌다.** 툴팁의 `치트키` 문구가 `#root` 안에 있기 때문이다.
 * → 텍스트 + 위치(크기) 조건을 **동시에** 만족해야 하고, 명시 제외 목록도 함께 쓴다.
 *
 * 숨김은 **DOM 제거가 아니라 `display: none !important`** 로 한다. 실측에서 요소는 DOM 에 남고
 * 크기만 0 이 되며 React 경고도 없었다.
 *
 * ⚠️ 배너는 `#root` 밖이므로 **`document.body` 를 `childList` 로 관찰**해야 한다.
 * `#root` 만 감시하면 절대 잡히지 않는다.
 *
 * **범위 명확화**: 이 기능은 **프로모션 팝업 UI 만 가린다.** 광고 자체를 차단하지 않으며
 * 영상 광고 삽입·재생에는 일절 개입하지 않는다.
 */

import { ID, PROMO } from '../constants/class';
import { qs, qsa } from '../utils/dom';
import { observe } from '../utils/observe';
import { info } from '../utils/log';
import type { Feature } from './types';

/** 숨긴 요소 표시용 속성. 해제 시 이 속성으로 되찾는다. */
const HIDDEN_ATTR = 'data-cm-promo-hidden';

const EXCLUDE_IDS: readonly string[] = PROMO.excludeIds;

/**
 * 배너 판정 — 텍스트·크기를 **동시에** 본다. 순수 함수라 테스트 대상이다.
 * rect 를 인자로 받는 이유: jsdom 은 레이아웃을 계산하지 않으므로 실측값을 주입해 검증한다.
 */
export function isPromoBanner(el: Element, rect: { width: number; height: number }): boolean {
  // 우리 노드는 절대 건드리지 않는다.
  if (el.id.startsWith('cm-')) return false;
  if (EXCLUDE_IDS.includes(el.id)) return false;

  const text = el.textContent ?? '';
  if (!text.includes(PROMO.banner.text)) return false;

  const { minW, maxW, minH, maxH } = PROMO.banner;
  return rect.width >= minW && rect.width <= maxW && rect.height >= minH && rect.height <= maxH;
}

function hide(el: HTMLElement): boolean {
  if (el.hasAttribute(HIDDEN_ATTR)) return false;
  el.style.setProperty('display', 'none', 'important');
  el.setAttribute(HIDDEN_ATTR, 'true');
  return true;
}

function restoreAll(): void {
  for (const el of qsa<HTMLElement>(`[${HIDDEN_ATTR}]`)) {
    el.style.removeProperty('display');
    el.removeAttribute(HIDDEN_ATTR);
  }
}

export const promoHideFeature: Feature = {
  id: 'promoHide',
  watches: ['promoHide'],
  supports: (ctx) =>
    (ctx.settings.promoHide.banner || ctx.settings.promoHide.playerTooltip) &&
    ctx.page.type !== 'unsupported',
  start: (ctx) => {
    const apply = () => {
      if (ctx.settings.promoHide.banner) {
        for (const el of qsa<HTMLElement>(PROMO.bodyDirectChild)) {
          const rect = el.getBoundingClientRect();
          if (isPromoBanner(el, rect) && hide(el)) {
            info(`promo banner hidden (${Math.round(rect.width)}x${Math.round(rect.height)})`);
          }
        }
      }

      if (ctx.settings.promoHide.playerTooltip) {
        // 툴팁은 셀렉터가 플레이어 컨트롤바 범위로 이미 한정돼 있어 크기 조건이 필요 없다.
        // 숨겨도 컨트롤바 레이아웃이 밀리지 않는지는 Playwright 로 확인한다 (§8.0).
        const tooltip = qs<HTMLElement>(PROMO.playerTooltip);
        if (tooltip && hide(tooltip)) info('promo player tooltip hidden');
      }
    };

    apply();

    const debounceMs = ctx.device.profile.relaxObservers ? 400 : 200;

    // ① 배너 — body 직계라 subtree 없이 childList 만 본다. 비용이 가장 낮다.
    const stopBody = observe(document.body, apply, {
      childList: true,
      subtree: false,
      debounceMs,
    });

    // ② 툴팁 — #root 안쪽 깊은 곳이라 별도로 관찰한다. 범위를 플레이어로 최대한 좁힌다.
    const tooltipRoot = qs(ID.livePlayerLayout) ?? qs(ID.vodPlayerLayout) ?? qs(ID.root);
    const stopTooltip = tooltipRoot
      ? observe(tooltipRoot, apply, { childList: true, subtree: true, debounceMs })
      : undefined;

    return () => {
      stopBody();
      stopTooltip?.();
      restoreAll();
    };
  },
};
