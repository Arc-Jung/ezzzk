/**
 * FR-14 호스트 플레이어 정지 테스트.
 *
 * 🔴 회귀 고정 — 멀티뷰가 열려도 뒤의 원본 플레이어가 계속 재생돼 같은 방송이 두 번 나왔다
 * (2026-08-15 사용자 보고). 해제 시 원래 `paused`·`muted` 로 되돌아가는지도 함께 고정한다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureHostState, hostRestoreActions, suspendHostPlayer } from './hostPlayer';

/** 실제 DOM 구조를 그대로 만든다 — 셀렉터(`#live_player_layout video`)까지 함께 검증하기 위함. */
function mountHostPlayer({ paused, muted }: { paused: boolean; muted: boolean }): HTMLVideoElement {
  document.body.innerHTML = '<div id="live_player_layout"><video></video></div>';
  const video = document.querySelector('video') as HTMLVideoElement;
  // jsdom 은 재생을 구현하지 않으므로 `paused` 를 직접 정의한다.
  let isPaused = paused;
  Object.defineProperty(video, 'paused', {
    configurable: true,
    get: () => isPaused,
  });
  Object.defineProperty(video, 'pause', {
    configurable: true,
    value: () => {
      isPaused = true;
    },
  });
  Object.defineProperty(video, 'play', {
    configurable: true,
    value: () => {
      isPaused = false;
      return Promise.resolve();
    },
  });
  video.muted = muted;
  return video;
}

/** 클릭·키 입력 직후의 일시적 사용자 활성화. jsdom 에는 없으므로 심는다. */
function setUserActivation(isActive: boolean): void {
  Object.defineProperty(navigator, 'userActivation', {
    configurable: true,
    value: { isActive, hasBeenActive: isActive },
  });
}

afterEach(() => {
  document.body.innerHTML = '';
  Reflect.deleteProperty(navigator, 'userActivation');
});

describe('captureHostState / hostRestoreActions', () => {
  it('재생 중이던 플레이어는 원복 시 다시 재생한다', () => {
    const saved = { paused: false, muted: false };
    expect(hostRestoreActions(saved)).toEqual({ shouldPlay: true, muted: false });
  });

  it('원래 음소거였다면 원복 후에도 음소거를 유지한다', () => {
    expect(hostRestoreActions({ paused: false, muted: true })).toEqual({
      shouldPlay: true,
      muted: true,
    });
  });

  it('원래 멈춰 있었다면 원복이 재생을 시작하지 않는다', () => {
    expect(hostRestoreActions({ paused: true, muted: false })).toEqual({
      shouldPlay: false,
      muted: false,
    });
  });

  it('현재 상태를 그대로 스냅샷한다', () => {
    const video = mountHostPlayer({ paused: false, muted: true });
    expect(captureHostState(video)).toEqual({ paused: false, muted: true });
  });
});

