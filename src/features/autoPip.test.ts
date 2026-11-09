import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../constants/storage';
import { decideDevice } from '../device';
import { autoPipFeature, registerAutoPip } from './autoPip';
import type { Disposer, FeatureContext } from './types';

let dispose: Disposer | void;
let handler: (() => void) | null;
let setHandler: ReturnType<typeof vi.fn>;
let video: HTMLVideoElement;
let request: ReturnType<typeof vi.fn>;
let pip: Element | null;
const visible = (element: Element) =>
  vi
    .spyOn(element, 'getBoundingClientRect')
    .mockReturnValue({ width: 640, height: 360 } as DOMRect);
function playable(element: HTMLVideoElement) {
  visible(element);
  for (const [key, value] of Object.entries({
    paused: false,
    ended: false,
    readyState: 4,
    videoWidth: 1280,
  }))
    Object.defineProperty(element, key, { configurable: true, value });
  element.requestPictureInPicture = vi.fn().mockResolvedValue({});
  return element;
}
beforeEach(() => {
  handler = null;
  pip = null;
  document.body.innerHTML =
    '<div id="live_player_layout"><div class="pzp-pc"><video></video></div></div>';
  video = playable(document.querySelector('video')!);
  request = video.requestPictureInPicture as ReturnType<typeof vi.fn>;
  setHandler = vi.fn((_action: string, callback: typeof handler) => {
    handler = callback;
  });
  Object.defineProperty(navigator, 'mediaSession', {
    configurable: true,
    value: { setActionHandler: setHandler },
  });
  Object.defineProperty(document, 'pictureInPictureEnabled', { configurable: true, value: true });
  Object.defineProperty(document, 'pictureInPictureElement', {
    configurable: true,
    get: () => pip,
  });
  Object.defineProperty(document, 'exitPictureInPicture', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  Reflect.deleteProperty(navigator, 'mediaSession');
  for (const key of ['pictureInPictureEnabled', 'pictureInPictureElement', 'exitPictureInPicture'])
    Reflect.deleteProperty(document, key);
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('브라우저 자동 PiP 연동', () => {
  it('기본 꺼짐이며 켠 싱글뷰의 재생 페이지에서만 지원한다', () => {
    const ctx: FeatureContext = {
      settings: DEFAULT_SETTINGS,
      device: decideDevice('auto'),
      page: { type: 'live', channelId: 'a'.repeat(32), videoNo: null, isSlotFrame: false },
    };
    expect(autoPipFeature.supports(ctx)).toBe(false);
    const enabled = { ...ctx, settings: { ...ctx.settings, autoPip: { enabled: true } } };
    expect(autoPipFeature.supports(enabled)).toBe(true);
    expect(autoPipFeature.supports({ ...enabled, page: { ...enabled.page, type: 'vod' } })).toBe(
      true,
    );
    expect(autoPipFeature.supports({ ...enabled, page: { ...enabled.page, type: 'other' } })).toBe(
      false,
    );
    expect(
      autoPipFeature.supports({ ...enabled, page: { ...enabled.page, isSlotFrame: true } }),
    ).toBe(false);
  });
  it('등록만으로 열지 않고 브라우저 액션에서만 요청한다', async () => {
    dispose = registerAutoPip();
    expect(setHandler).toHaveBeenCalledWith('enterpictureinpicture', expect.any(Function));
    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(request).not.toHaveBeenCalled();
    handler!();
    expect(request).toHaveBeenCalledOnce();
    await flush();
  });
  it.each(['paused', 'ended', 'readyState', 'videoWidth', 'disablePictureInPicture'])(
    '%s 상태의 재생 불가 영상은 제외한다',
    (key) => {
      Object.defineProperty(video, key, {
        configurable: true,
        value: ['paused', 'ended', 'disablePictureInPicture'].includes(key) ? true : 0,
      });
      dispose = registerAutoPip();
      handler!();
      expect(request).not.toHaveBeenCalled();
    },
  );
  it('숨겨진 영상·광고·멀티뷰 원본·이미 열린 PiP는 제외한다', async () => {
    dispose = registerAutoPip();
    video.style.visibility = 'hidden';
    handler!();
    video.style.visibility = '';
    const ad = document.createElement('div');
    ad.className = 'ad_info_area';
    visible(ad);
    document.getElementById('live_player_layout')!.append(ad);
    handler!();
    ad.remove();
    const stage = document.createElement('div');
    stage.id = 'cm-multiview-stage';
    document.body.append(stage);
    handler!();
    stage.remove();
    pip = document.createElement('video');
    handler!();
    pip = null;
    expect(request).not.toHaveBeenCalled();
    handler!();
    expect(request).toHaveBeenCalledOnce();
    await flush();
  });
  it('교체된 본방송 영상 중 실제 재생 중인 요소를 찾는다', async () => {
    dispose = registerAutoPip();
    const replacement = playable(document.createElement('video'));
    video.replaceWith(replacement);
    const empty = document.createElement('video');
    replacement.before(empty);
    handler!();
    await flush();
    expect(request).not.toHaveBeenCalled();
    expect(replacement.requestPictureInPicture).toHaveBeenCalledOnce();
  });
  it('요청 중 중복을 막고 거부를 처리하며 무한 재시도하지 않는다', async () => {
    let reject!: (error: Error) => void;
    request.mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    dispose = registerAutoPip();
    handler!();
    handler!();
    expect(request).toHaveBeenCalledOnce();
    reject(new Error('not allowed'));
    await flush();
    window.dispatchEvent(new Event('focus'));
    expect(request).toHaveBeenCalledOnce();
    handler!();
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('API·액션 미지원 시 재생에 영향을 주지 않는다', () => {
    Object.defineProperty(document, 'pictureInPictureEnabled', {
      configurable: true,
      value: false,
    });
    expect(registerAutoPip()).toBeUndefined();
    expect(setHandler).not.toHaveBeenCalled();
    Object.defineProperty(document, 'pictureInPictureEnabled', { configurable: true, value: true });
    setHandler.mockImplementation(() => {
      throw new TypeError('unsupported action');
    });
    expect(registerAutoPip()).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  });
  it('끄면 등록 해제하고 이미 열린 PiP나 영상 속성은 변경하지 않는다', async () => {
    dispose = registerAutoPip();
    const previous = handler!;
    pip = video;
    dispose?.();
    dispose = undefined;
    expect(setHandler).toHaveBeenLastCalledWith('enterpictureinpicture', null);
    previous();
    expect(request).not.toHaveBeenCalled();
    expect(document.exitPictureInPicture).not.toHaveBeenCalled();
    expect(video.hasAttribute('disablepictureinpicture')).toBe(false);
    await flush();
  });
  it('설정을 끈 뒤 늦게 승인된 요청만 취소한다', async () => {
    let finish!: (value: unknown) => void;
    request.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    dispose = registerAutoPip();
    handler!();
    dispose?.();
    dispose = undefined;
    pip = video;
    finish({});
    await flush();
    expect(document.exitPictureInPicture).toHaveBeenCalledOnce();
  });
});
