/**
 * FR-07 자동 넓은 화면.
 *
 * 실측 근거 (2026-08-11, 분석 문서 §5.1)
 * - `button.pzp-viewmode-button` 클릭으로 동작한다. 해시 없는 안정적 셀렉터다.
 * - ✅ **상태 판별은 버튼의 `aria-label`** 로 한다: `넓은 화면`(=현재 좁음) ↔ `좁은 화면`(=현재 넓음).
 * - 🔴 해시 클래스 `_is_large_` 에 의존하지 않는다.
 * - 🔴 `#layout-body._is_expanded_` 는 **좌측 사이드바** 상태이며 넓은 화면과 무관하다.
 *   넓은 화면을 토글해도 이 값은 변하지 않는다(실측) — 상태 판별에 쓰면 틀린다.
 * - 진입 직후에는 버튼이 아직 렌더되지 않았을 수 있으므로 렌더 감지 후 실행한다.
 * - VOD 에도 버튼이 있어 적용 가능하다. `m.chzzk` 에는 없다(모바일은 FR-10 이 대체).
 * - 전체화면과 독립이며 SPA 라우팅 후에도 유지된다(content.tsx 가 재시작하므로 멱등만 보장한다).
 */

import { PLAYER } from '../constants/class';
import { hasWideScreenButton } from '../pageType';
import { normalizeText, qs, qsVisible, sleep, waitFor } from '../utils/dom';
import { guardAsync, info, warning } from '../utils/log';
import { observe, type Disposer } from '../utils/observe';
import type { Feature } from './types';

/** 실측 aria-label. 버튼은 "다음에 할 동작"을 label 로 노출한다. */
const LABEL_GO_WIDE = '넓은 화면';
const LABEL_GO_NARROW = '좁은 화면';

/**
 * `aria-label` 로 현재 넓은 화면인지 판정한다. **순수 함수.**
 * - `좁은 화면` → 지금 넓은 화면이다 (true)
 * - `넓은 화면` → 지금 좁은 화면이다 (false)
 * - 그 외/없음 → 판정 불가 (null). 이 경우 토글하지 않는다 — 잘못 누르면 켜진 것을 끈다.
 */
export function isWideScreenActive(ariaLabel: string | null): boolean | null {
  const label = normalizeText(ariaLabel);
  if (label.length === 0) return null;
  if (label.includes(LABEL_GO_NARROW)) return true;
  if (label.includes(LABEL_GO_WIDE)) return false;
  return null;
}

/** 넓은 화면 버튼. 여러 개 매칭·숨김 요소를 피해 보이는 것만 고른다. */
export function findViewModeButton(): HTMLElement | null {
  return qsVisible<HTMLElement>(PLAYER.viewModeButton);
}

/**
 * 플레이어가 자기 복원 로직을 끝낼 때까지 기다린다.
 *
 * 🔴 **실측 결함 (2026-08-12, `chzzk-dom-24-widescreen-trace.json`)**:
 * 버튼이 렌더된 직후 label 을 읽고 클릭하면 **치지직이 저장해 둔 넓은 화면 상태를 되돌린다.**
 * 추적에서 t=2304ms 에 이미 `좁은 화면`(=넓은 화면 켜짐)이었는데 t=2318ms 에 `넓은 화면` 으로
 * 바뀌는 것을 확인했다 — 우리가 초기화 중의 낡은 상태를 읽고 껐다.
 * → 첫 `playing`/`loadeddata` 이후에 판단하고, 클릭 결과를 **반드시 재확인**한다.
 */
async function waitForPlayerSettled(timeoutMs: number): Promise<void> {
  const video = await waitFor<HTMLVideoElement>(`${PLAYER.rootPc} ${PLAYER.video}`, { timeoutMs });
  if (!video) return;

  if (video.readyState < 1) {
    await new Promise<void>((resolve) => {
      const done = () => {
        video.removeEventListener('loadeddata', done);
        video.removeEventListener('playing', done);
        clearTimeout(timer);
        resolve();
      };
      video.addEventListener('loadeddata', done, { once: true });
      video.addEventListener('playing', done, { once: true });
      const timer = setTimeout(done, timeoutMs);
    });
  }
  // 복원 로직이 label 을 확정할 여유를 준다. 이 지연 없이는 위 경합이 재현된다.
  await sleep(SETTLE_MS);
}

