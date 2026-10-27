import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../constants/storage';
import { ChatSubtitleOptions } from './ChatSubtitleOptions';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement('div');
document.body.appendChild(host);
const root = createRoot(host);
afterEach(() => act(() => root.render(null)));

describe('자막형 채팅 설정', () => {
  it('켜기·줄 수 변경을 즉시 반영하고 자막 설정만 초기화한다', () => {
    let latest: Settings = DEFAULT_SETTINGS;
    function Harness() {
      const [settings, setSettings] = useState(DEFAULT_SETTINGS);
      latest = settings;
      return (
        <ChatSubtitleOptions
          settings={settings}
          update={(patch) => setSettings((old) => ({ ...old, ...patch }))}
        />
      );
    }
    act(() => root.render(<Harness />));
    const toggle = host.querySelector<HTMLButtonElement>('button[role="switch"]')!;
    act(() => toggle.click());
    expect(latest.chatSubtitle.enabled).toBe(true);
    const select = host.querySelector<HTMLSelectElement>('#cm-subtitle-count')!;
    expect([...select.options].map((option) => option.value)).toEqual(['0', '3', '4', '5', '6']);
    act(() => {
      select.value = '6';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(latest.chatSubtitle.lines).toBe(6);
    const position = host.querySelector<HTMLSelectElement>('#cm-subtitle-position')!;
    expect(position.value).toBe('left');
    for (const value of ['left', 'center', 'right']) {
      act(() => {
        position.value = value;
        position.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(latest.chatSubtitle.position).toBe(value);
      expect(host.querySelector('.cm-subtitle-preview')!.getAttribute('data-position')).toBe(value);
    }
    const background = host.querySelector<HTMLInputElement>(
      'input[aria-label="자막형 채팅 배경색"]',
    )!;
    const opacity = host.querySelector<HTMLInputElement>('input[type="range"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setValue.call(background, '#123456');
      background.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      setValue.call(opacity, '30');
      opacity.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(latest.chatSubtitle.backgroundColor).toBe('#123456');
    expect(latest.chatSubtitle.backgroundOpacity).toBe(30);
    expect(
      host.querySelector<HTMLElement>('.cm-subtitle-preview > div')!.style.backgroundColor,
    ).toBe('rgba(18, 52, 86, 0.3)');
    expect(host.querySelector('[aria-label="자막형 채팅 미리보기"]')).not.toBeNull();
    act(() =>
      host
        .querySelector<HTMLButtonElement>('button[aria-label="자막형 채팅 기본값으로 되돌리기"]')!
        .click(),
    );
    expect(latest.chatSubtitle).toEqual(DEFAULT_SETTINGS.chatSubtitle);
  });
});
