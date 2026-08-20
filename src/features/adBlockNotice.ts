/**
 * FR-18.2 `광고 차단 프로그램을 사용 중이신가요?` 안내 팝업 자동 처리.
 *
 * 치지직이 광고 차단을 감지하면 재생 화면 위에 모달을 띄운다. 매번 사람이 `확인` 을 눌러야
 * 넘어가므로 대신 눌러 준다 (2026-08-12 요청).
 *
 * ## 실측으로 확정한 동작 (2026-08-15, `docs/frontend-dump/chzzk-dom-adblock-notice.json`)
 *
 * 애드가드를 함께 로드해 **진짜 모달**을 띄워 확인한 결과 (`scripts/probe-adblock-modal.mjs`):
 *
 * ```
 * div._dimmed_…            ← body 직계. 화면 전체를 덮는 fixed 오버레이
 *   div._container_…       role="alertdialog" aria-modal="true"
 *     div._contents_…      strong(문구) + p + p(> a "자세히 보기")
 *     div._footer_ > div._inner_ > div._cell_ > button "확인"
 * ```
 *
 * 셀렉터·버튼 판정은 **맞았다.** 그런데도 모달이 사라지지 않았다 —
 * 로그상 `dismissed 1 ad-block notice(s)` 가 0.3~2초 간격으로 **40회 이상** 반복됐다.
 * 🔴 즉 **치지직이 모달을 계속 다시 띄운다.** 광고 차단이 계속 감지되는 한 클릭만으로는 이길 수 없다.
 *
 * → 그래서 2단계로 처리한다.
 *   1. **먼저 `확인` 을 누른다** — 정상 경로다. 한 번에 닫히는 경우(일시적 감지)는 이걸로 끝난다.
 *   2. 눌렀는데도 잠시 뒤 그대로 있으면 **숨긴다**(`display: none`). 오버레이가 `fixed` 로 화면을
 *      덮고 있어 그냥 두면 재생 화면을 가리고 클릭도 막는다.
 *   한 번 2단계까지 간 페이지에서는 이후 같은 모달을 **즉시 숨긴다** — 이길 수 없는 클릭을
 *   초당 여러 번 반복하는 것이 더 나쁘다.
 *
 * 🔴 오클릭 방지가 여전히 이 기능의 핵심이다.
 * - `확인` 이라는 텍스트는 페이지 어디에나 있을 수 있다 → **반드시 이 모달 안쪽**에서만 찾는다.
 * - 모달 판정은 `광고 차단 프로그램` 문구를 포함하는 컨테이너로 한다.
 * - `자세히 보기` 는 **다른 페이지로 나가는 링크**다(실측 `href=help.naver.com/...`).
 *   절대 누르지 않는다 (FR-18 의 `광고 페이지 보기`, FR-06 의 랭킹 화살표와 같은 종류의 사고다).
 * - 숨김 대상은 **문구를 담은 모달 오버레이 하나뿐**이다. 조상으로 거슬러 올라가 페이지를 통째로
 *   숨기는 사고를 막기 위해 텍스트 길이 상한 + **구조 조건**(`role="alertdialog"` /
 *   `aria-modal="true"`)을 함께 요구한다. 길이 상한만으로는 로딩·오류로 본문이 짧은 순간에
 *   `#root` 가 매칭돼 앱 전체가 `display:none` 이 될 수 있고, 그 결과는 백지 화면이다.
 *
 * ## 클릭은 `inner`, 숨김은 `root` — 비대칭은 의도된 것이다
 *
 * - **클릭**은 가장 안쪽(문구를 담은 최소 컨테이너)에서 찾는다. 바깥에서 찾으면 모달 밖의
 *   동명 버튼까지 후보가 되어 오클릭 위험이 커진다.
 * - **숨김**은 가장 바깥 오버레이(`div._dimmed_…`)에 건다. 화면을 덮고 클릭을 먹는 주체가
 *   그 `fixed` 오버레이이기 때문이다. 안쪽 대화상자만 숨기면 딤 레이어가 남아 재생 화면을
 *   계속 가리고 클릭도 막힌다.
 */

