import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keepFullscreenOnReturn } from './fullscreenRestore';

let fullscreen: Element | null;
let hidden: boolean;
let pip: Element | null;
let focused: boolean;
let stop: (() => void) | undefined;
let player: HTMLElement;
let video: HTMLVideoElement;
let request: ReturnType<typeof vi.fn>;
let add: ReturnType<typeof vi.spyOn>;
const change = (element: Element | null) => {
  fullscreen = element;
  document.dispatchEvent(new Event('fullscreenchange'));
};
const visibility = (next: boolean) => {
  hidden = next;
  document.dispatchEvent(new Event('visibilitychange'));
};
const leaveForApp = () => {
  visibility(true);
  change(null);
};
const input = (
  target: Element,
  key?: string,
  trusted = true,
  phase = key ? 'keydown' : 'click',
) => {
  const listener = add.mock.calls.find((call) => call[0] === phase)![1] as EventListener;
  const event = Object.create(key ? KeyboardEvent.prototype : Event.prototype) as Event;
  if (key) Object.defineProperty(event, 'key', { value: key });
  Object.defineProperties(event, {
    isTrusted: { value: trusted },
    target: { value: target },
    type: { value: phase },
  });
  listener(event);
};
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  fullscreen = null;
  hidden = false;
  pip = null;
  Object.defineProperty(document, 'pictureInPictureElement', {
    configurable: true,
    get: () => pip,
  });
  focused = true;
  document.body.innerHTML =
    '<div class="pzp-pc"><video></video><button class="pzp-pc__fullscreen-button">전체화면</button><button>설정</button><textarea></textarea></div>';
  player = document.querySelector('.pzp-pc')!;
  video = document.querySelector('video')!;
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreen,
  });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  request = vi.fn(async () => {
    change(player);
  });
  player.requestFullscreen = request;
  Object.defineProperty(document, 'exitFullscreen', {
    configurable: true,
    value: vi.fn(async () => {
      change(null);
    }),
  });
  vi.stubGlobal('navigator', { userActivation: { isActive: true } });
  add = vi.spyOn(document, 'addEventListener');
  stop = keepFullscreenOnReturn();
});
afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const key of [
    'fullscreenElement',
    'visibilityState',
    'fullscreenEnabled',
    'exitFullscreen',
    'pictureInPictureElement',
  ])
    Reflect.deleteProperty(document, key);
});

