import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  autoBottomChatRatio,
  chatRatioRangeFor,
  chatWidthFeature,
  clampChatRatio,
  effectiveChatLayout,
  effectiveChatRatio,
  playerRightColumnHeightPx,
  playerRightGridHeightPx,
  PLAYER_RIGHT_COMPACT_RATIO,
  ratioToPx,
  resolveControlAnchor,
  stepChatRatio,
} from './chatWidth';
import { ICON_PATHS } from '../ui/icons';
import { auditIconButtons } from '../ui/iconButtonAudit.test-utils';
import { pictureSize } from '../utils/viewport';
import { CHAT_WIDTH_RANGE, DEFAULT_SETTINGS, STORAGE_KEY } from '../constants/storage';
import type { Settings } from '../constants/storage';
import { DEVICE_PROFILES } from '../constants/device';
import { claimWidth, resetLayoutArbiterForTest } from '../layoutArbiter';
import { CONTROL_ITEM_CLASS } from './controlBar';
import { OURS } from '../constants/class';
import { resetAllSettings } from '../storage';
import type { FeatureContext } from './types';

const { min: MIN, max: MAX } = CHAT_WIDTH_RANGE;
const STEP = DEFAULT_SETTINGS.chatWidth.step;

describe('clampChatRatio', () => {
  it('범위 안 값은 그대로 둔다', () => {
    expect(clampChatRatio(30, MIN, MAX)).toBe(30);
  });

  it('경계값은 통과한다', () => {
    expect(clampChatRatio(15, MIN, MAX)).toBe(15);
    expect(clampChatRatio(50, MIN, MAX)).toBe(50);
  });

  it('범위를 벗어나면 자른다', () => {
    expect(clampChatRatio(5, MIN, MAX)).toBe(15);
    expect(clampChatRatio(80, MIN, MAX)).toBe(50);
    expect(clampChatRatio(-100, MIN, MAX)).toBe(15);
  });

  it('NaN·Infinity 는 최소값으로 본다', () => {
    expect(clampChatRatio(Number.NaN, MIN, MAX)).toBe(15);
    expect(clampChatRatio(Number.POSITIVE_INFINITY, MIN, MAX)).toBe(50);
    expect(clampChatRatio(Number.NEGATIVE_INFINITY, MIN, MAX)).toBe(15);
  });

  it('min·max 가 뒤집혀 들어와도 안전하다', () => {
    expect(clampChatRatio(30, 50, 15)).toBe(30);
    expect(clampChatRatio(90, 50, 15)).toBe(50);
  });
});

describe('stepChatRatio', () => {
  /**
   * 🔴 기본 단계는 5 → 2 로 낮췄다 (사용자 보고 2026-08-24: "+/− 한 번 클릭마다 지금의 절반
   * 정도로 조정되게 해줘 — 지금 너무 크게 움직여").
   */
  it('기본 단계는 2% 다', () => {
    expect(STEP).toBe(2);
    expect(stepChatRatio(30, 1, STEP, MIN, MAX)).toBe(32);
    expect(stepChatRatio(30, -1, STEP, MIN, MAX)).toBe(28);
  });

  it('상한·하한을 넘지 않는다', () => {
    expect(stepChatRatio(49, 1, STEP, MIN, MAX)).toBe(50);
    expect(stepChatRatio(50, 1, STEP, MIN, MAX)).toBe(50);
    expect(stepChatRatio(16, -1, STEP, MIN, MAX)).toBe(15);
    expect(stepChatRatio(15, -1, STEP, MIN, MAX)).toBe(15);
  });

  it('현재값이 범위를 벗어나 있으면 먼저 범위로 들인다', () => {
    expect(stepChatRatio(90, -1, STEP, MIN, MAX)).toBe(48);
    expect(stepChatRatio(0, 1, STEP, MIN, MAX)).toBe(17);
  });

  it('delta 부호만 본다 — 크기는 step 이 결정한다', () => {
    expect(stepChatRatio(30, 10, STEP, MIN, MAX)).toBe(32);
    expect(stepChatRatio(30, -10, STEP, MIN, MAX)).toBe(28);
  });

  it('step 이 0·음수·NaN 이면 현재값을 유지한다', () => {
    expect(stepChatRatio(30, 1, 0, MIN, MAX)).toBe(30);
    expect(stepChatRatio(30, 1, -5, MIN, MAX)).toBe(30);
    expect(stepChatRatio(30, 1, Number.NaN, MIN, MAX)).toBe(30);
  });

  it('delta 가 NaN 이면 현재값을 유지한다', () => {
    expect(stepChatRatio(30, Number.NaN, STEP, MIN, MAX)).toBe(30);
  });

  it('설정에서 단계를 키우면 그만큼 움직인다', () => {
    expect(stepChatRatio(20, 1, 10, MIN, MAX)).toBe(30);
  });
});

describe('ratioToPx', () => {
  it('비율(%)을 뷰포트 폭에 곱해 반올림한다', () => {
    expect(ratioToPx(30, 1920)).toBe(576);
    expect(ratioToPx(15, 1440)).toBe(216);
    expect(ratioToPx(50, 900)).toBe(450);
  });

  it('반올림 결과가 정수다', () => {
    // 915 × 22% = 201.3 → 201
    expect(ratioToPx(22, 915)).toBe(201);
    // 1180 × 22% = 259.6 → 260
    expect(ratioToPx(22, 1180)).toBe(260);
  });

  it('0% 는 0px (접힌 상태)', () => {
    expect(ratioToPx(0, 1920)).toBe(0);
  });

  it('뷰포트 폭이 0·음수·NaN 이면 0', () => {
    expect(ratioToPx(30, 0)).toBe(0);
    expect(ratioToPx(30, -100)).toBe(0);
    expect(ratioToPx(30, Number.NaN)).toBe(0);
  });

  it('비율이 NaN 이면 0', () => {
    expect(ratioToPx(Number.NaN, 1920)).toBe(0);
  });

  it('음수 비율은 0 으로 막는다', () => {
    expect(ratioToPx(-10, 1920)).toBe(0);
  });
});

describe('effectiveChatRatio — FR-12 기기별 기본 점유율', () => {
  const range = { min: 15, max: 50 };

  it('auto 면 기기 프로필의 기본 점유율을 쓴다 (전역 30% 를 무시한다)', () => {
    expect(
      effectiveChatRatio(
        { ratio: 30, ratioSource: 'auto' },
        DEVICE_PROFILES.laptop,
        range.min,
        range.max,
      ),
    ).toBe(25);
    expect(
      effectiveChatRatio(
        { ratio: 30, ratioSource: 'auto' },
        DEVICE_PROFILES['tablet-10'],
        range.min,
        range.max,
      ),
    ).toBe(22);
    expect(
      effectiveChatRatio(
        { ratio: 30, ratioSource: 'auto' },
        DEVICE_PROFILES.desktop,
        range.min,
        range.max,
      ),
    ).toBe(28);
  });

  it('manual 이면 사용자 값이 기기 기본값을 이긴다', () => {
    expect(
      effectiveChatRatio(
        { ratio: 45, ratioSource: 'manual' },
        DEVICE_PROFILES.laptop,
        range.min,
        range.max,
      ),
    ).toBe(45);
  });

  it('7인치·모바일은 프로필 값이 null 이라 저장된 값을 그대로 둔다 (FR-10 이 폭을 정한다)', () => {
    expect(
      effectiveChatRatio(
        { ratio: 30, ratioSource: 'auto' },
        DEVICE_PROFILES.mobile,
        range.min,
        range.max,
      ),
    ).toBe(30);
    expect(
      effectiveChatRatio(
        { ratio: 30, ratioSource: 'auto' },
        DEVICE_PROFILES['tablet-7'],
        range.min,
        range.max,
      ),
    ).toBe(30);
  });

  it('범위를 벗어난 값은 클램프한다', () => {
    expect(
      effectiveChatRatio(
        { ratio: 99, ratioSource: 'manual' },
        DEVICE_PROFILES.desktop,
        range.min,
        range.max,
      ),
    ).toBe(50);
    expect(
      effectiveChatRatio(
        { ratio: 1, ratioSource: 'manual' },
        DEVICE_PROFILES.desktop,
        range.min,
        range.max,
      ),
    ).toBe(15);
  });

  it('노트북 1440×900 에서 25% 면 레터박스가 30% 일 때보다 작아진다', () => {
    // 실측 회귀: 30% → 영상 1007×566, 레터박스 334px
    const at30 = 1440 - ratioToPx(30, 1440);
    const at25 = 1440 - ratioToPx(25, 1440);
    const letterbox = (mainW: number) => 900 - (mainW / 16) * 9;
    expect(letterbox(at25)).toBeLessThan(letterbox(at30));
  });
});

