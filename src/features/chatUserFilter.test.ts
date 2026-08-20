import { describe, expect, it } from 'vitest';
import {
  PANEL_MESSAGE_CAP,
  backfillFromHistory,
  matchesFilter,
  messageKey,
  sameTarget,
  targetLabel,
} from './chatUserFilter';
import type { ChatMessage } from '../utils/reactFiber';

/**
 * 픽스처는 실측 `chatMessage` 스키마(분석 문서 §4.4)를 그대로 쓴다.
 * 가상 스크롤·패널 렌더 결합은 Playwright 로 검증한다 (§8.0).
 */

const HASH_A = '73e99baf49ca17d1df523c873e2be65d';
const HASH_B = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

function message(
  hash: string,
  nickname: string,
  content: string,
  time = 1786439619259,
): ChatMessage {
  return {
    key: `${hash}_${time}_5b1c7f0e-0000-4000-8000-000000000001`,
    user: hash,
    time,
    type: 1,
    status: 'NORMAL',
    content,
    originalContent: content,
    profile: {
      userIdHash: hash,
      nickname,
      profileImageUrl: '',
      userRoleCode: 'common_user',
      verifiedMark: false,
    },
    displayNicknameColor: { light: '#15978B', dark: '#91CBC6' },
  };
}

describe('matchesFilter', () => {
  const msg = message(HASH_A, 'Tragnile', '뭐여');

  it('userIdHash 로 일치시킨다', () => {
    expect(matchesFilter(msg, [{ userIdHash: HASH_A }])).toBe(true);
    expect(matchesFilter(msg, [{ userIdHash: HASH_B }])).toBe(false);
  });

  it('대상이 없으면 항상 false', () => {
    expect(matchesFilter(msg, [])).toBe(false);
  });

  it('🔴 닉네임이 같아도 userIdHash 가 다르면 걸러낸다 (동일 닉네임 구분)', () => {
    const impostor = message(HASH_B, 'Tragnile', '나도 Tragnile');
    expect(matchesFilter(impostor, [{ userIdHash: HASH_A, nickname: 'Tragnile' }])).toBe(false);
  });

  it('userIdHash 를 얻을 수 없을 때만 닉네임으로 폴백한다', () => {
    const noHash: ChatMessage = { content: '해시 없음', profile: { nickname: '익명' } };
    expect(matchesFilter(noHash, [{ nickname: '익명' }])).toBe(true);
    expect(matchesFilter(noHash, [{ nickname: '다른사람' }])).toBe(false);
    // 해시 대상만 지정된 경우, 해시 없는 메시지는 통과하지 못한다.
    expect(matchesFilter(noHash, [{ userIdHash: HASH_A }])).toBe(false);
  });

  it('profile 이 없어도 user / key 에서 해시를 찾는다', () => {
    expect(matchesFilter({ user: HASH_A }, [{ userIdHash: HASH_A }])).toBe(true);
    expect(matchesFilter({ key: `${HASH_A}_1_x` }, [{ userIdHash: HASH_A }])).toBe(true);
  });

  it('복수 대상 중 하나만 맞아도 통과한다', () => {
    expect(matchesFilter(msg, [{ userIdHash: HASH_B }, { userIdHash: HASH_A }])).toBe(true);
  });

  it('빈 대상 객체는 아무것도 매칭하지 않는다', () => {
    expect(matchesFilter(msg, [{}])).toBe(false);
    expect(matchesFilter(msg, [{ userIdHash: '', nickname: '' }])).toBe(false);
  });
});

describe('backfillFromHistory', () => {
  /** 실측 상한과 같은 200개 히스토리 */
  const history: ChatMessage[] = Array.from({ length: 200 }, (_, i) =>
    i % 2 === 0
      ? message(HASH_A, 'Tragnile', `A-${i}`, 1786439619000 + i)
      : message(HASH_B, '다른유저', `B-${i}`, 1786439619000 + i),
  );

  it('켠 즉시 대상 유저의 과거 발언을 채운다 (빈 화면으로 시작하지 않는다)', () => {
    const filled = backfillFromHistory(history, [{ userIdHash: HASH_A }]);
    expect(filled).toHaveLength(100);
    expect(filled[0]?.content).toBe('A-0');
  });

  it('시간순을 유지한다', () => {
    const filled = backfillFromHistory(history, [{ userIdHash: HASH_A }]);
    const times = filled.map((msg) => msg.time ?? 0);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('limit 을 넘으면 최신 것만 남긴다', () => {
    const filled = backfillFromHistory(history, [{ userIdHash: HASH_A }], 10);
    expect(filled).toHaveLength(10);
    expect(filled[9]?.content).toBe('A-198');
  });

  it('복수 대상을 함께 채운다', () => {
    expect(
      backfillFromHistory(history, [{ userIdHash: HASH_A }, { userIdHash: HASH_B }]),
    ).toHaveLength(200);
  });

  it('대상이 없거나 limit 이 0 이면 빈 배열', () => {
    expect(backfillFromHistory(history, [])).toEqual([]);
    expect(backfillFromHistory(history, [{ userIdHash: HASH_A }], 0)).toEqual([]);
  });

  it('기본 limit 은 패널 상한이다', () => {
    const many: ChatMessage[] = Array.from({ length: PANEL_MESSAGE_CAP + 50 }, (_, i) =>
      message(HASH_A, 'Tragnile', `A-${i}`, 1786439619000 + i),
    );
    expect(backfillFromHistory(many, [{ userIdHash: HASH_A }])).toHaveLength(PANEL_MESSAGE_CAP);
  });
});

describe('messageKey', () => {
  it('key 가 있으면 그것을 쓴다', () => {
    const msg = message(HASH_A, 'Tragnile', '뭐여');
    expect(messageKey(msg)).toBe(msg.key);
  });

  it('key 가 없으면 해시·시간·본문을 조합한다', () => {
    const a = messageKey({ user: HASH_A, time: 1, content: 'x' });
    const b = messageKey({ user: HASH_A, time: 2, content: 'x' });
    expect(a).not.toBe(b);
  });
});

describe('targetLabel / sameTarget', () => {
  it('닉네임을 우선 표시하고 없으면 해시 앞부분을 쓴다', () => {
    expect(targetLabel({ userIdHash: HASH_A, nickname: 'Tragnile' })).toBe('Tragnile');
    expect(targetLabel({ userIdHash: HASH_A })).toBe('73e99baf…');
    expect(targetLabel({})).toBe('알 수 없음');
  });

  it('해시가 같으면 같은 대상으로 본다 (닉네임 변경 무관)', () => {
    expect(sameTarget({ userIdHash: HASH_A, nickname: '옛닉' }, { userIdHash: HASH_A })).toBe(true);
    expect(sameTarget({ userIdHash: HASH_A }, { userIdHash: HASH_B })).toBe(false);
  });

  it('해시가 없을 때만 닉네임으로 비교한다', () => {
    expect(sameTarget({ nickname: '익명' }, { nickname: '익명' })).toBe(true);
    expect(sameTarget({ nickname: '익명' }, { userIdHash: HASH_A })).toBe(false);
  });
});
