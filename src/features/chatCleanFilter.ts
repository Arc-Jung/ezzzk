/**
 * 클린 채팅 필터 — 욕설·비속어가 섞인 채팅 메시지를 가린다.
 *
 * 🔴 **기본값은 끄기다.** 남의 말을 가리는 기능이라 사용자가 직접 켜야 한다.
 * 오탐으로 정상 대화가 사라져도, 켠 적 없는 사람은 그것이 필터 때문인지 알 수 없다.
 *
 * ## FR-11(유저 필터)과 방식이 다른 이유
 *
 * 유저 필터는 `display: none` 을 **쓰지 않는다.** 채팅 목록이 가상 스크롤(DOM 노드 25~28개)이라
 * "특정 유저만 남기기"를 DOM 숨김으로 하면 대상이 그 25개 안에 없을 때 채팅창이 통째로 빈다.
 *
 * 이쪽은 반대다 — **대부분을 남기고 소수를 가린다.** 한두 개가 빠져도 목록이 비지 않고 스크롤도
 * 망가지지 않는다. 치지직 자체 `클린 라이브` 도 같은 방식이다. 그래서 DOM 숨김을 쓴다.
 *
 * ⚠️ **노드는 재활용된다.** 필터 결과를 노드에 캐시하면 다른 메시지가 그 자리에 들어왔을 때
 * 잘못된 상태가 남는다 (유저 필터 주석의 실측 근거와 같은 이유). 매 변화마다 다시 판정한다.
 *
 * ❌ 메시지를 **삭제하지 않는다.** 숨김일 뿐이라 필터를 끄면 그대로 돌아온다.
 *    치지직 클라이언트의 `blindMessage` 같은 API 는 호출하지 않는다 (NFR-07).
 */

import { CHZZK } from '../constants/class';
import { hasSideChat } from '../pageType';
import { normalizeText, qsa, removeStyle, upsertStyle } from '../utils/dom';
import { observe } from '../utils/observe';
import { info } from '../utils/log';
import type { Feature } from './types';

const STYLE_ID = 'cm-chat-clean-filter-style';
/** 가려진 메시지에 붙이는 표식. CSS 는 이 속성만 본다. */
export const HIDDEN_ATTR = 'data-cm-clean-hidden';

/**
 * 기본 차단 단어.
 *
 * ⚠️ 여기에 정치·성향·특정 스트리머 이름 같은 것을 넣지 않는다. 그건 검열이지 클린 필터가 아니다.
 * 대상은 **누구에게나 욕설로 통하는 표현**으로 제한한다.
 * 부족하면 사용자가 설정에서 직접 추가한다 (`chatCleanFilter.words`).
 */
export const DEFAULT_BLOCK_WORDS: readonly string[] = [
  '시발',
  '씨발',
  '씨빨',
  '개새끼',
  '병신',
  '지랄',
  '좆',
  '니미',
  '엠창',
  '느금',
  '창녀',
  '보지',
  '자지',
  'fuck',
  'shit',
  'bitch',
  'asshole',
];

/**
 * 자모 반복·기호 삽입으로 필터를 피하는 것을 어느 정도 흡수한다.
 * `시 발`, `시!발`, `시ㅡ발` → `시발`.
 *
 * ⚠️ 완벽한 우회 차단은 목표가 아니다. 과하게 정규화하면 정상 문장이 걸린다
 * (예: 공백을 전부 지우면 `과시 발언` → `과시발언` 이 되어 `시발` 에 걸린다).
 * 그래서 **공백은 지우지 않고**, 단어 사이에 끼어든 기호만 걷어낸다.
 */
export function normalizeForMatch(text: string): string {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[!-/:-@[-`{-~·ㅡ_~^]+/g, '');
}

/** 차단 단어가 하나라도 들어 있는가. **순수 함수.** */
export function containsBlockedWord(text: string, words: readonly string[]): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  const haystack = normalizeForMatch(text);
  if (haystack.length === 0) return false;
  return words.some((word) => {
    const needle = normalizeForMatch(word);
    return needle.length > 0 && haystack.includes(needle);
  });
}

/**
 * 설정의 추가 단어를 기본 목록과 합친다. 빈 문자열·중복은 버린다. **순수 함수.**
 * 사용자가 넣은 값이 뒤에 오지만 `includes` 판정이라 순서는 결과에 영향이 없다.
 */
export function resolveBlockWords(extra: readonly string[] | undefined): string[] {
  const merged = [...DEFAULT_BLOCK_WORDS, ...(extra ?? [])]
    .map((w) => (typeof w === 'string' ? w.trim() : ''))
    .filter((w) => w.length > 0);
  return [...new Set(merged)];
}

/** 가려진 메시지를 실제로 감추는 CSS. 자리까지 없앤다 — 빈 줄이 남으면 더 눈에 띈다. */
const filterCss = (): string => `
[${HIDDEN_ATTR}='true'] {
  display: none !important;
}
`;

/**
 * 채팅 목록에서 차단 단어가 든 메시지에 표식을 단다.
 *
 * 🔴 매번 **전체를 다시 판정한다.** 노드 재활용 때문에 이전 판정을 믿을 수 없다.
 * 통과한 노드의 표식은 반드시 지운다 — 안 지우면 재활용된 정상 메시지가 계속 숨겨진다.
 */
export function applyFilter(root: ParentNode, words: readonly string[]): number {
  let hidden = 0;
  for (const node of qsa<HTMLElement>(CHZZK.chatMessage, root)) {
    const blocked = containsBlockedWord(node.textContent ?? '', words);
    if (blocked) {
      node.setAttribute(HIDDEN_ATTR, 'true');
      hidden += 1;
    } else if (node.hasAttribute(HIDDEN_ATTR)) {
      node.removeAttribute(HIDDEN_ATTR);
    }
  }
  return hidden;
}

export const chatCleanFilterFeature: Feature = {
  id: 'chatCleanFilter',
  watches: ['chatCleanFilter'],

  supports: (ctx) =>
    ctx.settings.chatCleanFilter.enabled && hasSideChat(ctx.page.type) && !ctx.page.isSlotFrame,

  start: (ctx) => {
    const words = resolveBlockWords(ctx.settings.chatCleanFilter.words);
    upsertStyle(STYLE_ID, filterCss());

    // `CHZZK.chatMessage` 가 이미 `#aside-chatting` 으로 범위를 좁히므로 root 는 document 로 둔다.
    const run = (): void => {
      applyFilter(document, words);
    };

    run();
    // 채팅은 계속 흐른다. 목록 자체가 늦게 그려지는 경우도 있어 document 를 관찰한다.
    const stop = observe(document.body, run);
    info(`clean filter: ${words.length}개 단어로 채팅 필터 시작`);

    return () => {
      stop();
      removeStyle(STYLE_ID);
      // 🔴 표식을 반드시 걷는다. 남기면 필터를 꺼도 메시지가 계속 숨겨진 채로 남는다.
      for (const node of qsa<HTMLElement>(`[${HIDDEN_ATTR}]`)) {
        node.removeAttribute(HIDDEN_ATTR);
      }
    };
  },
};
