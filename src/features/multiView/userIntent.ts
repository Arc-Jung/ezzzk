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
