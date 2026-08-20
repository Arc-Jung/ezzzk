import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../constants/storage';
import { DEVICE_PROFILES } from '../constants/device';
import {
  ensureWideScreen,
  findViewModeButton,
  isWideScreenActive,
  wideScreenFeature,
} from './wideScreen';
import type { FeatureContext } from './types';

describe('isWideScreenActive — aria-label 로만 판정한다', () => {
  it('`좁은 화면` label 은 지금 넓은 화면이라는 뜻', () => {
    expect(isWideScreenActive('좁은 화면')).toBe(true);
  });

  it('`넓은 화면` label 은 지금 좁은 화면이라는 뜻', () => {
    expect(isWideScreenActive('넓은 화면')).toBe(false);
  });

  it('앞뒤 공백·개행이 있어도 판정한다', () => {
    expect(isWideScreenActive('  좁은  화면 \n')).toBe(true);
    expect(isWideScreenActive('\t넓은 화면')).toBe(false);
  });

  it('null · 빈 문자열은 판정 불가', () => {
    expect(isWideScreenActive(null)).toBeNull();
    expect(isWideScreenActive('')).toBeNull();
    expect(isWideScreenActive('   ')).toBeNull();
  });

  it('모르는 label 은 판정 불가 — 임의로 토글하지 않기 위한 것', () => {
    expect(isWideScreenActive('전체화면')).toBeNull();
    expect(isWideScreenActive('설정')).toBeNull();
  });

  it('해시 클래스나 사이드바 상태는 판정에 쓰지 않는다', () => {
    // `_is_large_` / `_is_expanded_` 문자열이 들어와도 label 로만 본다.
    expect(isWideScreenActive('_is_large_1tswz_17')).toBeNull();
    expect(isWideScreenActive('_is_expanded_uaq06_22')).toBeNull();
  });
});

describe('ensureWideScreen — 이미 넓으면 토글하지 않는다', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function mountButton(ariaLabel: string | null): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'pzp-viewmode-button';
    if (ariaLabel !== null) button.setAttribute('aria-label', ariaLabel);
    // qsVisible 이 0×0 요소를 걸러내므로 rect 를 실제 버튼 크기(36px)로 모방한다.
    button.getBoundingClientRect = () =>
      ({ width: 36, height: 36, top: 0, left: 0, right: 36, bottom: 36 }) as DOMRect;
    document.body.appendChild(button);
    return button;
  }

  it('좁은 화면이면 한 번 클릭한다', async () => {
    const button = mountButton('넓은 화면');
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks += 1;
      // 실제 페이지처럼 클릭 후 label 이 뒤집힌다.
      button.setAttribute('aria-label', '좁은 화면');
    });

    await expect(ensureWideScreen({ timeoutMs: 50 })).resolves.toBe(true);
    expect(clicks).toBe(1);
  });

  it('이미 넓은 화면이면 클릭하지 않는다 (멱등)', async () => {
    const button = mountButton('좁은 화면');
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks += 1;
    });

    await expect(ensureWideScreen({ timeoutMs: 50 })).resolves.toBe(true);
    await expect(ensureWideScreen({ timeoutMs: 50 })).resolves.toBe(true);
    expect(clicks).toBe(0);
  });

  it('label 을 모르면 클릭하지 않고 null 을 돌려준다', async () => {
    const button = mountButton(null);
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks += 1;
    });

    await expect(ensureWideScreen({ timeoutMs: 50 })).resolves.toBeNull();
    expect(clicks).toBe(0);
  });

  it('버튼이 없으면 null — 예외를 던지지 않는다', async () => {
    await expect(ensureWideScreen({ timeoutMs: 30 })).resolves.toBeNull();
  });

  /**
   * 🔴 회귀 고정 — 실측 결함 (2026-08-12, `chzzk-dom-24-widescreen-trace.json`).
   * 치지직이 저장해 둔 넓은 화면 상태를 초기화 중에 적용하는데, 그 전에 우리가 낡은 label 을
   * 읽고 클릭하면 **켜져 있던 것을 끈다**. 추적에서 `좁은 화면 → 넓은 화면` 으로 뒤집히는 것을
   * 확인했다. → 클릭 결과를 재확인하고, 되돌려졌으면 다시 켠다.
   */
  it('플레이어 복원 로직이 되돌려도 재시도해서 결국 켠다', async () => {
    const button = mountButton('넓은 화면');
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks += 1;
      if (clicks === 1) {
        // 1회차: 켜졌다가 치지직 복원 로직이 곧바로 되돌린다.
        button.setAttribute('aria-label', '넓은 화면');
        return;
      }
      button.setAttribute('aria-label', '좁은 화면');
    });

    await expect(ensureWideScreen({ timeoutMs: 100 })).resolves.toBe(true);
    expect(clicks).toBe(2);
    expect(button.getAttribute('aria-label')).toBe('좁은 화면');
  });

  it('계속 되돌려지면 무한 재시도하지 않고 false 를 돌려준다', async () => {
    const button = mountButton('넓은 화면');
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks += 1;
      // 항상 좁은 화면으로 되돌린다 (넓은 화면을 못 쓰는 상황).
      button.setAttribute('aria-label', '넓은 화면');
    });

    await expect(ensureWideScreen({ timeoutMs: 100 })).resolves.toBe(false);
    expect(clicks).toBe(3);
  });

  it('재초기화가 겹쳐도 토글이 두 번 일어나지 않는다 (동시 실행 방지)', async () => {
    const button = mountButton('넓은 화면');
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks += 1;
      button.setAttribute('aria-label', '좁은 화면');
    });

    const [a, b] = await Promise.all([
      ensureWideScreen({ timeoutMs: 100 }),
      ensureWideScreen({ timeoutMs: 100 }),
    ]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(clicks).toBe(1);
  });

  it('findViewModeButton 은 보이는 버튼을 고른다', () => {
    const hidden = document.createElement('button');
    hidden.className = 'pzp-viewmode-button';
    hidden.getBoundingClientRect = () => ({ width: 0, height: 0 }) as DOMRect;
    document.body.appendChild(hidden);

    const visible = mountButton('넓은 화면');
    expect(findViewModeButton()).toBe(visible);
  });
});