describe('suspendHostPlayer', () => {
  it('멀티뷰 활성 시 호스트 플레이어를 정지하고 음소거한다', () => {
    const video = mountHostPlayer({ paused: false, muted: false });
    const resume = suspendHostPlayer({ isSlotFrame: false });
    expect(video.paused).toBe(true);
    expect(video.muted).toBe(true);
    resume();
  });

  it('플레이어가 스스로 다시 재생하면 즉시 다시 멈춘다', () => {
    const video = mountHostPlayer({ paused: false, muted: false });
    const resume = suspendHostPlayer({ isSlotFrame: false });
    void video.play();
    video.muted = false;
    video.dispatchEvent(new Event('play'));
    expect(video.paused).toBe(true);
    expect(video.muted).toBe(true);
    resume();
  });

  it('해제하면 이전 재생 상태로 되돌린다', () => {
    const video = mountHostPlayer({ paused: false, muted: false });
    const resume = suspendHostPlayer({ isSlotFrame: false });
    resume();
    expect(video.paused).toBe(false);
    expect(video.muted).toBe(false);
  });

  it('원래 음소거였다면 해제해도 음소거를 유지한다', () => {
    const video = mountHostPlayer({ paused: false, muted: true });
    const resume = suspendHostPlayer({ isSlotFrame: false });
    expect(video.muted).toBe(true);
    resume();
    expect(video.paused).toBe(false);
    expect(video.muted).toBe(true);
  });

  it('해제 후에는 재생 감시 리스너가 남지 않는다', () => {
    const video = mountHostPlayer({ paused: false, muted: false });
    const resume = suspendHostPlayer({ isSlotFrame: false });
    resume();
    video.dispatchEvent(new Event('play'));
    // 리스너가 남아 있으면 다시 멈추고 음소거된다.
    expect(video.paused).toBe(false);
    expect(video.muted).toBe(false);
  });

  it('슬롯 프레임에서는 아무 것도 하지 않는다 — 슬롯 영상까지 멈추면 안 된다', () => {
    const video = mountHostPlayer({ paused: false, muted: false });
    const resume = suspendHostPlayer({ isSlotFrame: true });
    expect(video.paused).toBe(false);
    expect(video.muted).toBe(false);
    resume();
    expect(video.paused).toBe(false);
    expect(video.muted).toBe(false);
  });

  it('플레이어가 아직 없으면 나중에 붙을 때 정지한다', async () => {
    document.body.innerHTML = '';
    const resume = suspendHostPlayer({ isSlotFrame: false });
    const video = mountHostPlayer({ paused: false, muted: false });
    // DOM 변화 관찰은 디바운스(500ms)된다.
    await new Promise((done) => setTimeout(done, 700));
    expect(video.paused).toBe(true);
    expect(video.muted).toBe(true);
    resume();
    expect(video.paused).toBe(false);
  });

  it('관찰 대상을 문서 전체가 아니라 플레이어 레이아웃으로 좁힌다 (NFR-04)', () => {
    const video = mountHostPlayer({ paused: false, muted: false });
    const layout = document.getElementById('live_player_layout');
    const observeSpy = vi.spyOn(MutationObserver.prototype, 'observe');

    const resume = suspendHostPlayer({ isSlotFrame: false });

    expect(observeSpy).toHaveBeenCalledTimes(1);
    const target = observeSpy.mock.calls[0]?.[0];
    expect(target).toBe(layout);
    expect(target).not.toBe(document.documentElement);

    observeSpy.mockRestore();
    resume();
    void video;
  });

  it('플레이어 레이아웃이 아직 없으면 body 를 관찰 대상으로 삼는다', () => {
    document.body.innerHTML = '';
    const observeSpy = vi.spyOn(MutationObserver.prototype, 'observe');

    const resume = suspendHostPlayer({ isSlotFrame: false });

    expect(observeSpy).toHaveBeenCalledTimes(1);
    const target = observeSpy.mock.calls[0]?.[0];
    expect(target).toBe(document.body);
    expect(target).not.toBe(document.documentElement);

    observeSpy.mockRestore();
    resume();
  });

  it('relaxObservers 가 켜지면 관찰 디바운스가 늘어난다', async () => {
    document.body.innerHTML = '';
    const resume = suspendHostPlayer({ isSlotFrame: false, relaxed: true });
    const video = mountHostPlayer({ paused: false, muted: false });
    // 기본 디바운스(500ms)만큼만 기다리면 완화된 디바운스(1000ms)에서는 아직 반응하지 않는다.
    await new Promise((done) => setTimeout(done, 700));
    expect(video.paused).toBe(false);
    // 완화된 디바운스까지 채우면 반응한다.
    await new Promise((done) => setTimeout(done, 500));
    expect(video.paused).toBe(true);
    expect(video.muted).toBe(true);
    resume();
  });

  it('N회 넘게 되살아나면 더 이상 pause 하지 않지만 음소거는 유지한다', () => {
    const video = mountHostPlayer({ paused: false, muted: false });
    const resume = suspendHostPlayer({ isSlotFrame: false });

    // 치지직 플레이어가 계속 자체 복구로 재생을 되살리는 상황을 흉내낸다 (무한 핑퐁 방지 확인).
    for (let i = 0; i < 3; i += 1) {
      video.muted = false;
      video.dispatchEvent(new Event('play'));
      expect(video.paused).toBe(true);
      expect(video.muted).toBe(true);
    }

    // 상한(3회)을 넘는 4번째 되살아남부터는 더 이상 pause 하지 않는다.
    void video.play();
    video.muted = false;
    video.dispatchEvent(new Event('play'));
    expect(video.paused).toBe(false);
    expect(video.muted).toBe(true);

    // 포기한 뒤에도 계속 되살아나면 음소거만은 계속 유지한다.
    video.muted = false;
    video.dispatchEvent(new Event('play'));
    expect(video.paused).toBe(false);
    expect(video.muted).toBe(true);

    resume();
  });
});

