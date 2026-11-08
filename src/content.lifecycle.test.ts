import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from './constants/storage';
const state = vi.hoisted(() => ({
  stop: vi.fn(),
  start: vi.fn(),
  route: vi.fn(),
  viewport: vi.fn(),
  settings: vi.fn(),
}));
vi.mock('./features/registry', () => ({
  FEATURES: [
    {
      id: 'test',
      supports: () => true,
      start: () => {
        state.start();
        return state.stop;
      },
    },
  ],
}));
vi.mock('./storage', () => ({
  loadSettings: vi.fn(async () => DEFAULT_SETTINGS),
  getCachedSettings: () => DEFAULT_SETTINGS,
  onSettingsChanged: () => state.settings,
}));
vi.mock('./utils/index', () => ({
  onRouteChange: () => state.route,
  onViewportChange: () => state.viewport,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
it('BFCache에서는 기능을 유지하고 문서를 버릴 때만 정리한다', async () => {
  vi.stubGlobal('location', new URL('https://chzzk.naver.com/live/' + 'a'.repeat(32)));
  await import('./content');
  await Promise.resolve();
  expect(state.start).toHaveBeenCalledOnce();
  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  expect(state.stop).not.toHaveBeenCalled();
  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
  expect(state.stop).toHaveBeenCalledOnce();
  expect(state.route).toHaveBeenCalledOnce();
  expect(state.viewport).toHaveBeenCalledOnce();
  expect(state.settings).toHaveBeenCalledOnce();
});
