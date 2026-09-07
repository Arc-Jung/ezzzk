/**
 * 방송 재개 감시 (`liveResume.ts`) 검증. 계획: `docs/live-resume-plan.md`.
 *
 * 이 기능의 위험은 **새로고침 루프** 하나로 모인다. `status: OPEN` 인데 페이지가 계속
 * 종료 화면이면 1분마다 영원히 새로고침한다. 그래서 상한·저장소 왕복·실패 경로를
 * 전부 여기서 고정한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../constants/storage';
import { decideDevice } from '../device';
import {
  FAST_POLL_COUNT,
  LIVE_RESUME_STORAGE_KEY,
  MAX_RELOADS,
  POLL_INTERVAL_MS,
  SLOW_POLL_INTERVAL_MS,
  pollIntervalFor,
  RELOAD_WINDOW_MS,
  SETTLE_MS,
  liveResumeFeature,
  parseLiveStatus,
  readReloadState,
  shouldReload,
} from './liveResume';
import type { FeatureContext } from './types';

describe('parseLiveStatus — 응답 스키마', () => {
  it('실측 응답에서 OPEN/CLOSE 를 읽는다', () => {
    // 실측 2026-09-06: polling/v3/channels/{id}/live-status
    expect(parseLiveStatus({ code: 200, content: { status: 'OPEN', liveTitle: '켠왕' } })).toBe(
      'OPEN',
    );
    expect(parseLiveStatus({ code: 200, content: { status: 'CLOSE' } })).toBe('CLOSE');
  });

  /**
   * 🔴 스키마가 바뀌었을 때 조용히 CLOSE 로 굳으면 기능이 죽은 채로 영원히 폴링만 한다.
   * 모르는 모양은 UNKNOWN 이어야 호출부가 경고를 남긴다.
   */
  it('모르는 모양은 CLOSE 가 아니라 UNKNOWN 이다', () => {
    expect(parseLiveStatus(null)).toBe('UNKNOWN');
    expect(parseLiveStatus({})).toBe('UNKNOWN');
    expect(parseLiveStatus({ content: null })).toBe('UNKNOWN');
    expect(parseLiveStatus({ content: {} })).toBe('UNKNOWN');
    expect(parseLiveStatus({ content: { status: 'STANDBY' } })).toBe('UNKNOWN');
    expect(parseLiveStatus({ status: 'OPEN' })).toBe('UNKNOWN');
    expect(parseLiveStatus('OPEN')).toBe('UNKNOWN');
  });
});

describe('readReloadState — sessionStorage 왕복', () => {
  const NOW = 1_000_000;

  it('값이 없으면 0회부터 시작한다', () => {
    expect(readReloadState(null, 'ch1', NOW)).toEqual({ channelId: 'ch1', count: 0, at: NOW });
  });

  it('깨진 JSON 은 없는 것으로 본다 (던지지 않는다)', () => {
    expect(readReloadState('{not json', 'ch1', NOW).count).toBe(0);
  });

  it('다른 채널의 카운터는 물려받지 않는다', () => {
    const other = JSON.stringify({ channelId: 'ch2', count: 3, at: NOW });
    expect(readReloadState(other, 'ch1', NOW).count).toBe(0);
  });

  /** 켰다 껐다를 반복하는 채널에서 옛 카운터가 남아 정상 동작을 막지 않아야 한다. */
  it('유효 시간이 지난 카운터는 버린다', () => {
    const stale = JSON.stringify({ channelId: 'ch1', count: 3, at: NOW });
    expect(readReloadState(stale, 'ch1', NOW + RELOAD_WINDOW_MS + 1).count).toBe(0);
    expect(readReloadState(stale, 'ch1', NOW + RELOAD_WINDOW_MS - 1).count).toBe(3);
  });

  it('숫자가 아닌 필드는 없는 것으로 본다', () => {
    const bad = JSON.stringify({ channelId: 'ch1', count: '3', at: NOW });
    expect(readReloadState(bad, 'ch1', NOW).count).toBe(0);
  });
});

describe('pollIntervalFor — 확인 주기 백오프', () => {
  it('처음 10회는 1분 간격이다', () => {
    for (let done = 0; done < FAST_POLL_COUNT; done += 1) {
      expect(pollIntervalFor(done)).toBe(POLL_INTERVAL_MS);
    }
  });

  it('10회를 채우면 10분 간격으로 늦춘다', () => {
    expect(pollIntervalFor(FAST_POLL_COUNT)).toBe(SLOW_POLL_INTERVAL_MS);
    expect(pollIntervalFor(FAST_POLL_COUNT + 50)).toBe(SLOW_POLL_INTERVAL_MS);
  });

  it('느슨한 주기가 촘촘한 주기보다 실제로 길다 (값을 뒤집어 적는 사고 방지)', () => {
    expect(SLOW_POLL_INTERVAL_MS).toBeGreaterThan(POLL_INTERVAL_MS);
  });
});