import { isVisible, normalizeText, qsa } from '../utils/dom';
import { observe } from '../utils/observe';
import { hasPlayer } from '../pageType';
import { info, warning } from '../utils/log';
import type { Feature } from './types';

/** 모달을 식별하는 문구. 제목 일부만 쓴다 — 본문 문구는 더 자주 바뀐다. */
export const AD_BLOCK_NOTICE_TEXT = '광고 차단 프로그램';

/** 눌러도 되는 버튼 텍스트. 정확히 일치만 허용한다. */
export const CONFIRM_LABELS: readonly string[] = ['확인'];

/** 절대 누르면 안 되는 것 — 외부로 나가는 링크·앵커. */
const NEVER_CLICK = 'a, [href]';

/** 모달 텍스트 길이 상한. 이보다 길면 모달이 아니라 페이지 컨테이너로 본다. */
export const MAX_NOTICE_TEXT_LEN = 200;

/**
 * 모달 판정을 위한 값싼 게이트. 이 셀렉터가 문서에 하나도 없으면 광고 차단 안내도 없다.
 * 실측(2026-08-15)에서 `div._container_…` 가 `role="alertdialog" aria-modal="true"` 를 갖는다.
 */
const DIALOG_SELECTOR = '[role="alertdialog"], [aria-modal="true"]';

/** 확장이 아니라 치지직 앱이 소유한 최상위 컨테이너. 절대 숨기면 안 되는 노드다. */
const APP_ROOT_ID = 'root';

/**
 * 이 요소가 광고 차단 안내 모달인가. **순수 함수 — 테스트 대상.**
 *
 * 텍스트만으로 판정하되 **너무 큰 조상**은 배제한다. `#root` 처럼 페이지 전체를 담은 노드도
 * 문구를 포함하므로, 그것을 모달로 보면 그 안의 아무 `확인` 이나 누르게 된다
 * (FR-13 에서 `#root` 가 `치트키` 텍스트에 걸려 페이지 전체를 숨긴 것과 같은 함정이다).
 *
 * 길이는 인자로 받지 않고 여기서 한 번만 계산한다. 인자로 받으면 호출부의 계산과 어긋날 수 있고,
 * 내부에서 또 정규화하면 수십 KB 짜리 `#root.textContent` 를 두 번 훑게 된다 (NFR-02b).
 */
export function isAdBlockNotice(el: Element): boolean {
  const text = normalizeText(el.textContent ?? '');
  if (!text.includes(AD_BLOCK_NOTICE_TEXT)) return false;
  // 모달 본문은 실측 스크린샷 기준 200자 이하다. 페이지 전체를 담은 노드를 걸러낸다.
  return text.length <= MAX_NOTICE_TEXT_LEN;
}

/**
 * 이 오버레이를 숨겨도 되는가. **순수 함수 — 테스트 대상.**
 *
 * 🔴 텍스트 길이 상한 하나에만 기대지 않는다. 로딩·오류로 본문이 짧은 순간에 `#root` 가
 * 문구까지 포함하면 앱 전체에 `display:none` 이 걸려 백지 화면이 된다. 확률은 낮지만 결과가
 * 비대칭적으로 나쁘므로 **구조 조건**을 함께 요구한다.
 */
export function canHideNoticeRoot(root: HTMLElement): boolean {
  if (root.id === APP_ROOT_ID) return false;
  // 앱 컨테이너를 품고 있으면 그것은 모달이 아니라 페이지다.
  if (root.querySelector(`#${APP_ROOT_ID}`)) return false;
  return root.matches(DIALOG_SELECTOR) || root.querySelector(DIALOG_SELECTOR) !== null;
}

/**
 * 모달 안에서 누를 버튼을 찾는다. **순수 함수 — 테스트 대상.**
 * 없으면 null. 링크는 후보에서 제외한다.
 */