/**
 * 🔴 실측 회귀 2026-08-16 (`probe-bottom-gap/report.json`, 412×915 실사이트).
 * 하단 배치에서 `main` 이 412×549 인데 영상은 412×232 라 **317px 이 죽은 검은 공백**이었다.
 * 점유율을 기기 고정값(40%)이 아니라 "뷰포트 높이 − 영상 그림 높이" 에서 유도해 없앤다.
 */
describe('autoBottomChatRatio — 세로 하단 자동 점유율', () => {
  /** 실측 프로브와 같은 값. 영상 그림 높이는 폭이 잡는 16:9 상한이다. */
  const PHONE = { width: 412, height: 915 };

  it('412×915 에서 자동 점유율은 "뷰포트 − 영상 그림 높이" 다', () => {
    const picture = pictureSize(PHONE.width, PHONE.height).height;
    expect(picture).toBeCloseTo(231.75, 5);
    // (915 − 231.75) / 915 = 74.67% → 소수 첫째 자리로 내려 74.6
    expect(autoBottomChatRatio(PHONE)).toBe(74.6);
  });

  it('그 점유율을 px 로 바꾸면 남는 공백이 사라진다 (실측 317px → 0px)', () => {
    const asidePx = ratioToPx(autoBottomChatRatio(PHONE), PHONE.height);
    expect(asidePx).toBe(683);
    const mainPx = PHONE.height - asidePx;
    const picture = pictureSize(PHONE.width, PHONE.height).height;
    // main 232px, 영상 그림 231.75px → 남는 높이는 1px 미만이다.
    expect(mainPx).toBe(232);
    expect(mainPx - picture).toBeLessThan(1);
  });

  it('올림이 아니라 내림한다 — 영상 그림을 깎지 않기 위해서다', () => {
    const asidePx = ratioToPx(autoBottomChatRatio(PHONE), PHONE.height);
    const picture = pictureSize(PHONE.width, PHONE.height).height;
    expect(PHONE.height - asidePx).toBeGreaterThanOrEqual(picture);
  });

  it('세로 화면 전반에서 43.75% 보다 크다 (16:9 이하로는 못 내려간다)', () => {
    for (const viewport of [
      { width: 540, height: 960 },
      { width: 720, height: 1280 },
      { width: 820, height: 1180 },
      { width: 300, height: 2000 },
    ]) {
      expect(autoBottomChatRatio(viewport)).toBeGreaterThan(43.7);
      expect(autoBottomChatRatio(viewport)).toBeLessThan(100);
    }
    expect(autoBottomChatRatio({ width: 540, height: 960 })).toBe(68.3);
  });

  it('16:9 보다 넓은 가로 화면은 영상이 높이에 걸려 남는 높이가 없다 → 0%', () => {
    expect(autoBottomChatRatio({ width: 915, height: 412 })).toBe(0);
    expect(autoBottomChatRatio({ width: 1920, height: 950 })).toBe(0);
  });

  it('16:10 노트북(1440×900)은 폭이 그림을 잡아 90px 이 남는다 → 10%', () => {
    // 1440 ÷ 16×9 = 810 → (900 − 810) / 900 = 10%
    expect(autoBottomChatRatio({ width: 1440, height: 900 })).toBe(10);
  });

  it('뷰포트가 0·음수·NaN 이면 0 (계산이 폭주하지 않는다)', () => {
    expect(autoBottomChatRatio({ width: 0, height: 915 })).toBe(0);
    expect(autoBottomChatRatio({ width: 412, height: 0 })).toBe(0);
    expect(autoBottomChatRatio({ width: -412, height: 915 })).toBe(0);
    expect(autoBottomChatRatio({ width: Number.NaN, height: 915 })).toBe(0);
  });
});

describe('chatRatioRangeFor — 상한은 하단 배치에서만 올린다', () => {
  const { min: MIN_R, max: MAX_R } = CHAT_WIDTH_RANGE;

  it('오른쪽 배치는 기존 범위를 그대로 쓴다 (가로에서 채팅이 화면을 덮으면 안 된다)', () => {
    for (const viewport of [
      { width: 412, height: 915 },
      { width: 1440, height: 900 },
      { width: 300, height: 2000 },
    ]) {
      expect(chatRatioRangeFor('right', viewport, MIN_R, MAX_R)).toEqual({ min: 15, max: 50 });
    }
  });

  it('하단 배치는 영상 그림 높이의 절반까지 내주는 상한을 만든다', () => {
    expect(chatRatioRangeFor('bottom', { width: 412, height: 915 }, MIN_R, MAX_R)).toEqual({
      min: 15,
      max: 87.3,
    });
    expect(chatRatioRangeFor('bottom', { width: 540, height: 960 }, MIN_R, MAX_R)).toEqual({
      min: 15,
      max: 84.1,
    });
  });

  it('🔴 자동 점유율은 언제나 범위 안이다 — 경계에서 값이 튀지 않기 위한 불변식', () => {
    for (const viewport of [
      { width: 412, height: 915 },
      { width: 540, height: 960 },
      { width: 360, height: 640 },
      { width: 300, height: 2000 },
      { width: 800, height: 801 },
      { width: 1180, height: 1181 },
    ]) {
      const auto = autoBottomChatRatio(viewport);
      const range = chatRatioRangeFor('bottom', viewport, MIN_R, MAX_R);
      expect(auto).toBeGreaterThanOrEqual(range.min);
      expect(auto).toBeLessThanOrEqual(range.max);
      // `+` 를 누를 여유도 남아 있어야 한다 (상한 = 자동값이면 버튼이 죽는다).
      expect(range.max).toBeGreaterThan(auto);
    }
  });

  it('상한은 **올리기만** 한다 — 남는 높이가 없으면 기존 50% 그대로다', () => {
    // 16:9 보다 넓으면 영상이 높이를 다 쓰므로 내줄 여백이 없다.
    expect(chatRatioRangeFor('bottom', { width: 915, height: 412 }, MIN_R, MAX_R)).toEqual({
      min: 15,
      max: 50,
    });
    expect(chatRatioRangeFor('bottom', { width: 1920, height: 950 }, MIN_R, MAX_R)).toEqual({
      min: 15,
      max: 50,
    });
    // 16:10 처럼 여백이 남는 가로에서는 그만큼만 올라간다 (자동값 10% 도 범위 안이다).
    expect(chatRatioRangeFor('bottom', { width: 1440, height: 900 }, MIN_R, MAX_R)).toEqual({
      min: 15,
      max: 55,
    });
  });

  it('뷰포트가 망가진 값이면 저장 범위를 그대로 돌려준다', () => {
    expect(chatRatioRangeFor('bottom', { width: 0, height: 0 }, MIN_R, MAX_R)).toEqual({
      min: 15,
      max: 50,
    });
    expect(chatRatioRangeFor('bottom', { width: 412, height: Number.NaN }, MIN_R, MAX_R)).toEqual({
      min: 15,
      max: 50,
    });
  });

  it('저장 스키마(15~50)는 건드리지 않는다 — 파생값으로만 올린다', () => {
    expect(CHAT_WIDTH_RANGE).toEqual({ min: 15, max: 50 });
    expect(DEFAULT_SETTINGS.chatWidth.max).toBe(50);
  });
});

/**
 * 🔴 실측 회귀 2026-08-15 (`scripts/verify-user-scenarios.mjs` 의 `ratio-9to16/S-06`, 540×960).
 * 세로 화면은 자동으로 하단 배치가 되는데, 설정 패널의 점유율 `+` 를 누르면 자동 배치가 풀리고
 * 저장된 `placement: 'right'` 로 되돌아갔다 (하단 높이 336 → 오른쪽 폭 189).
 * 원인은 폭 오버라이드와 배치 오버라이드를 하나의 플래그로 묶은 것이었다.
 */
