/**
 * 콘텐츠 스크립트 — 기능 초기화 오케스트레이션.
 *
 * ⚠️ `all_frames: true` 로 주입되므로 (FR-14 멀티뷰 슬롯 제어에 필수) 치지직이 삽입하는
 * 광고·소셜 iframe 에도 실행된다. **대상 프레임이 아니면 즉시 반환**해 불필요한 옵저버를
 * 걸지 않는다 (NFR-02b · NFR-04).
 *
 * 🔴 **설정 변경에 전 기능을 재시작하지 않는다** (실측 결함 3건의 공통 원인).
 * 전체 재시작을 하면 다음이 전부 깨진다:
 * - 설정 패널이 사용자가 값을 바꾸는 순간 닫힌다 (패널 자신이 언마운트된다)
 * - 멀티뷰가 오디오 슬롯을 바꿀 때마다 iframe 4개를 다시 로드한다
 * - 볼륨을 올리면 재시작이 기본값을 다시 적용해 되돌아간다
 * → 변경된 설정 섹션과 관련된 기능만 재시작한다 (`Feature.watches`).
 * 전체 재시작은 **라우팅·기기 유형 변경** 때만 한다.
 */

import { FEATURES } from './features/registry';
import type { Disposer, Feature, FeatureContext } from './features/types';
import { decideDevice, applyDeviceAttributes } from './device';
import { detectPageType, refineWithDom } from './pageType';
import { loadSettings, onSettingsChanged, getCachedSettings } from './storage';
import { WINDOW_LOCAL_SECTIONS, type Settings } from './constants/storage';
import { error, guard, info } from './utils/log';
import { onRouteChange, onViewportChange } from './utils/index';

/** 현재 돌고 있는 기능의 정리 함수. 기능 단위로 재시작하려면 id 로 찾을 수 있어야 한다. */
const running = new Map<string, Disposer | null>();

let stopRoute: Disposer | undefined;
let stopSettings: Disposer | undefined;
let stopViewport: Disposer | undefined;

function buildContext(settings: Settings): FeatureContext {
  const page = refineWithDom(detectPageType(location.href));
  const device = decideDevice(settings.device.override);
  return { page, device, settings };
}

function stopFeature(id: string): void {
  const dispose = running.get(id);
  if (dispose) guard(`${id}.dispose`, dispose);
  running.delete(id);
}

function stopAllFeatures(): void {
  for (const id of [...running.keys()]) stopFeature(id);
}

/** 기능 하나를 (다시) 시작한다. 이미 돌고 있으면 먼저 정리해 멱등성을 지킨다 (FR-12.1). */
function startFeature(feature: Feature, ctx: FeatureContext): void {
  stopFeature(feature.id);

  const supported = guard(`${feature.id}.supports`, () => feature.supports(ctx));
  if (!supported) return;

  const dispose = guard(`${feature.id}.start`, () => feature.start(ctx));
  running.set(feature.id, typeof dispose === 'function' ? dispose : null);
}

/** 전 기능을 다시 시작한다. 라우팅·기기 유형 변경 전용이다. */
function restartAll(settings: Settings): void {
  stopAllFeatures();

  const ctx = buildContext(settings);
  if (ctx.page.type === 'unsupported') {
    info('frame is not a chzzk page, skipping initialization');
    return;
  }

  applyDeviceAttributes(ctx.device);
  for (const feature of FEATURES) startFeature(feature, ctx);

  info(`initialized ${running.size} feature(s) for ${ctx.page.type} / ${ctx.device.deviceClass}`);
}

/** 두 설정에서 값이 달라진 최상위 섹션 키. */
export function changedSections(prev: Settings, next: Settings): (keyof Settings)[] {
  const keys = Object.keys(next) as (keyof Settings)[];
  return keys.filter((key) => JSON.stringify(prev[key]) !== JSON.stringify(next[key]));
}

/**
 * 이 기능이 바뀐 섹션 때문에 재시작해야 하는가.
 * `watches` 를 생략한 기능은 보수적으로 재시작한다. `[]` 는 절대 재시작하지 않는다.
 */
