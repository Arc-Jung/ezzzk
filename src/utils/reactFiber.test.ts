import { describe, expect, it } from 'vitest';
import {
  MAX_FIBER_DEPTH,
  findChatClient,
  findFiberKey,
  findInFiberProps,
  getFiberNode,
  readChatMessage,
  userIdHashFromKey,
  userIdHashOf,
  type ChatMessage,
} from './reactFiber';

/**
 * fiber 접근의 순수한 부분만 검증한다. 실제 치지직 fiber 결합은 Playwright 로 확인한다 (§8.0).
 * 픽스처는 실측 스키마(분석 문서 §4.4)를 그대로 옮긴 것이다.
 */

const USER_HASH = '73e99baf49ca17d1df523c873e2be65d';

/** 실측 `memoizedProps.chatMessage` 픽스처 */
const MEASURED_MESSAGE: ChatMessage = {
  key: `${USER_HASH}_1786439619259_5b1c7f0e-0000-4000-8000-000000000001`,
  user: USER_HASH,
  time: 1786439619259,
  type: 1,
  status: 'NORMAL',
  content: '뭐여',
  originalContent: '뭐여',
  profile: {
    userIdHash: USER_HASH,
    nickname: 'Tragnile',
    profileImageUrl: '',
    userRoleCode: 'common_user',
    verifiedMark: false,
  },
  displayNicknameColor: { light: '#15978B', dark: '#91CBC6' },
};

type FakeFiber = { memoizedProps?: Record<string, unknown>; return?: FakeFiber };

/** `__reactFiber$<random>` 키를 가진 가짜 요소를 만든다. */
function fakeElement(fiber: FakeFiber, key = '__reactFiber$abc123'): Element {
  const el: Record<string, unknown> = { [key]: fiber };
  return el as unknown as Element;
}

/** 길이 n 의 `.return` 체인. 마지막 노드에만 props 를 둔다. */
function chain(length: number, tailProps?: Record<string, unknown>): FakeFiber {
  let node: FakeFiber = { memoizedProps: tailProps };
  for (let i = 0; i < length; i += 1) {
    node = { memoizedProps: {}, return: node };
  }
  return node;
}

describe('findFiberKey', () => {
  it('접두어로 랜덤 fiber 키를 찾는다', () => {
    expect(findFiberKey({ __reactFiber$abc123: {} })).toBe('__reactFiber$abc123');
    expect(findFiberKey({ __reactFiber$zz99: {}, other: 1 })).toBe('__reactFiber$zz99');
  });

  it('fiber 키가 없으면 null', () => {
    expect(findFiberKey({})).toBeNull();
    expect(findFiberKey({ __reactProps$abc: {} })).toBeNull();
  });
});

describe('getFiberNode', () => {
  it('fiber 노드를 돌려준다', () => {
    const fiber: FakeFiber = { memoizedProps: { a: 1 } };
    expect(getFiberNode(fakeElement(fiber))).toBe(fiber);
  });

  it('fiber 가 없으면 null', () => {
    expect(getFiberNode({} as unknown as Element)).toBeNull();
  });
});

describe('findInFiberProps', () => {
  it('현재 단계의 props 에서 바로 찾는다', () => {
    const el = fakeElement({ memoizedProps: { chatMessage: MEASURED_MESSAGE } });
    const found = findInFiberProps(el, (props) => props['chatMessage']);
    expect(found).toBe(MEASURED_MESSAGE);
  });

  it('.return 을 거슬러 올라가 상위 props 에서 찾는다', () => {
    const el = fakeElement(chain(5, { textLimitCount: 400 }));
    expect(findInFiberProps(el, (props) => props['textLimitCount'])).toBe(400);
  });

  it('깊이 상한 15 를 넘으면 포기한다 (무한 루프 방지)', () => {
    const el = fakeElement(chain(40, { textLimitCount: 400 }));
    expect(findInFiberProps(el, (props) => props['textLimitCount'])).toBeUndefined();
  });

  it('경계: 깊이 상한 바로 안쪽은 찾는다', () => {
    const el = fakeElement(chain(MAX_FIBER_DEPTH - 1, { textLimitCount: 400 }));
    expect(findInFiberProps(el, (props) => props['textLimitCount'])).toBe(400);
  });

  it('순환 참조여도 멈춘다', () => {
    const node: FakeFiber = { memoizedProps: {} };
    node.return = node;
    expect(findInFiberProps(fakeElement(node), (props) => props['nope'])).toBeUndefined();
  });

  it('pick 이 던져도 탐색을 계속한다', () => {
    const el = fakeElement(chain(3, { textLimitCount: 400 }));
    let calls = 0;
    const found = findInFiberProps(el, (props) => {
      calls += 1;
      if (props['textLimitCount'] === undefined) throw new Error('boom');
      return props['textLimitCount'];
    });
    expect(found).toBe(400);
    expect(calls).toBeGreaterThan(1);
  });
});

