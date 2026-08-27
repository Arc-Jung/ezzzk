/**
 * FR-14 — **사용자가 직접 한 조작**과 코드·플레이어가 스스로 한 동작을 가른다.
 *
 * 🔴 이 구분이 없으면 우리가 건 음소거를 사용자 조작으로 오해한다. 반대로 구분을 포기하면
 * 사용자가 푼 음소거를 우리가 다시 걸어 **사용자와 싸우게 된다** (2026-08-15 사용자 보고).
 *
 * 판별은 브라우저의 **일시적 사용자 활성화**(클릭·키 입력 직후 몇 초 동안만 참)로 한다.
 * 치지직 플레이어가 리렌더·재접속으로 스스로 `muted` 를 되돌리는 경우에는 활성화가 없으므로
 * 이 함수가 거짓을 돌려주고, 우리는 평소대로 음소거를 다시 건다.
 *
 * 구현이 없는 환경(jsdom·구형 브라우저)에서는 항상 거짓이다 — 즉 **기존 동작이 그대로 유지**되고
 * 사용자 존중 경로만 켜지지 않는다. 조용히 반대로 동작하는 것보다 안전한 기본값이다.
 */
export function isUserInitiated(): boolean {
  return navigator.userActivation?.isActive === true;
}

/**
 * 실제 사용자 입력을 "방금 있었다"로 보는 창(ms). 브라우저의 일시적 활성화(약 5초)보다 짧게
 * 잡는다 — 활성화 창 끝자락에 플레이어가 스스로 되돌린 상태까지 사용자 몫으로 넘기지 않는다.
 */
const REAL_INPUT_WINDOW_MS = 2_000;

let lastRealInputAt = 0;
let syntheticDepth = 0;
let inputTrackerInstalled = false;

/**
 * 실입력 추적기를 이 프레임에 한 번만 설치한다.
 *
 * 캡처 단계 + passive 라 어떤 조작도 막지 않고, 하는 일은 타임스탬프 대입 하나뿐이다
 * (NFR-04 의 관심사인 옵저버 깨우기와는 성격이 다르다). 프레임 수명과 함께 가므로 떼지 않는다.
 *
 * 🔴 **모듈 로드 시점에 설치한다** (파일 맨 아래 즉시 호출). 첫 사용처에서 늦게 설치하면
 * 그 전에 일어난 입력을 통째로 놓쳐, **사용자의 첫 조작이 "우리가 한 것"으로 오판된다** —
 * 예: 사용자가 페이지에서 처음 누른 것이 음소거 버튼이면 우리가 곧바로 다시 풀어 싸운다.
 */
function ensureInputTracker(): void {
  if (inputTrackerInstalled) return;
  inputTrackerInstalled = true;
  const onInput = () => {
    if (syntheticDepth > 0) return;
    lastRealInputAt = Date.now();
  };
  for (const type of ['pointerdown', 'touchstart', 'keydown'] as const) {
    document.addEventListener(type, onInput, { capture: true, passive: true });
  }
}

// 첫 입력을 놓치지 않도록 로드 즉시 건다 (위 주석 참조).
ensureInputTracker();

/**
 * 우리가 합성 입력(`element.click()` 등)을 쏘는 구간을 감싼다. 그 안에서 발생한 입력은
 * 사용자 조작으로 세지 않는다.
 */
export function markSyntheticInput<T>(run: () => T): T {
  ensureInputTracker();
  syntheticDepth += 1;
  try {
    return run();
  } finally {
    syntheticDepth -= 1;
  }
}

/**
 * `isUserInitiated()` 의 **엄격판**. 브라우저 판정과 우리가 직접 관측한 실입력을 모두 요구한다.
 *
 * 🔴 실측 확정 (2026-08-27, `etc/tmp/probe-mv-unmute.mjs`): `userActivation.isActive` 하나로는
 * 못 가른다 — **우리 자신의 합성 클릭이 활성화를 만든다.** 자동재생 폴백이 재생 버튼을
 * `click()` 하는 순간 그 프레임이 활성 상태가 되어, 아무도 아무것도 누르지 않은 슬롯의
 * 음소거까지 "사용자가 했다"로 판정됐다 — 멀티뷰에서 음소거 자동 해제 재시도가 **한 번도
 * 걸리지 않은** 직접 원인이다. 같은 오염을 `hasBeenActive` 에 대해서는 2026-08-19 실측이 이미
 * 기록해 뒀다(`volume.ts` `rescueBlockedAutoplay` 주석 ①) — `isActive` 도 같은 함정이 있다.
 */
