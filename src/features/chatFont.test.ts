import { describe, expect, it } from 'vitest';
import { CHAT_FONT_RANGE } from '../constants/storage';
import {
  buildChatFontCss,
  clampSideFont,
  clampSlotFont,
  emojiSizeForFont,
  isScrolledToBottom,
  lineHeightForFont,
  visibleLines,
} from './chatFont';

describe('lineHeightForFont — 실측 스윕 재현 (docs 화면 ⑨ 표)', () => {
  it('실측값을 그대로 돌려준다', () => {
    expect(lineHeightForFont(11)).toBe(22);
    expect(lineHeightForFont(12)).toBe(24);
    expect(lineHeightForFont(14)).toBe(26);
    expect(lineHeightForFont(16)).toBe(29);
    expect(lineHeightForFont(18)).toBe(31);
    expect(lineHeightForFont(20)).toBe(34);
    expect(lineHeightForFont(24)).toBe(39);
  });

  it('실측 사이 값은 보간한다 (13px, 15px …)', () => {
    expect(lineHeightForFont(13)).toBe(25);
    expect(lineHeightForFont(15)).toBeGreaterThanOrEqual(26);
    expect(lineHeightForFont(15)).toBeLessThanOrEqual(29);
  });

  it('단조 증가한다 (폰트가 커지면 줄 높이도 커진다)', () => {
    for (let px = CHAT_FONT_RANGE.side.min; px < CHAT_FONT_RANGE.side.max; px += 1) {
      expect(lineHeightForFont(px + 1)).toBeGreaterThanOrEqual(lineHeightForFont(px));
    }
  });
});

describe('visibleLines — 스크롤 영역 안정화 후 761px 기준', () => {
  it('목업 표의 표시 줄 수를 재현한다', () => {
    // ⚠️ 761px 는 통나무 랭킹·공지가 채워진 뒤 **안정화된** 값이다(로드 직후는 871px).
    expect(visibleLines(761, 11)).toBe(34);
    expect(visibleLines(761, 12)).toBe(31);
    expect(visibleLines(761, 14)).toBe(29);
    expect(visibleLines(761, 16)).toBe(26);
    expect(visibleLines(761, 18)).toBe(24);
    expect(visibleLines(761, 20)).toBe(22);
    expect(visibleLines(761, 24)).toBe(19);
  });

  it('1600×900 시점(691px)의 26줄도 재현한다', () => {
    expect(visibleLines(691, 14)).toBe(26);
  });

  it('폰트를 키우면 보이는 줄이 줄어든다', () => {
    expect(visibleLines(761, 24)).toBeLessThan(visibleLines(761, 11));
  });

  it('높이가 0 이면 0 줄이다', () => {
    expect(visibleLines(0, 14)).toBe(0);
  });
});

describe('emojiSizeForFont — 1.3em 스케일 (실측 검증 기준값)', () => {
  it('14px 에서 18×18 로 원본과 같다', () => {
    expect(emojiSizeForFont(14)).toBe(18);
  });

  it('실측 검증값을 모두 재현한다', () => {
    expect(emojiSizeForFont(11)).toBe(14);
    expect(emojiSizeForFont(20)).toBe(26);
    expect(emojiSizeForFont(24)).toBe(31);
  });
});

describe('clampSideFont / clampSlotFont — 범위 클램프', () => {
  it('사이드는 11~24px 다', () => {
    expect(clampSideFont(10)).toBe(11);
    expect(clampSideFont(25)).toBe(24);
    expect(clampSideFont(14)).toBe(14);
  });

  it('슬롯은 10~16px 다', () => {
    expect(clampSlotFont(9)).toBe(10);
    expect(clampSlotFont(17)).toBe(16);
    expect(clampSlotFont(12)).toBe(12);
  });

  it('소수점은 반올림한다', () => {
    expect(clampSideFont(14.4)).toBe(14);
    expect(clampSideFont(14.6)).toBe(15);
  });

  it('NaN 은 최소값으로 본다', () => {
    expect(clampSideFont(Number.NaN)).toBe(11);
    expect(clampSlotFont(Number.NaN)).toBe(10);
  });

  it('기본값이 범위 안에 있다', () => {
    expect(clampSideFont(CHAT_FONT_RANGE.side.default)).toBe(CHAT_FONT_RANGE.side.default);
    expect(clampSlotFont(CHAT_FONT_RANGE.slot.default)).toBe(CHAT_FONT_RANGE.slot.default);
  });
});

describe('buildChatFontCss — 실측으로 확정된 주입 규칙', () => {
  const css = buildChatFontCss(20, 13);

  it('🔴 자손(*)까지 덮는다 — item 에만 주면 button·span 자식이 14px 를 유지한다', () => {
    expect(css).toMatch(/\[class\*="_item_"\] \*/);
    expect(css).toContain('font-size: 20px !important');
  });

  it('🔴 이모티콘을 1.3em 으로 함께 스케일한다', () => {
    expect(css).toMatch(/img \{ width: 1\.3em !important; height: 1\.3em !important; \}/);
  });

  it('line-height 1.3 을 함께 지정한다', () => {
    expect(css).toContain('line-height: 1.3 !important');
  });

  it('CSS 변수로 노출해 필터 패널·슬롯 스트립이 같은 값을 참조한다', () => {
    expect(css).toContain('--cm-chat-font-side: 20px');
    expect(css).toContain('--cm-chat-font-slot: 13px');
  });

  it('범위를 벗어난 입력도 클램프해서 넣는다', () => {
    const clamped = buildChatFontCss(99, 99);
    expect(clamped).toContain('--cm-chat-font-side: 24px');
    expect(clamped).toContain('--cm-chat-font-slot: 16px');
  });

  it('셀렉터는 #aside-chatting 으로 범위를 좁힌다 (오매칭 방지)', () => {
    expect(css).toContain('#aside-chatting');
  });

  it('같은 입력이면 같은 CSS 다 (멱등 — style 태그 내용만 교체한다)', () => {
    expect(buildChatFontCss(14, 12)).toBe(buildChatFontCss(14, 12));
  });
});

describe('isScrolledToBottom — 사용자가 위로 올려둔 상태를 침범하지 않는다', () => {
  it('맨 아래면 true', () => {
    expect(isScrolledToBottom({ scrollTop: 35, clientHeight: 761, scrollHeight: 796 })).toBe(true);
  });

  it('위로 올려둔 상태면 false', () => {
    expect(isScrolledToBottom({ scrollTop: 0, clientHeight: 761, scrollHeight: 2000 })).toBe(false);
  });

  it('허용 오차(24px) 안이면 맨 아래로 본다', () => {
    expect(isScrolledToBottom({ scrollTop: 1215, clientHeight: 761, scrollHeight: 2000 })).toBe(
      true,
    );
    expect(isScrolledToBottom({ scrollTop: 1200, clientHeight: 761, scrollHeight: 2000 })).toBe(
      false,
    );
  });

  it('스크롤이 없는 짧은 목록은 맨 아래다', () => {
    expect(isScrolledToBottom({ scrollTop: 0, clientHeight: 761, scrollHeight: 761 })).toBe(true);
  });
});
