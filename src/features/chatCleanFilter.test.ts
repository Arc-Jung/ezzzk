import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../constants/storage';
import {
  DEFAULT_BLOCK_WORDS,
  HIDDEN_ATTR,
  applyFilter,
  chatCleanFilterFeature,
  containsBlockedWord,
  normalizeForMatch,
  resolveBlockWords,
} from './chatCleanFilter';

describe('기본값 — 남의 말을 가리는 기능은 꺼진 채로 시작한다', () => {
  it('chatCleanFilter.enabled 가 false 다', () => {
    expect(DEFAULT_SETTINGS.chatCleanFilter.enabled).toBe(false);
  });

  it('추가 단어 목록은 비어 있다', () => {
    expect(DEFAULT_SETTINGS.chatCleanFilter.words).toEqual([]);
  });

  it('기본 설정에서는 supports 가 false 라 옵저버조차 걸지 않는다', () => {
    const ctx = {
      page: { type: 'live' as const, isSlotFrame: false },
      device: { profile: { touchTargetPx: 32 }, deviceClass: 'laptop' },
      settings: DEFAULT_SETTINGS,
    };
    expect(chatCleanFilterFeature.supports(ctx as never)).toBe(false);
  });
});

describe('normalizeForMatch — 기호 우회를 흡수하되 과하게 뭉개지 않는다', () => {
  it('사이에 낀 기호를 걷어낸다', () => {
    expect(normalizeForMatch('시!발')).toBe('시발');
    expect(normalizeForMatch('시_발')).toBe('시발');
  });

  it('대소문자를 통일한다', () => {
    expect(normalizeForMatch('FUCK')).toBe('fuck');
  });

  it('🔴 공백은 지우지 않는다 — 지우면 정상 문장이 걸린다', () => {
    // 공백까지 지우면 `과시 발언` → `과시발언` 이 되어 `시발` 에 걸린다.
    expect(normalizeForMatch('과시 발언')).toContain(' ');
    expect(containsBlockedWord('과시 발언이 심하다', DEFAULT_BLOCK_WORDS)).toBe(false);
  });
});

describe('containsBlockedWord', () => {
  it('기본 목록의 단어를 잡는다', () => {
    expect(containsBlockedWord('아 시발 뭐야', DEFAULT_BLOCK_WORDS)).toBe(true);
    expect(containsBlockedWord('what the fuck', DEFAULT_BLOCK_WORDS)).toBe(true);
  });

  it('기호로 끊어 놓아도 잡는다', () => {
    expect(containsBlockedWord('시!발', DEFAULT_BLOCK_WORDS)).toBe(true);
  });

  it('평범한 문장은 통과시킨다', () => {
    expect(containsBlockedWord('오늘 방송 재밌네요', DEFAULT_BLOCK_WORDS)).toBe(false);
    expect(containsBlockedWord('', DEFAULT_BLOCK_WORDS)).toBe(false);
  });

  it('단어 목록이 비면 아무것도 잡지 않는다', () => {
    expect(containsBlockedWord('시발', [])).toBe(false);
  });
});

describe('resolveBlockWords — 사용자 추가 단어 병합', () => {
  it('기본 목록에 추가한다', () => {
    const words = resolveBlockWords(['금지어']);
    expect(words).toContain('금지어');
    expect(words.length).toBe(DEFAULT_BLOCK_WORDS.length + 1);
  });

  it('빈 문자열·공백·중복을 버린다', () => {
    const words = resolveBlockWords(['', '   ', '시발', '금지어', '금지어']);
    expect(words.filter((w) => w === '금지어').length).toBe(1);
    expect(words.filter((w) => w === '시발').length).toBe(1);
    expect(words.some((w) => w.trim().length === 0)).toBe(false);
  });

  it('undefined 를 받아도 기본 목록을 돌려준다', () => {
    expect(resolveBlockWords(undefined)).toEqual([...DEFAULT_BLOCK_WORDS]);
  });
});

describe('applyFilter — DOM 표식', () => {
  function chat(...texts: string[]): HTMLElement[] {
    document.body.innerHTML = '<div id="aside-chatting"></div>';
    const list = document.getElementById('aside-chatting') as HTMLElement;
    return texts.map((text) => {
      const node = document.createElement('div');
      node.className = 'live_chatting_message_container__x';
      node.textContent = text;
      list.appendChild(node);
      return node;
    });
  }

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('차단 단어가 든 메시지에만 표식을 단다', () => {
    const [bad, good] = chat('시발 뭐야', '재밌다');
    const hidden = applyFilter(document, DEFAULT_BLOCK_WORDS);

    expect(hidden).toBe(1);
    expect(bad?.getAttribute(HIDDEN_ATTR)).toBe('true');
    expect(good?.hasAttribute(HIDDEN_ATTR)).toBe(false);
  });

  it('🔴 노드가 재활용되면 표식을 걷는다 — 안 걷으면 정상 메시지가 계속 숨는다', () => {
    const [node] = chat('시발');
    applyFilter(document, DEFAULT_BLOCK_WORDS);
    expect(node?.getAttribute(HIDDEN_ATTR)).toBe('true');

    // 가상 스크롤이 같은 노드에 다른 메시지를 넣은 상황.
    if (node) node.textContent = '안녕하세요';
    applyFilter(document, DEFAULT_BLOCK_WORDS);
    expect(node?.hasAttribute(HIDDEN_ATTR)).toBe(false);
  });

  it('메시지를 지우지 않는다 — 숨김일 뿐이라 되돌릴 수 있다', () => {
    const [node] = chat('시발');
    applyFilter(document, DEFAULT_BLOCK_WORDS);
    expect(node?.isConnected).toBe(true);
    expect(node?.textContent).toBe('시발');
  });
});