export function isUserInitiatedStrict(): boolean {
  ensureInputTracker();
  if (!isUserInitiated()) return false;
  return lastRealInputAt > 0 && Date.now() - lastRealInputAt <= REAL_INPUT_WINDOW_MS;
}

/**
 * 테스트 전용 — 프레임 수명과 함께 가는 모듈 상태를 초기화한다.
 * 가짜 타이머를 쓰는 테스트는 파일 안에서 시계가 앞뒤로 움직이므로, 앞 테스트가 남긴
 * 입력 시각이 다음 테스트의 판정을 오염시킨다. 프로덕션 경로에서는 부르지 않는다.
 */
export function resetInputTrackingForTests(): void {
  lastRealInputAt = 0;
  syntheticDepth = 0;
}

/**
 * 일시적 사용자 활성화가 유지되는 창(ms). 브라우저 구현(약 5초)에 맞춘 자체 상한이다.
 * `userActivation.isActive` 만으로는 "언제 눌렀는지"를 알 수 없어 우리가 따로 잰다.
 */
const HOST_INPUT_WINDOW_MS = 5_000;

/**
 * 이 노드(또는 조상)가 **우리가 만든 UI** 인가.
 *
 * 확장이 넣는 노드는 예외 없이 `cm-` 접두 id 나 클래스를 갖는다 (`constants/class.ts` 의 `OURS`).
 * 셀렉터 대신 조상을 직접 훑는 이유: `[class*="cm-"]` 는 치지직 클래스에 우연히 걸릴 수 있고,
 * 이 판정이 틀리면 "사용자 조작"을 잘못 인정해 원본 플레이어를 방치하게 된다.
 */
export function isOurUiNode(node: EventTarget | null): boolean {
  let el = node instanceof Element ? node : null;
  while (el) {
    if (el.id.startsWith('cm-')) return true;
    for (const token of el.classList) {
      if (token.startsWith('cm-')) return true;
    }
    el = el.parentElement;
  }
  return false;
}

/** 호스트 플레이어를 향한 사용자 조작 추적기. `suspendHostPlayer` 가 소유한다. */
export interface HostDirectedInput {
  /** 우리 UI **밖에서** 일어난 사용자 조작이 아직 활성화 창 안에 있는가. */
  isActive(): boolean;
  /** 리스너를 뗀다. */
  stop(): void;
}

/**
 * "사용자가 **호스트 플레이어를 향해** 조작했다" 를 판정할 수 있게 입력을 추적한다.
 *
 * 🔴 `isUserInitiated()` 하나로는 **멀티뷰를 여는 클릭 자체**가 사용자 조작으로 잡힌다
 * (실측 2026-08-22 `console-laptop13.log`:
 * `host player was resumed by the user; multiview stops re-suspending it` — 사용자는 그 사이
 * 아무것도 누르지 않았다). 진입 클릭 직후 치지직 플레이어가 스스로 `play` 를 쏘면 활성화 창이
 * 아직 열려 있어 우리가 항복해 버리고, 그러면 원본 소리가 슬롯 소리와 겹친다.
 *
 * → 추적을 **정지 시점부터** 시작하고, 우리 UI(`#cm-*` · `.cm-*`) 위에서 일어난 입력은 세지
 * 않는다. 남는 것은 "정지한 뒤에 우리 UI 밖에서 사용자가 한 조작" 뿐이다.
 *
 * 이벤트는 **캡처 단계**로 받는다 — 치지직 플레이어가 `stopPropagation()` 을 걸어도 놓치지 않는다.
 */
export function trackHostDirectedInput(doc: Document = document): HostDirectedInput {
  let lastAt: number | null = null;

  const onInput = (event: Event) => {
    if (isOurUiNode(event.target)) return;
    lastAt = Date.now();
  };

  const events = ['pointerdown', 'mousedown', 'touchstart', 'keydown'] as const;
  for (const type of events) {
    doc.addEventListener(type, onInput, { capture: true, passive: true });
  }

  return {
    isActive(): boolean {
      if (lastAt === null) return false;
      if (Date.now() - lastAt > HOST_INPUT_WINDOW_MS) return false;
      // 브라우저 판정과 **둘 다** 만족할 때만 인정한다 (프로그램 클릭 배제).
      return isUserInitiated();
    },
    stop(): void {
      for (const type of events) {
        doc.removeEventListener(type, onInput, { capture: true });
      }
      lastAt = null;
    },
  };
}