/** 클릭 결과가 반영될 때까지의 대기. 실측에서 label 은 14ms 안에 바뀌었다. */
const CLICK_SETTLE_MS = 400;
const SETTLE_MS = 600;
const MAX_ATTEMPTS = 3;

/**
 * 컨트롤바가 나타나기를 기다리는 상한 (2분).
 *
 * 🔴 근거 (사용자 보고 2026-08-17 "자동 넓은 화면이 안 켜진다"). 프리롤 광고 중에는 컨트롤바
 * DOM 이 아예 없어 `pzp-viewmode-button` 을 찾을 수 없는데, 예전 구현은 10초 창을 **한 번만**
 * 보고 `wide screen button not rendered, skipping` 을 남긴 뒤 **그 페이지에서 영구 포기**했다.
 * 광고는 10초를 훌쩍 넘긴다 (README 실측: 92초 광고). 화질·볼륨이 같은 부류를 이미 2분 상한으로
 * 해결했으므로 값과 근거를 그대로 따른다.
 */
const READY_WINDOW_MS = 120_000;

/**
 * 재시도 라운드 상한. **컨트롤바가 렌더된 뒤에만** 세므로 광고 시간은 예산을 쓰지 않는다.
 * label 을 못 읽거나(판정 불가) 치지직이 계속 되돌리는 상황에서 2분 내내 매달리지 않게 한다.
 */
const MAX_READY_ROUNDS = 10;

/** 동시 실행 방지 — 재초기화가 겹쳐도 토글이 두 번 일어나지 않게 한다. */
let inFlight: Promise<boolean | null> | null = null;

/**
 * 넓은 화면을 켠다. **이미 켜져 있으면 아무것도 하지 않는다.**
 * FR-10 도 이 함수를 그대로 쓴다 — 토글 로직을 복제하지 않는다.
 *
 * @returns 실행 후 넓은 화면 상태. 판정 불가·버튼 없음이면 null.
 */
export async function ensureWideScreen(
  options: { timeoutMs?: number; isCancelled?: () => boolean } = {},
): Promise<boolean | null> {
  // 라우팅·설정 변경으로 재초기화가 겹칠 수 있다. 진행 중이면 그 결과를 공유한다.
  if (inFlight) return inFlight;
  inFlight = runEnsureWideScreen(options).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runEnsureWideScreen({
  timeoutMs = 10_000,
  isCancelled = () => false,
}: { timeoutMs?: number; isCancelled?: () => boolean } = {}): Promise<boolean | null> {
  const rendered = await waitFor<HTMLElement>(PLAYER.viewModeButton, { timeoutMs });
  if (!rendered) {
    warning('wide screen button not rendered, skipping');
    return null;
  }

  await waitForPlayerSettled(timeoutMs);
  // 대기 중에 라우팅·설정 변경으로 이 실행이 무효가 됐으면 남의 페이지를 누르지 않는다.
  if (isCancelled()) return null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const button = findViewModeButton() ?? rendered;
    const state = isWideScreenActive(button.getAttribute('aria-label'));

    if (state === null) {
      warning('wide screen state is unknown from aria-label, not toggling');
      return null;
    }
    if (state) {
      if (attempt === 1) info('wide screen already active, no toggle');
      else info(`wide screen active after ${attempt - 1} toggle(s)`);
      return true;
    }

    button.click();
    await sleep(CLICK_SETTLE_MS);
    if (isCancelled()) return null;

    // 재확인 — 플레이어 복원 로직이 되돌렸다면 다음 시도에서 다시 켠다.
    if (isWideScreenActive(findViewModeButton()?.getAttribute('aria-label') ?? null) === true) {
      info(`wide screen toggled on (attempt ${attempt})`);
      return true;
    }
  }

  warning(`wide screen did not stay on after ${MAX_ATTEMPTS} attempts`);
  return false;
}

