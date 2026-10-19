import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../constants/storage';
import { DEVICE_PROFILES } from '../constants/device';
import type { FeatureContext } from './types';

const ctx: FeatureContext = {
  page: { type: 'live', channelId: 'a'.repeat(32), videoNo: null, isSlotFrame: false },
  settings: { ...DEFAULT_SETTINGS, wideScreen: { enabled: false, mode: 'fullscreen' } },
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
    reason: 'test',
  },
};
let dispose: (() => void) | void;

function player(playing = true) {
  document.body.innerHTML = '<div class="pzp-pc"><video></video><button>설정</button></div>';
  const root = document.querySelector<HTMLElement>('.pzp-pc')!;
  const video = document.querySelector('video')!;
  Object.defineProperty(video, 'paused', { configurable: true, value: !playing });
  Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
  const request = vi.fn().mockResolvedValue(undefined);
  root.requestFullscreen = request;
  return { root, video, request };
}

beforeEach(() => {
  vi.resetModules();
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('autoFullscreen', () => {
  it('전체화면을 선택해야 켜지며 슬롯·홈에서는 실행하지 않는다', async () => {
    const { autoFullscreenFeature: feature } = await import('./autoFullscreen');
    const { request } = player();
    dispose = feature.start({ ...ctx, settings: DEFAULT_SETTINGS });
    expect(request).not.toHaveBeenCalled();
    expect(feature.supports({ ...ctx, page: { ...ctx.page, isSlotFrame: true } })).toBe(false);
    dispose = feature.start({ ...ctx, page: { ...ctx.page, type: 'other' } });
    expect(request).not.toHaveBeenCalled();
    expect(feature.supports(ctx)).toBe(true);
  });

  it('다른 모드를 거쳐 전체화면을 다시 선택하면 새 요청을 허용한다', async () => {
    const { autoFullscreenFeature: feature } = await import('./autoFullscreen');
    const { request } = player();
    dispose = feature.start(ctx);
    await Promise.resolve();
    dispose?.();
    feature.start({ ...ctx, settings: DEFAULT_SETTINGS });
    dispose = feature.start(ctx);
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('홈에 갔다 같은 방송으로 돌아오면 다시 시작한다', async () => {
    const { autoFullscreenFeature: feature } = await import('./autoFullscreen');
    const { request } = player();
    dispose = feature.start(ctx);
    await Promise.resolve();
    dispose?.();
    feature.start({ ...ctx, page: { ...ctx.page, type: 'other' } });
    dispose = feature.start(ctx);
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('재생이 시작되면 한 번 전환하고 재시작·일시정지 해제 후 재진입하지 않는다', async () => {
    const { autoFullscreenFeature: feature } = await import('./autoFullscreen');
    const { video, request } = player(false);
    dispose = feature.start(ctx);
    expect(request).not.toHaveBeenCalled();
    Object.defineProperty(video, 'paused', { configurable: true, value: false });
    video.dispatchEvent(new Event('playing'));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
    dispose?.();
    dispose = feature.start(ctx);
    video.dispatchEvent(new Event('playing'));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('차단되면 무한 재시도하지 않고 신뢰된 영상 클릭에서만 다시 요청한다', async () => {
    const { autoFullscreenFeature: feature } = await import('./autoFullscreen');
    const { video, request } = player();
    request.mockRejectedValueOnce(new TypeError('User activation required'));
    const add = vi.spyOn(document, 'addEventListener');
    Object.defineProperty(navigator, 'userActivation', {
      configurable: true,
      value: { isActive: true },
    });
    dispose = feature.start(ctx);
    await Promise.resolve();
    video.dispatchEvent(new Event('playing'));
    video.click(); // 합성 이벤트는 재시도 대상이 아니다.
    expect(request).toHaveBeenCalledTimes(1);
    const handler = add.mock.calls.find((call) => call[0] === 'click')![1] as EventListener;
    handler({ isTrusted: true, target: document.querySelector('button') } as unknown as Event);
    handler({ isTrusted: true, target: document.body } as unknown as Event);
    expect(request).toHaveBeenCalledTimes(1);
    handler({ isTrusted: true, target: video } as unknown as Event);
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('요청 중 중복 이벤트를 무시하고 종료 후 리스너를 정리한다', async () => {
    const { autoFullscreenFeature: feature } = await import('./autoFullscreen');
    const { video, request } = player();
    request.mockReturnValue(new Promise(() => {}));
    dispose = feature.start(ctx);
    video.dispatchEvent(new Event('playing'));
    expect(request).toHaveBeenCalledTimes(1);
    dispose?.();
    dispose = undefined;
    video.dispatchEvent(new Event('playing'));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('기존 전체화면과 멀티뷰 원본을 덮어쓰지 않는다', async () => {
    const { autoFullscreenFeature: feature } = await import('./autoFullscreen');
    const { request } = player();
    const stage = document.createElement('div');
    stage.id = 'cm-multiview-stage';
    document.body.appendChild(stage);
    dispose = feature.start(ctx);
    expect(request).not.toHaveBeenCalled();
    stage.remove();
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: document.body,
    });
    document.querySelector('video')!.dispatchEvent(new Event('playing'));
    expect(request).not.toHaveBeenCalled();
  });
});
