import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEVICE_PROFILES } from '../constants/device';
import { DEFAULT_SETTINGS } from '../constants/storage';
import type { FeatureContext } from './types';
import {
  isAlreadyAchieved,
  matchesTarget,
  normalizeQualityLabel,
  parseQualityLabel,
  pickQualityItem,
  qualityFeature,
  targetHeightPx,
} from './quality';

/**
 * 픽스처는 모두 2026-08-11 실측값이다 (분석 문서 §3.2).
 * 탭·개행이 섞인 원본 문자열을 그대로 쓴다 — 정규화가 실제로 필요한지 검증하기 위함이다.
 */
const LIVE_LABELS = [
  '1080p(원본) \n\t\t HD   \n\t\t60fps',
  '720p \n\t\t HD \n\t\t60fps',
  '480p',
  '360p',
];

const VOD_LABELS = ['자동 (1080p) HD', '1080p \n\t\t HD \n\t\t60fps', '720p HD 60fps', '144p'];

/** 모바일 웹은 각 항목이 2회 매칭된다 (목록 전체가 한 번 더 반복되는 형태). */
const MOBILE_BASE = ['자동', '1080p(원본)', '720p', '480p', '360p', '144p'];
const MOBILE_LABELS = [...MOBILE_BASE, ...MOBILE_BASE];
/** 인접 중복 형태도 같은 결과가 나와야 한다. */
const MOBILE_LABELS_ADJACENT = MOBILE_BASE.flatMap((label) => [label, label]);

describe('normalizeQualityLabel', () => {
  it('탭·개행이 섞인 텍스트를 단일 스페이스로 정규화한다', () => {
    expect(normalizeQualityLabel(LIVE_LABELS[0] as string)).toBe('1080p(원본) HD 60fps');
    expect(normalizeQualityLabel('  \n\t 720p \t HD \n ')).toBe('720p HD');
  });

  it('빈 문자열·공백만 있는 문자열은 빈 문자열이 된다', () => {
    expect(normalizeQualityLabel('')).toBe('');
    expect(normalizeQualityLabel(' \n\t ')).toBe('');
  });
});

describe('parseQualityLabel', () => {
  it('라이브 항목을 해석한다', () => {
    expect(parseQualityLabel(LIVE_LABELS[0] as string)).toEqual({
      isAuto: false,
      heightPx: 1080,
      autoResolution: null,
    });
    expect(parseQualityLabel('480p')).toEqual({
      isAuto: false,
      heightPx: 480,
      autoResolution: null,
    });
  });

  it('`자동 (1080p) HD` 는 자동 + 괄호 안 해상도로 해석한다', () => {
    expect(parseQualityLabel('자동 (1080p) HD')).toEqual({
      isAuto: true,
      heightPx: null,
      autoResolution: 1080,
    });
  });

  it('해상도 표기가 없는 `자동` 은 해상도를 알 수 없다', () => {
    expect(parseQualityLabel('자동')).toEqual({
      isAuto: true,
      heightPx: null,
      autoResolution: null,
    });
  });

  it('3자리 해상도(144p)도 해석한다', () => {
    expect(parseQualityLabel('144p')).toEqual({
      isAuto: false,
      heightPx: 144,
      autoResolution: null,
    });
  });

  it('숫자로 시작하지 않는 알 수 없는 항목은 heightPx 가 null 이다', () => {
    expect(parseQualityLabel('알 수 없음')).toEqual({
      isAuto: false,
      heightPx: null,
      autoResolution: null,
    });
  });
});

describe('targetHeightPx', () => {
  it('해상도 목표만 높이를 가진다', () => {
    expect(targetHeightPx('1080p')).toBe(1080);
    expect(targetHeightPx('720p')).toBe(720);
    expect(targetHeightPx('480p')).toBe(480);
    expect(targetHeightPx('auto')).toBeNull();
    expect(targetHeightPx('best')).toBeNull();
  });
});

