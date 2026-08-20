/**
 * FR-12.1 창 크기 변화 대응.
 *
 * 안드로이드는 주소창 접힘·회전·분할 화면·자유 창·폴더블·IME 로 창 크기가 수시로 변한다.
 * 진입 시점에 한 번 계산해 고정하는 구현은 반드시 깨진다 →
 * **모든 레이아웃 값은 변화 시점에 재계산하고 캐시하지 않는다.**
 *
 * 크기 판단은 `visualViewport` 기준이다. `window.innerWidth/Height` 는 주소창·키보드 상태를
 * 반영하지 않는다 (실측: 915×412 뷰포트에서 visualViewport 는 900×397).
 */

import { RESIZE, VIDEO_ASPECT, ULTRA_WIDE_HYSTERESIS } from '../constants/device';
import { debounce, type Disposer } from './observe';

export type ViewportSize = { width: number; height: number; ratio: number };

/** visualViewport 를 우선 쓰고, 없으면 innerWidth/Height 로 폴백한다. */
export function readViewport(): ViewportSize {
  const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
  const width = vv?.width ?? window.innerWidth;
  const height = vv?.height ?? window.innerHeight;
  return { width, height, ratio: height > 0 ? width / height : 0 };
}

/**
 * FR-10 채팅 폭 비율. `chatRatio = 1 - (16/9) / (W/H)`
 * 19.5:9 → 0.1795, 20:9 → 0.2, 21:9 → 0.2381, 18:9 → 0.1111
 * 비율이 16:9 이하면 남는 폭이 없으므로 0 을 돌려준다.
 */
export function computeChatRatio(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 0;
  const ratio = width / height;
  if (ratio <= VIDEO_ASPECT) return 0;
  return 1 - VIDEO_ASPECT / ratio;
}

/**
 * 계산된 채팅 폭(px).
 * 반올림한다 — 실측 검증값이 반올림 기준이다 (915×412 → 182.56 → **183**, 2340×1080 → 420).
 * 내림하면 여백이 1px 남고, 올림하면 영상이 그만큼 줄어들 뿐 가로 스크롤은 생기지 않는다.
 */
export function computeChatWidthPx(width: number, height: number): number {
  return Math.round(width * computeChatRatio(width, height));
}

/**
 * ⚠️ `video` 요소의 rect 는 컨테이너 크기이고 실제 그림 크기가 아니다.
 * 실제 화면은 `min(w, h × 16/9)` 로 계산해야 한다.
 * 이 구분을 놓치면 "여백 없음"을 잘못 판정한다.
 */
export function pictureSize(
  containerW: number,
  containerH: number,
): { width: number; height: number; letterbox: number; pillarbox: number } {
  if (containerW <= 0 || containerH <= 0) {
    return { width: 0, height: 0, letterbox: 0, pillarbox: 0 };
  }
  const width = Math.min(containerW, containerH * VIDEO_ASPECT);
  const height = Math.min(containerH, containerW / VIDEO_ASPECT);
  return {
    width,
    height,
    /** 위아래 남는 총 높이 */
    letterbox: containerH - height,
    /** 좌우 남는 총 폭 */
    pillarbox: containerW - width,
  };
}

/**
 * FR-10 적용 여부를 히스테리시스로 판정한다.
 * 임계(16:9 = 1.778) 근처를 오갈 때 켜짐/꺼짐이 반복되면 화면이 깜빡인다
 * → 적용 1.80 / 해제 1.76 으로 벌려 둔다.
 */
export function shouldApplyUltraWide(ratio: number, currentlyApplied: boolean): boolean {
  if (currentlyApplied) return ratio >= ULTRA_WIDE_HYSTERESIS.releaseBelow;
  return ratio >= ULTRA_WIDE_HYSTERESIS.applyAbove;
}

/**
 * IME(소프트 키보드) 추정. 폭은 그대로인데 높이만 급감하면 키보드로 본다.
 * 이 경우 레이아웃을 재배치하지 않는다 — 채팅 입력 중 화면이 튀면 입력을 방해한다.
 */
export function looksLikeKeyboard(prev: ViewportSize, next: ViewportSize): boolean {
  if (prev.height <= 0) return false;
  const widthUnchanged = Math.abs(next.width - prev.width) <= 2;
  const heightDropRatio = (prev.height - next.height) / prev.height;
  return widthUnchanged && heightDropRatio >= 0.2;
}

export type ViewportChange = {
  size: ViewportSize;
  previous: ViewportSize;
  /** IME 로 추정되는 변화. true 면 폭·슬롯 배치를 유지해야 한다. */
  keyboardLikely: boolean;
};

/**
 * 크기 변화를 구독한다. 하나의 신호만 쓰지 않는다 (FR-12.1).
 * - visualViewport 의 resize · scroll — 주소창 접힘까지 잡아내는 유일한 신호
 * - window 의 resize · orientationchange
 * - matchMedia('(orientation: landscape)') 의 change
 * - 선택적으로 대상 컨테이너의 ResizeObserver — 창은 그대로인데 치지직이 레이아웃을 바꾸는 경우
 */
export function onViewportChange(
  callback: (change: ViewportChange) => void,
  { relaxed = false, observeElements = [] as Element[] } = {},
): Disposer {
  let previous = readViewport();

  const run = debounce(
    () => {
      const size = readViewport();
      const keyboardLikely = looksLikeKeyboard(previous, size);
      const change: ViewportChange = { size, previous, keyboardLikely };
      previous = size;
      callback(change);
    },
    relaxed ? RESIZE.debounceMsRelaxed : RESIZE.debounceMs,
  );

  const handler = () => run();

  const vv = window.visualViewport;
  vv?.addEventListener('resize', handler);
  vv?.addEventListener('scroll', handler);
  window.addEventListener('resize', handler);
  window.addEventListener('orientationchange', handler);

  const orientation = window.matchMedia('(orientation: landscape)');
  orientation.addEventListener('change', handler);

  const resizeObserver =
    observeElements.length > 0 && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(handler)
      : undefined;
  observeElements.forEach((el) => resizeObserver?.observe(el));

  return () => {
    run.cancel();
    vv?.removeEventListener('resize', handler);
    vv?.removeEventListener('scroll', handler);
    window.removeEventListener('resize', handler);
    window.removeEventListener('orientationchange', handler);
    orientation.removeEventListener('change', handler);
    resizeObserver?.disconnect();
  };
}