export const wideScreenFeature: Feature = {
  id: 'wideScreen',
  watches: ['wideScreen'],
  supports: (ctx) => ctx.settings.wideScreen.enabled && hasWideScreenButton(ctx.page.type),
  start: (ctx) => {
    let disposed = false;
    /** 켜졌거나(true) 상한까지 실패해 그만뒀다. 더 이상 시도하지 않는다. */
    let settled = false;
    let running = false;
    let rounds = 0;
    let stopWatch: Disposer | undefined;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    const stopWatching = () => {
      if (readyTimer !== undefined) {
        clearTimeout(readyTimer);
        readyTimer = undefined;
      }
      if (pollTimer !== undefined) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
      stopWatch?.();
      stopWatch = undefined;
    };

    const giveUp = (reason: string) => {
      if (settled) return;
      settled = true;
      stopWatching();
      warning(`wide screen not applied (${reason})`);
    };

    /**
     * 값싼 준비 판정 — 라운드를 셀 가치가 있는 상태인가.
     * **광고 구간에는 컨트롤바 DOM 이 아예 없다**(프로젝트 규칙 · 실측). 그래서 버튼 존재로
     * 걸러 내면 광고 시간이 재시도 예산을 갉아먹지 않는다 (`quality.ts` 와 같은 장치).
     * 라이브 페이지 body 는 채팅 때문에 쉬지 않고 변하므로 이 필터가 특히 중요하다.
     */
    const controlsRendered = (): boolean => qs(PLAYER.viewModeButton) !== null;

    const attempt = () => {
      if (disposed || settled || running || !controlsRendered()) return;
      running = true;
      rounds += 1;
      void guardAsync('wideScreen.ensure', async () => {
        const state = await ensureWideScreen({ isCancelled: () => disposed });
        running = false;
        if (disposed) return state;

        if (state === true) {
          settled = true;
          stopWatching();
          info(`wide screen state after start: true (round ${rounds})`);
          return state;
        }
        // `null`(label 판정 불가) · `false`(계속 되돌려짐) — 컨트롤바가 다시 그려지면 또 본다.
        if (rounds >= MAX_READY_ROUNDS) giveUp(`state ${String(state)} after ${rounds} rounds`);
        return state;
      });
    };

    attempt();

    /**
     * 🔴 여기서 끝내지 않는다. 콘텐츠 스크립트는 플레이어보다 먼저 뜨고, 프리롤 광고 중에는
     * 컨트롤바가 아예 없다 — 예전 구현은 10초 창을 놓치면 그 페이지에서 영구 포기했다
     * (사용자 보고 2026-08-17 "자동 넓은 화면이 안 켜진다").
     * `attributes` 는 보지 않는다: 우리 클릭이 바꾸는 `aria-label` 이 자기 자신을 다시 깨워
     * 루프가 된다. 노드 삽입(childList)만으로 컨트롤바 렌더를 잡을 수 있다.
     */
    stopWatch = observe(document.body, attempt, {
      debounceMs: ctx.device.profile.relaxObservers ? 1_000 : 500,
      childList: true,
      subtree: true,
    });
    readyTimer = setTimeout(() => giveUp('ready window elapsed'), READY_WINDOW_MS);

    /**
     * 🔴 옵저버만으로는 부족하다 — **DOM 이 조용하면 재시도가 오지 않는다.**
     * 실측(2026-08-17, `chzzk-dom-35-widescreen-live.json`): 로그인하지 않아 채팅 aside 가 없는
     * 페이지에서 컨트롤바가 t=1.0초에 이미 떠 있었는데도 20초 동안 재시도가 한 번도 오지 않아
     * 넓은 화면이 켜지지 않았다(같은 코드로 다음 실행에서는 t=4.5초에 옵저버가 깨어나 켜졌다).
     * 광고는 대개 iframe 안에서 그려져 최상위 문서에 변화를 남기지 않는 것이 원인으로 보인다.
     * → `onRouteChange` 가 history 패치 실패에 폴백 폴링을 두는 것과 같은 이유로 저비용 폴링을
     *   함께 둔다. 켜지는 즉시(또는 상한에서) 멈추므로 상시 비용이 아니다.
     */
    pollTimer = setInterval(attempt, ctx.device.profile.relaxObservers ? 2_000 : 1_000);

    // 원래 상태로 되돌리지 않는다 — 사용자가 직접 좁은 화면으로 바꿨을 수 있다.
    return () => {
      disposed = true;
      stopWatching();
    };
  },
};
