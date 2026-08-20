/**
 * FR-16 채팅 영역 부가 요소 숨김 + FR-17 광고 배너 숨김.
 *
 * 시청에 필요 없는 채팅 aside 부가 요소를 숨겨 채팅 목록에 공간을 돌려준다.
 * 항목별로 켜고 끌 수 있고 **기본값은 모두 숨김**이다.
 *
 * 실측 근거 (2026-08-12, `chzzk-dom-25-chat-clutter.json`, 라이브 5채널 · 1920×1080)
 *
 * `#aside-chatting` 직계 자식 구조:
 * | 요소 | 실측 클래스 | 크기 | 처리 |
 * |---|---|---|---|
 * | `채팅` 헤더 | `_container_1e2su_2` (안에 `h2._title_1e2su_12`) | 353×44 | 숨김 (FR-16) |
 * | 광고 배너 | `_container_11aky_1 _banner_b8csn_41` | 353×108 | 숨김 (FR-17) |
 * | 주간 후원 랭킹 | `_container_wl8bq_2` | 353×110 | 숨김 (FR-16) |
 * | 채팅 스크롤러 | `_container_8lqsk_1` | 353×761 | 유지 (안의 드롭스 카드만 숨김) |
 * | 입력 영역 | `_area_b8csn_49` | 353×105 | 유지 (안의 `무료 치즈 받기` 툴팁만 숨김) |
 *
 * 입력 영역 안쪽 (실측 2026-08-12, `chzzk-dom-32-free-cheese.json`):
 * ```
 * div._tools_1k5b6_125                    (313×32)
 * ├─ div._donation_1k5b6_132              (188×28)
 * │  ├─ button._donation_text_1k5b6_137   (77×28)   "후원하기"        ← 유지
 * │  ├─ span._tooltip_1k5b6_181           (124×28)  "무료 치즈 받기…"  ← 숨김
 * │  └─ div._action_1k5b6_140             (111×28)  아이콘 3개        ← 유지
 * └─ button._primary_vgt54_30             (46×32)   "채팅"            ← 전송, 절대 유지
 * ```
 * ⚠️ 이 툴팁은 **조건부 노출**이다. 실측에서 8채널 중 1채널에만 있었고 같은 채널에서도
 * 시점에 따라 사라졌다 → 없을 때 아무 일도 일어나지 않아야 한다(CSS 라 자연히 만족).
 *
 * 🔴 **`_container_s1cb2_` 는 드롭스 전용이 아니다.** 같은 클래스가 변형 modifier 로 3가지를 렌더한다:
 * - `_default_s1cb2_` → 드롭스 캠페인 안내 (드롭스 진행 채널에만 존재)
 * - `_filter_s1cb2_` → **공지**(클린 라이브 필터링 안내) — 전 채널 존재
 * - `_welcome_s1cb2_` → 채팅방 환영 메시지 — 전 채널 존재
 * → `_container_s1cb2_` 만으로 숨기면 **공지까지 사라진다.** 드롭스는 `_default_` 변형만 노린다.
 *
 * ⚠️ **FR-17 범위**: 여기서 숨기는 것은 광고 **배너 UI** 다. 영상 광고의 삽입·재생에는
 * 개입하지 않으며 네트워크 요청도 차단하지 않는다(`permissions` 는 `storage` 하나뿐이다 — NFR-06).
 * 이 구분을 스토어 설명과 README 에 명시한다.
 *
 * ⚠️ 부가 요소를 숨기면 스크롤 영역이 커진다 (실측 821px → 헤더·랭킹 숨김 후 **975px**).
 * FR-15 의 "보이는 줄 수" 안내는 치지직 기본 상태 기준값(761px)이므로 실제로는 더 많이 보인다.
 */

import { ID, OURS } from '../constants/class';
import { hasSideChat } from '../pageType';
import { qs, qsa, removeStyle, upsertStyle } from '../utils/dom';
import { observe, type Disposer } from '../utils/observe';
import { info } from '../utils/log';
import type { Feature } from './types';

/**
 * 실측 셀렉터. 접미 해시(`_2`, `_41`)는 버리고 접두어 부분 일치만 쓴다 (NFR-03).
 * `#aside-chatting` 하위로 범위를 좁혀 오매칭을 막는다.
 */
