import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OURS } from '../constants/class';
import { DEFAULT_SETTINGS } from '../constants/storage';
import { decideDevice } from '../device';
import { keepFullscreenOnReturn } from './fullscreenRestore';
import { registerDoubleTapFullscreen, doubleTapFullscreenFeature } from './doubleTapFullscreen';

let add: ReturnType<typeof vi.spyOn>;
let stop: () => void;
let player: HTMLElement;
let video: HTMLVideoElement;
let fullscreen: Element | null;
let request: ReturnType<typeof vi.fn>;
let exit: ReturnType<typeof vi.fn>;
const input = (type: string, target: Element = video, props: Record<string, unknown> = {}) => {
  const call = add.mock.calls.find((call) => call[0] === type);
  const event = {
    type,
    target,
    isTrusted: true,
    defaultPrevented: false,
    pointerType: 'touch',
    pointerId: 1,
    isPrimary: true,
    clientX: 100,
    clientY: 100,
    preventDefault(this: { defaultPrevented: boolean }) {
      this.defaultPrevented = true;
    },
    stopImmediatePropagation: vi.fn(),
    ...props,
  } as unknown as Event;
  (call![1] as EventListener)(event);
  return event;
};
const tap = (target = video as Element, props: Record<string, unknown> = {}) => {
  input('pointerdown', target, props);
  return input('pointerup', target, props);
};
const doubleTap = (target = video as Element) => {
  tap(target);
  return tap(target);
};
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  document.body.innerHTML =
    '<div class="pzp-pc"><video></video><div class="pzp-pc__bottom"><span>controls</span></div><button>設定</button><div role="dialog"><span>chat</span></div></div>';
  player = document.querySelector('.pzp-pc')!;
  video = document.querySelector('video')!;
  fullscreen = null;
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreen,
  });
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
  Object.defineProperty(document, 'pictureInPictureElement', { configurable: true, value: null });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  vi.stubGlobal('navigator', { userActivation: { isActive: true } });
  const change = (next: Element | null) => {
    fullscreen = next;
    document.dispatchEvent(new Event('fullscreenchange'));
  };
  request = vi.fn(async () => change(player));
  player.requestFullscreen = request;
  Object.defineProperty(document.documentElement, 'requestFullscreen', {
    configurable: true,
    value: vi.fn(async () => change(document.documentElement)),
  });
  exit = vi.fn(async () => change(null));
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
  add = vi.spyOn(document, 'addEventListener');
  stop = registerDoubleTapFullscreen();
});
afterEach(() => {
  stop();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const key of [
    'fullscreenElement',
    'fullscreenEnabled',
    'pictureInPictureElement',
    'visibilityState',
    'exitFullscreen',
  ])
    Reflect.deleteProperty(document, key);
  Reflect.deleteProperty(document.documentElement, 'requestFullscreen');
});

