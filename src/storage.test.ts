import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  SCHEMA_VERSION_KEY,
  STORAGE_KEY,
} from './constants/storage';
import { mergeSettings, migrate } from './storage';

/** chrome.storage.local 을 메모리로 대체한다 (chrome API 는 jsdom 에 없다). */
function installFakeChrome(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  const listeners: ((changes: Record<string, { newValue?: unknown }>, area: string) => void)[] = [];

  const fake = {
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
  (globalThis as unknown as { chrome: unknown }).chrome = fake;
  return { store, fake };
}

beforeEach(() => {
  vi.resetModules();
});

describe('mergeSettings — 부분 설정을 기본값 위에 병합', () => {
  it('빈 값이면 기본값을 그대로 준다', () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('섹션 내 일부 키만 저장돼 있어도 나머지는 기본값이 채워진다 (새 키 추가 안전)', () => {
    const merged = mergeSettings({ volume: { defaultLevel: 80 } });
    expect(merged.volume.defaultLevel).toBe(80);
    expect(merged.volume.step).toBe(DEFAULT_SETTINGS.volume.step);
    expect(merged.volume.autoUnmute).toBe(DEFAULT_SETTINGS.volume.autoUnmute);
  });

  it('배열은 병합하지 않고 통째로 교체한다 (프리셋 중복 방지)', () => {
    const merged = mergeSettings({
      chatPresets: [{ id: 'a', label: 'ㅋ', text: 'ㅋㅋㅋ', order: 0 }],
    });
    expect(merged.chatPresets).toHaveLength(1);
    expect(merged.chatPresets[0]?.text).toBe('ㅋㅋㅋ');
  });

  it('모르는 키는 무시한다', () => {
    const merged = mergeSettings({ nonexistentFeature: true }) as Record<string, unknown>;
    expect(merged.nonexistentFeature).toBeUndefined();
  });

  it('기본값을 오염시키지 않는다 (깊은 복사)', () => {
    const merged = mergeSettings({ volume: { defaultLevel: 99 } });
    merged.volume.defaultLevel = 1;
    merged.chatPresets.push({ id: 'x', label: 'x', text: 'x', order: 0 });
    expect(DEFAULT_SETTINGS.volume.defaultLevel).toBe(50);
    expect(DEFAULT_SETTINGS.chatPresets).toHaveLength(0);
  });
});

describe('migrate — 스키마 마이그레이션', () => {
  it('버전 없는(v0) 데이터도 병합해 살린다', () => {
    const result = migrate({ wideScreen: { enabled: false } }, 0);
    expect(result.wideScreen.enabled).toBe(false);
    expect(result.quality.target).toBe('1080p');
  });

  it('v0 의 깨진 값도 기본값으로 대체되지 않고 구조는 유지된다', () => {
    const result = migrate(null, 0);
    expect(result).toEqual(DEFAULT_SETTINGS);
  });

  it('현재 버전 데이터는 그대로 통과한다', () => {
    const result = migrate({ debug: true }, SCHEMA_VERSION);
    expect(result.debug).toBe(true);
  });
});

describe('loadSettings / saveSettings — chrome.storage 왕복', () => {
  it('저장된 값이 없으면 기본값을 쓰고 schemaVersion 을 기록한다', async () => {
    const { store } = installFakeChrome();
    const { loadSettings } = await import('./storage');
    const settings = await loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(store[SCHEMA_VERSION_KEY]).toBe(SCHEMA_VERSION);
  });

  it('부분 갱신이 기존 값을 지우지 않는다', async () => {
    installFakeChrome({
      [STORAGE_KEY]: { volume: { defaultLevel: 70 }, debug: true },
      [SCHEMA_VERSION_KEY]: SCHEMA_VERSION,
    });
    const { loadSettings, saveSettings } = await import('./storage');
    await loadSettings();
    const next = await saveSettings({ wideScreen: { enabled: false } });
    expect(next.wideScreen.enabled).toBe(false);
    expect(next.volume.defaultLevel).toBe(70);
    expect(next.debug).toBe(true);
  });

  it('updateSection 은 섹션 내 다른 키를 보존한다', async () => {
    installFakeChrome();
    const { loadSettings, updateSection } = await import('./storage');
    await loadSettings();
    const next = await updateSection('volume', { defaultLevel: 20 });
    expect(next.volume.defaultLevel).toBe(20);
    expect(next.volume.step).toBe(DEFAULT_SETTINGS.volume.step);
  });

  it('resetSection 은 해당 섹션만 기본값으로 되돌린다 (탭별 초기화)', async () => {
    installFakeChrome();
    const { loadSettings, saveSettings, resetSection } = await import('./storage');
    await loadSettings();
    await saveSettings({ volume: { ...DEFAULT_SETTINGS.volume, defaultLevel: 5 }, debug: true });
    const next = await resetSection('volume');
    expect(next.volume).toEqual(DEFAULT_SETTINGS.volume);
    expect(next.debug).toBe(true);
  });

  it('resetAllSettings 는 전체를 기본값으로 되돌린다', async () => {
    installFakeChrome();
    const { loadSettings, saveSettings, resetAllSettings } = await import('./storage');
    await loadSettings();
    await saveSettings({ debug: true });
    const next = await resetAllSettings();
    // 프리셋만 예외다 (아래 테스트 참조). 나머지는 전부 기본값이어야 한다.
    expect({ ...next, optionPresets: [] }).toEqual(DEFAULT_SETTINGS);
  });

  /**
   * 🔴 `DEFAULT_SETTINGS.optionPresets` 는 `[]` 다. 그대로 쓰면 "모두 초기화" 후
   * **기본 제공 프리셋 3종이 영구히 사라진다** — 시딩은 `onInstalled` 에서만 하고
   * 다시 호출되지 않기 때문이다. 초기화는 "설치 직후 상태"로 돌아가는 것이어야 한다 (US-006).
   */
  it('resetAllSettings 는 기본 제공 프리셋 3종을 다시 심는다', async () => {
    installFakeChrome();
    const { loadSettings, resetAllSettings } = await import('./storage');
    await loadSettings();
    const next = await resetAllSettings();
    expect(next.optionPresets.map((p) => p.name)).toEqual(['기본', '채팅 집중', '영상 집중']);
    expect(next.optionPresets).toHaveLength(3);
  });

  it('onSettingsChanged 로 다른 탭의 변경을 받는다', async () => {
    installFakeChrome();
    const { loadSettings, saveSettings, onSettingsChanged } = await import('./storage');
    await loadSettings();

    const seen: boolean[] = [];
    const stop = onSettingsChanged((s) => seen.push(s.wideScreen.enabled));
    await saveSettings({ wideScreen: { enabled: false } });
    expect(seen).toEqual([false]);

    stop();
    await saveSettings({ wideScreen: { enabled: true } });
    expect(seen).toEqual([false]);
  });

  it('storage 읽기 실패 시 기본값으로 폴백하고 예외를 던지지 않는다 (NFR-05)', async () => {
    const { fake } = installFakeChrome();
    fake.storage.local.get = vi.fn(async () => {
      throw new Error('storage unavailable');
    });
    const { loadSettings } = await import('./storage');
    await expect(loadSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });
});

describe('DEFAULT_SETTINGS — 요구사항이 못 박은 기본값', () => {
  it('통나무 자동 수집은 기본 끄기다 (계정 제재 리스크)', () => {
    expect(DEFAULT_SETTINGS.powerCollect.enabled).toBe(false);
  });

  it('채팅 프리셋 기본 동작은 즉시 전송이다', () => {
    expect(DEFAULT_SETTINGS.chatPresetBehavior).toBe('send');
  });

  it('채팅 폰트 기본값은 치지직 원본과 같은 14px / 슬롯 12px 다', () => {
    expect(DEFAULT_SETTINGS.chatFont.sidePx).toBe(14);
    expect(DEFAULT_SETTINGS.chatFont.slotPx).toBe(12);
  });

  it('슬롯 채팅 줄은 기본 3, 활성 슬롯 5, 배치는 오버레이다 (영상 손실 0%)', () => {
    expect(DEFAULT_SETTINGS.multiView.slotChatLines).toBe(3);
    expect(DEFAULT_SETTINGS.multiView.slotChatLinesActive).toBe(5);
    expect(DEFAULT_SETTINGS.multiView.slotChatPlacement).toBe('overlay');
  });

  /**
   * 2026-08-12 결정 변경: 비활성 슬롯도 목표 화질(1080p)로 재생한다 (사용자 요청).
   * 이전 기본값은 켜기(720p 하향)였고 근거는 대역폭 절약이었다 — 이제 사용자가 켜서 쓴다.
   */
  it('비활성 슬롯 화질 하향은 기본 끄기다 — 비활성 슬롯도 1080p 로 재생한다', () => {
    expect(DEFAULT_SETTINGS.multiView.lowerInactiveQuality).toBe(false);
  });

  it('볼륨 기본값 50%, 증감폭 10%, 이전 볼륨 유지는 끄기다', () => {
    expect(DEFAULT_SETTINGS.volume.defaultLevel).toBe(50);
    expect(DEFAULT_SETTINGS.volume.step).toBe(10);
    expect(DEFAULT_SETTINGS.volume.restoreLast).toBe(false);
  });
});

describe('onSettingsChanged — 쓴 주체(origin) 전달', () => {
  it('origin 을 넘겨 쓰면 그 값이 콜백에 전달된다', async () => {
    installFakeChrome();
    const { loadSettings, updateSection, onSettingsChanged } = await import('./storage');
    await loadSettings();

    const seen: (string | null)[] = [];
    const stop = onSettingsChanged((_s, meta) => seen.push(meta.origin));
    await updateSection('volume', { lastLevel: 80 }, { origin: 'volume' });
    expect(seen).toEqual(['volume']);
    stop();
  });

  it('origin 없이 쓰면 null 이다 (다른 탭에서 온 변경과 같게 취급)', async () => {
    installFakeChrome();
    const { loadSettings, saveSettings, onSettingsChanged } = await import('./storage');
    await loadSettings();

    const seen: (string | null)[] = [];
    const stop = onSettingsChanged((_s, meta) => seen.push(meta.origin));
    await saveSettings({ debug: true });
    expect(seen).toEqual([null]);
    stop();
  });

  it('origin 은 한 번만 소비된다 (다음 변경에 새지 않는다)', async () => {
    installFakeChrome();
    const { loadSettings, saveSettings, updateSection, onSettingsChanged } =
      await import('./storage');
    await loadSettings();

    const seen: (string | null)[] = [];
    const stop = onSettingsChanged((_s, meta) => seen.push(meta.origin));
    await updateSection('volume', { lastLevel: 70 }, { origin: 'volume' });
    await saveSettings({ debug: true });
    expect(seen).toEqual(['volume', null]);
    stop();
  });
});

/**
 * 🔴 실측 결함 회귀 (사용자 보고 2026-08-15) — 탭 두 개에서 A 만 조작했는데 B 의 채팅 폭도 변했다.
 * `origin` 은 쓴 탭의 메모리에만 있어 다른 탭에서는 언제나 `null` 이다 → 창을 구분하려면
 * **저장 payload 에 실려 오는 창 식별자**가 따로 있어야 한다.
 *
 * `vi.resetModules()` 후 다시 import 하면 storage 모듈이 새 `WINDOW_ID` 로 다시 평가된다 —
 * 같은 저장소를 공유하는 **다른 탭**과 같은 위상이다.
 */
describe('onSettingsChanged — 창(탭) 식별 (FR-05 창별 레이아웃)', () => {
  it('자기 창이 쓴 변경은 foreignWindow: false 다', async () => {
    installFakeChrome();
    const { loadSettings, updateSection, onSettingsChanged } = await import('./storage');
    await loadSettings();

    const seen: boolean[] = [];
    const stop = onSettingsChanged((_s, meta) => seen.push(meta.foreignWindow));
    await updateSection('chatWidth', { ratio: 40 }, { origin: 'chatWidth' });
    expect(seen).toEqual([false]);
    stop();
  });

  it('다른 창이 쓴 변경은 foreignWindow: true 다', async () => {
    installFakeChrome();
    const tabA = await import('./storage');
    await tabA.loadSettings();

    // 같은 저장소를 공유하는 두 번째 탭 (모듈 재평가 = 새 WINDOW_ID).
    vi.resetModules();
    const tabB = await import('./storage');
    await tabB.loadSettings();
    expect(tabB.WINDOW_ID).not.toBe(tabA.WINDOW_ID);

    const seen: { origin: string | null; foreignWindow: boolean }[] = [];
    const stop = tabA.onSettingsChanged((_s, meta) => seen.push({ ...meta }));
    await tabB.updateSection('chatWidth', { ratio: 45 }, { origin: 'chatWidth' });

    // A 에서는 origin 을 알 수 없지만(다른 탭의 메모리) 창이 다르다는 것은 알 수 있다.
    expect(seen).toEqual([{ origin: null, foreignWindow: true }]);
    stop();
  });

  it('작성자를 알 수 없는 쓰기(하네스 직접 set·마이그레이션)는 전역 변경으로 본다', async () => {
    const { fake } = installFakeChrome();
    const { loadSettings, onSettingsChanged } = await import('./storage');
    await loadSettings();

    const seen: boolean[] = [];
    const stop = onSettingsChanged((_s, meta) => seen.push(meta.foreignWindow));
    // 검증 하네스의 seedSettings 처럼 설정 본문만 직접 덮어쓴다.
    await fake.storage.local.set({ [STORAGE_KEY]: { chatWidth: { ratio: 22 } } });
    expect(seen).toEqual([false]);
    stop();
  });
});

/**
 * 🔴 회귀 고정 — 구독자가 **둘 이상**일 때 origin 이 첫 구독자에게 소비되던 결함.
 *
 * 실제 위상: `multiView` 가 자기 구독(R2 수정)을 `content.tsx` 보다 **먼저** 등록한다
 * (`restartAll` 이 `onSettingsChanged` 등록보다 앞에 있으므로). 구독자별로 chrome 리스너를
 * 따로 붙이면 `multiView` 의 리스너가 origin 을 먹고 `content.tsx` 는 항상 `null` 을 봐서
 * `volume`·`chatWidth`·`chatPreset` 이 자기 쓰기로 자기 재시작을 계속했다(R1 무효화).
 * 구독자 1개만 등록하는 테스트로는 절대 잡히지 않는다.
 */
describe('onSettingsChanged — 구독자가 여러 개일 때 (R1 무효화 회귀)', () => {
  it('모든 구독자가 같은 origin 을 본다 (등록 순서와 무관)', async () => {
    installFakeChrome();
    const { loadSettings, updateSection, onSettingsChanged } = await import('./storage');
    await loadSettings();

    const first: (string | null)[] = [];
    const second: (string | null)[] = [];
    const third: (string | null)[] = [];
    // multiView 처럼 meta 를 무시하는 구독자가 먼저 등록되는 상황을 그대로 재현한다.
    const stopA = onSettingsChanged((s) => first.push(s.volume.lastLevel === 80 ? 'saw' : 'other'));
    const stopB = onSettingsChanged((_s, meta) => second.push(meta.origin));
    const stopC = onSettingsChanged((_s, meta) => third.push(meta.origin));

    await updateSection('volume', { lastLevel: 80 }, { origin: 'volume' });

    expect(first).toEqual(['saw']);
    // 먼저 등록된 구독자가 origin 을 먹지 않는다.
    expect(second).toEqual(['volume']);
    expect(third).toEqual(['volume']);
    stopA();
    stopB();
    stopC();
  });

  it('구독자 하나가 던져도 나머지가 알림을 받는다', async () => {
    installFakeChrome();
    const { loadSettings, updateSection, onSettingsChanged } = await import('./storage');
    await loadSettings();

    const seen: (string | null)[] = [];
    const stopA = onSettingsChanged(() => {
      throw new Error('subscriber boom');
    });
    const stopB = onSettingsChanged((_s, meta) => seen.push(meta.origin));

    await updateSection('volume', { lastLevel: 70 }, { origin: 'volume' });
    expect(seen).toEqual(['volume']);
    stopA();
    stopB();
  });

  it('구독 해지된 구독자는 더 이상 받지 않는다', async () => {
    installFakeChrome();
    const { loadSettings, saveSettings, onSettingsChanged } = await import('./storage');
    await loadSettings();

    const a: number[] = [];
    const b: number[] = [];
    const stopA = onSettingsChanged(() => a.push(1));
    const stopB = onSettingsChanged(() => b.push(1));
    await saveSettings({ debug: true });
    stopA();
    await saveSettings({ debug: false });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(2);
    stopB();
  });
});

describe('origin 대기 목록 — 연속·교차 쓰기 (D 항목)', () => {
  it('연속 쓰기 각각이 자기 origin 을 유지한다 (슬롯 1개로는 앞 쓰기를 잃는다)', async () => {
    installFakeChrome();
    const { loadSettings, updateSection, onSettingsChanged } = await import('./storage');
    await loadSettings();

    const seen: (string | null)[] = [];
    const stop = onSettingsChanged((_s, meta) => seen.push(meta.origin));
    // chatWidth 의 `+ + +` 처럼 디바운스 없이 연달아 쓰는 상황.
    await updateSection('chatWidth', { ratio: 30 }, { origin: 'chatWidth' });
    await updateSection('chatWidth', { ratio: 35 }, { origin: 'chatWidth' });
    await updateSection('chatWidth', { ratio: 40 }, { origin: 'chatWidth' });

    expect(seen).toEqual(['chatWidth', 'chatWidth', 'chatWidth']);
    stop();
  });

  it('기능 간 교차 쓰기도 각자 origin 을 유지한다', async () => {
    installFakeChrome();
    const { loadSettings, updateSection, onSettingsChanged } = await import('./storage');
    await loadSettings();

    const seen: (string | null)[] = [];
    const stop = onSettingsChanged((_s, meta) => seen.push(meta.origin));
    await updateSection('chatWidth', { ratio: 25 }, { origin: 'chatWidth' });
    await updateSection('volume', { lastLevel: 60 }, { origin: 'volume' });

    expect(seen).toEqual(['chatWidth', 'volume']);
    stop();
  });

  it('쓰기가 실패하면 대기 항목이 남지 않아 다음 변경을 잘못 귀속시키지 않는다', async () => {
    const { fake } = installFakeChrome();
    const { loadSettings, updateSection, onSettingsChanged } = await import('./storage');
    await loadSettings();

    // 첫 쓰기를 실패시킨다 → onChanged 가 오지 않는다.
    const realSet = fake.storage.local.set;
    fake.storage.local.set = vi.fn(async () => {
      throw new Error('quota exceeded');
    });
    await updateSection('volume', { lastLevel: 90 }, { origin: 'volume' });

    // 이후 정상 쓰기는 origin 이 null 이어야 한다 (실패한 쓰기의 origin 이 새면 안 된다).
    fake.storage.local.set = realSet;
    const seen: (string | null)[] = [];
    const stop = onSettingsChanged((_s, meta) => seen.push(meta.origin));
    await updateSection('volume', { lastLevel: 90 });
    expect(seen).toEqual([null]);
    stop();
  });
});

/**
 * 🔴 팬아웃 중 해지된 구독자는 호출되지 않아야 한다 — **`storage.ts` 의 불변식**으로 보장한다.
 * 사본을 순회하므로 구조적으로는 해지 후에도 호출될 수 있고, 지금은 각 구독자가 자기 쪽에서
 * (`alive` 플래그 등) 막고 있을 뿐이었다. R2 가 구독을 추가하자마자 origin 이 깨진 전례가 있으니
 * 구독자 규약에 의존하지 않는다.
 */
describe('onSettingsChanged — 팬아웃 중 해지', () => {
  it('앞선 구독자가 해지한 뒤 구독자는 이번 이벤트를 받지 않는다', async () => {
    installFakeChrome();
    const { loadSettings, saveSettings, onSettingsChanged } = await import('./storage');
    await loadSettings();

    const calls: string[] = [];

    // 첫 구독자가 두 번째 구독자를 해지한다 (기기 유형 변경으로 전체 teardown 이 도는 상황).
    const stopFirst = onSettingsChanged(() => {
      calls.push('first');
      stopSecond();
    });
    const stopSecond = onSettingsChanged(() => calls.push('second'));
    const stopThird = onSettingsChanged(() => calls.push('third'));

    await saveSettings({ debug: true });

    // 해지된 두 번째는 빠지고 세 번째는 정상 수신한다.
    expect(calls).toEqual(['first', 'third']);

    stopFirst();
    stopThird();
  });

  it('팬아웃 중 새로 등록된 구독자는 이번 이벤트를 받지 않는다', async () => {
    installFakeChrome();
    const { loadSettings, saveSettings, onSettingsChanged } = await import('./storage');
    await loadSettings();

    const calls: string[] = [];
    let stopLate: (() => void) | undefined;
    const stopFirst = onSettingsChanged(() => {
      calls.push('first');
      stopLate ??= onSettingsChanged(() => calls.push('late'));
    });

    await saveSettings({ debug: true });
    expect(calls).toEqual(['first']);

    // 다음 이벤트부터는 받는다.
    await saveSettings({ debug: false });
    expect(calls).toEqual(['first', 'first', 'late']);

    stopFirst();
    stopLate?.();
  });
});
