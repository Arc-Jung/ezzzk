/**
 * 검은 화면 재생 실패 재시도.
 *
 * 🔴 사용자 보고 (2026-08-23): "싱글 방송 요청 할 때도 가끔 실패해서 검은 화면만 뜰 때가 있다."
 *
 * 판정 신호: `video` 요소는 붙었지만 **스트림 데이터를 한 번도 받지 못했다**
 * (`readyState < HAVE_CURRENT_DATA` 이고 `currentTime` 이 계속 0). 이 상태가 일정 시간
 * 이어지면 `video.load()` 로 소스를 다시 물려 재요청하고 재생을 다시 시도한다.
 *
 * ⚠️ 이미 데이터를 한 번이라도 받은 뒤 사용자가 직접 멈춘 경우까지 되살리면 안 된다 —
 * 그런 경우는 `currentTime > 0` 이거나 `readyState` 가 이미 올라가 있으므로 이 판정에
 * 걸리지 않는다. `volume.ts` 의 "막힌 자동재생" 폴백(재생 버튼을 대신 누름)과는 겨냥하는
 * 증상이 다르다 — 그쪽은 정책 때문에 **재생이 멈춘** 경우이고, 이 기능은 **스트림 자체가
 * 붙지 못한** 경우다. 둘 다 켜져 있어도 서로 다른 조건이라 부딪히지 않는다.
 */

import { hasPlayer } from '../pageType';
import { qs } from '../utils/dom';
import { info, warning } from '../utils/log';
import { observe } from '../utils/observe';
import type { Feature } from './types';

/** HTMLMediaElement.HAVE_CURRENT_DATA. jsdom 에는 이 상수가 없어 숫자로 직접 쓴다. */
const HAVE_CURRENT_DATA = 2;

/** `video` 가 붙은 뒤 이 시간 안에 데이터가 하나도 안 오면 멈춘 것으로 본다. */
export const STALL_CHECK_DELAY_MS = 8_000;

/** 복구 시도 뒤 다시 판정하기까지의 간격. */
export const STALL_RECHECK_DELAY_MS = 6_000;

/** 복구 시도 상한. 방송이 실제로 끝났거나 오류인 상황에서 무한히 재시도하지 않는다. */
export const MAX_STALL_RECOVERY_ATTEMPTS = 2;

export type StallableVideo = {
  readyState: number;
  currentTime: number;
  ended: boolean;
};

/** 순수 판정 함수 — 유닛 테스트가 직접 검증한다. */
export function isPlaybackStalled(video: StallableVideo): boolean {
  if (video.ended) return false;
  // 조금이라도 재생이 진행된 적 있으면(되감기 포함) 멈춘 게 아니다.
  if (video.currentTime > 0) return false;
  return video.readyState < HAVE_CURRENT_DATA;
}

export const playbackStallFeature: Feature = {
  id: 'playbackStall',
  watches: [],
  supports: (ctx) => hasPlayer(ctx.page.type),
  start: () => {
    let disposed = false;
    let video: HTMLVideoElement | null = null;
    let recoveryAttempts = 0;
    let checkTimer: ReturnType<typeof setTimeout> | undefined;

    const clearCheckTimer = () => {
      if (checkTimer !== undefined) clearTimeout(checkTimer);
      checkTimer = undefined;
    };

    const scheduleCheck = (delayMs: number) => {
      clearCheckTimer();
      checkTimer = setTimeout(check, delayMs);
    };

    function check(): void {
      if (disposed || !video) return;
      if (!isPlaybackStalled(video)) {
        recoveryAttempts = 0;
        return;
      }
      if (recoveryAttempts >= MAX_STALL_RECOVERY_ATTEMPTS) {
        warning(
          `playback stalled after ${MAX_STALL_RECOVERY_ATTEMPTS} recovery attempts ` +
            `(readyState=${video.readyState})`,
        );
        return;
      }
      recoveryAttempts += 1;
      info(
        `playback stalled (readyState=${video.readyState}); recovering ` +
          `(${recoveryAttempts}/${MAX_STALL_RECOVERY_ATTEMPTS})`,
      );
      try {
        video.load();
      } catch (e) {
        warning('video.load() failed during stall recovery', e);
      }
      void video.play()?.catch?.(() => undefined);
      scheduleCheck(STALL_RECHECK_DELAY_MS);
    }

    const attach = (el: HTMLVideoElement) => {
      if (video === el) return;
      video = el;
      recoveryAttempts = 0;
      scheduleCheck(STALL_CHECK_DELAY_MS);
    };

    const findAndAttach = () => {
      const el = qs<HTMLVideoElement>('video');
      if (el) attach(el);
    };

    findAndAttach();
    // 리렌더로 `video` 가 통째로 교체될 수 있다 (`hostPlayer.ts` 와 같은 이유).
    const stopObserve = observe(document.body, findAndAttach, { debounceMs: 300 });

    return () => {
      disposed = true;
      clearCheckTimer();
      stopObserve();
    };
  },
};