export const CLUTTER = {
  /** `채팅` 헤더. 실측 353×44 — 숨기면 그만큼 채팅 목록이 길어진다. */
  header: `${ID.asideChatting} > [class*="_container_1e2su"]`,
  /** 주간 후원 랭킹. 실측 353×110. FR-06 이 오클릭을 피하려고 제외하는 그 영역이다. */
  ranking: `${ID.asideChatting} > [class*="_container_wl8bq"]`,
  /** 광고 배너. 실측 353×108, 문구 `1 / 1 광고 시청 중입니다.` */
  adBanner: `${ID.asideChatting} > [class*="_banner_b8csn"]`,
  /**
   * `무료 치즈 받기` 프로모션 툴팁. 실측 353px 입력 영역의 tools 줄 안 `span._tooltip_1k5b6_181`
   * (124×28)로, `내 치즈로 이동` 링크와 `툴팁 닫기` 버튼을 품고 있다.
   * ⚠️ 형제인 `후원하기` 버튼(`_donation_text_`)·아이콘 버튼(`_action_`)·전송 버튼은 건드리지 않는다.
   */
  freeCheeseTooltip: `${ID.asideChatting} [class*="_tools_1k5b6"] [class*="_tooltip_1k5b6"]`,
  /** 시스템 카드(공통 컴포넌트). 변형 modifier 로 드롭스·공지·환영을 모두 렌더한다. */
  systemCard: '[class*="_container_s1cb2"]',
  /**
   * 드롭스 카드 = 시스템 카드의 `_default_` 변형. 실측 5채널에서 `_default_` 는 드롭스에만 붙었고
   * 공지는 `_filter_`, 환영은 `_welcome_` 였다.
   */
  dropsCard: '[class*="_container_s1cb2"][class*="_default_s1cb2"]',
  /**
   * 클린 라이브 안내(`쾌적한 시청 환경을 위해 일부 메시지는 필터링 됩니다`) = `_filter_` 변형.
   * 실측 353×110 이상을 차지해 채팅 목록을 크게 가린다 (2026-08-12 요청으로 기본 숨김).
   * ⚠️ 환영 메시지(`_welcome_`)는 건드리지 않는다 — 변형 modifier 로만 구분한다.
   */
  cleanLiveCard: '[class*="_container_s1cb2"][class*="_filter_s1cb2"]',
  /** 비로그인 입력창. placeholder 를 줄일 대상이다. */
  loginTextarea: `${ID.asideChatting} textarea[class*="_not_login_"]`,
  /** 채팅 목록 항목 — 드롭스 카드가 이 안에 들어온다. */
  listItem: `${ID.asideChatting} [class*="_item_"]`,
} as const;

export type ClutterSettings = {
  header: boolean;
  ranking: boolean;
  drops: boolean;
  /** 채팅 aside 의 광고 배너 (FR-17) */
  adBanner: boolean;
  /** `무료 치즈 받기` 프로모션 툴팁 */
  freeCheese: boolean;
  /** 클린 라이브 필터링 안내 */
  cleanLive: boolean;
  /** 비로그인 입력창 placeholder 를 `로그인` 으로 줄인다 */
  shortLoginPlaceholder: boolean;
};

/**
 * 숨김 CSS. **전부 CSS 로 처리한다.**
 *
 * 🔴 **실측 결함 (2026-08-12, `chzzk-dom-26-chat-clutter-verification.json`)**:
 * 처음에는 드롭스만 JS 로 판정해 목록 항목에 클래스를 붙였는데 **적용되지 않았다**
 * (`hiddenMarked: 0`, 드롭스 항목 높이 93px 로 그대로 보임). 채팅 목록은 새 메시지마다
 * React 가 리렌더하면서 `className` 을 덮어써 우리가 붙인 클래스를 지운다.
 * → React 가 관리하는 노드에 클래스를 붙이는 방식은 성립하지 않는다. `:has()` 로 CSS 에서 끝낸다.
 *
 * ⚠️ 드롭스 규칙은 `_default_s1cb2` 변형 modifier 에 의존한다. 치지직이 재배포로 해시를 바꾸면
 * 이 규칙은 **아무것도 매칭하지 않고 조용히 무효**가 된다(드롭스가 다시 보인다).
 * 공지·환영 메시지가 잘못 사라지는 방향으로는 깨지지 않으므로 안전한 실패다 (NFR-03).
 */