export function findConfirmButton(modal: Element): HTMLElement | null {
  for (const candidate of Array.from(modal.querySelectorAll<HTMLElement>('button'))) {
    if (candidate.closest(NEVER_CLICK)) continue;
    const label = normalizeText(candidate.textContent ?? '');
    if (!CONFIRM_LABELS.includes(label)) continue;
    return candidate;
  }
  return null;
}

/** 이미 우리가 숨긴 모달임을 표시한다. 같은 노드를 반복 처리하지 않기 위한 것이다. */
export const HIDDEN_ATTR = 'data-cm-adblock-hidden';

/** 지금 떠 있는 광고 차단 안내 오버레이들. 문구를 담은 **바깥 컨테이너**(body 직계/포털)를 돌려준다. */
export function findAdBlockNoticeRoots(): HTMLElement[] {
  /**
   * 🔴 값싼 게이트를 먼저 통과시킨다. 옵저버가 200ms 디바운스로 body 서브트리를 보므로 라이브
   * 채팅 중에는 이 함수가 초당 5회 돈다. 게이트가 없으면 매번 `#root.textContent`(채팅 로그 전체,
   * 수십 KB)를 읽고 정규식까지 돌리게 된다 (NFR-02b/NFR-04).
   */
  if (!document.querySelector(DIALOG_SELECTOR)) return [];
  // 후보를 좁힌다 — 모달은 body 직계 또는 포털 안에 있다 (실측 2026-08-15: `div._dimmed_…` 가 body 직계).
  return qsa<HTMLElement>('body > div, #portal, #portal *').filter(isAdBlockNotice);
}

/**
 * 오버레이를 화면에서 치운다. **노드를 지우지 않는다** — 리액트가 관리하는 노드를 제거하면
 * 언마운트 시 예외가 나 페이지가 깨질 수 있다. 보이지 않게만 하고 클릭도 통과시킨다.
 */
export function hideNotice(root: HTMLElement): void {
  root.setAttribute(HIDDEN_ATTR, 'true');
  root.style.setProperty('display', 'none', 'important');
  // 오버레이가 남아 클릭을 먹는 경우까지 막는다 (display:none 이면 불필요하지만 이중 안전장치다).
  root.style.setProperty('pointer-events', 'none', 'important');
}

/**
 * 우리가 숨긴 오버레이를 되돌린다. 사용자가 FR-18 토글을 끄면 기능만 멈추는 것이 아니라
 * 화면도 원상복구되어야 한다 (`ultraWideLayout` 의 속성 제거, `chatWidth` 의 `removeStyle` 과 같다).
 */
export function restoreHiddenNotices(): void {
  for (const root of qsa<HTMLElement>(`[${HIDDEN_ATTR}]`)) {
    root.style.removeProperty('display');
    root.style.removeProperty('pointer-events');
    root.removeAttribute(HIDDEN_ATTR);
  }
}

/**
 * 지금 떠 있는 광고 차단 안내를 처리한다.
 *
 * @param escalate 참이면 `확인` 을 누르지 않고 **바로 숨긴다.** 클릭이 통하지 않는다는 것이
 *   이미 드러난 페이지에서 쓴다 — 이길 수 없는 클릭을 초당 여러 번 반복하지 않기 위함이다.
 * @returns 누른 버튼 수와 숨긴 오버레이 수
 */
export function dismissAdBlockNotices(escalate = false): { clicked: number; hidden: number } {
  let clicked = 0;
  let hidden = 0;
  const seen = new Set<Element>();

  for (const root of findAdBlockNoticeRoots()) {
    if (root.hasAttribute(HIDDEN_ATTR)) continue;

    // 가장 안쪽(작은) 후보에서 버튼을 찾는다. 조상·자손이 함께 매칭되면 중복 클릭이 된다.
    const inner = Array.from(root.querySelectorAll<HTMLElement>('*')).find(isAdBlockNotice) ?? root;
    if (seen.has(inner)) continue;
    seen.add(inner);

    if (escalate) {
      // 🔴 구조 조건을 통과하지 못하면 숨기지 않는다. 앱 컨테이너를 숨기면 백지 화면이다.
      if (!canHideNoticeRoot(root)) {
        warning('ad-block notice overlay failed structural check, skipping hide');
        continue;
      }
      hideNotice(root);
      hidden += 1;
      continue;
    }

    const button = findConfirmButton(inner);
    if (!button || !isVisible(button)) continue;
    button.click();
    clicked += 1;
  }
  return { clicked, hidden };
}