/**
 * 🔴 회귀 — 자동 넓은 화면이 켜지지 않는다 (사용자 보고 2026-08-17).
 *
 * 원인: `start()` 가 `waitFor(viewModeButton, 10초)` **한 번**만 했다. 프리롤 광고 중에는
 * 컨트롤바 DOM 이 아예 없고(프로젝트 규칙 · 실측) 광고는 10초를 훌쩍 넘긴다(README: 92초 사례).
 * 그 창을 놓치면 `wide screen button not rendered, skipping` 한 줄만 남기고 **그 페이지에서
 * 영구 포기**했다 — 같은 부류를 화질(`quality.ts`)·볼륨(`volume.ts`)이 이미 준비 옵저버 +
 * 시간·횟수 상한으로 해결했으므로 값과 근거를 그대로 따른다.
 */
describe('wideScreenFeature — 컨트롤바가 늦게 떠도(광고 구간) 켠다', () => {
  const ctx: FeatureContext = {
    page: { type: 'live', channelId: 'a'.repeat(32), videoNo: null, isSlotFrame: false },
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
      reason: 'test fixture',
    },
    settings: DEFAULT_SETTINGS,
  };

  /** 실측 구조: `.pzp-pc` 안에 `video` 와 컨트롤바 버튼이 함께 산다. */
  function mountPlayer(ariaLabel: string): HTMLButtonElement {
    const root = document.createElement('div');
    root.className = 'pzp-pc';
    const video = document.createElement('video');
    Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
    root.appendChild(video);

    const button = document.createElement('button');
    button.className = 'pzp-viewmode-button';
    button.setAttribute('aria-label', ariaLabel);
    button.getBoundingClientRect = () =>
      ({ width: 36, height: 36, top: 0, left: 0, right: 36, bottom: 36 }) as DOMRect;
    button.addEventListener('click', () => {
      button.setAttribute('aria-label', '좁은 화면');
    });
    root.appendChild(button);
    document.body.appendChild(root);
    return button;
  }

  /** 앞 describe 가 남긴 노드와 섞이지 않게 이 플레이어 안에서만 읽는다. */
  const label = (): string | null =>
    document.querySelector('.pzp-pc button.pzp-viewmode-button')?.getAttribute('aria-label') ??
    null;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('컨트롤바가 15초 뒤에 떠도 그때 켠다 (예전 구현은 10초에 영구 포기했다)', async () => {
    vi.useFakeTimers();
    const dispose = wideScreenFeature.start(ctx);

    // 광고 구간 — 컨트롤바 DOM 이 없다. 예전 구현은 여기서 이미 포기 상태였다.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(label()).toBeNull();

    // 광고가 끝나고 컨트롤바가 붙는다.
    mountPlayer('넓은 화면');
    await vi.advanceTimersByTimeAsync(5_000);

    expect(label()).toBe('좁은 화면');
    dispose?.();
  });

  it('이미 넓은 화면으로 떠 있으면 누르지 않는다 (늦게 떠도 멱등)', async () => {
    vi.useFakeTimers();
    const dispose = wideScreenFeature.start(ctx);

    await vi.advanceTimersByTimeAsync(12_000);
    const button = mountPlayer('좁은 화면');
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks += 1;
    });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(clicks).toBe(0);
    expect(label()).toBe('좁은 화면');
    dispose?.();
  });

  it('켜고 나면 대기 타이머·옵저버가 남지 않는다', async () => {
    vi.useFakeTimers();
    const dispose = wideScreenFeature.start(ctx);
    await vi.advanceTimersByTimeAsync(3_000);
    mountPlayer('넓은 화면');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(label()).toBe('좁은 화면');

    dispose?.();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('정리한 뒤에 컨트롤바가 떠도 건드리지 않는다', async () => {
    vi.useFakeTimers();
    const dispose = wideScreenFeature.start(ctx);
    await vi.advanceTimersByTimeAsync(2_000);
    dispose?.();

    mountPlayer('넓은 화면');
    await vi.advanceTimersByTimeAsync(10_000);

    expect(label()).toBe('넓은 화면');
  });
});

