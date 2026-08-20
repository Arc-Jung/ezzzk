import { describe, expect, it } from 'vitest';
import { classifyDevice, type DeviceSignals } from './device';
import { DEVICE_PROFILES } from './constants/device';

function signals(
  partial: Partial<DeviceSignals> & { longSide: number; shortSide: number },
): DeviceSignals {
  return {
    hasTouch: false,
    canHover: true,
    coarsePointer: false,
    devicePixelRatio: 1,
    uaMobile: null,
    ...partial,
  };
}

describe('classifyDevice — 필수 검증 프로필 3종 (요구사항 §8.0)', () => {
  it('모바일 915×412, 터치 ○ → mobile', () => {
    const result = classifyDevice(
      signals({
        longSide: 915,
        shortSide: 412,
        hasTouch: true,
        canHover: false,
        coarsePointer: true,
        devicePixelRatio: 2.625,
      }),
    );
    expect(result.deviceClass).toBe('mobile');
  });

  it('모바일 세로 412×915 도 mobile (긴 변 기준으로 본다)', () => {
    const result = classifyDevice(
      signals({
        longSide: 915,
        shortSide: 412,
        hasTouch: true,
        canHover: false,
        coarsePointer: true,
      }),
    );
    expect(result.deviceClass).toBe('mobile');
  });

  it('태블릿 10인치 1180×820, 터치 ○ → tablet-10', () => {
    const result = classifyDevice(
      signals({
        longSide: 1180,
        shortSide: 820,
        hasTouch: true,
        canHover: false,
        coarsePointer: true,
        devicePixelRatio: 2,
      }),
    );
    expect(result.deviceClass).toBe('tablet-10');
  });

  it('노트북 13인치 1440×900, 터치 ✕ → laptop', () => {
    const result = classifyDevice(
      signals({
        longSide: 1440,
        shortSide: 900,
        hasTouch: false,
        canHover: true,
        devicePixelRatio: 2,
      }),
    );
    expect(result.deviceClass).toBe('laptop');
  });
});

describe('classifyDevice — 크기 계층', () => {
  it('터치 없고 1680 이상은 desktop', () => {
    expect(classifyDevice(signals({ longSide: 1920, shortSide: 1080 })).deviceClass).toBe(
      'desktop',
    );
    expect(classifyDevice(signals({ longSide: 1680, shortSide: 1050 })).deviceClass).toBe(
      'desktop',
    );
  });

  it('터치 없고 1680 미만은 laptop', () => {
    expect(classifyDevice(signals({ longSide: 1679, shortSide: 1050 })).deviceClass).toBe('laptop');
    expect(classifyDevice(signals({ longSide: 1280, shortSide: 800 })).deviceClass).toBe('laptop');
  });

  it('터치 전용 기기의 인치 계층', () => {
    const touchOnly = (longSide: number, shortSide: number) =>
      classifyDevice(
        signals({ longSide, shortSide, hasTouch: true, canHover: false, coarsePointer: true }),
      ).deviceClass;

    expect(touchOnly(1366, 1024)).toBe('tablet-13'); // iPad Pro 12.9" 급
    expect(touchOnly(1180, 820)).toBe('tablet-10'); // iPad 10.9" 급
    expect(touchOnly(1024, 768)).toBe('tablet-10');
    expect(touchOnly(744, 600)).toBe('tablet-7'); // iPad mini 급
    expect(touchOnly(599, 400)).toBe('mobile');
  });

  it('짧은 변이 480 미만이면 크기가 커도 mobile 이다 (초광폭 폰 가로)', () => {
    const result = classifyDevice(
      signals({
        longSide: 2340,
        shortSide: 1080 / 2.625,
        hasTouch: true,
        canHover: false,
        coarsePointer: true,
      }),
    );
    // 2340×412 급 — 긴 변은 태블릿-13 구간이지만 짧은 변이 480 미만이라 폰이다.
    expect(result.deviceClass).toBe('mobile');
  });
});

describe('classifyDevice — 터치 우선 규칙 (FR-12 회귀)', () => {
  it('터치 + 호버 병용은 태블릿이 아니라 노트북으로 본다', () => {
    const result = classifyDevice(
      signals({ longSide: 1366, shortSide: 768, hasTouch: true, canHover: true }),
    );
    expect(result.deviceClass).toBe('laptop');
  });

  it('데스크톱에서 창을 좁혀도 mobile·tablet 으로 오판하지 않는다', () => {
    // 1920 모니터에서 창을 500×400 으로 좁힌 상황. 터치 없음 → laptop 까지만 내려간다.
    const result = classifyDevice(
      signals({ longSide: 500, shortSide: 400, hasTouch: false, canHover: true }),
    );
    expect(result.deviceClass).toBe('laptop');
    expect(result.deviceClass).not.toBe('mobile');
  });

  it('터치 노트북을 분할 화면으로 좁혀도 mobile 이 되지 않는다', () => {
    const result = classifyDevice(
      signals({ longSide: 700, shortSide: 450, hasTouch: true, canHover: true }),
    );
    expect(result.deviceClass).toBe('laptop');
  });

  it('판정 근거를 문자열로 남긴다 (디버그 로그용)', () => {
    const result = classifyDevice(signals({ longSide: 1920, shortSide: 1080 }));
    expect(result.reason).toContain('no touch');
    expect(result.reason).toContain('1920');
  });
});

describe('DEVICE_PROFILES — 유형별 값 (FR-12 표)', () => {
  it('터치 기기는 44px 타겟이고 호버 UI 를 쓰지 않는다', () => {
    for (const cls of ['tablet-13', 'tablet-10', 'tablet-7', 'mobile'] as const) {
      expect(DEVICE_PROFILES[cls].touchTargetPx).toBe(44);
      expect(DEVICE_PROFILES[cls].allowHover).toBe(false);
    }
  });

  it('멀티뷰 최대 분할은 tablet-10 이하에서 2 다', () => {
    expect(DEVICE_PROFILES.desktop.maxSplit).toBe(4);
    expect(DEVICE_PROFILES.laptop.maxSplit).toBe(4);
    expect(DEVICE_PROFILES['tablet-13'].maxSplit).toBe(4);
    expect(DEVICE_PROFILES['tablet-10'].maxSplit).toBe(2);
    expect(DEVICE_PROFILES['tablet-7'].maxSplit).toBe(2);
    expect(DEVICE_PROFILES.mobile.maxSplit).toBe(2);
  });

  it('슬롯 채팅 줄 상한 (FR-14.2)', () => {
    expect(DEVICE_PROFILES.desktop.maxSlotChatLines).toBe(5);
    expect(DEVICE_PROFILES['tablet-10'].maxSlotChatLines).toBe(3);
    expect(DEVICE_PROFILES['tablet-7'].maxSlotChatLines).toBe(2);
    expect(DEVICE_PROFILES.mobile.maxSlotChatLines).toBe(2);
  });

  it('모바일·7인치급은 볼륨 컨트롤을 기본 숨김하고 단축키를 끈다', () => {
    for (const cls of ['tablet-7', 'mobile'] as const) {
      expect(DEVICE_PROFILES[cls].volumeAlwaysVisible).toBe(false);
      expect(DEVICE_PROFILES[cls].shortcuts).toBe('off');
    }
  });
});