describe('effectiveChatLayout — 폭 오버라이드와 배치 오버라이드는 별개다', () => {
  const range = { min: 15, max: 50 };
  const portrait = { width: 540, height: 960 };
  const landscape = { width: 1440, height: 900 };
  /** 실측 프로필: 540×960 은 tablet-10 으로 판정된다 (chatRatioPortrait 35). */
  const tablet = DEVICE_PROFILES['tablet-10'];
  const layout = (
    settings: Parameters<typeof effectiveChatLayout>[0],
    viewport: { width: number; height: number },
    flags: Parameters<typeof effectiveChatLayout>[5] = {},
  ) => effectiveChatLayout(settings, tablet, viewport, range.min, range.max, flags);

  it('(a) 세로에서 폭만 직접 정하면 하단 배치는 유지되고 점유율만 사용자 값이 된다', () => {
    expect(
      layout({ ratio: 40, ratioSource: 'manual', placement: 'right' }, portrait, {
        widthOverride: true,
      }),
    ).toEqual({ placement: 'bottom', ratio: 40 });
  });

  it('(b) 세로에서 배치를 오른쪽으로 고르면 그 선택이 유지된다 (자동 하단으로 되돌아가지 않는다)', () => {
    expect(
      layout({ ratio: 30, ratioSource: 'auto', placement: 'right' }, portrait, {
        placementOverride: true,
      }),
    ).toMatchObject({ placement: 'right' });
  });

  it('(c) 사용자가 고른 하단 배치는 저장값에서 그대로 복원된다', () => {
    expect(
      layout({ ratio: 30, ratioSource: 'auto', placement: 'bottom' }, landscape, {
        placementOverride: true,
      }),
    ).toMatchObject({ placement: 'bottom' });
  });

  it('(d) 양쪽 모두 auto 면 세로에서 자동 하단 배치·"뷰포트 − 영상" 점유율이 된다', () => {
    expect(layout({ ratio: 30, ratioSource: 'auto', placement: 'right' }, portrait)).toEqual({
      placement: 'bottom',
      ratio: autoBottomChatRatio(portrait),
    });
    // 기기 프로필의 고정값(35%)이 아니라 뷰포트에서 유도된 값이다.
    expect(autoBottomChatRatio(portrait)).toBe(68.3);
  });

  it('(d-2) 세로에서 사용자가 하단을 직접 고른 경우에도 같은 자동 점유율을 쓴다', () => {
    expect(
      layout({ ratio: 30, ratioSource: 'auto', placement: 'bottom' }, portrait, {
        placementOverride: true,
      }),
    ).toEqual({ placement: 'bottom', ratio: autoBottomChatRatio(portrait) });
  });

  /**
   * 🔴 하단 배치에서 상한이 15~50 이면 저장된 자동값(68.3%)이 시작하자마자 50 으로 깎인다.
   * 그러면 첫 `−` 클릭에서 aside 가 656 → 460px 로 튄다.
   */
  it('(d-3) 하단 배치의 사용자 값은 올라간 상한까지 살아남는다', () => {
    expect(
      layout({ ratio: 68.3, ratioSource: 'manual', placement: 'right' }, portrait, {
        widthOverride: true,
      }),
    ).toEqual({ placement: 'bottom', ratio: 68.3 });
    // 오른쪽 배치였다면 같은 값이 50 으로 잘린다 (가로 범위는 그대로 지킨다).
    expect(
      layout({ ratio: 68.3, ratioSource: 'manual', placement: 'right' }, landscape, {
        widthOverride: true,
      }),
    ).toEqual({ placement: 'right', ratio: 50 });
  });

  it('(e) 가로에서는 기존 동작 그대로 — 저장된 배치와 기기별 기본 점유율', () => {
    expect(layout({ ratio: 30, ratioSource: 'auto', placement: 'right' }, landscape)).toEqual({
      placement: 'right',
      ratio: 22,
    });
    expect(
      layout({ ratio: 45, ratioSource: 'manual', placement: 'right' }, landscape, {
        widthOverride: true,
      }),
    ).toEqual({ placement: 'right', ratio: 45 });
  });

  /**
   * 🔴 실측 회귀 2026-08-16 (`verify-user-scenarios` mobile-landscape/S-06).
   * 세로에서 저장된 하단 자동값(74.6%)이 가로로 돌아온 뒤에도 남아 오른쪽 범위 상한(50%)에
   * 눌러앉았고, 설정 패널의 `+` 가 영구 비활성이 되어 클릭이 타임아웃했다.
   */
  it('(d-4) 하단 자동값은 가로로 돌아올 때 물려받지 않는다 (상한에 눌러앉지 않는다)', () => {
    const phonePortrait = { width: 412, height: 915 };
    const phoneLandscape = { width: 915, height: 412 };
    const phone = DEVICE_PROFILES.mobile;
    const auto = autoBottomChatRatio(phonePortrait);
    expect(auto).toBeGreaterThan(range.max);

    // 세로에서 자동값이 저장된 뒤 가로로 회전한 상태.
    const rotated = effectiveChatLayout(
      { ratio: auto, ratioSource: 'auto', placement: 'right' },
      phone,
      phoneLandscape,
      range.min,
      range.max,
    );
    expect(rotated.placement).toBe('right');
    expect(rotated.ratio).toBe(DEFAULT_SETTINGS.chatWidth.ratio);
    // 상한이 아니어야 `+` 가 살아 있다.
    expect(rotated.ratio).toBeLessThan(range.max);
  });

  it('(d-5) 사용자가 직접 정한 값(manual)은 그대로 존중한다', () => {
    expect(
      effectiveChatLayout(
        { ratio: 74.6, ratioSource: 'manual', placement: 'right' },
        DEVICE_PROFILES.mobile,
        { width: 915, height: 412 },
        range.min,
        range.max,
        { widthOverride: true },
      ),
    ).toEqual({ placement: 'right', ratio: 50 });
  });

  /**
   * 🔴 2026-08-20 요청으로 규칙이 바뀌었다 — **자세만 본다.**
   * 예전에는 `chatRatioPortrait` 가 없는 프로필(데스크톱)이면 세로여도 오른쪽에 남았다.
   * 그 결과 창을 세로로 길게 줄이면 영상과 채팅이 둘 다 찌그러졌다.
   */
  it('세로용 점유율이 없는 프로필(데스크톱)도 세로 뷰포트면 하단으로 간다', () => {
    const result = effectiveChatLayout(
      { ratio: 30, ratioSource: 'auto', placement: 'right' },
      DEVICE_PROFILES.desktop,
      portrait,
      range.min,
      range.max,
    );
    expect(result.placement).toBe('bottom');
  });

  it('가로로 조금이라도 길면 오른쪽이다 — 정사각도 오른쪽', () => {
    for (const vp of [
      { width: 901, height: 900 },
      { width: 900, height: 900 },
    ]) {
      expect(
        effectiveChatLayout(
          { ratio: 30, ratioSource: 'auto', placement: 'right' },
          DEVICE_PROFILES.desktop,
          vp,
          range.min,
          range.max,
        ).placement,
      ).toBe('right');
    }
  });

  it('세로로 1px 만 길어도 하단이다', () => {
    expect(
      effectiveChatLayout(
        { ratio: 30, ratioSource: 'auto', placement: 'right' },
        DEVICE_PROFILES.desktop,
        { width: 900, height: 901 },
        range.min,
        range.max,
      ).placement,
    ).toBe('bottom');
  });

  it('토글(배치 오버라이드)은 자세보다 우선한다 — 언제든 바꿀 수 있다', () => {
    expect(
      effectiveChatLayout(
        { ratio: 30, ratioSource: 'auto', placement: 'right' },
        DEVICE_PROFILES.desktop,
        portrait,
        range.min,
        range.max,
        { placementOverride: true },
      ).placement,
    ).toBe('right');
  });

  /**
   * 🔴 회귀 방지 (실측 2026-08-16, 실사이트 412×915).
   * 폰 세로가 오른쪽 배치로 남으면 치지직 자체 래퍼가 `flex-direction: column` 이라
   * aside 가 124×124 상자로 찌그러지고 채팅 목록 높이가 0 이 된다.
   */
  it('폰 세로(412×915)는 자동으로 하단 배치가 된다', () => {
    expect(DEVICE_PROFILES.mobile.chatRatioPortrait).not.toBeNull();
    expect(
      effectiveChatLayout(
        { ratio: 30, ratioSource: 'auto', placement: 'right' },
        DEVICE_PROFILES.mobile,
        { width: 412, height: 915 },
        range.min,
        range.max,
      ),
    ).toEqual({ placement: 'bottom', ratio: autoBottomChatRatio({ width: 412, height: 915 }) });
  });

  it('폰 가로(915×412)는 하단 배치로 바뀌지 않는다 (자세만 본다)', () => {
    expect(
      effectiveChatLayout(
        { ratio: 30, ratioSource: 'auto', placement: 'right' },
        DEVICE_PROFILES.mobile,
        { width: 915, height: 412 },
        range.min,
        range.max,
      ),
    ).toMatchObject({ placement: 'right' });
  });
});