describe('전체화면 복귀', () => {
  it('PiP가 열리면 종료 판정을 보류하고 닫기 전까지 전체화면을 요청하지 않는다', async () => {
    change(player);
    change(null);
    pip = video;
    video.dispatchEvent(new Event('enterpictureinpicture'));
    await vi.advanceTimersByTimeAsync(400);
    visibility(true);
    visibility(false);
    window.dispatchEvent(new Event('focus'));
    input(video);
    video.dispatchEvent(new Event('playing'));
    expect(request).not.toHaveBeenCalled();
    pip = null;
    video.dispatchEvent(new Event('leavepictureinpicture'));
    await flush();
    expect(request).toHaveBeenCalledOnce();
  });
  it('전체화면에 들어간 적이 없으면 앱 복귀로 요청하지 않는다', () => {
    visibility(true);
    visibility(false);
    window.dispatchEvent(new Event('focus'));
    expect(request).not.toHaveBeenCalled();
  });
  it('수동 전체화면도 앱 복귀 때 원래 플레이어로 복원한다', async () => {
    change(player);
    leaveForApp();
    expect(request).not.toHaveBeenCalled();
    visibility(false);
    await flush();
    expect(request).toHaveBeenCalledOnce();
    expect(fullscreen).toBe(player);
    expect(video.parentElement).toBe(player);
  });
  it('전체화면 해제가 숨김보다 먼저 와도 유지 의사를 보존한다', async () => {
    change(player);
    change(null);
    await vi.advanceTimersByTimeAsync(100);
    visibility(true);
    await vi.advanceTimersByTimeAsync(300);
    visibility(false);
    await flush();
    expect(fullscreen).toBe(player);
  });
  it('숨김 이벤트 없이 창 포커스가 옮겨가도 복원한다', async () => {
    change(player);
    focused = false;
    window.dispatchEvent(new Event('blur'));
    change(null);
    focused = true;
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(request).toHaveBeenCalledOnce();
  });
  it('같은 문서의 iframe으로 옮겨간 포커스만으로 중복 전체화면을 요청하지 않는다', async () => {
    change(player);
    window.dispatchEvent(new Event('blur'));
    await vi.advanceTimersByTimeAsync(300);
    visibility(true);
    visibility(false);
    expect(request).not.toHaveBeenCalled();
  });
  it('명시적인 종료 입력 없이 해제되면 전체화면을 복원한다', async () => {
    change(player);
    change(null);
    await vi.advanceTimersByTimeAsync(300);
    visibility(true);
    visibility(false);
    expect(request).toHaveBeenCalledOnce();
    expect(fullscreen).toBe(player);
  });
  it('해제 후 250ms 넘게 늦은 앱 전환에서도 복원 의사가 사라지지 않는다', async () => {
    request.mockRejectedValueOnce(new TypeError('User activation required'));
    change(player);
    change(null);
    await vi.advanceTimersByTimeAsync(1200);
    expect(request).toHaveBeenCalledOnce();
    visibility(true);
    await vi.advanceTimersByTimeAsync(5000);
    visibility(false);
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(fullscreen).toBe(player);
  });
  it('복귀 포커스 뒤에 늦게 도착한 해제 이벤트도 복원한다', async () => {
    change(player);
    visibility(true);
    visibility(false);
    window.dispatchEvent(new Event('focus'));
    change(null);
    await vi.advanceTimersByTimeAsync(300);
    expect(fullscreen).toBe(player);
    expect(request).toHaveBeenCalledOnce();
  });
  it.each(['button', 'Escape', 'Escape keyup', 'f'])(
    '명시적 종료 %s를 존중한다',
    async (action) => {
      change(player);
      if (action === 'button') input(document.querySelector('.pzp-pc__fullscreen-button')!);
      else
        input(
          player,
          action === 'Escape keyup' ? 'Escape' : action,
          true,
          action === 'Escape keyup' ? 'keyup' : 'keydown',
        );
      leaveForApp();
      visibility(false);
      await vi.advanceTimersByTimeAsync(300);
      expect(request).not.toHaveBeenCalled();
    },
  );
  it('마우스 더블클릭으로 직접 종료하면 앱 복귀 때도 다시 진입하지 않는다', async () => {
    change(player);
    input(video, undefined, true, 'dblclick');
    change(null);
    await vi.advanceTimersByTimeAsync(300);
    visibility(true);
    visibility(false);
    expect(request).not.toHaveBeenCalled();
  });
  it('차단된 자동 요청을 반복하지 않고 다음 신뢰된 영상 입력에서 복원한다', async () => {
    request.mockRejectedValueOnce(new TypeError('User activation required'));
    change(player);
    leaveForApp();
    visibility(false);
    await flush();
    window.dispatchEvent(new Event('focus'));
    video.dispatchEvent(new Event('playing'));
    input(video, undefined, false);
    input(document.querySelector('textarea')!);
    input(document.querySelectorAll('button')[1]!);
    expect(request).toHaveBeenCalledTimes(1);
    input(video);
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(fullscreen).toBe(player);
  });
  it('복귀 중 교체된 플레이어로 연결하고 재생 요소를 이동하지 않는다', async () => {
    change(player);
    leaveForApp();
    const replacement = player.cloneNode(true) as HTMLElement;
    replacement.requestFullscreen = vi.fn(async () => {
      change(replacement);
    });
    player.replaceWith(replacement);
    visibility(false);
    await flush();
    expect(fullscreen).toBe(replacement);
    expect(replacement.querySelector('video')).not.toBeNull();
  });
  it.each(['최소화', '정리'])('%s 뒤 늦게 승인된 복원 요청도 다시 종료한다', async (action) => {
    let finish!: () => void;
    request.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    change(player);
    leaveForApp();
    visibility(false);
    if (action === '최소화') input(document.querySelector('.pzp-pc__fullscreen-button')!);
    else {
      stop?.();
      stop = undefined;
    }
    change(player);
    finish();
    await flush();
    expect(document.exitFullscreen).toHaveBeenCalledOnce();
    expect(fullscreen).toBeNull();
  });
  it('멀티뷰 루트를 복원하고 슬롯 터치 중계는 소유한 iframe만 허용한다', async () => {
    const stage = document.createElement('div');
    stage.id = 'cm-multiview-stage';
    const frame = document.createElement('iframe');
    stage.append(frame);
    document.body.append(stage);
    const root = vi.fn(async () => {
      change(document.documentElement);
    });
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: root,
    });
    root.mockRejectedValueOnce(new TypeError('Gesture required'));
    try {
      change(document.documentElement);
      leaveForApp();
      visibility(false);
      await flush();
      const message = (source: MessageEventSource | null, origin: string) =>
        window.dispatchEvent(
          new MessageEvent('message', {
            data: 'cm-fullscreen-restore-gesture',
            source,
            origin,
          }),
        );
      message(window, location.origin);
      message(frame.contentWindow, 'https://example.com');
      expect(root).toHaveBeenCalledTimes(1);
      message(frame.contentWindow, location.origin);
      await flush();
      expect(root).toHaveBeenCalledTimes(2);
      expect(stage.firstChild).toBe(frame);
    } finally {
      Reflect.deleteProperty(document.documentElement, 'requestFullscreen');
    }
  });
  it('자식 iframe의 전체화면은 부모가 가로채지 않는다', () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    change(frame);
    leaveForApp();
    visibility(false);
    expect(request).not.toHaveBeenCalled();
  });
  it('BFCache 왕복에서 복귀 의사를 유지하고 정리 뒤 재시도하지 않는다', async () => {
    change(player);
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    change(null);
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    await flush();
    expect(request).toHaveBeenCalledOnce();
    leaveForApp();
    stop?.();
    stop = undefined;
    visibility(false);
    input(video);
    await vi.advanceTimersByTimeAsync(500);
    expect(request).toHaveBeenCalledOnce();
  });
});
