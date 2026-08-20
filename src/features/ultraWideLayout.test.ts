import { describe, expect, it } from 'vitest';
import {
  computeUltraWideCss,
  isLandscape,
  needsOverlayFallback,
  scaledChatFont,
} from './ultraWideLayout';
import { CHAT_FONT_RANGE, DEFAULT_SETTINGS } from '../constants/storage';
import { computeChatWidthPx } from '../utils/viewport';

const MIN_CHAT_PX = DEFAULT_SETTINGS.ultraWide.minChatPx;
const BASE_FONT = CHAT_FONT_RANGE.side.default;

describe('needsOverlayFallback — FR-10.2 좁은 폭 폴백', () => {
  it('기본 최소 가독 폭은 150px 다', () => {
    expect(MIN_CHAT_PX).toBe(150);
  });

  it('최소 가독 폭 미만이면 오버레이로 전환한다', () => {
    expect(needsOverlayFallback(140, MIN_CHAT_PX, true)).toBe(true);
    expect(needsOverlayFallback(0, MIN_CHAT_PX, true)).toBe(true);
  });

  it('최소 가독 폭 이상이면 사이드 배치를 유지한다', () => {
    expect(needsOverlayFallback(150, MIN_CHAT_PX, true)).toBe(false);
    // 915×412 실측 계산값 183px 는 사이드 배치로 충분하다.
    expect(needsOverlayFallback(183, MIN_CHAT_PX, true)).toBe(false);
    // 2340×1080 실측 계산값 420px.
    expect(needsOverlayFallback(420, MIN_CHAT_PX, true)).toBe(false);
  });

  it('설정에서 폴백을 끄면 좁아도 전환하지 않는다', () => {
    expect(needsOverlayFallback(10, MIN_CHAT_PX, false)).toBe(false);
  });

  it('비정상 값은 전환하지 않는다', () => {
    expect(needsOverlayFallback(Number.NaN, MIN_CHAT_PX, true)).toBe(false);
  });
});

describe('scaledChatFont — 폭에 비례 축소, 11px 하한', () => {
  it('하한은 11px 이며 그 아래로 내려가지 않는다', () => {
    expect(CHAT_FONT_RANGE.side.min).toBe(11);
    expect(scaledChatFont(183, BASE_FONT)).toBe(11);
    expect(scaledChatFont(10, BASE_FONT)).toBe(11);
    expect(scaledChatFont(0, BASE_FONT)).toBe(11);
  });

  it('기준 폭(353px) 이상이면 원래 크기를 유지한다', () => {
    expect(scaledChatFont(353, BASE_FONT)).toBe(BASE_FONT);
    expect(scaledChatFont(420, BASE_FONT)).toBe(BASE_FONT);
    expect(scaledChatFont(900, 20)).toBe(20);
  });

  it('중간 폭은 비례해 줄어든다', () => {
    // 300 / 353 × 14 = 11.9 → 12
    expect(scaledChatFont(300, BASE_FONT)).toBe(12);
    // 250 / 353 × 24 = 17.0 → 17
    expect(scaledChatFont(250, 24)).toBe(17);
  });

  it('원래 크기보다 커지지 않는다', () => {
    expect(scaledChatFont(340, 11)).toBe(11);
    expect(scaledChatFont(352, 12)).toBeLessThanOrEqual(12);
  });

  it('비정상 값은 하한을 돌려준다', () => {
    expect(scaledChatFont(Number.NaN, BASE_FONT)).toBe(11);
    expect(scaledChatFont(200, Number.NaN)).toBe(11);
  });

  it('같은 입력이면 같은 결과다 (멱등)', () => {
    expect(scaledChatFont(200, BASE_FONT)).toBe(scaledChatFont(200, BASE_FONT));
  });
});

describe('isLandscape', () => {
  it('폭이 높이보다 크면 가로', () => {
    expect(isLandscape(915, 412)).toBe(true);
    expect(isLandscape(412, 915)).toBe(false);
    expect(isLandscape(800, 800)).toBe(false);
  });
});

describe('computeUltraWideCss — FR-10.2 / FR-10.5 필수 선언을 모두 포함한다', () => {
  const css = computeUltraWideCss(183, BASE_FONT, { touchTargetPx: 44 });

  it('safe-area 를 좌우 패딩에 반영한다 (FR-10.5)', () => {
    expect(css).toContain('padding-left: env(safe-area-inset-left, 0px) !important');
    expect(css).toContain('padding-right: env(safe-area-inset-right, 0px) !important');
  });

  it('축소된 폰트를 자손까지 적용한다', () => {
    expect(css).toContain('font-size: 11px !important');
    expect(css).toContain('[class*="_item_"] *');
  });

  it('긴 단어를 강제로 줄바꿈한다', () => {
    expect(css).toContain('overflow-wrap: anywhere !important');
  });

  it('배지·구독 아이콘·프로필 이미지를 숨긴다', () => {
    expect(css).toContain('[class*="_badge"]');
    expect(css).toContain('[class*="_subscription"]');
    expect(css).toContain('[class*="_profile"]');
    expect(css).toMatch(/display: none !important/);
  });

  it('닉네임은 1줄 말줄임이다', () => {
    expect(css).toContain('text-overflow: ellipsis !important');
    expect(css).toContain('white-space: nowrap !important');
  });

  it('입력창 접힘 상태에서 입력창·전송 버튼을 숨긴다', () => {
    expect(css).toContain("[data-cm-chat-input='collapsed']");
    expect(css).toContain('textarea[class*="_input_"]');
    expect(css).toContain('button[class*="_send_button_"]');
  });

  it('입력 토글 버튼은 터치 타겟 크기를 따른다', () => {
    expect(css).toContain('width: 44px');
    expect(computeUltraWideCss(183, BASE_FONT, { touchTargetPx: 32 })).toContain('width: 32px');
  });

  it('폭 자체는 여기서 쓰지 않는다 — layoutArbiter 담당이다', () => {
    expect(css).not.toContain('flex: 0 0');
    expect(css).not.toContain('width: 183px');
  });

  it('같은 입력이면 같은 문자열이다 (멱등)', () => {
    expect(computeUltraWideCss(200, BASE_FONT)).toBe(computeUltraWideCss(200, BASE_FONT));
  });

  it('폭이 넓어지면 폰트도 커진다', () => {
    expect(computeUltraWideCss(420, BASE_FONT)).toContain(`font-size: ${BASE_FONT}px !important`);
  });
});

describe('실측 프로필과의 결합 — 계산 폭이 실험값과 일치해야 한다', () => {
  it('915×412 → 183px, 사이드 배치 유지', () => {
    const widthPx = computeChatWidthPx(915, 412);
    expect(widthPx).toBe(183);
    expect(needsOverlayFallback(widthPx, MIN_CHAT_PX, true)).toBe(false);
  });

  it('2340×1080 → 420px, 폰트는 원래 크기', () => {
    const widthPx = computeChatWidthPx(2340, 1080);
    expect(widthPx).toBe(420);
    expect(scaledChatFont(widthPx, BASE_FONT)).toBe(BASE_FONT);
  });

  it('18:9 급(720×360)은 폭이 좁아 오버레이로 간다', () => {
    const widthPx = computeChatWidthPx(720, 360);
    expect(widthPx).toBe(80);
    expect(needsOverlayFallback(widthPx, MIN_CHAT_PX, true)).toBe(true);
  });
});