/**
 * 2026-08-15 요청 — 4개 버튼을 토글 하나로 묶어 채팅 버튼 왼쪽에 둔다.
 * 여유 폭 실측치(도구 행에 우리 묶음을 넣기 전)는 함수 주석의 표와 같다.
 */
describe('resolveControlAnchor — 도구 행 여유 폭으로 배치를 고른다', () => {
  it('도구 행을 못 찾으면 플로팅으로 폴백한다 (NFR-05)', () => {
    expect(resolveControlAnchor(null, 44)).toBe('floating');
    expect(resolveControlAnchor(Number.NaN, 44)).toBe('floating');
  });

  it('토글 하나조차 못 들어가면 플로팅이다 (모바일 세로 1px · FR-10 오버레이 10px)', () => {
    expect(resolveControlAnchor(1, 44)).toBe('floating');
    expect(resolveControlAnchor(10, 44)).toBe('floating');
    // 토글 44 + gap 4 = 48 이 경계다.
    expect(resolveControlAnchor(47, 44)).toBe('floating');
    expect(resolveControlAnchor(48, 44)).toBe('popover');
  });

  it('토글은 들어가지만 4개를 펼칠 자리가 없으면 팝오버다 (태블릿10 가로 69px · 노트북13 169px)', () => {
    expect(resolveControlAnchor(69, 44)).toBe('popover');
    expect(resolveControlAnchor(169, 32)).toBe('popover');
  });

  it('4개까지 들어가면 인라인이다 (태블릿10 세로 하단 배치 629px)', () => {
    expect(resolveControlAnchor(629, 44)).toBe('inline');
    // (44+4) × 5 = 240 이 경계다.
    expect(resolveControlAnchor(239, 44)).toBe('popover');
    expect(resolveControlAnchor(240, 44)).toBe('inline');
  });

  it('터치 타겟 하한(28px)을 밑도는 프로필 값에도 28px 로 계산한다', () => {
    // 28 + 4 = 32 → 그 아래는 폴백
    expect(resolveControlAnchor(31, 10)).toBe('floating');
    expect(resolveControlAnchor(32, 10)).toBe('popover');
  });
});

/**
 * 기능 단위 — 버튼을 **실제로 눌러** 오버라이드가 서는지, 그리고 **재시작 후에도 사는지** 본다.
 *
 * 리뷰 지적 회귀 (2026-08-15):
 * - M1: `togglePlacement` 이 `ratioSource` 없이 저장해 재시작하면 `placement: 'bottom'` 이 죽었다.
 * - m8: 클램프 경계에서 `+` 가 조기 반환해 오버라이드 승격이 일어나지 않았다.
 */