describe('matchesTarget', () => {
  it('`1080p(원본)` 은 접두어 매칭으로 1080p 목표에 걸린다', () => {
    expect(matchesTarget(LIVE_LABELS[0] as string, '1080p')).toBe(true);
    expect(matchesTarget('1080p HD 60fps', '1080p')).toBe(true);
  });

  it('정확히 일치 비교라면 실패했을 케이스를 통과시킨다', () => {
    expect(normalizeQualityLabel(LIVE_LABELS[0] as string)).not.toBe('1080p');
    expect(matchesTarget(LIVE_LABELS[0] as string, '1080p')).toBe(true);
  });

  it('`자동 (1080p)` 는 1080p 접두어 매칭에 걸리지 않는다', () => {
    expect(matchesTarget('자동 (1080p) HD', '1080p')).toBe(false);
  });

  it('auto 목표는 `자동` 접두어에만 걸린다', () => {
    expect(matchesTarget('자동', 'auto')).toBe(true);
    expect(matchesTarget('자동 (1080p) HD', 'auto')).toBe(true);
    expect(matchesTarget('1080p(원본)', 'auto')).toBe(false);
  });

  it('best 목표는 접두어로 판정하지 않는다', () => {
    expect(matchesTarget('1080p(원본)', 'best')).toBe(false);
    expect(matchesTarget('자동', 'best')).toBe(false);
  });

  it('빈 라벨은 어떤 목표에도 걸리지 않는다', () => {
    expect(matchesTarget('', '1080p')).toBe(false);
    expect(matchesTarget('  ', 'auto')).toBe(false);
  });

  it('720p·480p 목표가 다른 항목에 오탐하지 않는다', () => {
    expect(matchesTarget('480p', '480p')).toBe(true);
    expect(matchesTarget('360p', '480p')).toBe(false);
    expect(matchesTarget('144p', '720p')).toBe(false);
  });
});

describe('isAlreadyAchieved', () => {
  it('`자동 (1080p)` 는 1080p 목표를 이미 달성한 것으로 본다 (클릭하지 않는다)', () => {
    expect(isAlreadyAchieved('자동 (1080p) HD', '1080p')).toBe(true);
  });

  it('괄호 안 해상도가 목표와 다르면 달성이 아니다', () => {
    expect(isAlreadyAchieved('자동 (720p)', '1080p')).toBe(false);
    expect(isAlreadyAchieved('자동 (1080p) HD', '720p')).toBe(false);
  });

  it('해상도를 모르는 `자동` 은 달성으로 인정하지 않는다', () => {
    expect(isAlreadyAchieved('자동', '1080p')).toBe(false);
  });

  it('목표와 접두어가 같으면 달성이다', () => {
    expect(isAlreadyAchieved(LIVE_LABELS[0] as string, '1080p')).toBe(true);
    expect(isAlreadyAchieved('720p HD 60fps', '720p')).toBe(true);
  });

  it('best 목표는 라벨 하나만으로 판정할 수 없다', () => {
    expect(isAlreadyAchieved('1080p(원본)', 'best')).toBe(false);
  });

  it('auto 목표는 `자동` 항목이 선택돼 있으면 달성이다', () => {
    expect(isAlreadyAchieved('자동', 'auto')).toBe(true);
  });
});

describe('pickQualityItem — 라이브 목록', () => {
  it('1080p 목표를 정확히 찾는다', () => {
    expect(pickQualityItem(LIVE_LABELS, '1080p')).toEqual({
      index: 0,
      reason: 'target match "1080p(원본) HD 60fps"',
    });
  });

  it('720p 목표를 찾는다', () => {
    expect(pickQualityItem(LIVE_LABELS, '720p')?.index).toBe(1);
  });

  it('best 목표는 최고 해상도를 고른다', () => {
    expect(pickQualityItem(LIVE_LABELS, 'best')).toEqual({
      index: 0,
      reason: 'best available "1080p(원본) HD 60fps"',
    });
  });

  it('auto 항목이 없으면 auto 목표는 null 이다', () => {
    expect(pickQualityItem(LIVE_LABELS, 'auto')).toBeNull();
  });
});

describe('pickQualityItem — VOD 목록 (480p·360p 없음)', () => {
  it('1080p 목표는 `자동 (1080p)` 이 아니라 명시 항목을 고른다', () => {
    expect(pickQualityItem(VOD_LABELS, '1080p')?.index).toBe(1);
  });

  it('없는 480p 목표는 최고 화질로 폴백한다', () => {
    const pick = pickQualityItem(VOD_LABELS, '480p');
    expect(pick?.index).toBe(1);
    expect(pick?.reason).toContain('fallback');
  });

  it('best 폴백 후보에서 `자동` 항목은 제외된다', () => {
    expect(pickQualityItem(VOD_LABELS, 'best')?.index).toBe(1);
  });

  it('auto 목표는 `자동 (1080p)` 을 고른다', () => {
    expect(pickQualityItem(VOD_LABELS, 'auto')?.index).toBe(0);
  });
});