describe('shouldReload — 새로고침 상한', () => {
  const state = (count: number) => ({ channelId: 'ch1', count, at: Date.now() });

  it('OPEN 이 아니면 절대 새로고침하지 않는다', () => {
    expect(shouldReload('CLOSE', state(0))).toBe(false);
    expect(shouldReload('UNKNOWN', state(0))).toBe(false);
  });

  it('상한까지는 허용하고 넘으면 멈춘다', () => {
    expect(shouldReload('OPEN', state(MAX_RELOADS - 1))).toBe(true);
    expect(shouldReload('OPEN', state(MAX_RELOADS))).toBe(false);
    expect(shouldReload('OPEN', state(MAX_RELOADS + 1))).toBe(false);
  });
});

/**
 * 기능 본체. `location.reload` 와 `fetch` 만 대체하고 나머지는 실제 코드를 그대로 돌린다
 * (모킹 최소화 — CLAUDE.md).
 */
describe('liveResumeFeature', () => {
  let reloads: number;
  let fetchMock: ReturnType<typeof vi.fn>;

  const ctx = (overrides: Partial<FeatureContext> = {}): FeatureContext => ({
    page: { type: 'live', channelId: 'ch1', videoNo: null, isSlotFrame: false },
    device: decideDevice('desktop'),
    settings: { ...DEFAULT_SETTINGS, liveResume: { enabled: true } },
    ...overrides,
  });

  /** 응답 본문을 순서대로 돌려준다. 마지막 값은 계속 반복된다. */
  const respondWith = (...statuses: string[]) => {
    let index = 0;
    fetchMock.mockImplementation(() => {
      const status = statuses[Math.min(index, statuses.length - 1)];
      index += 1;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ code: 200, content: { status } }),
      });
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    sessionStorage.clear();
    reloads = 0;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // jsdom 의 location.reload 는 "Not implemented" 를 던진다 — 호출 횟수만 센다.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        reload: () => {
          reloads += 1;
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    sessionStorage.clear();
    document.body.innerHTML = '';
  });

  describe('supports', () => {
    it('설정이 꺼져 있으면 돌지 않는다 (기본값이 꺼짐이다)', () => {
      expect(DEFAULT_SETTINGS.liveResume.enabled).toBe(false);
      expect(liveResumeFeature.supports(ctx({ settings: DEFAULT_SETTINGS }))).toBe(false);
    });

    it('켜면 라이브 페이지에서 돈다', () => {
      expect(liveResumeFeature.supports(ctx())).toBe(true);
    });

    it('VOD·기타 페이지에서는 돌지 않는다', () => {
      for (const type of ['vod', 'other', 'mobile-web', 'unsupported'] as const) {
        const page = { type, channelId: 'ch1', videoNo: null, isSlotFrame: false };
        expect(liveResumeFeature.supports(ctx({ page }))).toBe(false);
      }
    });

    /** 🔴 슬롯이 제멋대로 리로드되면 멀티뷰 무대가 통째로 깨진다. */
    it('멀티뷰 슬롯 프레임에서는 돌지 않는다', () => {
      const page = { type: 'live' as const, channelId: 'ch1', videoNo: null, isSlotFrame: true };
      expect(liveResumeFeature.supports(ctx({ page }))).toBe(false);
    });
  });

  /**
   * 🔴 방송중 페이지에서 폴링이 돌면 모든 시청 세션이 1분마다 불필요한 요청을 낸다.
   * 플레이어가 있으면 즉시 감시를 끝내야 한다.
   */
  it('플레이어가 이미 있으면 상태를 조회하지도 않는다', async () => {
    document.body.innerHTML = '<div id="live_player_layout"><video></video></div>';
    const dispose = liveResumeFeature.start(ctx());

    await vi.advanceTimersByTimeAsync(SETTLE_MS + 10);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(reloads).toBe(0);
    dispose?.();
  });

  it('로딩 중(SETTLE_MS 이전)에는 아무것도 하지 않는다', async () => {
    respondWith('CLOSE');
    const dispose = liveResumeFeature.start(ctx());

    await vi.advanceTimersByTimeAsync(SETTLE_MS - 100);

    expect(fetchMock).not.toHaveBeenCalled();
    dispose?.();
  });

  it('종료 화면이면 처음 10회를 1분 주기로 확인한다', async () => {
    respondWith('CLOSE');
    const dispose = liveResumeFeature.start(ctx());

    await vi.advanceTimersByTimeAsync(SETTLE_MS + 10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/channels/ch1/live-status');

    for (let done = 1; done < FAST_POLL_COUNT; done += 1) {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      expect(fetchMock).toHaveBeenCalledTimes(done + 1);
    }

    // 확인만 했을 뿐 새로고침은 없다 — 주기마다 새로고침하지 않는다는 것이 이 기능의 핵심이다.
    expect(reloads).toBe(0);
    dispose?.();
  });

  /**
   * 🔴 백오프가 안 걸리면 종료된 방송을 켜 둔 탭이 하루에 1,440번 요청한다.
   * 10회를 채운 뒤에는 1분이 지나도 조용해야 한다.
   */
  it('10회를 채우면 10분 간격으로 늦춘다', async () => {
    respondWith('CLOSE');
    const dispose = liveResumeFeature.start(ctx());

    await vi.advanceTimersByTimeAsync(SETTLE_MS + 10);
    for (let done = 1; done < FAST_POLL_COUNT; done += 1) {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    }
    expect(fetchMock).toHaveBeenCalledTimes(FAST_POLL_COUNT);

    // 1분이 더 지나도 아직이다.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(FAST_POLL_COUNT);

    // 10분을 채우면 그때 한 번.
    await vi.advanceTimersByTimeAsync(SLOW_POLL_INTERVAL_MS - POLL_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(FAST_POLL_COUNT + 1);
    expect(reloads).toBe(0);
    dispose?.();
  });

  it('OPEN 으로 바뀌면 그때 한 번 새로고침한다', async () => {
    respondWith('CLOSE', 'OPEN');
    const dispose = liveResumeFeature.start(ctx());

    await vi.advanceTimersByTimeAsync(SETTLE_MS + 10);
    expect(reloads).toBe(0);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(reloads).toBe(1);
    dispose?.();
  });

  /**
   * 🔴 이 기능의 유일한 심각 위험. OPEN 인데 페이지가 계속 종료 화면이면 영원히
   * 새로고침한다. 새로고침이 실제로 일어나지 않는 테스트 환경에서 재시작을 반복해
   * 상한이 실제로 멈추는지 본다.
   */
  it('새로고침해도 종료 화면이면 상한에서 멈춘다', async () => {
    respondWith('OPEN');

    for (let attempt = 0; attempt < MAX_RELOADS + 2; attempt += 1) {
      const dispose = liveResumeFeature.start(ctx());
      await vi.advanceTimersByTimeAsync(SETTLE_MS + 10);
      dispose?.();
    }

    expect(reloads).toBe(MAX_RELOADS);
  });

  it('플레이어가 붙으면 상한 카운터를 지운다', async () => {
    sessionStorage.setItem(
      LIVE_RESUME_STORAGE_KEY,
      JSON.stringify({ channelId: 'ch1', count: 2, at: Date.now() }),
    );
    document.body.innerHTML = '<div id="live_player_layout"></div>';

    const dispose = liveResumeFeature.start(ctx());
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 10);

    expect(sessionStorage.getItem(LIVE_RESUME_STORAGE_KEY)).toBeNull();
    dispose?.();
  });

  /**
   * 🔴 요청이 던지면 다음 주기를 예약하는 코드에 닿지 못해 폴링이 영원히 멈춘다.
   * 네트워크가 한 번 끊긴 것만으로 기능이 죽으면 안 된다.
   */
  it('요청이 실패해도 다음 주기를 계속 돈다', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const dispose = liveResumeFeature.start(ctx());

    await vi.advanceTimersByTimeAsync(SETTLE_MS + 10);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reloads).toBe(0);
    dispose?.();
  });

  it('HTTP 오류 응답도 같은 방식으로 넘긴다', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) });
    const dispose = liveResumeFeature.start(ctx());

    await vi.advanceTimersByTimeAsync(SETTLE_MS + 10);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reloads).toBe(0);
    dispose?.();
  });

  it('정리하면 타이머가 남지 않는다', async () => {
    respondWith('CLOSE');
    const dispose = liveResumeFeature.start(ctx());
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 10);

    dispose?.();
    const before = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);

    expect(fetchMock.mock.calls.length).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
  });
});