/**
 * 🔴 옵저버만 믿으면 안 된다 — 실측 2026-08-17.
 * 채팅 aside 가 없는(비로그인) 페이지에서 컨트롤바가 t=1.0초에 이미 떠 있었는데도 20초 동안
 * 옵저버가 한 번도 깨어나지 않아 넓은 화면이 켜지지 않았다. 광고가 iframe 안에서 그려져
 * 최상위 문서에 변화를 남기지 않는 것으로 보인다. 그래서 저비용 폴링을 함께 둔다.
 */
describe('wideScreenFeature — DOM 이 조용해도(옵저버 무응답) 켠다', () => {
  const ctx: FeatureContext = {
    page: { type: 'live', channelId: 'b'.repeat(32), videoNo: null, isSlotFrame: false },
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
      reason: 'test fixture',
    },
    settings: DEFAULT_SETTINGS,
  };

  const label = (): string | null =>
    document.querySelector('.pzp-pc button.pzp-viewmode-button')?.getAttribute('aria-label') ??
    null;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('MutationObserver 가 전혀 발화하지 않아도 폴링이 켠다', async () => {
    // 옵저버를 완전히 죽여 폴링만 남긴다 — 실측에서 관찰된 상황을 그대로 만든다.
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe(): void {}
        disconnect(): void {}
        takeRecords(): [] {
          return [];
        }
      },
    );
    vi.useFakeTimers();

    const dispose = wideScreenFeature.start(ctx);

    const root = document.createElement('div');
    root.className = 'pzp-pc';
    const video = document.createElement('video');
    Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
    root.appendChild(video);
    const button = document.createElement('button');
    button.className = 'pzp-viewmode-button';
    button.setAttribute('aria-label', '넓은 화면');
    button.getBoundingClientRect = () =>
      ({ width: 36, height: 36, top: 0, left: 0, right: 36, bottom: 36 }) as DOMRect;
    button.addEventListener('click', () => button.setAttribute('aria-label', '좁은 화면'));
    root.appendChild(button);
    document.body.appendChild(root);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(label()).toBe('좁은 화면');
    dispose?.();
    expect(vi.getTimerCount()).toBe(0);
  });
});