describe('pickQualityItem — 모바일 웹 목록 (각 항목 2회 중복)', () => {
  it('중복을 제거하고 처음 등장한 인덱스를 돌려준다', () => {
    expect(pickQualityItem(MOBILE_LABELS, '1080p')?.index).toBe(1);
    expect(pickQualityItem(MOBILE_LABELS, '480p')?.index).toBe(3);
  });

  it('인접 중복 형태에서도 처음 등장한 인덱스를 돌려준다', () => {
    expect(MOBILE_LABELS_ADJACENT[2]).toBe('1080p(원본)');
    expect(pickQualityItem(MOBILE_LABELS_ADJACENT, '1080p')?.index).toBe(2);
  });

  it('best 는 144p 가 있어도 1080p 를 고른다', () => {
    expect(pickQualityItem(MOBILE_LABELS, 'best')?.index).toBe(1);
  });

  it('auto 목표는 첫 `자동` 항목을 고른다', () => {
    expect(pickQualityItem(MOBILE_LABELS, 'auto')?.index).toBe(0);
  });
});

describe('pickQualityItem — 경계', () => {
  it('빈 목록은 null 이다', () => {
    expect(pickQualityItem([], '1080p')).toBeNull();
  });

  it('공백만 있는 항목은 후보에서 제외된다', () => {
    expect(pickQualityItem(['', '  \n\t '], '1080p')).toBeNull();
  });

  it('해상도를 알 수 없는 항목만 있으면 폴백할 대상이 없다', () => {
    expect(pickQualityItem(['자동', '알 수 없음'], '1080p')).toBeNull();
  });

  it('저화질 송출 채널(360p 만)에서는 360p 로 폴백한다', () => {
    const pick = pickQualityItem(['360p', '144p'], '1080p');
    expect(pick?.index).toBe(0);
    expect(pick?.reason).toBe('target 1080p unavailable, fallback to "360p"');
  });

  it('목록 순서가 오름차순이어도 최고 화질을 고른다', () => {
    expect(pickQualityItem(['144p', '360p', '720p'], 'best')?.index).toBe(2);
  });
});

describe('isAlreadyAchieved — 자동 (1080p) 를 달성으로 보지 않는다', () => {
  /** 실측 라이브 목록 (chzzk-dom-2). `자동` 과 고정 항목이 함께 있다. */
  const LIVE_LABELS = [
    '자동 (1080p) HD',
    '1080p(원본) HD 60fps',
    '720p HD',
    '480p',
    '360p',
    '144p',
  ];

  it('🔴 자동 (1080p) 는 목록에 고정 1080p 가 있으면 달성이 아니다', () => {
    // 자동은 대역폭에 따라 내려간다 → 고정 항목을 눌러야 한다.
    expect(isAlreadyAchieved('자동 (1080p) HD', '1080p', LIVE_LABELS)).toBe(false);
  });

  it('고정 1080p 가 선택돼 있으면 달성이다', () => {
    expect(isAlreadyAchieved('1080p(원본) HD 60fps', '1080p', LIVE_LABELS)).toBe(true);
  });

  it('고정 항목이 없으면(VOD 등) 자동 (1080p) 를 달성으로 인정한다', () => {
    expect(isAlreadyAchieved('자동 (1080p)', '1080p', ['자동 (1080p)', '720p', '480p'])).toBe(true);
  });

  it('목록을 주지 않으면 예전처럼 관대하게 본다 (호출부가 목록을 넘기도록 되어 있다)', () => {
    expect(isAlreadyAchieved('자동 (1080p)', '1080p')).toBe(true);
  });

  it('자동 해상도가 목표와 다르면 달성이 아니다', () => {
    expect(isAlreadyAchieved('자동 (720p)', '1080p', LIVE_LABELS)).toBe(false);
  });

  it('목표가 auto 면 자동 항목이 달성이다', () => {
    expect(isAlreadyAchieved('자동 (1080p) HD', 'auto', LIVE_LABELS)).toBe(true);
  });

  it('고정 1080p 목록에서 pickQualityItem 이 고정 항목을 고른다', () => {
    const pick = pickQualityItem(LIVE_LABELS, '1080p');
    expect(pick).not.toBeNull();
    expect(LIVE_LABELS[pick?.index ?? -1]).toBe('1080p(원본) HD 60fps');
  });
});