export const adBlockNoticeFeature: Feature = {
  id: 'adBlockNotice',
  watches: ['adSkip'],
  // FR-18 과 같은 토글을 쓴다 — 사용자에게는 "광고 관련 자동 처리" 하나로 보이는 것이 낫다.
  supports: (ctx) => ctx.settings.adSkip.enabled && hasPlayer(ctx.page.type),
  start: (ctx) => {
    /**
     * 클릭이 통하지 않는다고 판정하기까지 기다리는 시간. 리액트 리렌더 + 애니메이션이 끝나기에
     * 충분하면서, 사용자가 모달을 오래 보고 있지 않을 만큼 짧아야 한다.
     */
    const ESCALATE_AFTER_MS = 1_200;
    /** 이 횟수만큼 눌러도 안 닫히면 그 페이지에서는 이후 즉시 숨김으로 간다. */
    const MAX_CLICK_ATTEMPTS = 2;

    let clickAttempts = 0;
    /** 이 페이지에서는 클릭이 통하지 않는다고 확정됐는가. */
    let escalated = false;
    let verifyTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const tryDismiss = () => {
      if (disposed) return;
      const { clicked, hidden } = dismissAdBlockNotices(escalated);
      if (hidden > 0) info(`hid ${hidden} ad-block notice(s)`);
      if (clicked === 0) return;

      clickAttempts += 1;
      info(`dismissed ${clicked} ad-block notice(s)`);

      /**
       * 🔴 누른 것으로 끝내지 않는다. 실측(2026-08-15)에서 치지직은 모달을 계속 다시 띄웠고,
       * 우리는 40회 넘게 누르기만 했다. 눌러도 남아 있으면 숨김으로 넘어간다.
       */
      if (verifyTimer !== undefined) return;
      verifyTimer = setTimeout(() => {
        verifyTimer = undefined;
        if (disposed) return;
        const stillThere = findAdBlockNoticeRoots().some(
          (root) => !root.hasAttribute(HIDDEN_ATTR) && isVisible(root),
        );
        if (!stillThere) {
          // 정상적으로 닫혔다 → 재시도 카운터를 되돌린다. 세션 중 누적되면 다음 모달이
          // 재시도 없이 바로 숨김으로 가 버린다 ("2회 눌러도 안 닫히면" 의도와 어긋난다).
          clickAttempts = 0;
          return;
        }
        if (clickAttempts < MAX_CLICK_ATTEMPTS) {
          tryDismiss();
          return;
        }
        escalated = true;
        warning('ad-block notice keeps reappearing after confirm, hiding it instead');
        tryDismiss();
      }, ESCALATE_AFTER_MS);
    };

    tryDismiss();

    /**
     * 모달은 나중에 삽입되고, 삽입 후 `display`·`class` 로 표시가 바뀌는 경우도 있다
     * (FR-18 의 스킵 버튼이 그랬다) → 노드 삽입과 속성 변화를 함께 본다.
     * 관찰 대상은 body 다 — 모달이 body 직계나 포털에 붙기 때문이다.
     */
    const stopObserve = observe(document.body, tryDismiss, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
      debounceMs: ctx.device.profile.relaxObservers ? 400 : 200,
    });

    return () => {
      disposed = true;
      if (verifyTimer !== undefined) clearTimeout(verifyTimer);
      stopObserve();
      // 기능을 끄면 우리가 숨긴 모달도 되돌린다. 끄고 나서도 영영 안 보이면 안 된다.
      restoreHiddenNotices();
    };
  },
};
