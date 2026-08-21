import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEVICE_PROFILES } from '../constants/device';
import { DEFAULT_SETTINGS, STORAGE_KEY, type Settings } from '../constants/storage';
import { resetAllSettings } from '../storage';
import type { FeatureContext } from './types';
import {
  VOLUME_STORAGE_KEYS,
  clampVolumePercent,
  formatVolumeLabel,
  insertVolumeControl,
  isMutedByLabel,
  normalizeStep,
  percentToElementUnit,
  percentToUnit,
  stepVolume,
  unitToPercent,
  volumeFeature,
  volumeStorageValues,
} from './volume';

describe('clampVolumePercent', () => {
  /**
   * 🔴 상한이 100 → **200** 으로 바뀌었다 (요청 2026-08-20 볼륨 증폭).
   * 100 을 넘는 몫은 `video.volume` 이 아니라 Web Audio 게인이 담당한다 — 요소에 넣는 값은
   * `percentToElementUnit` 이 100 에서 자른다.
   */
  it('0~200 범위로 클램프한다 (증폭 구간 포함)', () => {
    expect(clampVolumePercent(-30)).toBe(0);
    expect(clampVolumePercent(0)).toBe(0);
    expect(clampVolumePercent(50)).toBe(50);
    expect(clampVolumePercent(100)).toBe(100);
    expect(clampVolumePercent(140)).toBe(140);
    expect(clampVolumePercent(500)).toBe(200);
  });

  it('요소에 넣는 값은 100% 에서 자른다 (video.volume 은 0~1 이다)', () => {
    expect(percentToElementUnit(50)).toBe(0.5);
    expect(percentToElementUnit(100)).toBe(1);
    expect(percentToElementUnit(200)).toBe(1);
  });

  it('소수는 정수로 반올림한다', () => {
    expect(clampVolumePercent(17.58)).toBe(18);
    expect(clampVolumePercent(17.4)).toBe(17);
  });

  it('NaN·Infinity 는 0 으로 본다', () => {
    expect(clampVolumePercent(Number.NaN)).toBe(0);
    expect(clampVolumePercent(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampVolumePercent(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe('stepVolume', () => {
  it('기본 10% 단위로 증감한다', () => {
    expect(stepVolume(50, 1, 10)).toBe(60);
    expect(stepVolume(50, -1, 10)).toBe(40);
  });

  it('설정된 증감 폭 5·20 을 따른다', () => {
    expect(stepVolume(50, 1, 5)).toBe(55);
    expect(stepVolume(50, -1, 5)).toBe(45);
    expect(stepVolume(50, 1, 20)).toBe(70);
    expect(stepVolume(50, -1, 20)).toBe(30);
  });

  it('0·200 경계를 넘지 않는다 (증폭 상한)', () => {
    expect(stepVolume(195, 1, 10)).toBe(200);
    expect(stepVolume(200, 1, 10)).toBe(200);
    expect(stepVolume(5, -1, 10)).toBe(0);
    expect(stepVolume(0, -1, 20)).toBe(0);
  });

  it('delta 는 방향만 쓴다 — 크기는 step 이 정한다', () => {
    expect(stepVolume(50, 7, 10)).toBe(60);
    expect(stepVolume(50, -0.2, 10)).toBe(40);
    expect(stepVolume(50, 0, 10)).toBe(50);
  });

  it('잘못된 step 은 기본값 10 으로 되돌린다', () => {
    expect(stepVolume(50, 1, 0)).toBe(60);
    expect(stepVolume(50, 1, -5)).toBe(60);
    expect(stepVolume(50, 1, Number.NaN)).toBe(60);
  });

  it('범위 밖 현재값도 먼저 클램프된다', () => {
    expect(stepVolume(240, -1, 10)).toBe(190);
    expect(stepVolume(Number.NaN, 1, 10)).toBe(10);
  });
});

describe('percentToUnit / unitToPercent', () => {
  it('퍼센트 → 0~1 단위로 변환한다', () => {
    expect(percentToUnit(0)).toBe(0);
    expect(percentToUnit(50)).toBe(0.5);
    expect(percentToUnit(100)).toBe(1);
  });

  it('증폭 구간은 1 을 넘는 단위로 표현한다 (게인이 쓴다)', () => {
    expect(percentToUnit(-10)).toBe(0);
    expect(percentToUnit(150)).toBe(1.5);
    expect(percentToUnit(250)).toBe(2);
    expect(percentToUnit(Number.NaN)).toBe(0);
  });

  it('0~1 단위 → 퍼센트로 변환한다', () => {
    expect(unitToPercent(0)).toBe(0);
    expect(unitToPercent(0.5)).toBe(50);
    expect(unitToPercent(1)).toBe(100);
  });

  it('VOD 실측값 0.1758 은 18% 로 읽힌다', () => {
    expect(unitToPercent(0.1758)).toBe(18);
  });

  it('왕복 변환이 정수 퍼센트를 보존한다', () => {
    for (let p = 0; p <= 100; p += 1) {
      expect(unitToPercent(percentToUnit(p))).toBe(p);
    }
  });

  it('NaN·Infinity 는 0 으로 본다', () => {
    expect(unitToPercent(Number.NaN)).toBe(0);
    expect(unitToPercent(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('isMutedByLabel', () => {
  it('`음소거 해제` 는 지금 음소거된 상태를 뜻한다', () => {
    expect(isMutedByLabel('음소거 해제')).toBe(true);
  });

  it('`음소거` 는 지금 소리가 켜진 상태를 뜻한다', () => {
    expect(isMutedByLabel('음소거')).toBe(false);
  });

  it('탭·개행이 섞여도 판별한다', () => {
    expect(isMutedByLabel('  음소거 \n\t 해제 ')).toBe(true);
    expect(isMutedByLabel('\n\t음소거\t')).toBe(false);
  });

  it('label 이 없으면 음소거로 단정하지 않는다', () => {
    expect(isMutedByLabel(null)).toBe(false);
    expect(isMutedByLabel(undefined)).toBe(false);
    expect(isMutedByLabel('')).toBe(false);
    expect(isMutedByLabel('   ')).toBe(false);
  });

  it('알 수 없는 label 은 음소거가 아니라고 본다', () => {
    expect(isMutedByLabel('전체 화면')).toBe(false);
  });
});

describe('volumeStorageValues', () => {
  it('실측 형태 그대로 만든다', () => {
    expect(volumeStorageValues(50, false)).toEqual({
      volume: '{"value":0.5}',
      muted: 'false',
    });
  });

  it('음소거 상태는 문자열 `true` 다', () => {
    expect(volumeStorageValues(30, true)).toEqual({
      volume: '{"value":0.3}',
      muted: 'true',
    });
  });

  it('0%·100% 도 유효한 JSON 이다', () => {
    expect(volumeStorageValues(0, false).volume).toBe('{"value":0}');
    expect(volumeStorageValues(100, false).volume).toBe('{"value":1}');
  });

  /**
   * 🔴 치지직이 이 값을 읽어 `video.volume` 에 넣는다 — 1 을 넘기면 플레이어가 깨진다.
   * 증폭분은 Web Audio 게인이 담당하므로 저장값은 요소 단위(0~1)로 잘라야 한다.
   */
  it('증폭 구간도 저장은 1 을 넘지 않는다', () => {
    expect(volumeStorageValues(150, false).volume).toBe('{"value":1}');
    expect(volumeStorageValues(200, false).volume).toBe('{"value":1}');
    expect(volumeStorageValues(-20, false).volume).toBe('{"value":0}');
  });

  it('기록한 값을 다시 읽으면 원래 퍼센트가 나온다', () => {
    const parsed = JSON.parse(volumeStorageValues(35, false).volume) as { value: number };
    expect(unitToPercent(parsed.value)).toBe(35);
  });

  it('저장 키는 실측 키와 같다', () => {
    expect(VOLUME_STORAGE_KEYS.volume).toBe('player-volume');
    expect(VOLUME_STORAGE_KEYS.muted).toBe('player-volume-muted');
  });
});

describe('normalizeStep', () => {
  it('허용된 5·10·20 은 그대로 쓴다', () => {
    expect(normalizeStep(5)).toBe(5);
    expect(normalizeStep(10)).toBe(10);
    expect(normalizeStep(20)).toBe(20);
  });

  it('그 외 값은 기본 10 으로 되돌린다', () => {
    expect(normalizeStep(7)).toBe(10);
    expect(normalizeStep(0)).toBe(10);
    expect(normalizeStep(Number.NaN)).toBe(10);
  });
});

describe('insertVolumeControl', () => {
  /**
   * 우측 정렬 그룹에서 볼륨 컨트롤이 오른쪽 끝에 붙으면, 노출되는 순간 왼쪽 형제 전부가
   * 폭만큼 밀려 첫 탭이 빗나간다 (실측 2026-08-15 mobile-landscape, 136px 이동).
   * → 항상 맨 왼쪽에 놓여야 한다.
   */
  const makeGroup = () => {
    const group = document.createElement('div');
    for (const id of ['cm-multiview-button', 'cm-settings-button', 'native-fullscreen']) {
      const child = document.createElement('button');
      child.id = id;
      group.appendChild(child);
    }
    return group;
  };
  const ids = (group: Element) => Array.from(group.children).map((el) => el.id);

  it('그룹의 첫 자식으로 삽입한다 — 오른쪽 형제 좌표가 흔들리지 않게', () => {
    const group = makeGroup();
    const node = document.createElement('div');
    node.id = 'cm-volume-control';

    insertVolumeControl(group, node);

    expect(group.firstElementChild).toBe(node);
    expect(ids(group)).toEqual([
      'cm-volume-control',
      'cm-multiview-button',
      'cm-settings-button',
      'native-fullscreen',
    ]);
  });

  it('레이아웃 순서를 order:-1 로 고정한다 — 다른 노드가 앞에 끼어도 맨 왼쪽이다', () => {
    const group = makeGroup();
    const node = document.createElement('div');

    insertVolumeControl(group, node);
    // controlBar.ts 의 버튼도 firstChild 앞에 붙는다 → DOM 순서만으로는 보장되지 않는다.
    const later = document.createElement('button');
    later.id = 'cm-settings-button-remount';
    group.insertBefore(later, group.firstChild);

    expect(node.style.order).toBe('-1');
    expect(later.style.order).toBe('');
  });

  it('이미 같은 그룹에 있으면 다시 옮기지 않는다 (재삽입으로 순서가 뒤집히지 않는다)', () => {
    const group = makeGroup();
    const node = document.createElement('div');
    node.id = 'cm-volume-control';

    insertVolumeControl(group, node);
    const later = document.createElement('button');
    later.id = 'cm-settings-button-remount';
    group.insertBefore(later, group.firstChild);
    insertVolumeControl(group, node);

    expect(ids(group)).toEqual([
      'cm-settings-button-remount',
      'cm-volume-control',
      'cm-multiview-button',
      'cm-settings-button',
      'native-fullscreen',
    ]);
  });

  it('다른 부모에 붙어 있었으면 새 그룹의 첫 자식으로 다시 넣는다 (컨트롤바 리렌더)', () => {
    const oldGroup = makeGroup();
    const node = document.createElement('div');
    oldGroup.appendChild(node);
    const newGroup = makeGroup();

    insertVolumeControl(newGroup, node);

    expect(newGroup.firstElementChild).toBe(node);
    expect(oldGroup.contains(node)).toBe(false);
  });
});

describe('formatVolumeLabel', () => {
  it('일반 상태는 퍼센트를 표시한다', () => {
    expect(formatVolumeLabel(50, false)).toBe('50%');
  });

  it('0% 는 음소거로 표시한다', () => {
    expect(formatVolumeLabel(0, false)).toBe('음소거');
  });

  it('muted 면 볼륨값과 무관하게 음소거로 표시한다 (VOD 실측: muted + volume 0.1758)', () => {
    expect(formatVolumeLabel(18, true)).toBe('음소거');
  });
});

/**
 * 🔴 회귀 — 볼륨 조절 `+`/`−` 가 아예 나타나지 않는다 (사용자 보고 2026-08-16).
 *
 * 실사이트 프로브(`scripts/probe-volume-control.mjs`)로 재현했다: 노트북·노트북 최대화·모바일
 * 가로 **3개 프로필 전부 `missing`**, 로그는 `volume feature disabled: video element not found`.
 * 컨트롤바도 있고 우리 멀티뷰·설정 버튼도 삽입돼 있는데 볼륨만 없었다.
 *
 * 원인: `start()` 시점에 `video` 가 없으면 재시도도 옵저버도 없이 **그 페이지에서 영구 포기**했다.
 * 콘텐츠 스크립트는 플레이어보다 먼저 뜨고, 프리롤 광고 중에는 본 `<video>` 가 늦게 붙는다.
 * 화질 기능(`quality.ts`)이 같은 부류를 이미 준비 옵저버 + 시간·횟수 상한으로 해결했다.
 */
describe('volumeFeature — video 가 늦게 나타나거나 교체돼도 붙는다', () => {
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

  /**
   * 실측 구조를 그대로 본뜬다: `#live_player_layout`(옵저버 앵커) > `.pzp-pc`(플레이어 루트) >
   * `div.pzp-pc__bottom-buttons-right`(삽입 대상). `video` 는 따로 붙인다.
   */
  function mountPlayer(): HTMLElement {
    const layout = document.createElement('div');
    layout.id = 'live_player_layout';
    const root = document.createElement('div');
    root.className = 'pzp-pc';
    const bar = document.createElement('div');
    bar.className = 'pzp-pc__bottom-buttons-right';
    root.appendChild(bar);
    layout.appendChild(root);
    document.body.appendChild(layout);
    return root;
  }

  /** jsdom 의 `readyState` 는 0 이라 초기 적용 경로로 들어가지 않는다 → 실측처럼 준비 상태로 만든다. */
  function addVideo(root: HTMLElement): HTMLVideoElement {
    const video = document.createElement('video');
    Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
    root.appendChild(video);
    return video;
  }

  const control = (): HTMLElement | null => document.getElementById('cm-volume-control');
  const shownLabel = (): string | null =>
    document.querySelector('#cm-volume-control .cm-volume-value')?.textContent ?? null;

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('시작할 때 video 가 없어도 나중에 나타나면 결국 붙는다', async () => {
    vi.useFakeTimers();

    const dispose = volumeFeature.start(ctx);

    // 예전 구현은 이 시점에 이미 영구 포기한 상태였다.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(control()).toBeNull();

    // 광고가 끝나고 플레이어가 붙는다.
    const root = mountPlayer();
    const video = addVideo(root);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(control()).not.toBeNull();
    expect(control()?.parentElement?.className).toBe('pzp-pc__bottom-buttons-right');
    // 기본 볼륨 50% 가 실제로 적용됐다.
    expect(video.volume).toBeCloseTo(0.5);
    expect(shownLabel()).toBe('50%');

    dispose?.();
  });

  it('볼륨 조작 버튼은 전부 문자가 아니라 aria-hidden svg 아이콘이다 (NFR-10 전수 검사)', async () => {
    vi.useFakeTimers();
    const dispose = volumeFeature.start(ctx);

    const root = mountPlayer();
    addVideo(root);
    await vi.advanceTimersByTimeAsync(5_000);

    const buttons = control()?.querySelectorAll<HTMLButtonElement>('.cm-volume-button');
    // `−` · `+` · 음량 평탄화 토글 셋이다.
    // 🔴 버튼이 늘면 이 수도 함께 올려 **전수 검사**를 유지한다 — 숫자를 지우면 새 버튼이 검사를 빠져나간다.
    expect(buttons?.length).toBe(3);
    for (const button of Array.from(buttons ?? [])) {
      expect(button.getAttribute('aria-label')).toBeTruthy();
      expect(button.textContent).toBe('');
      const svg = button.querySelector('svg');
      expect(svg).toBeTruthy();
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.getAttribute('viewBox')).toBe('0 0 16 16');
    }

    dispose?.();
  });

  it('플레이어가 늦게 붙어도 성공하면 대기 타이머가 남지 않는다', async () => {
    vi.useFakeTimers();

    const dispose = volumeFeature.start(ctx);
    await vi.advanceTimersByTimeAsync(3_000);
    addVideo(mountPlayer());
    await vi.advanceTimersByTimeAsync(5_000);
    expect(control()).not.toBeNull();

    dispose?.();
    expect(vi.getTimerCount()).toBe(0);
  });

  /**
   * 🔴 전체화면 전환이 대표적이다 — 플레이어가 리렌더되며 `video` 요소가 통째로 교체된다.
   * 예전 구현은 `start()` 시점의 참조를 클로저에 붙들고 있어 교체되면 죽은 노드를 조작했다.
   */
  it('video 요소가 교체돼도 새 요소에 계속 동작한다', async () => {
    vi.useFakeTimers();

    const root = mountPlayer();
    const first = addVideo(root);
    const dispose = volumeFeature.start(ctx);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(first.volume).toBeCloseTo(0.5);

    // 전체화면 전환 — 플레이어가 컨트롤바째로 다시 그려지고 video 가 새 요소로 바뀐다.
    root.remove();
    const nextRoot = mountPlayer();
    const second = addVideo(nextRoot);
    await vi.advanceTimersByTimeAsync(5_000);

    // 새 요소에 볼륨이 다시 적용되고 컨트롤도 새 컨트롤바 안에 다시 붙었다.
    expect(second.volume).toBeCloseTo(0.5);
    expect(control()).not.toBeNull();
    expect(nextRoot.contains(control())).toBe(true);

    // 새 요소의 volumechange 를 따라간다 (네이티브 슬라이더 조작).
    second.volume = 0.3;
    second.dispatchEvent(new Event('volumechange'));
    await vi.advanceTimersByTimeAsync(100);
    expect(shownLabel()).toBe('30%');

    // 옛 요소는 더 이상 표시에 영향을 주지 않는다 — 리스너가 떨어졌다.
    first.volume = 0.9;
    first.dispatchEvent(new Event('volumechange'));
    await vi.advanceTimersByTimeAsync(100);
    expect(shownLabel()).toBe('30%');

    dispose?.();
  });

  it('끝내 video 가 안 나타나면 시간 상한에서 조용히 끝난다', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // 컨트롤바는 있는데 video 만 없는 상태 (프로브가 실사이트에서 관측한 바로 그 상태).
    mountPlayer();
    const dispose = volumeFeature.start(ctx);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(control()).toBeNull();
    expect(warn).not.toHaveBeenCalled();

    // 2분 상한을 넘기면 포기한다.
    await vi.advanceTimersByTimeAsync(61_000);
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('ready window elapsed');
    // 포기했으면 타이머·옵저버가 남지 않는다 (무한 재시도 금지).
    expect(vi.getTimerCount()).toBe(0);

    dispose?.();
  });

  it('컨트롤바가 있는데 video 가 계속 없으면 라운드 상한에서 끝난다 (시간 상한 전에)', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const root = mountPlayer();
    const dispose = volumeFeature.start(ctx);

    // 플레이어가 계속 리렌더되는 상황 — 라운드가 쌓인다. 상한(30)을 넘기면 포기한다.
    for (let i = 0; i < 35; i += 1) {
      root.appendChild(document.createElement('span'));
      await vi.advanceTimersByTimeAsync(300);
    }

    const messages = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(messages).toContain('rounds');
    expect(messages).not.toContain('ready window elapsed');
    expect(vi.getTimerCount()).toBe(0);

    dispose?.();
  });
});

/**
 * 🔴 사용자 보고 2026-08-19: "새로고침하거나 새 탭으로 치지직을 열면 바로 자동재생이 안 되고
 * 재생 버튼을 눌러줘야 한다."
 *
 * 실측(`scripts/probe-autoplay-ab.mjs`, 3프로필 A/B)으로 확인한 사실:
 * - **확장 없이도 발생한다** — 엄격 정책 대조군에서 `paused · muted=false · readyState=0` 으로 멈춘다.
 * - 그 상태에서 우리가 `video.play()` 를 불러도 오류 없이 그대로 멈춰 있다(치지직이 스트림 미부착).
 * → 음소거로 만든 뒤 **플레이어 재생 버튼을 대신 누른다.** 소리는 첫 사용자 제스처에서 되돌린다.
 */
describe('volumeFeature — 막힌 자동재생을 대신 풀어 준다', () => {
  const ctx: FeatureContext = {
    page: { type: 'live', channelId: 'c'.repeat(32), videoNo: null, isSlotFrame: false },
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

  /** 실측 구조: 플레이어 루트 안에 `video` 와 재생 버튼(`pzp-pc__playback-switch`). */
  function mountBlockedPlayer({ paused = true, readyState = 4 } = {}): {
    video: HTMLVideoElement;
    button: HTMLButtonElement;
  } {
    const layout = document.createElement('div');
    layout.id = 'live_player_layout';
    const root = document.createElement('div');
    root.className = 'pzp-pc';
    const bar = document.createElement('div');
    bar.className = 'pzp-pc__bottom-buttons-right';
    root.appendChild(bar);

    const video = document.createElement('video');
    // 차단된 상태를 실측대로 흉내낸다: 멈춰 있고 음소거가 아니다.
    Object.defineProperty(video, 'readyState', { value: readyState, configurable: true });
    Object.defineProperty(video, 'paused', { value: paused, configurable: true, writable: true });
    video.muted = false;
    root.appendChild(video);

    const button = document.createElement('button');
    button.className = 'pzp-pc__playback-switch';
    button.setAttribute('aria-label', '재생');
    button.getBoundingClientRect = () =>
      ({ width: 36, height: 36, top: 0, left: 0, right: 36, bottom: 36 }) as DOMRect;
    root.appendChild(button);

    layout.appendChild(root);
    document.body.appendChild(layout);
    return { video, button };
  }

  function setUserActivation(hasBeenActive: boolean | undefined): void {
    if (hasBeenActive === undefined) {
      Reflect.deleteProperty(navigator, 'userActivation');
      return;
    }
    Object.defineProperty(navigator, 'userActivation', {
      configurable: true,
      value: { isActive: hasBeenActive, hasBeenActive },
    });
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setUserActivation(undefined);
    document.body.innerHTML = '';
  });

  it('사용자 조작이 없었고 멈춰 있으면 음소거로 만든 뒤 재생 버튼을 누른다', async () => {
    vi.useFakeTimers();
    setUserActivation(false);
    const { video, button } = mountBlockedPlayer();
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks += 1;
    });

    const dispose = volumeFeature.start(ctx);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(clicks).toBe(1);
    // 🔴 제스처 전까지 음소거를 유지해야 한다. 곧바로 소리를 켜면 다시 막혀 원래 증상으로 돌아간다.
    expect(video.muted).toBe(true);
    dispose?.();
  });

  /**
   * ⚠️ 사용자가 직접 멈춘 것을 다시 재생시키면 조작을 빼앗는 것이다.
   * 판정은 `navigator.userActivation` 이 아니라 **행동**으로 한다 — 실측에서 사람이 아무것도
   * 누르지 않았는데도 `hasBeenActive` 가 참이었다(자동화·합성 클릭으로 오염된다).
   */
  it('사용자가 멈춘 뒤에는 다시 재생시키지 않는다 (pause 시점 일시적 활성화로 가른다)', async () => {
    vi.useFakeTimers();
    setUserActivation(true);
    // 정상 재생 중으로 시작한다 — 진입 직후 차단이 아니므로 폴백 대상이 아니다.
    const { video, button } = mountBlockedPlayer({ paused: false });
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks += 1;
    });

    const dispose = volumeFeature.start(ctx);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(clicks).toBe(0);

    // 사용자가 재생 버튼을 눌러 멈춘다: 활성화 상태에서 pause 이벤트가 온다.
    Object.defineProperty(video, 'paused', { value: true, configurable: true, writable: true });
    video.dispatchEvent(new Event('pause'));
    await vi.advanceTimersByTimeAsync(5_000);

    expect(clicks).toBe(0);
    dispose?.();
  });

  it('userActivation 이 참이어도(자동화·합성 클릭 오염) 진입 직후 차단은 되살린다', async () => {
    vi.useFakeTimers();
    setUserActivation(true);
    const { button } = mountBlockedPlayer({ readyState: 0 });
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks += 1;
    });

    const dispose = volumeFeature.start(ctx);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(clicks).toBeGreaterThanOrEqual(1);
    dispose?.();
  });

  it('이미 재생 중이면 누르지 않는다', async () => {
    vi.useFakeTimers();
    setUserActivation(false);
    const { button } = mountBlockedPlayer({ paused: false });
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks += 1;
    });

    const dispose = volumeFeature.start(ctx);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(clicks).toBe(0);
    dispose?.();
  });
  /**
   * 🔴 회귀 고정 — **차단된 순간의 `video` 는 `readyState = 0` 이다** (실측 2026-08-19).
   * 첫 구현은 폴백을 `readyState >= 2` 분기에만 붙여 정작 차단 상태에서 한 번도 실행되지 않았다
   * (라이브 A/B 9회 중 3회 차단, 폴백 로그 0건).
   */
  it('스트림이 아직 안 붙은 상태(readyState 0)에서도 되살린다', async () => {
    vi.useFakeTimers();
    setUserActivation(false);
    const { video, button } = mountBlockedPlayer({ readyState: 0 });
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks += 1;
    });

    const dispose = volumeFeature.start(ctx);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(clicks).toBeGreaterThanOrEqual(1);
    expect(video.muted).toBe(true);
    dispose?.();
  });

  it('계속 멈춰 있어도 재생 버튼을 무한히 누르지 않는다', async () => {
    vi.useFakeTimers();
    setUserActivation(false);
    const { button } = mountBlockedPlayer({ readyState: 0 });
    let clicks = 0;
    // 눌러도 계속 멈춰 있는 상황(방송 종료·오류)을 흉내낸다.
    button.addEventListener('click', () => {
      clicks += 1;
    });

    const dispose = volumeFeature.start(ctx);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(clicks).toBeLessThanOrEqual(3);
    dispose?.();
  });
});
/**
 * 🔴 컨트롤바 볼륨 UI 에 음량 평탄화(컴프레서) 토글을 SVG 아이콘 버튼으로 넣는다.
 * `+`/`−` 옆에 렌더되고, 색만이 아니라 `aria-label`·`aria-pressed`·`data-enabled` 로 상태를
 * 알린다. 저장은 **사용자 클릭에서만** 한다 — 초기 렌더에서 저장하면 무한 재초기화 루프가
 * 생긴다는 것은 이 파일 상단 주석에 이미 기록된 실측 결함이다.
 */
