/**
 * 화면 ⑥ 확장 팝업 (FR-09.1) 렌더 검증.
 *
 * 🔴 이 파일이 생기기 전까지 `Popup.tsx` 에는 테스트가 **하나도 없었다.** 그 사이 P3 아이콘
 * 치환에서 삭제 버튼의 `✕` 문자가 그대로 살아남았고, 546줄짜리 레이아웃 개편도 검증 없이
 * 들어갔다. 여기서는 실제로 마운트해 **눌러 볼 수 있는 상태인지**를 본다.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_SETTINGS, STORAGE_KEY } from '../constants/storage';
import { auditIconButtons } from '../ui/iconButtonAudit.test-utils';

declare global {
  // React 18 이 act 지원 환경임을 알리는 표준 플래그. 없으면 경고가 쏟아진다.
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** chrome.storage.local 을 메모리로 대체한다 (chrome API 는 jsdom 에 없다). */
function installFakeChrome(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  const listeners: ((changes: Record<string, { newValue?: unknown }>, area: string) => void)[] = [];

  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async (keys: string[]) => {
          const out: Record<string, unknown> = {};
          for (const key of keys) if (key in store) out[key] = store[key];
          return out;
        }),
        set: vi.fn(async (patch: Record<string, unknown>) => {
          const changes: Record<string, { newValue?: unknown }> = {};
          for (const [key, value] of Object.entries(patch)) {
            store[key] = value;
            changes[key] = { newValue: value };
          }
          listeners.forEach((l) => l(changes, 'local'));
        }),
      },
      onChanged: {
        addListener: vi.fn((l: (typeof listeners)[number]) => listeners.push(l)),
        removeListener: vi.fn((l: (typeof listeners)[number]) => {
          const i = listeners.indexOf(l);
          if (i >= 0) listeners.splice(i, 1);
        }),
      },
    },
  };
  return { store };
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;

/** 팝업을 마운트하고 `useSettings` 의 첫 비동기 로드까지 흘려보낸다. */
async function mountPopup(): Promise<HTMLElement> {
  const { Popup } = await import('./Popup');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<Popup />);
  });
  return host;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  document.body.replaceChildren();
  Reflect.deleteProperty(globalThis as unknown as { chrome?: unknown }, 'chrome');
});

describe('Popup — 마운트', () => {
  it('설정을 읽기 전에는 안내 문구를 보여 준다 (빈 화면이 아니다)', async () => {
    // `get` 이 영원히 답하지 않게 두어 로딩 상태를 고정한다.
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    };
    const el = await mountPopup();
    expect(el.textContent).toContain('설정을 읽는 중');
  });

  it('저장된 설정을 읽고 나면 기능 토글이 그려진다', async () => {
    installFakeChrome({ [STORAGE_KEY]: DEFAULT_SETTINGS });
    const el = await mountPopup();

    expect(el.textContent).not.toContain('설정을 읽는 중');
    expect(el.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThan(0);
  });

  /**
   * 🔴 P3 아이콘 치환 회귀. 삭제 버튼은 `✕` 문자를 SVG 로 바꾸면서 **보이는 텍스트가
   * 사라졌다** — `aria-label` 이 유일한 이름이다. 저장된 조합이 있어야 렌더되므로
   * 픽스처에 하나 넣고 본다.
   */
  it('저장된 조합의 삭제 버튼이 라벨 있는 아이콘 버튼이다', async () => {
    installFakeChrome({
      [STORAGE_KEY]: {
        ...DEFAULT_SETTINGS,
        multiView: {
          ...DEFAULT_SETTINGS.multiView,
          sets: [
            {
              id: 'set-1',
              name: '테스트 조합',
              slots: [{ index: 1, channelId: 'abc', channelName: '로마러' }],
            },
          ],
        },
      },
    });
    const el = await mountPopup();

    const remove = el.querySelector<HTMLButtonElement>('button[aria-label="테스트 조합 삭제"]');
    expect(remove).not.toBeNull();
    expect(remove?.textContent?.trim()).toBe('');
    expect(remove?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();

    // 스테퍼(`−`/`+`)까지 포함해 아이콘 버튼 전수 검사.
    const audit = auditIconButtons(el, { expectAtLeast: 3, context: 'popup' });
    expect(audit.auditedIconButtons).toBeGreaterThanOrEqual(3);
  });

  it('스테퍼의 −/+ 는 문자가 아니라 aria-hidden svg 다', async () => {
    installFakeChrome({ [STORAGE_KEY]: DEFAULT_SETTINGS });
    const el = await mountPopup();

    const steppers = el.querySelectorAll('.cm-stepper button');
    expect(steppers.length).toBeGreaterThan(0);
    for (const button of steppers) {
      expect(button.textContent?.trim()).toBe('');
      expect(button.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    }
  });
});