describe('userIdHashFromKey', () => {
  it('앞부분 해시를 뽑는다', () => {
    expect(userIdHashFromKey(MEASURED_MESSAGE.key)).toBe(USER_HASH);
  });

  it('형태가 다르면 null', () => {
    expect(userIdHashFromKey('nothex_123_uuid')).toBeNull();
    expect(userIdHashFromKey('abc_1_2')).toBeNull();
    expect(userIdHashFromKey('')).toBeNull();
    expect(userIdHashFromKey(null)).toBeNull();
    expect(userIdHashFromKey(undefined)).toBeNull();
  });
});

describe('readChatMessage', () => {
  it('실측 스키마를 읽는다', () => {
    const el = fakeElement(chain(4, { chatMessage: MEASURED_MESSAGE }));
    expect(readChatMessage(el)?.profile?.nickname).toBe('Tragnile');
  });

  it('식별자가 전혀 없는 객체는 무시한다', () => {
    const el = fakeElement({ memoizedProps: { chatMessage: { content: 'x' } } });
    expect(readChatMessage(el)).toBeNull();
  });

  it('fiber 가 없으면 null', () => {
    expect(readChatMessage({} as unknown as Element)).toBeNull();
  });
});

describe('findChatClient', () => {
  it('messageList + messageLimitCount 를 가진 인스턴스를 찾아 읽기 표면만 노출한다', () => {
    const source = {
      messageList: [MEASURED_MESSAGE],
      messageLimitCount: 200,
      textLimitCount: 400,
      accessToken: 'MUST-NOT-BE-EXPOSED',
      send: () => undefined,
      blindMessage: () => undefined,
    };
    const el = fakeElement(chain(6, { gameChatClient: source }));
    const client = findChatClient(el);

    expect(client?.messageLimitCount).toBe(200);
    expect(client?.textLimitCount).toBe(400);
    expect(client?.messageList).toHaveLength(1);
    // NFR-07 — 토큰과 동작 메서드는 표면에 없어야 한다.
    expect(Object.keys(client ?? {})).toEqual([
      'messageList',
      'messageLimitCount',
      'textLimitCount',
    ]);
  });

  it('messageList 가 갱신되면 최신 값을 읽는다 (게터)', () => {
    const source = { messageList: [] as ChatMessage[], messageLimitCount: 200 };
    const client = findChatClient(fakeElement({ memoizedProps: { client: source } }));
    source.messageList.push(MEASURED_MESSAGE);
    expect(client?.messageList).toHaveLength(1);
    // textLimitCount 가 없으면 0 — 호출부가 폴백을 쓸 수 있게 한다.
    expect(client?.textLimitCount).toBe(0);
  });

  it('클라이언트가 없으면 null', () => {
    expect(findChatClient(fakeElement({ memoizedProps: { a: 1 } }))).toBeNull();
  });
});

describe('userIdHashOf', () => {
  it('profile.userIdHash 를 우선한다', () => {
    expect(userIdHashOf(MEASURED_MESSAGE)).toBe(USER_HASH);
  });

  it('profile 이 없으면 user, 그다음 key 에서 뽑는다', () => {
    expect(userIdHashOf({ user: USER_HASH })).toBe(USER_HASH);
    expect(userIdHashOf({ key: `${USER_HASH}_1_x` })).toBe(USER_HASH);
    expect(userIdHashOf({ content: 'x' })).toBeNull();
  });
});