describe('영상 두 번 터치 전체화면', () => {
  it.each(['live', 'vod', 'mobile-web'] as const)(
    '%s에서 설정을 껐을 때는 시작하지 않는다',
    (type) => {
      const context = {
        device: decideDevice('auto'),
        page: { type, isSlotFrame: false, channelId: null, videoNo: null },
        settings: DEFAULT_SETTINGS,
      };
      expect(doubleTapFullscreenFeature.supports(context)).toBe(true);
      expect(
        doubleTapFullscreenFeature.supports({
          ...context,
          settings: { ...DEFAULT_SETTINGS, tripleTapFullscreen: { enabled: false } },
        }),
      ).toBe(false);
      expect(doubleTapFullscreenFeature.watches).toContain('tripleTapFullscreen');
    },
  );
  it('두 번째 터치에서만 진입하고 다음 두 번 터치로 종료한다', async () => {
    tap();
    expect(request).not.toHaveBeenCalled();
    tap();
    expect(request).toHaveBeenCalledWith({ navigationUI: 'hide' });
    await flush();
    doubleTap();
    expect(exit).toHaveBeenCalledOnce();
  });
  it('첫 클릭은 유지하고 두 번째 터치의 click/dblclick은 막는다', () => {
    tap();
    expect(input('click').defaultPrevented).toBe(false);
    tap();
    expect(input('click').defaultPrevented).toBe(true);
    expect(input('dblclick').defaultPrevented).toBe(true);
    expect(request).toHaveBeenCalledOnce();
  });
  it('터치 직후 마우스로 전환해도 마우스 더블클릭을 막지 않는다', () => {
    tap();
    input('pointerdown', video, { pointerType: 'mouse' });
    expect(input('dblclick').defaultPrevented).toBe(false);
    doubleTap();
    expect(request).toHaveBeenCalledOnce();
  });
  it('긴 간격의 두 번 터치는 묶지 않는다', () => {
    tap();
    vi.advanceTimersByTime(351);
    tap();
    expect(request).not.toHaveBeenCalled();
  });
  it('서로 멀리 떨어진 터치는 묶지 않는다', () => {
    tap();
    tap(video, { clientX: 200 });
    expect(request).not.toHaveBeenCalled();
  });
  it('서로 다른 플레이어의 터치는 합치지 않는다', () => {
    tap();
    const other = document.createElement('div');
    other.className = 'pzp-mobile';
    other.innerHTML = '<video></video>';
    document.body.append(other);
    other.requestFullscreen = vi.fn(async () => {});
    const otherVideo = other.querySelector('video')!;
    tap(otherVideo);
    expect(other.requestFullscreen).not.toHaveBeenCalled();
    tap(otherVideo);
    expect(other.requestFullscreen).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
  });
  it.each(['button', '.pzp-pc__bottom span', '[role="dialog"] span'])(
    '%s 조작은 두 번 터치로 보지 않는다',
    (selector) => {
      tap();
      doubleTap(document.querySelector(selector)!);
      tap();
      expect(request).not.toHaveBeenCalled();
    },
  );
  it('화면 밖 터치를 끼우면 연속 입력이 끊긴다', () => {
    tap();
    tap(document.body);
    tap();
    expect(request).not.toHaveBeenCalled();
  });
  it('스와이프와 길게 누르기를 제외한다', () => {
    tap();
    input('pointerdown');
    input('pointermove', video, { clientX: 150 });
    input('pointermove');
    input('pointerup');
    tap();
    expect(request).not.toHaveBeenCalled();
    input('pointerdown');
    vi.advanceTimersByTime(301);
    input('pointerup');
    tap();
    expect(request).not.toHaveBeenCalled();
  });
  it('핀치 중 손가락이 먼저 떨어져도 마지막 손가락을 탭으로 세지 않는다', () => {
    tap();
    input('pointerdown');
    input('pointerdown', video, { pointerId: 2, isPrimary: false });
    input('pointerup', video, { pointerId: 2, isPrimary: false });
    input('pointerup');
    tap();
    expect(request).not.toHaveBeenCalled();
  });
  it('pointercancel 이후에는 새 두 번 터치를 기다린다', () => {
    tap();
    input('pointerdown');
    input('pointercancel');
    tap();
    expect(request).not.toHaveBeenCalled();
  });
  it('페이지가 숨겨지면 이전 터치를 잊는다', () => {
    tap();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    tap();
    expect(request).not.toHaveBeenCalled();
  });
  it('합성 이벤트로 전체화면을 요청하지 않는다', () => {
    for (let i = 0; i < 2; i++) {
      input('pointerdown', video, { isTrusted: false });
      input('pointerup', video, { isTrusted: false });
    }
    expect(request).not.toHaveBeenCalled();
  });
  it('PiP 중에는 전환하지 않는다', () => {
    Object.defineProperty(document, 'pictureInPictureElement', {
      configurable: true,
      value: video,
    });
    doubleTap();
    expect(request).not.toHaveBeenCalled();
  });
  it('권한 거부 후에도 다음 두 번 터치로 다시 요청할 수 있다', async () => {
    request.mockRejectedValueOnce(new TypeError('blocked'));
    doubleTap();
    await flush();
    doubleTap();
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('처리 중인 전체화면 요청을 중복 실행하지 않는다', () => {
    request.mockReturnValueOnce(new Promise(() => {}));
    doubleTap();
    doubleTap();
    expect(request).toHaveBeenCalledOnce();
  });
  it('멀티뷰 슬롯은 부모에게 전체 무대 전환을 요청한다', () => {
    stop();
    add.mockClear();
    stop = registerDoubleTapFullscreen(true);
    const post = vi.spyOn(window.parent, 'postMessage');
    doubleTap();
    expect(post).toHaveBeenCalledWith('cm-double-tap-fullscreen', location.origin);
    expect(request).not.toHaveBeenCalled();
  });
  it('등록된 슬롯의 요청만 부모 전체화면으로 처리한다', async () => {
    const stage = document.createElement('div');
    stage.id = OURS.multiViewStageId;
    const frame = document.createElement('iframe');
    stage.append(frame);
    document.body.append(stage);
    const send = (origin: string, source: Window | null) =>
      window.dispatchEvent(
        new MessageEvent('message', { data: 'cm-double-tap-fullscreen', origin, source }),
      );
    send('https://wrong.example', frame.contentWindow);
    send(location.origin, window);
    expect(document.documentElement.requestFullscreen).not.toHaveBeenCalled();
    send(location.origin, frame.contentWindow);
    expect(document.documentElement.requestFullscreen).toHaveBeenCalledOnce();
    await flush();
    send(location.origin, frame.contentWindow);
    expect(exit).toHaveBeenCalledOnce();
  });
  it('멀티뷰 활성 중 숨겨진 원본 플레이어는 조작하지 않는다', () => {
    const stage = document.createElement('div');
    stage.id = OURS.multiViewStageId;
    document.body.append(stage);
    doubleTap();
    expect(request).not.toHaveBeenCalled();
  });
  it('직접 종료한 뒤 앱으로 돌아와도 전체화면을 다시 켜지 않는다', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const restore = keepFullscreenOnReturn();
    try {
      doubleTap();
      await flush();
      doubleTap();
      await flush();
      window.dispatchEvent(new PageTransitionEvent('pagehide'));
      window.dispatchEvent(new PageTransitionEvent('pageshow'));
      await vi.advanceTimersByTimeAsync(400);
      expect(request).toHaveBeenCalledOnce();
      expect(fullscreen).toBeNull();
    } finally {
      restore();
    }
  });
  it('정리 후에는 입력 리스너가 제거된다', () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    stop();
    expect(
      remove.mock.calls.filter(([type]) =>
        [
          'pointerdown',
          'pointermove',
          'pointerup',
          'pointercancel',
          'click',
          'dblclick',
          'visibilitychange',
          'fullscreenchange',
        ].includes(String(type)),
      ),
    ).toHaveLength(8);
  });
});