export function buildClutterCss(settings: ClutterSettings): string {
  const rules: string[] = [];
  if (settings.header) rules.push(`${CLUTTER.header} { display: none !important; }`);
  if (settings.ranking) rules.push(`${CLUTTER.ranking} { display: none !important; }`);
  if (settings.adBanner) rules.push(`${CLUTTER.adBanner} { display: none !important; }`);
  if (settings.freeCheese) {
    rules.push(`${CLUTTER.freeCheeseTooltip} { display: none !important; }`);
  }
  if (settings.drops) {
    // 카드만 숨기면 항목의 패딩이 남아 빈 줄이 생긴다 → :has() 로 항목째 숨긴다.
    rules.push(`${CLUTTER.listItem}:has(${CLUTTER.dropsCard}) { display: none !important; }`);
  }
  if (settings.cleanLive) {
    rules.push(`${CLUTTER.listItem}:has(${CLUTTER.cleanLiveCard}) { display: none !important; }`);
  }
  return rules.join('\n');
}

/** 축약해 넣을 문구. 3글자로 줄여 좁은 채팅 폭에서 한 줄에 들어가게 한다. */
export const SHORT_LOGIN_PLACEHOLDER = '로그인';

/**
 * 비로그인 입력창의 placeholder 를 축약한다. 돌려주는 함수로 원래 값을 복원한다.
 * 대상이 없으면(로그인 상태) 아무 일도 하지 않는다.
 */
function shortenLoginPlaceholder(relaxed: boolean): Disposer {
  const originals = new WeakMap<HTMLTextAreaElement, string>();

  const apply = () => {
    for (const node of qsa<HTMLTextAreaElement>(CLUTTER.loginTextarea)) {
      const current = node.getAttribute('placeholder') ?? '';
      if (current === SHORT_LOGIN_PLACEHOLDER) continue;
      if (!originals.has(node)) originals.set(node, current);
      node.setAttribute('placeholder', SHORT_LOGIN_PLACEHOLDER);
    }
  };

  apply();

  const aside = qs(ID.asideChatting) ?? document.body;
  const stop = observe(aside, apply, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['placeholder', 'class'],
    debounceMs: relaxed ? 400 : 200,
  });

  return () => {
    stop();
    for (const node of qsa<HTMLTextAreaElement>(CLUTTER.loginTextarea)) {
      const original = originals.get(node);
      if (original !== undefined) node.setAttribute('placeholder', original);
    }
  };
}

export const chatClutterHideFeature: Feature = {
  id: 'chatClutterHide',
  watches: ['chatClutter'],
  supports: (ctx) => hasSideChat(ctx.page.type) && !ctx.page.isSlotFrame,
  start: (ctx) => {
    const settings = ctx.settings.chatClutter;

    const apply = () => upsertStyle(OURS.chatClutterStyleId, buildClutterCss(settings));

    apply();

    /**
     * 비로그인 입력창 placeholder 축약 (`채팅에 참여하려면 로그인 해주세요` → `로그인`).
     *
     * 🔴 placeholder 는 **속성**이라 CSS 로 바꿀 수 없다. 값을 직접 쓰고, React 리렌더가
     * 되돌리면 다시 쓴다 — 이 저장소에서 className 이 덮어써진 것과 같은 종류의 문제다
     * (`chzzk-dom-26` 실측). 원래 값은 복원용으로 보관한다.
     */
    const stopPlaceholder = settings.shortLoginPlaceholder
      ? shortenLoginPlaceholder(ctx.device.profile.relaxObservers)
      : null;

    info(
      `chat clutter hidden — header: ${settings.header}, ranking: ${settings.ranking}, ` +
        `drops: ${settings.drops}, adBanner: ${settings.adBanner}, freeCheese: ${settings.freeCheese}`,
    );

    /**
     * 페이지 리렌더로 `<style>` 이 사라지는 경우만 복구한다.
     * 숨김 판정 자체는 CSS 가 하므로 목록 변화마다 계산할 필요가 없다 (NFR-04).
     */
    const stopObserve = observe(document.head, apply, {
      childList: true,
      subtree: false,
      debounceMs: ctx.device.profile.relaxObservers ? 600 : 300,
    });

    return () => {
      stopObserve();
      stopPlaceholder?.();
      removeStyle(OURS.chatClutterStyleId);
    };
  },
};
