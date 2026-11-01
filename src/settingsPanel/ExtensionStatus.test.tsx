import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ExtensionStatus } from './ExtensionStatus';
let root: Root | null = null;
let host: HTMLElement;
beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
async function render(tag: string | null, failure = false) {
  vi.stubGlobal('chrome', {
    runtime: {
      getManifest: () => ({ version: '0.1.74' }),
      sendMessage: vi.fn(() =>
        failure
          ? Promise.reject(new Error('offline'))
          : Promise.resolve({ release: tag ? { tag, url: 'https://example.com' } : null }),
      ),
    },
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<ExtensionStatus />);
  });
}
describe('설정창 버전과 업데이트 링크', () => {
  it('현재 버전을 즉시 저장 문구 왼쪽에 표시하고 최신 버전 링크를 연다', async () => {
    await render('v0.1.75');
    const text = host.textContent!;
    expect(text.indexOf('v0.1.74')).toBeLessThan(text.indexOf('변경은 즉시 저장됩니다.'));
    const link = host.querySelector('a')!;
    expect(link.textContent).toContain('업데이트 v0.1.75');
    expect(link.href).toBe('https://github.com/Arc-Jung/ezzzk/releases/tag/v0.1.75');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
  });
  it.each(['v0.1.74', 'v0.1.73', null])(
    '더 최신 버전이 없으면 링크를 표시하지 않는다: %s',
    async (tag) => {
      await render(tag);
      expect(host.querySelector('a')).toBeNull();
      expect(host.textContent).toContain('v0.1.74');
    },
  );
  it('조회 실패해도 버전과 즉시 저장 안내를 유지한다', async () => {
    await render(null, true);
    expect(host.textContent).toContain('v0.1.74');
    expect(host.textContent).toContain('변경은 즉시 저장됩니다.');
    expect(host.querySelector('a')).toBeNull();
  });
});
