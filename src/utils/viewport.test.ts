import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  onViewportChange,
  computeChatRatio,
  computeChatWidthPx,
  looksLikeKeyboard,
  pictureSize,
  shouldApplyUltraWide,
} from './viewport';

describe('computeChatRatio — FR-10 공식 (실험 PASS 값 재현)', () => {
  it('19.5:9 (2340×1080) → 17.95%', () => {
    const ratio = computeChatRatio(2340, 1080);
    expect(ratio).toBeCloseTo(0.1795, 4);
  });

  it('참고 비율표와 일치한다', () => {
    // 요구사항 FR-10: 18:9 → 11.1% / 19.5:9 → 17.9% / 20:9 → 20.0% / 21:9 → 23.8%
    expect(computeChatRatio(1800, 900)).toBeCloseTo(0.1111, 4);
    expect(computeChatRatio(2000, 900)).toBeCloseTo(0.2, 4);
    expect(computeChatRatio(2100, 900)).toBeCloseTo(0.2381, 4);
  });

  it('16:9 이하에서는 남는 폭이 없어 0 이다', () => {
    expect(computeChatRatio(1920, 1080)).toBe(0);
    expect(computeChatRatio(1440, 900)).toBe(0); // 노트북 프로필 — FR-10 미적용
    expect(computeChatRatio(1180, 820)).toBe(0); // 태블릿10 프로필 — FR-10 미적용
  });

  it('잘못된 입력은 0 이다', () => {
    expect(computeChatRatio(0, 1080)).toBe(0);
    expect(computeChatRatio(1920, 0)).toBe(0);
    expect(computeChatRatio(-100, 1080)).toBe(0);
  });
});

describe('computeChatWidthPx — 실측 PASS 기준값', () => {
  it('2340×1080 → 420px (실측 검증값)', () => {
    expect(computeChatWidthPx(2340, 1080)).toBe(420);
  });

  it('915×412 모바일 가로 → 183px (실측 검증값)', () => {
    expect(computeChatWidthPx(915, 412)).toBe(183);
  });

  it('16:9 이하는 0 이다', () => {
    expect(computeChatWidthPx(1920, 1080)).toBe(0);
  });
});

describe('pictureSize — 실제 그림 크기', () => {
  it('컨테이너가 16:9 보다 넓으면 좌우 필러박스가 생긴다', () => {
    const result = pictureSize(1986, 1080);
    expect(Math.round(result.width)).toBe(1920);
    expect(Math.round(result.height)).toBe(1080);
    expect(Math.round(result.letterbox)).toBe(0);
    expect(Math.round(result.pillarbox)).toBe(66);
  });

  it('컨테이너가 16:9 보다 높으면 위아래 레터박스가 생긴다', () => {
    const result = pictureSize(959, 1080);
    expect(Math.round(result.width)).toBe(959);
    expect(Math.round(result.height)).toBe(539);
    expect(Math.round(result.letterbox)).toBe(541);
    expect(Math.round(result.pillarbox)).toBe(0);
  });

  it('실측 기준값 재현 — 기본 상태 1746×930 → 1653×930', () => {
    const result = pictureSize(1746, 930);
    expect(Math.round(result.width)).toBe(1653);
    expect(Math.round(result.height)).toBe(930);
  });

  it('FR-10 적용 후 1919×1080 은 여백이 1px 이하다 (실측 PASS 기준)', () => {
    const result = pictureSize(1919, 1080);
    expect(result.letterbox).toBeLessThanOrEqual(1);
    expect(result.pillarbox).toBeLessThanOrEqual(1);
  });

  it('4분할 슬롯 959×539 는 이미 16:9 라 여백 ≤1px 이다 (목업 화면 ③)', () => {
    const result = pictureSize(959, 539);
    expect(result.letterbox).toBeLessThanOrEqual(1);
    expect(result.pillarbox).toBeLessThanOrEqual(1);
  });

  it('0 입력은 0 이다', () => {
    expect(pictureSize(0, 0)).toEqual({ width: 0, height: 0, letterbox: 0, pillarbox: 0 });
  });
});