describe('volumeFeature — 컴프레서(음량 평탄화) 토글 버튼', () => {
  /** chrome.storage.local 을 메모리로 대체한다 (chrome API 는 jsdom 에 없다). */
  function installFakeChrome(): { store: Record<string, unknown> } {
    const store: Record<string, unknown> = {};
    const fake = {
      storage: {
        local: {
          get: vi.fn(async (keys: string[] | string) => {
            const list = Array.isArray(keys) ? keys : [keys];
            const out: Record<string, unknown> = {};
            for (const key of list) if (key in store) out[key] = store[key];
            return out;
          }),
          set: vi.fn(async (patch: Record<string, unknown>) => {
            Object.assign(store, patch);
          }),
        },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    };
    (globalThis as unknown as { chrome: unknown }).chrome = fake;
    return { store };
  }

  let store: Record<string, unknown>;
  /** 저장이 fire-and-forget 이라 마이크로태스크를 한 바퀴 돌린다. 가짜 타이머 환경이라 실제
   *  `setTimeout` 대신 가짜 시계를 진행시켜야 큐에 쌓인 프로미스가 풀린다. */
  const flush = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(0);
  };

  const ctx: FeatureContext = {
    page: { type: 'live', channelId: 'd'.repeat(32), videoNo: null, isSlotFrame: false },
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

  function mountPlayer(): HTMLElement {
    const layout = document.createElement('div');
    layout.id = 'live_player_layout';
    const root = document.createElement('div');
    root.className = 'pzp-pc';
    const bar = document.createElement('div');
    bar.className = 'pzp-pc__bottom-buttons-right';
    root.appendChild(bar);
    layout.appendChild(root);
    document.body.appendChild(layout);
    return root;
  }

  function addVideo(root: HTMLElement): HTMLVideoElement {
    const video = document.createElement('video');
    Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
    root.appendChild(video);
    return video;
  }

  // 아이콘은 aria-hidden 이라 자체로는 못 찾는다 — data-enabled 는 이 버튼만 갖는다.
  const compressorButton = (): HTMLButtonElement | null =>
    document.querySelector<HTMLButtonElement>('#cm-volume-control button[data-enabled]');

  const savedCompressorEnabled = (): boolean | undefined =>
    (store[STORAGE_KEY] as Settings | undefined)?.audio?.compressor?.enabled;

  beforeEach(async () => {
    document.body.innerHTML = '';
    ({ store } = installFakeChrome());
    await resetAllSettings();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    Reflect.deleteProperty(globalThis as unknown as { chrome?: unknown }, 'chrome');
  });

  it('+/− 옆에 aria-label·aria-pressed 를 가진 토글 버튼이 렌더된다', async () => {
    vi.useFakeTimers();
    addVideo(mountPlayer());
    const dispose = volumeFeature.start(ctx);
    await vi.advanceTimersByTimeAsync(3_000);

    const button = compressorButton();
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-label')).toBe('음량 평탄화 켜기');
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    expect(button?.dataset.enabled).toBe('false');
    // "옆에" — +/− 와 같은 컨테이너 안에 있다.
    const group = document.getElementById('cm-volume-control');
    expect(group?.contains(button)).toBe(true);
    expect(group?.querySelector('button[aria-label="볼륨 낮추기"]')).not.toBeNull();
    expect(group?.querySelector('button[aria-label="볼륨 높이기"]')).not.toBeNull();

    dispose?.();
  });

  it('초기 렌더만으로는 저장하지 않는다 (무한 재초기화 루프 방지)', async () => {
    vi.useFakeTimers();
    addVideo(mountPlayer());
    const dispose = volumeFeature.start(ctx);
    // 준비 대기·자동 재확인(800ms)까지 넉넉히 지나도 컴프레서 설정은 그대로여야 한다.
    await vi.advanceTimersByTimeAsync(5_000);

    expect(savedCompressorEnabled()).toBe(false);

    dispose?.();
  });

  it('클릭하면 즉시 상태 표시가 뒤집히고 audio.compressor.enabled 를 반전시켜 저장한다', async () => {
    vi.useFakeTimers();
    addVideo(mountPlayer());
    const dispose = volumeFeature.start(ctx);
    await vi.advanceTimersByTimeAsync(3_000);

    const button = compressorButton();
    button?.click();

    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(button?.getAttribute('aria-label')).toBe('음량 평탄화 끄기');
    expect(button?.dataset.enabled).toBe('true');

    await flush();
    expect(savedCompressorEnabled()).toBe(true);

    button?.click();
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    expect(button?.getAttribute('aria-label')).toBe('음량 평탄화 켜기');
    expect(button?.dataset.enabled).toBe('false');

    await flush();
    expect(savedCompressorEnabled()).toBe(false);

    dispose?.();
  });

  it('색만으로 상태를 전달하지 않는다 — aria-pressed·data-enabled 가 함께 바뀐다', async () => {
    vi.useFakeTimers();
    addVideo(mountPlayer());
    const dispose = volumeFeature.start(ctx);
    await vi.advanceTimersByTimeAsync(3_000);

    const button = compressorButton();
    const colorBefore = button?.style.color;
    button?.click();

    expect(button?.style.color).not.toBe(colorBefore);
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(button?.dataset.enabled).toBe('true');

    dispose?.();
  });
});
