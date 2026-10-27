import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../constants/storage';
import { decideDevice } from '../device';
import {
  CHAT_SUBTITLE_BUTTON_ID,
  CHAT_SUBTITLE_STAGE_BUTTON_ID,
  chatSubtitleButtonFeature,
} from './chatSubtitleButton';
import type { FeatureContext } from './types';

const storage = vi.hoisted(() => ({
  current: null as Settings | null,
  listener: null as ((settings: Settings) => void) | null,
  save: vi.fn(),
  unsubscribe: vi.fn(),
}));
vi.mock('../storage', () => ({
  getCachedSettings: () => storage.current,
  saveSettings: (patch: Partial<Settings>) => {
    storage.save(patch);
    storage.current = { ...storage.current!, ...patch };
    storage.listener?.(storage.current);
    return Promise.resolve(storage.current);
  },
  onSettingsChanged: (listener: (settings: Settings) => void) => {
    storage.listener = listener;
    return storage.unsubscribe;
  },
}));
let stop: (() => void) | void;
const context = (): FeatureContext => ({
  settings: storage.current!,
  device: decideDevice('mobile'),
  page: { type: 'live', channelId: 'a'.repeat(32), videoNo: null, isSlotFrame: false },
});
const button = () => document.getElementById(CHAT_SUBTITLE_BUTTON_ID) as HTMLButtonElement;
beforeEach(() => {
  vi.useFakeTimers();
  storage.save.mockClear();
  storage.unsubscribe.mockClear();
  storage.current = {
    ...DEFAULT_SETTINGS,
    chatSubtitle: { ...DEFAULT_SETTINGS.chatSubtitle, position: 'center', backgroundOpacity: 30 },
  };
  document.body.innerHTML =
    '<div class="pzp-pc pzp-pc--controls"><div class="pzp-pc__bottom-buttons-right"></div></div>';
});
afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
});
describe('자막형 채팅 아이콘', () => {
  it('끄기 상태에서도 삽입하고 영상 클릭으로 전파하지 않으며 표시 설정을 유지해 토글한다', () => {
    stop = chatSubtitleButtonFeature.start(context());
    expect(button().querySelector('svg')).not.toBeNull();
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(parseInt(button().style.width)).toBeGreaterThanOrEqual(44);
    const playerClick = vi.fn();
    document.querySelector('.pzp-pc')!.addEventListener('click', playerClick);
    button().click();
    expect(playerClick).not.toHaveBeenCalled();
    expect(button().getAttribute('aria-label')).toBe('자막형 채팅 끄기');
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(storage.current!.chatSubtitle).toMatchObject({
      enabled: true,
      position: 'center',
      backgroundOpacity: 30,
    });
    button().click();
    expect(storage.current!.chatSubtitle.enabled).toBe(false);
    expect(storage.save).toHaveBeenCalledTimes(2);
  });
  it('설정창 변경·컨트롤바 재생성·멀티뷰 진입 시 최신 상태로 동기화하고 정리한다', async () => {
    stop = chatSubtitleButtonFeature.start(context());
    storage.current!.chatSubtitle.enabled = true;
    storage.listener!(storage.current!);
    expect(button().getAttribute('aria-pressed')).toBe('true');
    button().remove();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="cm-multiview-stage"><div class="cm-stage-bar"><button aria-label="이지직 설정 열기"></button></div></div>',
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(button().getAttribute('aria-pressed')).toBe('true');
    const stage = document.getElementById(CHAT_SUBTITLE_STAGE_BUTTON_ID) as HTMLButtonElement;
    expect(stage.getAttribute('aria-pressed')).toBe('true');
    stage.click();
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(stage.getAttribute('aria-pressed')).toBe('false');
    stop?.();
    stop = undefined;
    expect(storage.unsubscribe).toHaveBeenCalled();
    expect(document.getElementById(CHAT_SUBTITLE_STAGE_BUTTON_ID)).toBeNull();
    expect(button()).toBeNull();
  });
  it('VOD와 멀티뷰 슬롯 안에는 중복 버튼을 넣지 않는다', () => {
    expect(chatSubtitleButtonFeature.supports(context())).toBe(true);
    expect(
      chatSubtitleButtonFeature.supports({
        ...context(),
        page: { ...context().page, type: 'vod' },
      }),
    ).toBe(false);
    expect(
      chatSubtitleButtonFeature.supports({
        ...context(),
        page: { ...context().page, isSlotFrame: true },
      }),
    ).toBe(false);
  });
});