describe('shouldApplyUltraWide — 히스테리시스 (깜빡임 방지)', () => {
  it('꺼진 상태에서는 1.80 이상에서만 켠다', () => {
    expect(shouldApplyUltraWide(1.79, false)).toBe(false);
    expect(shouldApplyUltraWide(1.8, false)).toBe(true);
    expect(shouldApplyUltraWide(2.221, false)).toBe(true); // 모바일 915×412
  });

  it('켜진 상태에서는 1.76 미만이 되어야 끈다', () => {
    expect(shouldApplyUltraWide(1.78, true)).toBe(true);
    expect(shouldApplyUltraWide(1.76, true)).toBe(true);
    expect(shouldApplyUltraWide(1.75, true)).toBe(false);
  });

  it('임계 사이(1.76~1.80)를 왕복해도 상태가 뒤집히지 않는다', () => {
    let applied = false;
    // 1.79 에서는 켜지지 않는다.
    applied = shouldApplyUltraWide(1.79, applied);
    expect(applied).toBe(false);
    // 1.81 에서 켜진다.
    applied = shouldApplyUltraWide(1.81, applied);
    expect(applied).toBe(true);
    // 다시 1.78 로 내려와도 유지된다 — 여기가 깜빡임이 나던 구간이다.
    applied = shouldApplyUltraWide(1.78, applied);
    expect(applied).toBe(true);
  });

  it('16:9(1.778) 정확히에서는 꺼진 상태를 유지한다', () => {
    expect(shouldApplyUltraWide(16 / 9, false)).toBe(false);
  });

  it('프로필 3종 기대값', () => {
    // 모바일 915×412 → 2.221 → 적용
    expect(shouldApplyUltraWide(915 / 412, false)).toBe(true);
    // 태블릿10 1180×820 → 1.439 → 미적용
    expect(shouldApplyUltraWide(1180 / 820, false)).toBe(false);
    // 노트북 1440×900 → 1.600 → 미적용
    expect(shouldApplyUltraWide(1440 / 900, false)).toBe(false);
  });
});

describe('looksLikeKeyboard — IME 추정', () => {
  it('폭 불변 + 높이 급감은 키보드로 본다', () => {
    const prev = { width: 412, height: 915, ratio: 412 / 915 };
    const next = { width: 412, height: 500, ratio: 412 / 500 };
    expect(looksLikeKeyboard(prev, next)).toBe(true);
  });

  it('회전은 키보드가 아니다 (폭이 바뀐다)', () => {
    const prev = { width: 412, height: 915, ratio: 412 / 915 };
    const next = { width: 915, height: 412, ratio: 915 / 412 };
    expect(looksLikeKeyboard(prev, next)).toBe(false);
  });

  it('주소창 접힘 정도(수십 px)는 키보드로 보지 않는다', () => {
    const prev = { width: 412, height: 915, ratio: 412 / 915 };
    const next = { width: 412, height: 860, ratio: 412 / 860 };
    expect(looksLikeKeyboard(prev, next)).toBe(false);
  });

  it('높이가 늘어나는 방향(키보드 닫힘)은 false 다', () => {
    const prev = { width: 412, height: 500, ratio: 412 / 500 };
    const next = { width: 412, height: 915, ratio: 412 / 915 };
    expect(looksLikeKeyboard(prev, next)).toBe(false);
  });
});

describe('폴드 전환 뷰포트 구독', () => {
  let stop: (() => void) | undefined;
  afterEach(() => {
    stop?.();
    stop = undefined;
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const viewport = (width: number, height: number) => {
    vi.stubGlobal('innerWidth', width);
    vi.stubGlobal('innerHeight', height);
  };
  it('연속 resize 신호가 있어도 폭 변경은 300ms를 기다리지 않고 반영한다', async () => {
    vi.useFakeTimers();
    viewport(859, 798);
    const callback = vi.fn();
    stop = onViewportChange(callback, { relaxed: true });
    viewport(411, 812);
    window.dispatchEvent(new Event('resize'));
    await vi.advanceTimersByTimeAsync(32);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]![0]).toMatchObject({
      size: { width: 411, height: 812 },
      keyboardLikely: false,
    });
    for (let i = 0; i < 5; i++) {
      window.dispatchEvent(new Event('resize'));
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(callback).toHaveBeenCalledTimes(1);
  });
  it('입력 중이 아닌 창 높이 축소를 키보드로 오판하지 않는다', async () => {
    vi.useFakeTimers();
    viewport(411, 812);
    const callback = vi.fn();
    stop = onViewportChange(callback);
    viewport(411, 540);
    window.dispatchEvent(new Event('resize'));
    await vi.advanceTimersByTimeAsync(350);
    expect(callback.mock.calls[0]![0].keyboardLikely).toBe(false);
  });
  it('실제 입력 중 키보드 추정은 유지하고, 구독 해제 후 예약된 갱신은 취소한다', async () => {
    vi.useFakeTimers();
    viewport(411, 812);
    const input = document.createElement('textarea');
    document.body.appendChild(input);
    input.focus();
    const callback = vi.fn();
    stop = onViewportChange(callback);
    viewport(411, 540);
    window.dispatchEvent(new Event('resize'));
    await vi.advanceTimersByTimeAsync(350);
    expect(callback.mock.calls[0]![0].keyboardLikely).toBe(true);
    viewport(859, 798);
    window.dispatchEvent(new Event('resize'));
    stop();
    stop = undefined;
    await vi.advanceTimersByTimeAsync(400);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