export function shouldRestartFeature(
  feature: Pick<Feature, 'watches'> & { id?: string },
  changed: readonly (keyof Settings)[],
  /**
   * 이 변경을 만든 기능의 id. **자기 자신이 쓴 변경으로는 재시작하지 않는다** —
   * 쓴 쪽은 이미 새 값을 적용한 상태이고, 재시작하면 편집 상태가 날아가거나
   * 저장값을 기준으로 다시 계산해 사용자 입력을 되돌린다.
   */
  origin: string | null = null,
  /**
   * **다른 창(탭)이 쓴 변경인가.** 참이면 창 로컬 섹션(`WINDOW_LOCAL_SECTIONS`)의 변화는
   * 이 창에서 무시한다 — FR-05 레이아웃 조작은 조작한 창에만 적용되고, 저장값은 앞으로
   * 새로 여는 탭의 기본값으로만 쓰인다 (사용자 보고 2026-08-15).
   */
  foreignWindow = false,
): boolean {
  if (origin !== null && feature.id === origin) return false;
  const relevant = foreignWindow
    ? changed.filter((key) => !WINDOW_LOCAL_SECTIONS.includes(key))
    : changed;
  // 다른 창이 창 로컬 섹션만 바꿨다면 이 창에서는 할 일이 없다.
  if (foreignWindow && relevant.length === 0) return false;
  if (feature.watches === undefined) return true;
  return feature.watches.some((key) => relevant.includes(key));
}

function applySettingsChange(
  prev: Settings,
  next: Settings,
  origin: string | null,
  foreignWindow: boolean,
): void {
  const changed = changedSections(prev, next);
  if (changed.length === 0) {
    // `chrome.storage` 는 값이 같아도 `set` 하면 `onChanged` 를 발생시킨다 — 여기서 끊는다.
    info('settings write produced no change, skipping');
    return;
  }

  /**
   * 기기 유형 override 는 터치 타겟·밀도·분할 상한까지 바꾸므로 전 기능에 영향을 준다.
   * 이때만 예외적으로 전체 재시작을 한다.
   */
  if (changed.includes('device')) {
    info('device override changed, reinitializing all features');
    restartAll(next);
    return;
  }

  const ctx = buildContext(next);
  if (ctx.page.type === 'unsupported') return;

  const targets = FEATURES.filter((feature) =>
    shouldRestartFeature(feature, changed, origin, foreignWindow),
  );
  if (targets.length === 0) {
    info(
      `settings changed [${changed.join(', ')}] → no feature needs a restart` +
        (foreignWindow ? ' (written by another window)' : ''),
    );
    return;
  }

  for (const feature of targets) startFeature(feature, ctx);

  info(
    `settings changed [${changed.join(', ')}] → restarted ${targets.length} feature(s): ${targets
      .map((f) => f.id)
      .join(', ')}`,
  );
}

async function bootstrap(): Promise<void> {
  // 도메인 판별은 설정을 읽기 전에 한다 — 무관한 프레임에서 storage 를 건드리지 않는다.
  const preliminary = detectPageType(location.href);
  if (preliminary.type === 'unsupported') return;

  const settings = await loadSettings();
  restartAll(settings);

  stopRoute = onRouteChange((url) => {
    info(`route changed to ${url}, reinitializing`);
    restartAll(getCachedSettings());
  });

  let previousSettings = settings;
  stopSettings = onSettingsChanged((next, meta) => {
    const prev = previousSettings;
    previousSettings = next;
    applySettingsChange(prev, next, meta.origin, meta.foreignWindow);
  });

  /**
   * 크기 변화 시 기기 유형을 재판정한다. 레이아웃 값 자체는 각 기능이 자기 구독으로
   * 재계산하므로 여기서는 deviceClass 가 바뀔 때만 재시작한다 — 리사이즈마다
   * 전체 재시작을 하면 저사양 기기에서 프레임 예산을 넘긴다.
   */
  let lastDeviceClass = decideDevice(settings.device.override).deviceClass;
  stopViewport = onViewportChange(
    ({ keyboardLikely }) => {
      // IME 로 높이만 줄어든 경우는 레이아웃을 재배치하지 않는다.
      if (keyboardLikely) return;
      const current = decideDevice(getCachedSettings().device.override).deviceClass;
      if (current === lastDeviceClass) return;
      info(`deviceClass changed ${lastDeviceClass} → ${current}, reinitializing`);
      lastDeviceClass = current;
      restartAll(getCachedSettings());
    },
    { relaxed: decideDevice(settings.device.override).profile.relaxObservers },
  );
}

function shutdown(): void {
  stopAllFeatures();
  stopRoute?.();
  stopSettings?.();
  stopViewport?.();
}

window.addEventListener('pagehide', shutdown, { once: true });

bootstrap().catch((e) => error('bootstrap failed', e));
