/**
 * React 내부(fiber) 읽기 전용 접근 유틸. FR-11(유저 필터)·FR-04(길이 상한)의 공통 기반이다.
 *
 * 왜 필요한가 (실측 2026-08-11, 분석 문서 §4.4)
 * - 채팅 메시지 DOM 에는 **유저 식별자가 전혀 없다.** `data-*` 도 없고 닉네임 텍스트만 있다.
 * - 식별자는 fiber 의 `memoizedProps.chatMessage` 에서만 얻을 수 있다.
 *
 * 규칙
 * - `__reactFiber$*` 키 이름은 **매번 랜덤**이다. 접두어로 찾는다.
 * - `.return` 상향 탐색은 **깊이 상한 15** 에서 즉시 포기한다(무한 루프·성능 사고 방지).
 * - ❌ 클라이언트의 `send`·`blindMessage` 등 **동작 메서드는 노출하지도, 호출하지도 않는다.**
 * - ❌ `accessToken`·`extras.extraToken` 은 **읽지도 저장하지도 로그로 남기지도 않는다** (NFR-07).
 *   그래서 아래 타입에 `extras` 자체를 모델링하지 않았다 — 실수로 만질 여지를 없앤다.
 */

const FIBER_KEY_PREFIX = '__reactFiber$';

/** `.return` 상향 탐색 깊이 상한. 초과 시 즉시 포기한다. */
export const MAX_FIBER_DEPTH = 15;

export type ChatMessageProfile = {
  /** 안정적 유저 식별자. 닉네임이 아니라 이 값으로 필터한다. */
  userIdHash?: string;
  nickname?: string;
  profileImageUrl?: string;
  userRoleCode?: string;
  verifiedMark?: boolean;
};

/** 실측 스키마 중 **읽기만 하는 필드**만 모델링한다 (실측 2026-08-11). */
export type ChatMessage = {
  /** `{userIdHash}_{time}_{uuid}` */
  key?: string;
  /** `profile.userIdHash` 와 동일함을 실측 확인 */
  user?: string;
  time?: number;
  type?: number;
  status?: string;
  content?: string;
  originalContent?: string;
  profile?: ChatMessageProfile;
  /** 라이트/다크 테마별 닉네임 색. 원본 채팅과 시각적으로 맞추는 데 쓴다. */
  displayNicknameColor?: { light?: string; dark?: string };
};

/**
 * 채팅 클라이언트의 **읽기 전용 표면**. 실측된 메서드(`send` 등)는 의도적으로 넣지 않는다.
 * 게터로 원본을 참조하므로 값은 항상 최신이다.
 */
export type ChatClient = {
  readonly messageList: ChatMessage[];
  readonly messageLimitCount: number;
  readonly textLimitCount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** `__reactFiber$<random>` 키 이름을 찾는다. 없으면 null. */
export function findFiberKey(el: object): string | null {
  try {
    return Object.keys(el).find((key) => key.startsWith(FIBER_KEY_PREFIX)) ?? null;
  } catch {
    return null;
  }
}

/** 요소에 붙은 fiber 노드. 구조가 바뀔 수 있으므로 `unknown` 으로 다룬다. */
export function getFiberNode(el: Element): unknown | null {
  const key = findFiberKey(el);
  if (key === null) return null;
  try {
    return (el as unknown as Record<string, unknown>)[key] ?? null;
  } catch {
    return null;
  }
}

/**
 * fiber 를 `.return` 으로 거슬러 올라가며 각 단계의 `memoizedProps` 에서 원하는 값을 뽑는다.
 * `pick` 이 `undefined` 가 아닌 값을 돌려준 첫 단계에서 멈춘다.
 */
export function findInFiberProps<T>(
  el: Element,
  pick: (props: Record<string, unknown>) => T | undefined,
  maxDepth = MAX_FIBER_DEPTH,
): T | undefined {
  let node: unknown = getFiberNode(el);
  let depth = 0;

  while (isRecord(node) && depth < maxDepth) {
    const props = node['memoizedProps'];
    if (isRecord(props)) {
      try {
        const found = pick(props);
        if (found !== undefined) return found;
      } catch {
        // props 접근 자체가 던지는 경우(게터 등)는 그 단계만 건너뛴다.
      }
    }
    node = node['return'];
    depth += 1;
  }
  return undefined;
}

/** `{userIdHash}_{time}_{uuid}` 의 앞부분 해시만 뽑는다. 형태가 다르면 null. */
export function userIdHashFromKey(key: string | null | undefined): string | null {
  if (typeof key !== 'string') return null;
  const head = key.split('_')[0];
  if (head === undefined) return null;
  // 실측 해시는 32자 hex. 길이는 바뀔 수 있으니 8자 이상 hex 만 허용한다.
  return /^[0-9a-f]{8,}$/i.test(head) ? head : null;
}

/** 채팅 메시지 요소에서 원본 `chatMessage` 를 읽는다. 얻지 못하면 null. */
export function readChatMessage(el: Element): ChatMessage | null {
  const found = findInFiberProps<ChatMessage>(el, (props) => {
    const candidate = props['chatMessage'];
    if (!isRecord(candidate)) return undefined;
    // 최소 식별 조건 — 이 중 하나라도 있어야 우리가 쓸 수 있는 메시지다.
    const hasIdentity =
      typeof candidate['user'] === 'string' ||
      typeof candidate['key'] === 'string' ||
      isRecord(candidate['profile']);
    return hasIdentity ? (candidate as ChatMessage) : undefined;
  });
  return found ?? null;
}

/**
 * 상위 props 에 들어 있는 채팅 클라이언트를 **읽기 전용 표면으로 감싸** 돌려준다.
 * 원본 객체를 그대로 흘리지 않는 이유는 `send`·`blindMessage` 접근 경로를 아예 만들지 않기 위해서다.
 */
export function findChatClient(el: Element): ChatClient | null {
  const source = findInFiberProps<Record<string, unknown>>(el, (props) => {
    for (const value of Object.values(props)) {
      if (!isRecord(value)) continue;
      if (Array.isArray(value['messageList']) && typeof value['messageLimitCount'] === 'number') {
        return value;
      }
    }
    return undefined;
  });
  if (!source) return null;

  return {
    get messageList(): ChatMessage[] {
      const list = source['messageList'];
      return Array.isArray(list) ? (list as ChatMessage[]) : [];
    },
    get messageLimitCount(): number {
      const value = source['messageLimitCount'];
      return typeof value === 'number' ? value : 0;
    },
    get textLimitCount(): number {
      const value = source['textLimitCount'];
      return typeof value === 'number' ? value : 0;
    },
  };
}

/** 메시지의 유저 식별자. `profile.userIdHash` → `user` → `key` 순으로 본다. */
export function userIdHashOf(msg: ChatMessage): string | null {
  const fromProfile = msg.profile?.userIdHash;
  if (typeof fromProfile === 'string' && fromProfile.length > 0) return fromProfile;
  if (typeof msg.user === 'string' && msg.user.length > 0) return msg.user;
  return userIdHashFromKey(msg.key);
}