/**
 * 🔴 회귀 — 광고 차단 안내 팝업이 떠 있으면 1080p 자동 전환이 안 된다 (사용자 보고 2026-08-15).
 *
 * 모달이 떠 있는 동안에는 설정 버튼이 없거나 가려져 최초 백오프(5회 · 약 3초)가 전부 실패하고,
 * 예전 구현은 그 페이지에서 영구 포기했다 — adBlockNotice 가 나중에 모달을 닫아도 다시 돌지 않았다.
 * 여기서는 "처음엔 아무것도 없다가 잠시 뒤 플레이어가 나타나는" 상황을 재현한다.
 */
describe('qualityFeature — 플레이어가 늦게 나타나도 결국 적용한다', () => {
  const CHECKED = 'pzp-ui-setting-pane-item--checked';
  /** 실측 라이브 목록 (chzzk-dom-2). 처음에는 `자동` 이 선택돼 있다. */
  const LIVE_ITEMS = ['자동 (1080p) HD', '1080p(원본) HD 60fps', '720p HD', '480p', '360p'];

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

  /** jsdom 은 레이아웃을 계산하지 않아 rect 가 0 이다 → qsVisible 이 통과하도록 크기를 주입한다. */
  function giveSize(el: Element): void {
    el.getBoundingClientRect = () =>
      ({ width: 32, height: 32, top: 0, left: 0, right: 32, bottom: 32, x: 0, y: 0 }) as DOMRect;
  }

  /**
   * 광고·모달이 걷힌 뒤의 플레이어. 설정 버튼을 눌러야 화질 목록이 렌더된다.
   * ⚠️ 컨테이너 ID 는 실측 그대로 `#live_player_layout` 이다 — 되돌림 감시가 이 범위의
   * `<video>` 만 보기 때문에(m5) 여기서도 같은 구조를 만든다.
   */
  function mountPlayer(): HTMLElement {
    const bar = document.createElement('div');
    bar.id = 'live_player_layout';
    const button = document.createElement('button');
    button.setAttribute('aria-label', '설정');
    giveSize(button);
    button.addEventListener('click', () => {
      if (bar.querySelector('ul')) return;
      const list = document.createElement('ul');
      LIVE_ITEMS.forEach((label, index) => {
        const item = document.createElement('li');
        item.className = 'pzp-ui-setting-quality-item';
        if (index === 0) item.classList.add(CHECKED);
        item.textContent = label;
        item.setAttribute('data-click-count', '0');
        item.addEventListener('click', () => {
          // 🔴 M2 회귀 판정의 핵심 — "라벨이 이미 목표와 같아도 실제로 눌렸는가"를 센다.
          const before = Number(item.getAttribute('data-click-count') ?? '0');
          item.setAttribute('data-click-count', String(before + 1));
          for (const other of Array.from(list.children)) other.classList.remove(CHECKED);
          item.classList.add(CHECKED);
        });
        list.appendChild(item);
      });
      bar.appendChild(list);
    });
    bar.appendChild(button);
    document.body.appendChild(bar);
    return bar;
  }

  /**
   * 실사이트를 본뜬 플레이어 — 항목이 **`keydown` Enter 에만** 반응한다.
   * `click` 리스너는 일부러 달지 않는다 (실측: 합성 `click()` 은 무시된다).
   * `listPreRendered` 면 설정 버튼을 누르지 않아도 목록이 DOM 에 있다 (실측: 0×0 로 존재).
   */
  function mountKeydownPlayer(options: { listPreRendered?: boolean } = {}): {
    settingClicks: () => number;
  } {
    const bar = document.createElement('div');
    bar.id = 'live_player_layout';
    const button = document.createElement('button');
    button.setAttribute('aria-label', '설정');
    giveSize(button);
    let settingClicks = 0;

    const renderList = () => {
      if (bar.querySelector('ul')) return;
      const list = document.createElement('ul');
      LIVE_ITEMS.forEach((label, index) => {
        const item = document.createElement('li');
        item.className = 'pzp-ui-setting-quality-item';
        if (index === 0) item.classList.add(CHECKED);
        item.textContent = label;
        item.setAttribute('data-click-count', '0');
        item.addEventListener('keydown', (event) => {
          if ((event as KeyboardEvent).key !== 'Enter') return;
          for (const other of Array.from(list.children)) other.classList.remove(CHECKED);
          item.classList.add(CHECKED);
        });
        item.addEventListener('click', () => {
          // 클릭 폴백이 돌았는지 세기만 한다 — 실사이트처럼 선택은 바뀌지 않는다.
          const before = Number(item.getAttribute('data-click-count') ?? '0');
          item.setAttribute('data-click-count', String(before + 1));
        });
        list.appendChild(item);
      });
      bar.appendChild(list);
    };

    button.addEventListener('click', () => {
      settingClicks += 1;
      renderList();
    });
    bar.appendChild(button);
    document.body.appendChild(bar);
    if (options.listPreRendered === true) renderList();
    return { settingClicks: () => settingClicks };
  }

  /** 되돌림 감시 대상 `<video>`. 플레이어 컨테이너 **안에** 넣어야 스코프 셀렉터에 잡힌다. */
  function mountVideo(host: HTMLElement, height: number): { set: (px: number) => void } {
    const video = document.createElement('video');
    let current = height;
    Object.defineProperty(video, 'videoHeight', { get: () => current });
    host.appendChild(video);
    return {
      set: (px: number) => {
        current = px;
      },
    };
  }

  /** 광고 플레이어(레거시 네이버). `button.btn_skip` 은 광고 시작부터 DOM 에 있다 (adSkip.ts 실측). */
  function mountAdPlayer(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'vod_player_wrap pc';
    const skip = document.createElement('button');
    skip.className = 'btn_skip';
    skip.style.display = 'none';
    wrap.appendChild(skip);
    document.body.appendChild(wrap);
    return wrap;
  }

  function checkedLabel(): string | null {
    return document.querySelector(`li.${CHECKED}`)?.textContent ?? null;
  }

  function clickedLabels(host: ParentNode = document): string[] {
    return Array.from(host.querySelectorAll('li.pzp-ui-setting-quality-item')).flatMap((el) =>
      Number(el.getAttribute('data-click-count') ?? '0') > 0
        ? [`${normalizeQualityLabel(el.textContent ?? '')}×${el.getAttribute('data-click-count')}`]
        : [],
    );
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('처음엔 설정 버튼도 화질 목록도 없다가 나중에 나타나면 화질이 결국 적용된다', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';

    const dispose = qualityFeature.start(ctx);

    // 최초 백오프(약 3초)가 전부 실패하는 구간 — 예전 구현은 여기서 영구 포기했다.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(checkedLabel()).toBeNull();

    // adBlockNotice 가 모달을 닫고 광고가 끝나 플레이어가 나타난 시점.
    mountPlayer();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(normalizeQualityLabel(checkedLabel() ?? '')).toBe('1080p(원본) HD 60fps');

    dispose?.();
  });

  it('성공하면 재시도 경로가 정리되어 타이머·옵저버가 남지 않는다', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';

    const dispose = qualityFeature.start(ctx);
    await vi.advanceTimersByTimeAsync(5_000);
    mountPlayer();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(checkedLabel()).not.toBeNull();

    dispose?.();
    expect(vi.getTimerCount()).toBe(0);
  });

  /**
   * 실측 2026-08-15 (`adblock-shots/report.json`): 우리가 1080p 를 적용한 뒤
   * 치지직이 360p 로 되돌렸고, 목록 구성은 그대로여서 `childList` 옵저버가 놓쳤다.
   */
  it('적용 뒤 치지직이 화질을 되돌리면 다시 적용한다', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    const host = mountPlayer();
    const video = mountVideo(host, 1080);

    const dispose = qualityFeature.start(ctx);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(normalizeQualityLabel(checkedLabel() ?? '')).toBe('1080p(원본) HD 60fps');

    // 치지직이 몰래 360p 로 내린다 — 선택만 바뀌고 목록은 그대로다.
    const items = Array.from(document.querySelectorAll('li.pzp-ui-setting-quality-item'));
    for (const item of items) item.classList.remove(CHECKED);
    items[items.length - 1]?.classList.add(CHECKED);
    video.set(360);

    // 쿨다운(30초)이 지나기 전에는 건드리지 않는다.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(normalizeQualityLabel(checkedLabel() ?? '')).toBe('360p');

    await vi.advanceTimersByTimeAsync(30_000);
    expect(normalizeQualityLabel(checkedLabel() ?? '')).toBe('1080p(원본) HD 60fps');

    dispose?.();
    expect(vi.getTimerCount()).toBe(0);
  });

  /**
   * 🔴 M2 회귀 (코드 리뷰 2026-08-15). 실측 상황은 **"라벨은 1080p 그대로인데 실제 해상도가
   * 360p"** 였다. 조기 반환(`isAlreadyAchieved`)이 살아 있으면 재적용이 아무것도 누르지 않는
   * no-op 이 되고 재적용 예산만 소모된다. 여기서는 **항목이 실제로 다시 클릭됐는지**를 센다.
   */
  it('🔴 라벨은 목표 그대로인데 videoHeight 만 낮으면 항목을 강제로 다시 클릭한다', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    const host = mountPlayer();
    const video = mountVideo(host, 1080);

    const dispose = qualityFeature.start(ctx);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(normalizeQualityLabel(checkedLabel() ?? '')).toBe('1080p(원본) HD 60fps');

    const target = Array.from(document.querySelectorAll('li.pzp-ui-setting-quality-item')).find(
      (el) => normalizeQualityLabel(el.textContent ?? '') === '1080p(원본) HD 60fps',
    );
    const clicksAfterInitialApply = Number(target?.getAttribute('data-click-count'));
    expect(clicksAfterInitialApply).toBe(1);

    // 🔴 라벨(선택 표시)은 1080p 그대로 두고 실제 해상도만 360p 로 떨어뜨린다.
    video.set(360);
    expect(normalizeQualityLabel(checkedLabel() ?? '')).toBe('1080p(원본) HD 60fps');

    // 연속 샘플(3회 · 15초) + 쿨다운(30초)을 넘긴다.
    await vi.advanceTimersByTimeAsync(60_000);

    expect(Number(target?.getAttribute('data-click-count'))).toBeGreaterThan(
      clicksAfterInitialApply,
    );
    // 클릭이 일어난 항목은 목표 항목 하나뿐이어야 한다 (엉뚱한 항목을 누르지 않았다).
    expect(clickedLabels().map((entry) => entry.split('×')[0])).toEqual(['1080p(원본) HD 60fps']);

    dispose?.();
    expect(vi.getTimerCount()).toBe(0);
  });

  /**
   * 🔴 M4 회귀. 광고가 같은 `<video>` 로 480p 재생되는 구간에서는 되돌림 판정을 건너뛴다.
   * 오판하면 설정 패널이 열렸다 닫히며 깜빡이고 재적용 예산도 광고가 소진한다.
   */
  it('🔴 광고 재생 중에는 해상도가 낮아도 재적용하지 않는다', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    const host = mountPlayer();
    const video = mountVideo(host, 1080);

    const dispose = qualityFeature.start(ctx);
    await vi.advanceTimersByTimeAsync(3_000);
    const target = Array.from(document.querySelectorAll('li.pzp-ui-setting-quality-item')).find(
      (el) => normalizeQualityLabel(el.textContent ?? '') === '1080p(원본) HD 60fps',
    );
    expect(Number(target?.getAttribute('data-click-count'))).toBe(1);

    // 광고 플레이어가 붙고 480p 로 재생된다.
    const ad = mountAdPlayer();
    video.set(480);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(Number(target?.getAttribute('data-click-count'))).toBe(1);

    // 광고가 끝나고도 낮은 채로 남으면 그때는 재적용한다.
    ad.remove();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(Number(target?.getAttribute('data-click-count'))).toBeGreaterThan(1);

    dispose?.();
    expect(vi.getTimerCount()).toBe(0);
  });

  /** 🔴 M4 회귀 — 1회짜리 순간 저하(버퍼링·전환)로는 재적용하지 않는다. */
  it('🔴 해상도 저하가 1회 샘플뿐이면 재적용하지 않는다', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    const host = mountPlayer();
    const video = mountVideo(host, 1080);

    const dispose = qualityFeature.start(ctx);
    await vi.advanceTimersByTimeAsync(3_000);
    const target = Array.from(document.querySelectorAll('li.pzp-ui-setting-quality-item')).find(
      (el) => normalizeQualityLabel(el.textContent ?? '') === '1080p(원본) HD 60fps',
    );

    // 쿨다운이 끝난 뒤 한 샘플만 360p 였다가 곧바로 회복한다.
    await vi.advanceTimersByTimeAsync(35_000);
    video.set(360);
    await vi.advanceTimersByTimeAsync(5_000);
    video.set(1080);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(Number(target?.getAttribute('data-click-count'))).toBe(1);

    dispose?.();
    expect(vi.getTimerCount()).toBe(0);
  });

  /**
   * 🔴 M3 회귀. `readyRounds` 가 성공 라운드까지 세면, 오래 시청한 페이지에서 라운드가 상한을
   * 넘긴 뒤 한 번만 실패해도 `giveUp` 으로 기능이 영구 비활성이 됐다. 성공 시 리셋을 검증한다.
   */
  it('🔴 성공 라운드가 상한을 넘게 쌓여도 그 뒤 한 번 실패했다고 영구 포기하지 않는다', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    const host = mountPlayer();
    const video = mountVideo(host, 1080);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const dispose = qualityFeature.start(ctx);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(normalizeQualityLabel(checkedLabel() ?? '')).toBe('1080p(원본) HD 60fps');

    // 목록 옵저버를 12회 깨운다 (상한 10 초과). 매번 이미 목표 상태라 run 은 성공으로 끝난다.
    const list = host.querySelector('ul') as HTMLUListElement;
    for (let i = 0; i < 12; i += 1) {
      list.appendChild(document.createElement('li'));
      await vi.advanceTimersByTimeAsync(600);
    }
    expect(warn).not.toHaveBeenCalled();

    // 이제 플레이어가 리렌더로 사라진다 → 다음 run 은 실패한다.
    list.remove();
    host.querySelector('button')?.remove();

    // 드리프트 감시가 재적용을 시도했다가 실패하는 경로.
    video.set(360);
    await vi.advanceTimersByTimeAsync(60_000);

    const messages = warn.mock.calls.map((call) => String(call[0]));
    // 🔴 예전 구현: readyRounds 가 13 이라 첫 실패에서 곧바로 giveUp → 페이지 내내 기능 사망.
    expect(messages.some((m) => m.includes('quality list not found'))).toBe(false);

    // 기능이 살아 있으니 플레이어가 돌아오면 다시 적용된다.
    mountPlayer();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(normalizeQualityLabel(checkedLabel() ?? '')).toBe('1080p(원본) HD 60fps');

    dispose?.();
  });

  /** m5 회귀 — 되돌림 감시는 플레이어 밖의 `<video>`(광고 iframe·배너 등)를 보지 않는다. */
  it('플레이어 컨테이너 밖의 video 는 되돌림 판정에 쓰지 않는다', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    // 문서 전체의 첫 video 는 플레이어 밖에 있는 360p 짜리다.
    const stray = document.createElement('video');
    Object.defineProperty(stray, 'videoHeight', { get: () => 360 });
    document.body.appendChild(stray);

    const host = mountPlayer();
    mountVideo(host, 1080);

    const dispose = qualityFeature.start(ctx);
    await vi.advanceTimersByTimeAsync(3_000);
    const target = Array.from(document.querySelectorAll('li.pzp-ui-setting-quality-item')).find(
      (el) => normalizeQualityLabel(el.textContent ?? '') === '1080p(원본) HD 60fps',
    );
    expect(Number(target?.getAttribute('data-click-count'))).toBe(1);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(Number(target?.getAttribute('data-click-count'))).toBe(1);

    dispose?.();
    expect(vi.getTimerCount()).toBe(0);
  });

  /**
   * 사용자 요청 2026-08-15: "1080p 포기하지 말고 계속 눌러서 계속 1080p 세팅 하도록 하자."
   * 이전에는 5회 시도 후 물러났다 — 이제 상한이 없다.
   */
  it('되돌림이 계속되면 포기하지 않고 계속 재적용한다', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    const host = mountPlayer();
    // 무엇을 눌러도 실제 해상도는 계속 360p 인 상황.
    mountVideo(host, 360);
    const dispose = qualityFeature.start(ctx);
    await vi.advanceTimersByTimeAsync(3_000);

    // 예전 상한(5회)을 훌쩍 넘기는 시간을 흘린다.
    await vi.advanceTimersByTimeAsync(300_000);

    /**
     * 로그가 아니라 **실제 클릭 수**로 센다 — `info()` 는 디버그 모드에서만 출력되므로
     * 테스트에서 관찰할 수 없다. 픽스처가 항목마다 클릭을 직접 센다.
     */
    const target = Array.from(document.querySelectorAll('li.pzp-ui-setting-quality-item')).find(
      (el) => normalizeQualityLabel(el.textContent ?? '').startsWith('1080p'),
    );
    const clicks = Number(target?.getAttribute('data-click-count') ?? '0');
    // 쿨다운 15초 → 300초면 5회를 훨씬 넘는다. 상한이 남아 있으면 여기서 걸린다.
    expect(clicks).toBeGreaterThan(5);

    dispose?.();
    expect(vi.getTimerCount()).toBe(0);
  });

  /**
   * 🔴 실측 2026-08-15 (`quality-ext-noui-shots/report.json`, 프로브
   * `scripts/probe-quality-ext-noui.mjs`): 화질 `li` 에 합성 `keydown` Enter 를 보내면
   * 설정 패널을 열지 않아도(rect 0×0) 화질이 실제로 바뀐다. 같은 항목의 `click()` 은 실패한다.
   * 여기서는 keydown 만 받는 픽스처를 만들어 **클릭 없이도 적용되는지**를 검증한다.
   */
  it('🔴 keydown Enter 만 받는 항목도 활성화한다 (클릭하지 않는다)', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    mountKeydownPlayer();

    const dispose = qualityFeature.start(ctx);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(normalizeQualityLabel(checkedLabel() ?? '')).toBe('1080p(원본) HD 60fps');
    // 클릭 폴백이 돌지 않았어야 한다 — keydown 으로 이미 `--checked` 가 옮겨갔기 때문이다.
    expect(clickedLabels()).toEqual([]);

    dispose?.();
  });

  /**
   * 폴백 회귀 — keydown 경로는 VOD·모바일 웹(`m.chzzk`)에서 미검증이다.
   * keydown 이 안 먹는 항목에서는 예전처럼 `click()` 으로 떨어져야 한다 (NFR-05).
   */
  it('🔴 keydown 이 안 먹으면 click 으로 폴백한다', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    // mountPlayer 의 항목은 click 리스너만 달려 있다 = keydown 무시.
    mountPlayer();

    const dispose = qualityFeature.start(ctx);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(normalizeQualityLabel(checkedLabel() ?? '')).toBe('1080p(원본) HD 60fps');
    expect(clickedLabels()).toEqual(['1080p(원본) HD 60fps×1']);

    dispose?.();
  });

  /**
   * 🔴 2단계 메뉴 개봉 제거 회귀. 항목은 패널을 열지 않아도 DOM 에 있고 keydown 이 먹으므로,
   * 목록이 이미 있으면 설정 버튼을 **절대** 누르지 않는다 (패널 깜빡임 제거).
   */
  it('🔴 화질 목록이 이미 DOM 에 있으면 설정 버튼을 누르지 않는다', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    const { settingClicks } = mountKeydownPlayer({ listPreRendered: true });

    const dispose = qualityFeature.start(ctx);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(normalizeQualityLabel(checkedLabel() ?? '')).toBe('1080p(원본) HD 60fps');
    expect(settingClicks()).toBe(0);

    dispose?.();
  });

  it('플레이어가 끝내 나타나지 않으면 상한에서 warning 을 남기고 포기한다', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const dispose = qualityFeature.start(ctx);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(warn).not.toHaveBeenCalled();

    // 재시도 시간 상한(2분)이 지나면 조용히 비활성으로 끝낸다 (NFR-05).
    await vi.advanceTimersByTimeAsync(130_000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('quality list not found');

    dispose?.();
    expect(vi.getTimerCount()).toBe(0);
  });
});
