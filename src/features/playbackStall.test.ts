/**
 * 검은 화면 재생 실패 재시도 테스트.
 *
 * 🔴 사용자 보고 (2026-08-23): "싱글 방송 요청 할 때도 가끔 실패해서 검은 화면만 뜰 때가 있다."
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEVICE_PROFILES } from '../constants/device';
import { DEFAULT_SETTINGS } from '../constants/storage';
import type { FeatureContext } from './types';
import {
  MAX_STALL_RECOVERY_ATTEMPTS,
  STALL_CHECK_DELAY_MS,
  STALL_RECHECK_DELAY_MS,
  isPlaybackStalled,
  playbackStallFeature,
} from './playbackStall';

describe('isPlaybackStalled', () => {
  it('readyState 가 낮고 재생이 한 번도 진행되지 않았으면 멈춘 것으로 본다', () => {
    expect(isPlaybackStalled({ readyState: 0, currentTime: 0, ended: false })).toBe(true);
    expect(isPlaybackStalled({ readyState: 1, currentTime: 0, ended: false })).toBe(true);
  });

  it('readyState 가 HAVE_CURRENT_DATA(2) 이상이면 멈춘 게 아니다', () => {
    expect(isPlaybackStalled({ readyState: 2, currentTime: 0, ended: false })).toBe(false);
    expect(isPlaybackStalled({ readyState: 4, currentTime: 0, ended: false })).toBe(false);
  });

  it('한 번이라도 재생이 진행됐으면(currentTime > 0) 멈춘 게 아니다 — 사용자가 직접 멈췄을 수 있다', () => {
    expect(isPlaybackStalled({ readyState: 0, currentTime: 12.5, ended: false })).toBe(false);
  });

  it('영상이 끝난 것은 멈춘 게 아니다', () => {
    expect(isPlaybackStalled({ readyState: 0, currentTime: 0, ended: true })).toBe(false);
  });
});

function mountVideo(): HTMLVideoElement {
  document.body.innerHTML = '<div id="live_player_layout"><video></video></div>';
  const video = document.querySelector('video') as HTMLVideoElement;
  let loadCalls = 0;
  let playCalls = 0;
  Object.defineProperty(video, 'load', {
    configurable: true,
    value: () => {
      loadCalls += 1;
    },
  });
  Object.defineProperty(video, 'play', {
    configurable: true,
    value: () => {
      playCalls += 1;
      return Promise.resolve();
    },
  });
  Object.defineProperty(video, '__loadCalls', { get: () => loadCalls });
  Object.defineProperty(video, '__playCalls', { get: () => playCalls });
  return video;
}

const ctx: FeatureContext = {
  page: { type: 'live', channelId: 'a'.repeat(32), videoNo: null, isSlotFrame: false },
  device: {
    deviceClass: 'desktop',
    profile: DEVICE_PROFILES.desktop,
    signals: {
      longSide: 1920,
      shortSide: 1080,
      hasTouch: false,
      canHover: true,
      coarsePointer: false,
      devicePixelRatio: 1,
      uaMobile: null,
    },
    reason: 'test fixture',
  },
  settings: DEFAULT_SETTINGS,
};

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('playbackStallFeature', () => {
  it('데이터가 계속 안 오면 확인 지연 뒤 video.load()·play() 로 복구를 시도한다', () => {
    vi.useFakeTimers();
    const video = mountVideo();
    Object.defineProperty(video, 'readyState', { configurable: true, value: 0 });
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 0 });

    const dispose = playbackStallFeature.start(ctx);
    vi.advanceTimersByTime(STALL_CHECK_DELAY_MS);

    expect((video as unknown as { __loadCalls: number }).__loadCalls).toBe(1);
    expect((video as unknown as { __playCalls: number }).__playCalls).toBe(1);
    dispose?.();
  });

  it('readyState 가 이미 충분하면 아무것도 하지 않는다', () => {
    vi.useFakeTimers();
    const video = mountVideo();
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 30 });

    const dispose = playbackStallFeature.start(ctx);
    vi.advanceTimersByTime(STALL_CHECK_DELAY_MS + STALL_RECHECK_DELAY_MS * 3);

    expect((video as unknown as { __loadCalls: number }).__loadCalls).toBe(0);
    dispose?.();
  });

  it(`${MAX_STALL_RECOVERY_ATTEMPTS}회 재시도해도 안 살아나면 더 시도하지 않는다`, () => {
    vi.useFakeTimers();
    const video = mountVideo();
    Object.defineProperty(video, 'readyState', { configurable: true, value: 0 });
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 0 });

    const dispose = playbackStallFeature.start(ctx);
    // 최초 확인 + 재시도 상한만큼의 재확인을 모두 지나 보낸다.
    vi.advanceTimersByTime(
      STALL_CHECK_DELAY_MS + STALL_RECHECK_DELAY_MS * (MAX_STALL_RECOVERY_ATTEMPTS + 2),
    );

    expect((video as unknown as { __loadCalls: number }).__loadCalls).toBe(
      MAX_STALL_RECOVERY_ATTEMPTS,
    );
    dispose?.();
  });

  it('복구 시도 뒤 데이터가 들어오면 더 이상 재시도하지 않는다', () => {
    vi.useFakeTimers();
    const video = mountVideo();
    Object.defineProperty(video, 'readyState', { configurable: true, value: 0 });
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 0 });

    const dispose = playbackStallFeature.start(ctx);
    vi.advanceTimersByTime(STALL_CHECK_DELAY_MS);
    expect((video as unknown as { __loadCalls: number }).__loadCalls).toBe(1);

    // 복구가 통했다 — 스트림이 붙었다.
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 5 });
    vi.advanceTimersByTime(STALL_RECHECK_DELAY_MS * 3);

    expect((video as unknown as { __loadCalls: number }).__loadCalls).toBe(1);
    dispose?.();
  });

  it('정리하면 더 이상 확인하지 않는다', () => {
    vi.useFakeTimers();
    const video = mountVideo();
    Object.defineProperty(video, 'readyState', { configurable: true, value: 0 });
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 0 });

    const dispose = playbackStallFeature.start(ctx);
    dispose?.();
    vi.advanceTimersByTime(STALL_CHECK_DELAY_MS + STALL_RECHECK_DELAY_MS * 5);

    expect((video as unknown as { __loadCalls: number }).__loadCalls).toBe(0);
  });
});
