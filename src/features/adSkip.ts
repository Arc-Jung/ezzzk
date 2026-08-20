/**
 * FR-18 광고 `SKIP` 버튼 자동 클릭.
 *
 * 실측 근거 (2026-08-12, `chzzk-dom-27-ad-skip.json` · `chzzk-dom-28-ad-skip-deep.json`, 라이브 6채널)
 *
 * 광고는 치지직 본 플레이어(`pzp-pc`)가 아니라 **별도의 레거시 네이버 광고 플레이어**로 재생된다.
 * 이 플레이어는 **해시 없는 평범한 클래스명**을 쓴다 — 치지직 CSS 모듈보다 오히려 안정적이다.
 *
 * ```
 * div.vod_player_wrap.pc                 (1326×746) 광고 플레이어 루트
 * ├─ div.ad_info_area                    (1270×16)  "15초 후 SKIP  이 광고가 표시되는 이유"
 * │  ├─ div.skip_area > p.skip_info      (110×27)   "N초 후 SKIP"  ← 카운트다운 표시, 클릭 대상 아님
 * │  └─ button.btn_skip > span.txt       (115×43)   "SKIP"        ← ✅ 유일한 클릭 대상
 * └─ div.link_btn_area > a.link_more     (120×36)   "광고 페이지 보기" ← ❌ 절대 클릭 금지
 * ```
 *
 * 🔴 **`button.btn_skip` 은 광고 시작부터 DOM 에 존재한다. 나타나는 게 아니라 `display` 만 바뀐다.**
 * 실측 (`chzzk-dom-30`, 나나양): t=1~15.5s 구간 31개 샘플 전부 `present: true`,
 * `display: none`, `rect 0×0` → t=16s 에 `display: block`, `115×43`, `hitIsSelfOrChild: true`.
 * `skip_area` 가 `button.btn_skip` 으로 **교체되는 것이 아니다** — 둘은 별개 노드이고 표시 상태만 바뀐다.
 *
 * ⚠️ **따라서 `isVisible()` 검사를 절대 빼면 안 된다.** 존재 여부로 판정하면 카운트다운 중에
 * 0×0 숨김 버튼을 누르게 되고, 검증에서도 "안 눌렸다"고 오판한다 (실제로 1차 검증에서 오판했다).
 * **보이는지가 유일한 유효 신호다.**
 *
 * ⚠️ **`a.link_more`(`광고 페이지 보기`)를 클릭하면 광고주 페이지가 열린다.** 텍스트에 `광고` 가
 * 들어간다고 아무 요소나 누르면 안 된다 — FR-06 의 랭킹 오클릭과 같은 종류의 사고다.
 * 그래서 `button.btn_skip` 만 대상으로 하고, 카운트다운 중인 `skip_area`·`skip_info` 는 건드리지 않는다.
 *
 * ⚠️ 이 기능은 **광고를 차단하지 않는다.** 광고 재생을 막거나 네트워크 요청을 가로채지 않고,
 * 치지직이 제공하는 스킵 버튼을 사용자 대신 누를 뿐이다 (FR-13·FR-17 과 같은 범위 원칙).
 */

import { ID } from '../constants/class';
import { hasPlayer } from '../pageType';
import { isVisible, normalizeText, qsa } from '../utils/dom';
import { observe } from '../utils/observe';
import { info } from '../utils/log';
import type { Feature } from './types';

/** 광고 플레이어 셀렉터. 해시가 없어 접두어 부분 일치가 필요 없다 (실측). */
export const AD = {
  /** ✅ 유일한 클릭 대상. 보이는지(`isVisible`)를 반드시 함께 확인한다. */
  skipButton: 'button.btn_skip',
  /**
   * ❌ 광고주 페이지로 나가는 링크. 절대 클릭하지 않는다.
   * `<a>` 는 `button.btn_skip` 에 매칭될 수 없어 구조적으로 도달 불가지만,
   * 향후 마크업이 바뀌어도 안전하도록 조상 검사로 한 겹 더 막는다.
   */
  advertiserLink: 'a.link_more, div.link_btn_area',
} as const;

/**
 * 이 요소를 클릭해도 되는가. **순수 함수** — 테스트 대상.
 *
 * 조건을 모두 만족해야 한다:
 * 1. `button.btn_skip` 이다 (카운트다운 `skip_area`·`skip_info` 는 제외)
 * 2. 광고주 링크(`link_more`)의 자손이 아니다
 * 3. 화면에 실제로 보인다 (0×0 · `display:none` 제외)
 */
export function isClickableSkipButton(el: Element): boolean {
  if (!el.matches(AD.skipButton)) return false;
  if (el.closest(AD.advertiserLink)) return false;
  return isVisible(el);
}

/**
 * 카운트다운 문구에서 남은 초를 읽는다. **디버그 로그 전용** — 클릭 판정에는 쓰지 않는다
 * (판정은 `isVisible` 하나로 충분하고, 문구 파싱에 의존하면 문구 개편에 깨진다).
 */
export function parseSkipCountdown(text: string): number | null {
  const match = /(\d+)\s*초\s*후/.exec(normalizeText(text));
  if (!match?.[1]) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds : null;
}

/**
 * 지금 보이는 스킵 버튼을 눌러 준다.
 * @returns 클릭한 버튼 수 (0 = 아직 스킵할 수 없음)
 */
export function clickSkipButtons(): number {
  let clicked = 0;
  for (const button of qsa<HTMLElement>(AD.skipButton)) {
    if (!isClickableSkipButton(button)) continue;
    button.click();
    clicked += 1;
  }
  return clicked;
}

export const adSkipFeature: Feature = {
  id: 'adSkip',
  watches: ['adSkip'],
  supports: (ctx) => ctx.settings.adSkip.enabled && hasPlayer(ctx.page.type),
  start: (ctx) => {
    const trySkip = () => {
      const clicked = clickSkipButtons();
      if (clicked > 0) info(`clicked ${clicked} ad skip button(s)`);
    };

    trySkip();

    /**
     * 🔴 **`childList` 만 관찰하면 안 된다.** 스킵 버튼은 광고 시작부터 DOM 에 있고
     * 카운트다운이 끝날 때 **`display` 만 바뀐다**(위 실측 참조). 노드 삽입이 아니므로
     * `childList` 변화로는 그 순간이 잡히지 않는다.
     * → `style`·`class` 속성 변화를 함께 관찰한다. 이것이 표시 상태 전환을 잡는 신호다.
     *
     * 카운트다운 문구는 텍스트 변화라 `characterData` 를 켜지 않는 한 옵저버를 깨우지 않고,
     * 속성 필터를 두 개로 좁혀 두었으므로 재생 내내 CPU 를 먹지 않는다 (NFR-04).
     * 광고 플레이어는 본 플레이어 컨테이너 안에 들어오므로 그 서브트리를 관찰한다.
     */
    const root =
      document.querySelector(ID.livePlayerLayout) ??
      document.querySelector(ID.vodPlayerLayout) ??
      document.body;

    return observe(root, trySkip, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
      debounceMs: ctx.device.profile.relaxObservers ? 300 : 150,
    });
  },
};