describe('chatWidthFeature — 사용자 조작과 재시작 (실측 회귀 2026-08-15)', () => {
  /** chrome.storage.local 을 메모리로 대체한다 (chrome API 는 jsdom 에 없다). */
  function installFakeChrome(): { store: Record<string, unknown> } {
    const store: Record<string, unknown> = {};
    const fake = {
      storage: {
        local: {
          get: vi.fn(async (keys: string[] | string) => {
            const list = Array.isArray(keys) ? keys : [keys];
            const out: Record<string, unknown> = {};
            for (const key of list) if (key in store) out[key] = store[key];
            return out;
          }),
          set: vi.fn(async (patch: Record<string, unknown>) => {
            Object.assign(store, patch);
          }),
        },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    };
    (globalThis as unknown as { chrome: unknown }).chrome = fake;
    return { store };
  }

  let store: Record<string, unknown>;

  /** 저장이 fire-and-forget 이라 마이크로태스크를 한 바퀴 돌린다. */
  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  const savedChatWidth = (): Settings['chatWidth'] =>
    (store[STORAGE_KEY] as Settings | undefined)?.chatWidth as Settings['chatWidth'];

  const makeCtx = (
    chatWidth: Partial<Settings['chatWidth']>,
    profileOverrides: Partial<(typeof DEVICE_PROFILES)['laptop']> = {},
  ): FeatureContext => ({
    page: { type: 'live', channelId: 'a'.repeat(32), videoNo: null, isSlotFrame: false },
    device: {
      deviceClass: 'laptop',
      profile: { ...DEVICE_PROFILES.laptop, ...profileOverrides },
      signals: {
        longSide: 1440,
        shortSide: 900,
        hasTouch: false,
        canHover: true,
        coarsePointer: false,
        devicePixelRatio: 1,
        uaMobile: null,
      },
      reason: 'test fixture',
    },
    settings: {
      ...DEFAULT_SETTINGS,
      chatWidth: { ...DEFAULT_SETTINGS.chatWidth, ...chatWidth },
    },
  });

  const layoutCss = (): string => document.getElementById(OURS.layoutStyleId)?.textContent ?? '';

  const click = (label: string): void => {
    const button = document.querySelector<HTMLButtonElement>(
      `#cm-chat-width-control button[aria-label="${label}"]`,
    );
    if (!button) throw new Error(`button not found: ${label}`);
    button.click();
  };

  /** 위치 전환 버튼. aria-label 이 "다음 상태"를 담아 계속 바뀌므로 접두사로 찾는다. */
  const placementButton = (): HTMLButtonElement | null =>
    document.querySelector<HTMLButtonElement>(
      '#cm-chat-width-control button[aria-label^="채팅 위치를"]',
    );

  /** 뷰포트 폭. jsdom 기본값(1024)을 그대로 쓴다 — 비율 → px 기대값 계산에 필요하다. */
  const VIEWPORT_WIDTH = 1024;

  beforeEach(async () => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    resetLayoutArbiterForTest();
    ({ store } = installFakeChrome());
    // jsdom 에는 matchMedia 가 없다 (onViewportChange 가 방향 변화를 여기로 듣는다).
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    // storage 모듈의 캐시를 기본값으로 되돌린다 (모듈 전역이라 테스트 간 새어 나간다).
    await resetAllSettings();
    expect(window.innerWidth).toBe(VIEWPORT_WIDTH);
  });

  afterEach(() => {
    resetLayoutArbiterForTest();
    document.getElementById('cm-chat-width-control')?.remove();
  });

  it('`+` 를 누르면 사용자 조작으로 표시돼 FR-10 계산값을 이긴다', async () => {
    const dispose = chatWidthFeature.start(makeCtx({ ratioSource: 'auto' }));
    // FR-10 이 뒤늦게 좁은 계산값을 주장해도 사용자 조작이 이겨야 한다.
    claimWidth('ultraWide', 183, 'ratio 2.021');
    expect(layoutCss()).toContain('width: 183px !important');

    click('채팅 폭 늘리기');
    await flush();

    // 기기 기본값 25% → 27% (STEP=2)
    expect(layoutCss()).toContain(`width: ${ratioToPx(25 + STEP, VIEWPORT_WIDTH)}px !important`);
    expect(savedChatWidth()).toMatchObject({ ratio: 25 + STEP, ratioSource: 'manual' });
    dispose?.();
  });

  /**
   * m8 회귀 — 기기 기본값이 이미 상한이면 `+` 는 값을 못 바꾼다. 그래도 **오버라이드 승격**은
   * 일어나야 한다. 조기 반환하면 초광폭에서 `+` 가 영원히 죽은 버튼이 된다.
   */
  it('클램프 경계에서도 `+` 가 오버라이드를 승격시킨다', async () => {
    const max = DEFAULT_SETTINGS.chatWidth.max;
    const dispose = chatWidthFeature.start(
      makeCtx({ ratioSource: 'auto' }, { chatRatioLandscape: max }),
    );
    claimWidth('ultraWide', 183, 'ratio 2.021');
    expect(layoutCss()).toContain('width: 183px !important');

    click('채팅 폭 늘리기');
    await flush();

    expect(layoutCss()).toContain(`width: ${ratioToPx(max, VIEWPORT_WIDTH)}px !important`);
    expect(savedChatWidth()).toMatchObject({ ratio: max, ratioSource: 'manual' });
    dispose?.();
  });

  it('`−` 도 경계에서 오버라이드를 승격시킨다', async () => {
    const min = DEFAULT_SETTINGS.chatWidth.min;
    const dispose = chatWidthFeature.start(
      makeCtx({ ratioSource: 'auto' }, { chatRatioLandscape: min }),
    );
    claimWidth('ultraWide', 183, 'ratio 2.021');

    click('채팅 폭 줄이기');
    await flush();

    expect(layoutCss()).toContain(`width: ${ratioToPx(min, VIEWPORT_WIDTH)}px !important`);
    expect(savedChatWidth()).toMatchObject({ ratioSource: 'manual' });
    dispose?.();
  });

  it('접기 → 펼치기 후에도 오버라이드가 저장에 남는다', async () => {
    const dispose = chatWidthFeature.start(makeCtx({ ratioSource: 'auto' }));

    click('채팅 접기');
    await flush();
    expect(layoutCss()).toContain('width: 0 !important');
    expect(savedChatWidth()).toMatchObject({ collapsed: true, ratioSource: 'manual' });

    click('채팅 펼치기');
    await flush();
    // 🔴 펼치면 `collapsed` 가 false 라, `ratioSource` 가 없으면 오버라이드 근거가 사라진다.
    expect(savedChatWidth()).toMatchObject({ collapsed: false, ratioSource: 'manual' });
    dispose?.();
  });

  /**
   * M1 회귀 — 위치 전환은 `placement` 만 저장하고 `ratioSource` 는 `'auto'` 로 남았다.
   * 그래서 재시작하면 오버라이드가 사라지고 FR-10 이 이겨 **하단 배치가 조용히 죽었다**
   * (버튼 아이콘은 ▤ 그대로였다).
   */
  it('위치를 아래로 바꾸면 재시작 후에도 하단 배치가 유지된다', async () => {
    const dispose = chatWidthFeature.start(makeCtx({ ratioSource: 'auto' }));

    expect(placementButton()?.getAttribute('aria-label')).toBe('채팅 위치를 아래로 옮기기');
    placementButton()?.click();
    await flush();
    expect(layoutCss()).toContain('flex-direction: column !important');
    // 배치만 사용자 값이 된다 — 점유율은 계속 기기별 기본값을 따른다.
    expect(savedChatWidth()).toMatchObject({
      placement: 'bottom',
      placementSource: 'manual',
      ratioSource: 'auto',
    });

    // 재시작: content.tsx 는 저장된 설정으로 기능을 다시 시작한다.
    dispose?.();
    resetLayoutArbiterForTest();
    document.getElementById('cm-chat-width-control')?.remove();

    const restarted = chatWidthFeature.start(makeCtx(savedChatWidth()));
    claimWidth('ultraWide', 183, 'ratio 2.021');

    expect(layoutCss()).toContain('flex-direction: column !important');
    expect(layoutCss()).not.toContain('width: 183px !important');
    // 아이콘도 하단 배치를 그대로 보여 준다 (표시와 실제가 갈라지지 않는다).
    // ▤(아래 배치) 대체 — LayoutBottomIcon 은 rect + 가로 분할선 2개 엘리먼트로 그려진다.
    expect(placementButton()?.querySelector('svg')?.children).toHaveLength(2);
    expect(placementButton()?.querySelector('path')?.getAttribute('d')).toBe(
      ICON_PATHS.layoutBottom[1].d,
    );
    restarted?.();
  });

  /**
   * 🔴 실측 회귀 2026-08-15 `ratio-9to16/S-06` — 세로 화면의 자동 하단 배치가 점유율 `+` 한 번에
   * 풀렸다 (하단 높이 336 → 오른쪽 폭 189). 폭 조작은 배치를 건드리지 않아야 한다.
   */
  describe('세로 화면 (540×960) — 자동 하단 배치', () => {
    /** jsdom 의 뷰포트를 세로로 바꾼다 (`readViewport` 는 innerWidth/Height 로 폴백한다). */
    const setPortraitViewport = (): void => {
      Object.defineProperty(window, 'innerWidth', { value: 540, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: 960, configurable: true });
    };

    afterEach(() => {
      Object.defineProperty(window, 'innerWidth', { value: VIEWPORT_WIDTH, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
    });

    /** 실측 프로필과 같은 값 — tablet-10 의 세로 점유율은 35% 다. */
    const portraitCtx = (chatWidth: Partial<Settings['chatWidth']> = {}) =>
      makeCtx(chatWidth, { chatRatioPortrait: 35 });

    /** 540×960 의 자동 하단 점유율 — 기기 고정값 35% 가 아니라 뷰포트에서 유도된다. */
    const AUTO = autoBottomChatRatio({ width: 540, height: 960 });

    it('시작하자마자 하단 배치가 된다 (높이 = 960 − 영상 그림 높이)', () => {
      setPortraitViewport();
      const dispose = chatWidthFeature.start(portraitCtx());

      expect(AUTO).toBe(68.3);
      expect(layoutCss()).toContain('flex-direction: column !important');
      expect(layoutCss()).toContain(`height: ${ratioToPx(AUTO, 960)}px !important`);
      dispose?.();
    });

    /**
     * 🔴 실측 회귀 2026-08-16 — 자동값(68.3%)이 저장 상한(50%)을 넘어 첫 `−` 에서 값이 튀었다.
     * 하단 배치에서는 상한이 올라가야 `+`/`−` 가 단조롭게 움직인다.
     */
    it('`+`/`−` 가 자동값 근처에서 단조롭게 움직인다 (경계에서 튀지 않는다)', async () => {
      setPortraitViewport();
      const dispose = chatWidthFeature.start(portraitCtx());
      const heightOf = (): number =>
        Number(/height: (\d+)px !important/.exec(layoutCss())?.[1] ?? -1);

      const start = heightOf();
      expect(start).toBe(ratioToPx(AUTO, 960));

      click('채팅 폭 늘리기');
      await flush();
      const plus1 = heightOf();
      click('채팅 폭 늘리기');
      await flush();
      const plus2 = heightOf();
      expect(plus1).toBe(ratioToPx(AUTO + STEP, 960));
      expect(plus2).toBeGreaterThan(plus1);

      click('채팅 폭 줄이기');
      await flush();
      click('채팅 폭 줄이기');
      await flush();
      // 원래 값으로 정확히 돌아온다 — 중간에 상한으로 끌려가지 않았다는 뜻이다.
      expect(heightOf()).toBe(start);
      dispose?.();
    });

    it('`+` 를 눌러도 하단 배치가 유지되고 높이만 커진다', async () => {
      setPortraitViewport();
      const dispose = chatWidthFeature.start(portraitCtx());

      click('채팅 폭 늘리기');
      await flush();

      expect(layoutCss()).toContain('flex-direction: column !important');
      expect(layoutCss()).toContain(`height: ${ratioToPx(AUTO + STEP, 960)}px !important`);
      // 폭만 사용자 값이 된다 — 배치는 계속 자동이다.
      expect(savedChatWidth()).toMatchObject({ ratioSource: 'manual', placementSource: 'auto' });
      dispose?.();
    });

    /** 새로고침·기능 재시작 후에도 상한 위의 사용자 값이 살아남아야 한다. */
    it('상한(50%)을 넘는 하단 점유율이 재시작 후에도 유지된다', async () => {
      setPortraitViewport();
      const dispose = chatWidthFeature.start(portraitCtx());
      click('채팅 폭 늘리기');
      await flush();
      const saved = savedChatWidth();
      expect(saved.ratio).toBe(AUTO + STEP);

      dispose?.();
      resetLayoutArbiterForTest();
      document.getElementById('cm-chat-width-control')?.remove();

      const restarted = chatWidthFeature.start(portraitCtx(saved));
      expect(layoutCss()).toContain(`height: ${ratioToPx(AUTO + STEP, 960)}px !important`);
      restarted?.();
    });

    it('세로에서 위치 버튼으로 오른쪽을 고르면 그 선택이 재시작 후에도 유지된다', async () => {
      setPortraitViewport();
      const dispose = chatWidthFeature.start(portraitCtx());
      expect(layoutCss()).toContain('flex-direction: column !important');

      // 현재가 하단이므로 누르면 오른쪽이 된다.
      placementButton()?.click();
      await flush();
      expect(layoutCss()).not.toContain('flex-direction: column !important');
      expect(savedChatWidth()).toMatchObject({ placement: 'right', placementSource: 'manual' });

      dispose?.();
      resetLayoutArbiterForTest();
      document.getElementById('cm-chat-width-control')?.remove();

      const restarted = chatWidthFeature.start(portraitCtx(savedChatWidth()));
      expect(layoutCss()).not.toContain('flex-direction: column !important');
      restarted?.();
    });

    it('되돌리기(양쪽 auto)면 다시 자동 하단 배치가 된다', () => {
      setPortraitViewport();
      const dispose = chatWidthFeature.start(
        portraitCtx({ ratioSource: 'auto', placementSource: 'auto', placement: 'right' }),
      );

      expect(layoutCss()).toContain('flex-direction: column !important');
      expect(layoutCss()).toContain(`height: ${ratioToPx(AUTO, 960)}px !important`);
      dispose?.();
    });
  });

  /**
   * 2026-08-15 요청 — 도구 행에 4개를 그대로 내보내면 좁은 폭에서 넘친다.
   * 토글 하나로 묶고, 자리에 따라 인라인 / 팝오버 / 플로팅으로 나눈다.
   */
  describe('토글 묶음과 배치 폴백', () => {
    const control = (): HTMLElement | null => document.getElementById('cm-chat-width-control');
    const items = (): HTMLElement | null =>
      control()?.querySelector<HTMLElement>('.cm-chat-width-items') ?? null;
    const toggle = (): HTMLButtonElement | null =>
      control()?.querySelector<HTMLButtonElement>('button[aria-label^="채팅 폭 조절"]') ?? null;

    /** 실측 픽스처(`scripts/fixtures/live-page.html`)의 입력 영역을 그대로 옮긴 마크업. */
    const mountChatArea = (toolsFreePx: number | null): void => {
      document.body.innerHTML = `
        <aside id="aside-chatting">
          <div class="_area_b8csn_49">
            <textarea class="_input_1k5b6_92"></textarea>
            <div class="_tools_1k5b6_125">
              <div class="_donation_1k5b6_132">
                <button type="button" class="_donation_text_1k5b6_137">후원하기</button>
              </div>
              <button type="button" class="_send_button_1k5b6_176">채팅</button>
            </div>
          </div>
        </aside>`;
      if (toolsFreePx === null) return;
      // jsdom 은 레이아웃을 하지 않는다 → 도구 행의 폭만 실측치로 대신 심는다.
      const tools = document.querySelector('[class*="_tools_"]') as HTMLElement;
      Object.defineProperty(tools, 'clientWidth', { value: toolsFreePx, configurable: true });
    };

    it('기본은 접힘 — 도구 행에는 토글 하나만 나간다', () => {
      const dispose = chatWidthFeature.start(makeCtx({}));

      expect(control()?.dataset['expanded']).toBe('false');
      expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
      expect(toggle()?.getAttribute('aria-label')).toBe('채팅 폭 조절 열기');
      expect(items()?.hidden).toBe(true);
      dispose?.();
    });

    it('토글을 누르면 4개가 펼쳐지고 aria-label 은 그대로다 (하네스·테스트가 이 이름을 쓴다)', () => {
      const dispose = chatWidthFeature.start(makeCtx({}));

      toggle()?.click();

      expect(control()?.dataset['expanded']).toBe('true');
      expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
      expect(toggle()?.getAttribute('aria-label')).toBe('채팅 폭 조절 닫기');
      expect(items()?.hidden).toBe(false);
      expect(
        Array.from(items()?.querySelectorAll('button') ?? []).map((b) =>
          b.getAttribute('aria-label'),
        ),
      ).toEqual(['채팅 폭 늘리기', '채팅 폭 줄이기', '채팅 접기', '채팅 위치를 아래로 옮기기']);

      // 다시 누르면 접힌다.
      toggle()?.click();
      expect(items()?.hidden).toBe(true);
      dispose?.();
    });

    it('펼침 상태는 저장하지 않는다 (세션 안에서만 유지)', async () => {
      const dispose = chatWidthFeature.start(makeCtx({ ratioSource: 'manual' }));

      await flush();
      const before = JSON.stringify(store[STORAGE_KEY] ?? null);

      toggle()?.click();
      await flush();

      // 저장 스냅샷이 그대로다 — 펼침/접힘은 어떤 필드로도 저장되지 않는다.
      expect(JSON.stringify(store[STORAGE_KEY] ?? null)).toBe(before);
      expect(JSON.stringify(store[STORAGE_KEY] ?? null)).not.toContain('expanded');
      dispose?.();
    });

    it('도구 행이 없으면 화면 오른쪽 플로팅으로 폴백한다 (NFR-05)', () => {
      const dispose = chatWidthFeature.start(makeCtx({}));

      expect(control()?.dataset['anchor']).toBe('floating');
      expect(control()?.parentElement).toBe(document.body);
      dispose?.();
    });

    it('여유가 넉넉하면 도구 행의 채팅 버튼 **왼쪽**에 인라인으로 들어간다', () => {
      mountChatArea(629);
      const dispose = chatWidthFeature.start(makeCtx({}));

      expect(control()?.dataset['anchor']).toBe('inline');
      expect(control()?.dataset['side']).toBe('right');
      expect(control()?.parentElement?.className).toContain('_tools_');
      expect(control()?.nextElementSibling?.className).toContain('_send_button_');
      dispose?.();
    });

    it('토글은 들어가지만 4개가 안 들어가면 팝오버로 연다 (태블릿10 가로 69px)', () => {
      mountChatArea(69);
      const dispose = chatWidthFeature.start(makeCtx({}));

      expect(control()?.dataset['anchor']).toBe('popover');
      expect(control()?.nextElementSibling?.className).toContain('_send_button_');
      dispose?.();
    });

    /**
     * 🔴 실측 회귀 2026-08-15 — 접으면 채팅 aside 가 폭 0 이라 도구 행 안의 버튼이 사라져
     * **펼치기를 다시 누를 방법이 없어진다** (하네스에서 10개 프로필 전부 클릭 타임아웃).
     */
    it('접으면 도구 행을 떠나 플로팅으로 옮겨 간다 (펼치기 버튼이 살아 있어야 한다)', () => {
      mountChatArea(629);
      const dispose = chatWidthFeature.start(makeCtx({}));
      expect(control()?.dataset['anchor']).toBe('inline');

      toggle()?.click();
      click('채팅 접기');

      expect(control()?.dataset['anchor']).toBe('floating');
      expect(control()?.parentElement).toBe(document.body);
      // 펼치기 버튼은 여전히 펼쳐진 묶음 안에 보인다.
      expect(items()?.hidden).toBe(false);
      expect(control()?.querySelector('button[aria-label="채팅 펼치기"]')).not.toBeNull();

      click('채팅 펼치기');
      expect(control()?.dataset['anchor']).toBe('inline');
      dispose?.();
    });

    /**
     * 🔴 실측 회귀 2026-08-16 (실사이트 노트북13 1440×900).
     * 치지직 입력 영역·도구 행은 우리가 마운트한 뒤에 그려진다. 예전에는 첫 배치가 그대로
     * 굳어 여유 폭이 119px 이나 되는데도 **항상 플로팅**이었다 (뷰포트를 1px 흔들어야
     * 도구 행으로 들어갔다). 채팅 영역 DOM 변화를 듣고 자리를 다시 골라야 한다.
     */
    it('도구 행이 나중에 그려져도 그때 도구 행으로 옮겨 간다', async () => {
      document.body.innerHTML = '<aside id="aside-chatting"></aside>';
      const dispose = chatWidthFeature.start(makeCtx({}));
      expect(control()?.dataset['anchor']).toBe('floating');

      const aside = document.getElementById('aside-chatting') as HTMLElement;
      aside.innerHTML = `
        <div class="_area_b8csn_49">
          <textarea class="_input_1k5b6_92"></textarea>
          <div class="_tools_1k5b6_125">
            <div class="_donation_1k5b6_132"></div>
            <button type="button" class="_send_button_1k5b6_176">채팅</button>
          </div>
        </div>`;
      const tools = document.querySelector('[class*="_tools_"]') as HTMLElement;
      Object.defineProperty(tools, 'clientWidth', { value: 629, configurable: true });

      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(control()?.dataset['anchor']).toBe('inline');
      expect(control()?.parentElement?.className).toContain('_tools_');
      dispose?.();
    });

    it('토글조차 못 들어가면 도구 행을 쓰지 않는다 (모바일 세로 1px)', () => {
      mountChatArea(1);
      const dispose = chatWidthFeature.start(makeCtx({}));

      expect(control()?.dataset['anchor']).toBe('floating');
      expect(control()?.parentElement).toBe(document.body);
      dispose?.();
    });

    /**
     * P3 아이콘 치환 회귀 — 폴백 경로에는 토글(`↔`)이 **추가로** 붙는다.
     * 우측 가운데 앵커에는 없는 버튼이라 그쪽 검사만으로는 라벨 소실을 못 잡는다.
     */
    it('폴백(플로팅) 경로의 아이콘 버튼도 접근성 이름을 갖는다', () => {
      mountChatArea(1);
      const dispose = chatWidthFeature.start(makeCtx({}));

      const root = control();
      expect(root).not.toBeNull();
      expect(root?.dataset['anchor']).toBe('floating');
      // 토글 + `+ − ⟩ ▦` = 5개.
      const audit = auditIconButtons(root as HTMLElement, {
        expectAtLeast: 5,
        context: 'chatWidth floating',
      });
      expect(audit.auditedIconButtons).toBe(audit.totalButtons);
      dispose?.();
    });
  });
  /**
   * P2 — 채팅 폭 조절 묶음을 플레이어 우측 가운데으로 옮긴다 (도구 행·플로팅은 폴백으로만 남는다).
   */
  describe('P2 — 플레이어 우측 가운데 앵커', () => {
    const control = (): HTMLElement | null => document.getElementById('cm-chat-width-control');
    const items = (): HTMLElement | null =>
      control()?.querySelector<HTMLElement>('.cm-chat-width-items') ?? null;
    const toggle = (): HTMLButtonElement | null =>
      control()?.querySelector<HTMLButtonElement>('button[aria-label^="채팅 폭 조절"]') ?? null;

    /**
     * 실측 구조를 본뜬 최소 플레이어 루트 (`PLAYER.rootPc` = `.pzp-pc`).
     * `heightPx` 를 주면 `getBoundingClientRect().height` 를 그 값으로 고정한다 — jsdom 은
     * 레이아웃을 계산하지 않으므로(항상 0) 2×2 접힘 판정(`updatePlayerRightCompact`)을 테스트하려면
     * 직접 못박아야 한다.
     */
    const mountPlayerRoot = (heightPx?: number): HTMLElement => {
      const root = document.createElement('div');
      root.className = 'pzp-pc';
      document.body.appendChild(root);
      if (heightPx !== undefined) {
        root.getBoundingClientRect = () =>
          ({
            height: heightPx,
            width: 0,
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            x: 0,
            y: 0,
          }) as DOMRect;
      }
      return root;
    };

    it('플레이어가 있으면 컨트롤이 플레이어의 자식으로 들어간다', () => {
      const player = mountPlayerRoot();
      const dispose = chatWidthFeature.start(makeCtx({}));

      expect(control()?.dataset['anchor']).toBe('player-right-center');
      expect(control()?.parentElement).toBe(player);
      // 컨트롤바 자동 숨김과 같은 신호(클래스)를 써야 한다.
      expect(control()?.classList.contains(CONTROL_ITEM_CLASS)).toBe(true);
      dispose?.();
    });

    it('토글 없이 버튼 4개가 처음부터 전부 보인다', () => {
      mountPlayerRoot();
      const dispose = chatWidthFeature.start(makeCtx({}));

      expect(control()?.dataset['expanded']).toBe('true');
      expect(items()?.hidden).toBe(false);
      expect(
        Array.from(items()?.querySelectorAll('button') ?? []).map((b) =>
          b.getAttribute('aria-label'),
        ),
      ).toEqual(['채팅 폭 늘리기', '채팅 폭 줄이기', '채팅 접기', '채팅 위치를 아래로 옮기기']);
      dispose?.();
    });

    it('이 앵커에는 ↔ 토글 버튼이 없다 (누를 것이 없다)', () => {
      mountPlayerRoot();
      const dispose = chatWidthFeature.start(makeCtx({}));

      expect(toggle()).toBeNull();
      expect(control()?.querySelector('button[aria-label="채팅 폭 조절 열기"]')).toBeNull();
      dispose?.();
    });

    /**
     * 세로 공간은 넘친다 (플레이어 오른쪽이라 도구 행처럼 좁지 않다) — 접힘 대신
     * `flex-direction: column` 으로 상시 세로 배치한다. row-reverse 는 더 필요 없다.
     */
    it('우측 가운데 앵커는 세로로 쌓인다 (column, row-reverse 아님)', () => {
      mountPlayerRoot();
      const dispose = chatWidthFeature.start(makeCtx({}));

      const style = document.getElementById('cm-chat-width-control-style');
      const css = style?.textContent ?? '';
      const anchorRule = css.slice(css.indexOf('[data-anchor="player-right-center"] {'));
      expect(anchorRule).toContain('right:');
      expect(anchorRule.slice(0, anchorRule.indexOf('}'))).toContain('flex-direction: column');
      const itemsRule = css.slice(
        css.indexOf('[data-anchor="player-right-center"] .cm-chat-width-items'),
      );
      expect(itemsRule.slice(0, itemsRule.indexOf('}'))).toContain('flex-direction: column');
      expect(css).not.toContain('row-reverse');
      dispose?.();
    });

    /**
     * P3 아이콘 치환 회귀 — 이 앵커의 버튼은 전부 아이콘 전용이라 `aria-label` 이
     * 사라지면 스크린리더에서 넷 다 그냥 "버튼"이 된다. 눈으로는 멀쩡해 보인다.
     */
    it('앵커의 아이콘 버튼에 접근성 이름이 전부 남아 있다', () => {
      mountPlayerRoot();
      const dispose = chatWidthFeature.start(makeCtx({}));

      const root = control();
      expect(root).not.toBeNull();
      // `+ − ⟩ ▦` 넷. 이 앵커는 토글(`↔`)을 렌더하지 않는다.
      const audit = auditIconButtons(root as HTMLElement, {
        expectAtLeast: 4,
        context: 'chatWidth player-right-center',
      });
      // 텍스트를 가진 버튼이 섞여 있으면 전수 검사가 아니게 된다.
      expect(audit.auditedIconButtons).toBe(audit.totalButtons);
      dispose?.();
    });

    it('🔴 세로 가운데에 붙는다 — 우상단은 치지직 LIVE 뱃지와 겹쳐 내려왔다', () => {
      mountPlayerRoot();
      const dispose = chatWidthFeature.start(makeCtx({}));

      const css = document.getElementById('cm-chat-width-control-style')?.textContent ?? '';
      const anchorRule = css.slice(css.indexOf('[data-anchor="player-right-center"] {'));
      const block = anchorRule.slice(0, anchorRule.indexOf('}'));
      expect(block).toContain('top: 50%');
      expect(block).toContain('translateY(-50%)');
      /*
       * 🔴 우상단 인셋으로 되돌리면 치지직 LIVE 뱃지를 다시 가린다
       * (실측 2026-08-21: laptop13 55×24px 겹침, mobile-portrait 는 뱃지가 통째로 덮였다).
       */
      expect(block).not.toMatch(/top:\s*12px/);
      dispose?.();
    });

    it('접힌 상태에서도 플레이어가 있으면 자리를 잃지 않는다 (aside 크기와 무관)', () => {
      const player = mountPlayerRoot();
      const dispose = chatWidthFeature.start(makeCtx({ collapsed: true }));

      expect(control()?.dataset['anchor']).toBe('player-right-center');
      expect(control()?.parentElement).toBe(player);
      dispose?.();
    });
    it('접힌 상태에서도 자동 숨김 신호(CONTROL_ITEM_CLASS)가 붙어 있다 (감사 #2 — 컨트롤바 숨김과 동기화)', () => {
      mountPlayerRoot();
      const dispose = chatWidthFeature.start(makeCtx({ collapsed: true }));

      expect(control()?.classList.contains(CONTROL_ITEM_CLASS)).toBe(true);
      dispose?.();
    });

    it('감사 #2 — 접힌 토글도 어두운 배경 위에서 식별되게 테두리·반투명 배경을 명시한다', () => {
      mountPlayerRoot();
      const dispose = chatWidthFeature.start(makeCtx({ collapsed: true }));

      const css = document.getElementById('cm-chat-width-control-style')?.textContent ?? '';
      // 배경(alpha 명시)과 테두리를 둘 다 요구한다 — 배경만으로는 레터박스(검은 배경)와
      // 대비가 0에 가까워졌던 감사 이슈(#2)가 재발한다.
      expect(css).toMatch(
        /#cm-chat-width-control button\s*\{[^}]*border:\s*1px solid rgba\(255, 255, 255, 0\.35\)/,
      );
      expect(css).toMatch(
        /#cm-chat-width-control button\s*\{[^}]*background:\s*rgba\(0, 0, 0, 0\.65\)/,
      );
      dispose?.();
    });

    it('플레이어가 없으면 기존 폴백(플로팅) 경로를 탄다', () => {
      const dispose = chatWidthFeature.start(makeCtx({}));

      expect(control()?.dataset['anchor']).toBe('floating');
      expect(control()?.parentElement).toBe(document.body);
      expect(control()?.classList.contains(CONTROL_ITEM_CLASS)).toBe(false);
      dispose?.();
    });
    it('폴백(플로팅)에서는 토글 접힘/펼침이 그대로 동작한다 — 좁은 자리 전제가 아직 살아 있다', () => {
      const dispose = chatWidthFeature.start(makeCtx({}));

      expect(control()?.dataset['anchor']).toBe('floating');
      expect(toggle()).not.toBeNull();
      expect(control()?.dataset['expanded']).toBe('false');
      expect(items()?.hidden).toBe(true);

      toggle()?.click();
      expect(control()?.dataset['expanded']).toBe('true');
      expect(items()?.hidden).toBe(false);

      toggle()?.click();
      expect(control()?.dataset['expanded']).toBe('false');
      expect(items()?.hidden).toBe(true);
      dispose?.();
    });

    it('플레이어가 없으면 도구 행 폴백도 그대로 동작한다', () => {
      document.body.innerHTML = `
        <aside id="aside-chatting">
          <div class="_area_b8csn_49">
            <textarea class="_input_1k5b6_92"></textarea>
            <div class="_tools_1k5b6_125">
              <div class="_donation_1k5b6_132"></div>
              <button type="button" class="_send_button_1k5b6_176">채팅</button>
            </div>
          </div>
        </aside>`;
      const tools = document.querySelector('[class*="_tools_"]') as HTMLElement;
      Object.defineProperty(tools, 'clientWidth', { value: 629, configurable: true });
      const dispose = chatWidthFeature.start(makeCtx({}));

      expect(control()?.dataset['anchor']).toBe('inline');
      expect(control()?.parentElement?.className).toContain('_tools_');
      dispose?.();
    });

    it('dispose 후 노드·스타일이 남지 않는다', () => {
      mountPlayerRoot();
      const dispose = chatWidthFeature.start(makeCtx({}));

      expect(control()).not.toBeNull();
      expect(document.getElementById('cm-chat-width-control-style')).not.toBeNull();

      dispose?.();

      expect(control()).toBeNull();
      expect(document.getElementById('cm-chat-width-control-style')).toBeNull();
    });
    /**
     * 2×2 접힘 — 세로 한 줄이 플레이어 높이의 절반을 넘으면 접는다.
     * 기준은 실제 플레이어 높이다(프로필 이름이 아니다) — `mountPlayerRoot(heightPx)` 로
     * `getBoundingClientRect().height` 를 직접 못박아 검증한다.
     */
    describe('2×2 접힘 — 플레이어 높이 기준', () => {
      it('플레이어가 낮으면(모바일 세로 실측 232px) 2×2 로 접힌다', () => {
        mountPlayerRoot(232);
        const dispose = chatWidthFeature.start(makeCtx({}, { touchTargetPx: 44 }));
        // 세로 한 줄 196px / 232px = 84.5% > 50% → 접는다.
        expect(playerRightColumnHeightPx(44) / 232).toBeGreaterThan(PLAYER_RIGHT_COMPACT_RATIO);
        expect(control()?.dataset['compact']).toBe('true');
        // 접힌 뒤에는 절반 이하로 내려간다 (100px / 232px = 43.1%).
        expect(playerRightGridHeightPx(44) / 232).toBeLessThan(0.5);
        dispose?.();
      });

      it('플레이어가 넉넉하면(laptop13 실측 900px) 1열을 유지한다', () => {
        mountPlayerRoot(900);
        const dispose = chatWidthFeature.start(makeCtx({}, { touchTargetPx: 32 }));
        // 세로 한 줄 148px / 900px = 16.4% ≤ 50% → 유지한다.
        expect(playerRightColumnHeightPx(32) / 900).toBeLessThan(PLAYER_RIGHT_COMPACT_RATIO);
        expect(control()?.dataset['compact']).toBe('false');
        dispose?.();
      });

      it('접힘 기준은 캐시하지 않는다 — 플레이어 높이가 나중에 바뀌면 다시 판정한다 (FR-12.1)', async () => {
        const player = mountPlayerRoot(900); // 처음엔 넉넉하다 → 1열.
        const dispose = chatWidthFeature.start(
          makeCtx({ ratioSource: 'auto' }, { touchTargetPx: 44 }),
        );
        expect(control()?.dataset['compact']).toBe('false');

        // 회전 등으로 플레이어가 낮아졌다고 가정한다. 값은 매번 다시 읽어야 하므로
        // 마운트 시점 값을 캐시했다면 여기서 바뀌지 않아야 하는데, 바뀌어야 통과한다.
        player.getBoundingClientRect = () =>
          ({ height: 200, width: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 }) as DOMRect;
        click('채팅 폭 늘리기'); // apply() 를 다시 태우는 계기 — 변경 내용 자체는 무관하다.
        await flush();

        expect(control()?.dataset['compact']).toBe('true');
        dispose?.();
      });

      it('접혀도 버튼 히트 영역은 touchTargetPx 이상이다 (grid 칸도 버튼과 같은 크기)', () => {
        mountPlayerRoot(232);
        const dispose = chatWidthFeature.start(makeCtx({}, { touchTargetPx: 44 }));
        const css = document.getElementById('cm-chat-width-control-style')?.textContent ?? '';
        expect(css).toMatch(/button\s*\{[^}]*min-width:\s*44px/);
        expect(css).toMatch(/button\s*\{[^}]*min-height:\s*44px/);
        // 아이콘을 줄여 접는 게 아니라 배치만 바꾼다 — grid 칸도 버튼 크기(44px) 그대로다.
        expect(css).toContain('grid-template-columns: repeat(2, 44px)');
        dispose?.();
      });
    });

    /** SVG 아이콘 전수 검사 — 문자 아이콘이 하나도 남지 않았는지 본다. */
    describe('SVG 아이콘 — 문자 아이콘 0개', () => {
      it('버튼 4개 모두 SVG 를 갖고 aria-hidden·aria-label 을 지킨다 (전수 검사)', () => {
        mountPlayerRoot();
        const dispose = chatWidthFeature.start(makeCtx({}));
        const buttons = Array.from(items()?.querySelectorAll<HTMLButtonElement>('button') ?? []);
        expect(buttons).toHaveLength(4);
        for (const button of buttons) {
          expect(button.getAttribute('aria-label')).toBeTruthy();
          const svg = button.querySelector('svg');
          expect(svg).not.toBeNull();
          expect(svg?.getAttribute('aria-hidden')).toBe('true');
          // 문자 아이콘이 남아 있으면 버튼 자체의 텍스트 노드로 보인다 — SVG 안의 <path>/<rect> 만 있어야 한다.
          expect(button.textContent?.trim()).toBe('');
        }
        dispose?.();
      });

      it('접기 버튼을 누르면 SVG 가 사라지지 않고 아이콘만 바뀐다 (⟩ → ⟨)', async () => {
        mountPlayerRoot();
        const dispose = chatWidthFeature.start(makeCtx({}));
        const collapseButton = document.querySelector<HTMLButtonElement>(
          '#cm-chat-width-control button[aria-label="채팅 접기"]',
        );
        expect(collapseButton?.querySelector('svg')).not.toBeNull();

        click('채팅 접기');
        await flush();

        const svg = collapseButton?.querySelector('svg');
        expect(svg).not.toBeNull(); // textContent 로 덮었다면 여기서 사라진다.
        expect(collapseButton?.getAttribute('aria-label')).toBe('채팅 펼치기');
        dispose?.();
      });

      it('위치 전환 버튼을 누르면 SVG 가 사라지지 않고 아이콘만 바뀐다 (▦ → ▤)', async () => {
        mountPlayerRoot();
        const dispose = chatWidthFeature.start(makeCtx({ ratioSource: 'auto' }));
        expect(placementButton()?.querySelector('svg')).not.toBeNull();

        placementButton()?.click();
        await flush();

        expect(placementButton()?.querySelector('svg')).not.toBeNull();
        expect(placementButton()?.querySelector('path')?.getAttribute('d')).toBe(
          ICON_PATHS.layoutBottom[1].d,
        );
        dispose?.();
      });
    });
  });

  it('되돌리기(ratioSource: auto)로 재시작하면 FR-10 계산값이 다시 이긴다', () => {
    const dispose = chatWidthFeature.start(
      makeCtx({ ratioSource: 'auto', collapsed: false, placement: 'right' }),
    );
    claimWidth('ultraWide', 183, 'ratio 2.021');

    expect(layoutCss()).toContain('width: 183px !important');
    dispose?.();
  });

  it('manual 로 저장돼 있으면 시작하자마자 FR-10 을 이긴다 (이전 세션의 조작)', () => {
    const dispose = chatWidthFeature.start(makeCtx({ ratioSource: 'manual', ratio: 45 }));
    claimWidth('ultraWide', 183, 'ratio 2.021');

    expect(layoutCss()).toContain(`width: ${ratioToPx(45, VIEWPORT_WIDTH)}px !important`);
    dispose?.();
  });
});
