/**
 * FR-12 기기 유형 판별 + 유형별 CSS 변수 주입.
 *
 * 판별 규칙
 * - **User-Agent 문자열 파싱에 의존하지 않는다** (위조·이형이 많음).
 * - **터치 여부가 1순위 판정 신호, 크기가 2순위다.** 크기만으로는 "터치 노트북"과
 *   "13인치 태블릿"을 구분할 수 없다.
 *   · 터치 있음 + hover: none + 폭이 태블릿 구간 → 태블릿
 *   · 터치 있음 + hover: hover (트랙패드/마우스 병용) → 노트북
 * - 인치 판정은 원리적으로 추정이다. 인접 유형 간에는 **기능 차이를 두지 않는다.**
 * - 재판정은 창 크기·방향 변경마다 하되, **분할 화면으로 폭이 줄었다고 mobile 로 바뀌면 안 되므로
 *   터치·호버 신호를 크기보다 우선한다.**
 */

import {
  DEVICE_PROFILES,
  SIZE_TIERS,
  type DeviceClass,
  type DeviceProfile,
} from './constants/device';
import { readViewport } from './utils/viewport';
import { info } from './utils/log';

export type DeviceSignals = {
  /** 가로 기준 긴 변 (CSS 픽셀) */
  longSide: number;
  /** 짧은 변 */
  shortSide: number;
  /** navigator.maxTouchPoints > 0 또는 (pointer: coarse) */
  hasTouch: boolean;
  /** matchMedia('(hover: hover)') */
  canHover: boolean;
  /** matchMedia('(pointer: coarse)') */
  coarsePointer: boolean;
  devicePixelRatio: number;
  /** navigator.userAgentData.mobile — 보조 신호 */
  uaMobile: boolean | null;
};

export type DeviceDecision = {
  deviceClass: DeviceClass;
  profile: DeviceProfile;
  signals: DeviceSignals;
  /** 판정 근거 — 디버그 로그에 남긴다 */
  reason: string;
};

type NavigatorUAData = { mobile?: boolean };

export function readSignals(): DeviceSignals {
  const { width, height } = readViewport();
  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);

  const maxTouchPoints = navigator.maxTouchPoints ?? 0;
  const coarsePointer = safeMatch('(pointer: coarse)');
  const canHover = safeMatch('(hover: hover)');
  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;

  return {
    longSide,
    shortSide,
    hasTouch: maxTouchPoints > 0 || coarsePointer,
    canHover,
    coarsePointer,
    devicePixelRatio: window.devicePixelRatio || 1,
    uaMobile: typeof uaData?.mobile === 'boolean' ? uaData.mobile : null,
  };
}

function safeMatch(query: string): boolean {
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

/**
 * 신호로부터 deviceClass 를 판정한다. 순수 함수 — 테스트 대상.
 *
 * 프로필 3종 기대값 (요구사항 §8.0)
 * - 모바일 915×412, 터치 ○ → `mobile`
 * - 태블릿10 1180×820, 터치 ○ → `tablet-10`
 * - 노트북 1440×900, 터치 ✕ → `laptop`
 */
export function classifyDevice(signals: DeviceSignals): {
  deviceClass: DeviceClass;
  reason: string;
} {
  const { longSide, shortSide, hasTouch, canHover } = signals;

  if (!hasTouch) {
    // 터치가 없으면 태블릿일 수 없다. 크기로만 나눈다.
    if (longSide >= SIZE_TIERS.desktopMin) {
      return {
        deviceClass: 'desktop',
        reason: `no touch, longSide ${longSide} >= ${SIZE_TIERS.desktopMin}`,
      };
    }
    return {
      deviceClass: 'laptop',
      reason: `no touch, longSide ${longSide} < ${SIZE_TIERS.desktopMin}`,
    };
  }

  // 터치 + 호버 병용은 트랙패드/마우스가 달린 노트북으로 본다.
  // ⚠️ 크기보다 이 신호가 우선이다 — 창을 좁혀도 mobile 로 오판하지 않게 하는 핵심 규칙.
  if (canHover) {
    if (longSide >= SIZE_TIERS.desktopMin) {
      return {
        deviceClass: 'desktop',
        reason: `touch + hover, longSide ${longSide} → treated as desktop`,
      };
    }
    return { deviceClass: 'laptop', reason: `touch + hover (trackpad/mouse) → treated as laptop` };
  }

  // 터치 전용 기기 — 크기로 계층을 나눈다.
  if (longSide < SIZE_TIERS.tablet7Min || shortSide < SIZE_TIERS.mobileShortSide) {
    return {
      deviceClass: 'mobile',
      reason: `touch only, longSide ${longSide} < ${SIZE_TIERS.tablet7Min} or shortSide ${shortSide} < ${SIZE_TIERS.mobileShortSide}`,
    };
  }
  if (longSide < SIZE_TIERS.tablet10Min) {
    return {
      deviceClass: 'tablet-7',
      reason: `touch only, longSide ${longSide} in [${SIZE_TIERS.tablet7Min}, ${SIZE_TIERS.tablet10Min})`,
    };
  }
  if (longSide < SIZE_TIERS.tablet13Min) {
    return {
      deviceClass: 'tablet-10',
      reason: `touch only, longSide ${longSide} in [${SIZE_TIERS.tablet10Min}, ${SIZE_TIERS.tablet13Min})`,
    };
  }
  return {
    deviceClass: 'tablet-13',
    reason: `touch only, longSide ${longSide} >= ${SIZE_TIERS.tablet13Min}`,
  };
}

/** 설정의 수동 override 를 반영해 최종 판정을 만든다. */
export function decideDevice(override: 'auto' | DeviceClass = 'auto'): DeviceDecision {
  const signals = readSignals();
  if (override !== 'auto') {
    return {
      deviceClass: override,
      profile: DEVICE_PROFILES[override],
      signals,
      reason: `manual override → ${override}`,
    };
  }
  const { deviceClass, reason } = classifyDevice(signals);
  return { deviceClass, profile: DEVICE_PROFILES[deviceClass], signals, reason };
}

/**
 * 유형별 값을 CSS 변수로 표현해 런타임 재판정 시 스타일만 교체되게 한다.
 * 개별 모듈이 deviceClass 로 분기하지 않고 이 변수를 읽는다.
 */
export function deviceCssVars(decision: DeviceDecision): string {
  const { profile, deviceClass } = decision;
  return [
    `--cm-device: "${deviceClass}";`,
    `--cm-control-size: ${profile.touchTargetPx}px;`,
    `--cm-density: ${profile.relaxObservers ? 'low' : 'high'};`,
    `--cm-allow-hover: ${profile.allowHover ? 1 : 0};`,
  ].join(' ');
}

/** `<html>` 에 data 속성으로도 노출해 CSS 선택자에서 쓸 수 있게 한다. */
export function applyDeviceAttributes(decision: DeviceDecision): void {
  const root = document.documentElement;
  root.setAttribute('data-cm-device', decision.deviceClass);
  root.setAttribute('data-cm-touch', decision.signals.hasTouch ? 'true' : 'false');
  root.style.cssText = mergeInlineStyle(root.style.cssText, deviceCssVars(decision));
  info(`device classified as ${decision.deviceClass} (${decision.reason})`);
}

/** 기존 인라인 스타일을 지우지 않고 우리 변수만 갱신한다 (멱등성 — FR-12.1). */
function mergeInlineStyle(existing: string, ours: string): string {
  const stripped = existing
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith('--cm-'))
    .join('; ');
  return stripped.length > 0 ? `${stripped}; ${ours}` : ours;
}