/**
 * 🔴 사용자 보고 (2026-08-15) 후속 — 사용자가 호스트 플레이어를 **직접** 되살리면
 * 우리와 싸우게 된다. 자체 복구(사용자 활성화 없음)와는 구분해서, 직접 조작에는 물러선다.
 */
describe('suspendHostPlayer — 사용자가 직접 조작하면 물러선다', () => {
  it('(d) 사용자가 직접 재생하면 더 이상 되돌리지 않는다', () => {
    const video = mountHostPlayer({ paused: false, muted: false });
    const resume = suspendHostPlayer({ isSlotFrame: false });
    expect(video.paused).toBe(true);

    setUserActivation(true);
    void video.play();
    video.muted = false;
    video.dispatchEvent(new Event('play'));

    expect(video.paused).toBe(false);
    expect(video.muted).toBe(false);
    resume();
  });

  it('한 번 물러선 뒤에는 계속 되살아나도 다시 멈추지 않는다 (핑퐁 없음)', () => {
    const video = mountHostPlayer({ paused: false, muted: false });
    const resume = suspendHostPlayer({ isSlotFrame: false });

    setUserActivation(true);
    void video.play();
    video.dispatchEvent(new Event('play'));

    // 활성화가 만료된 뒤에도 판단을 뒤집지 않는다.
    setUserActivation(false);
    for (let i = 0; i < 3; i += 1) {
      void video.play();
      video.muted = false;
      video.dispatchEvent(new Event('play'));
      expect(video.paused).toBe(false);
      expect(video.muted).toBe(false);
    }
    resume();
  });

  it('사용자가 직접 음소거를 풀면 다시 음소거하지 않는다', () => {
    const video = mountHostPlayer({ paused: false, muted: false });
    const resume = suspendHostPlayer({ isSlotFrame: false });
    expect(video.muted).toBe(true);

    setUserActivation(true);
    video.muted = false;
    video.dispatchEvent(new Event('volumechange'));

    expect(video.muted).toBe(false);
    // 이후 플레이어가 되살아나도 음소거를 강요하지 않는다.
    video.dispatchEvent(new Event('play'));
    expect(video.muted).toBe(false);
    resume();
  });

  it('사용자 활성화가 없는 음소거 해제는 물러설 이유가 아니다 (자체 복구)', () => {
    const video = mountHostPlayer({ paused: false, muted: false });
    const resume = suspendHostPlayer({ isSlotFrame: false });

    setUserActivation(false);
    video.muted = false;
    video.dispatchEvent(new Event('volumechange'));
    // 자체 복구는 `play` 경로가 평소대로 처리한다.
    video.dispatchEvent(new Event('play'));
    expect(video.paused).toBe(true);
    expect(video.muted).toBe(true);
    resume();
  });

  it('사용자가 만든 상태는 멀티뷰를 해제해도 되돌리지 않는다', () => {
    const video = mountHostPlayer({ paused: false, muted: true });
    const resume = suspendHostPlayer({ isSlotFrame: false });

    setUserActivation(true);
    video.muted = false;
    video.dispatchEvent(new Event('volumechange'));
    void video.play();
    video.dispatchEvent(new Event('play'));

    resume();
    // 스냅샷(muted: true)으로 되돌리면 사용자가 켠 소리를 우리가 다시 끄는 꼴이 된다.
    expect(video.muted).toBe(false);
    expect(video.paused).toBe(false);
  });
});
