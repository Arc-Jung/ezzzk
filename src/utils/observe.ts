/**
 * MutationObserver / SPA 라우팅 감지 유틸.
 * 옵저버는 필요한 서브트리에만 붙이고 디바운스한다 (NFR-04).
 */

import { error, warning } from './log';

export type Disposer = () => void;

/** 트레일링 디바운스 — 연속 변화 중 마지막 값으로 수렴한다 (FR-12.1). */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  waitMs: number,
): ((...args: A) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, waitMs);
  };
  wrapped.cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return wrapped;
}

/** 특정 서브트리를 관찰하고 디바운스된 콜백을 호출한다. */
export function observe(
  target: Node,
  callback: () => void,
  {
    debounceMs = 100,
    childList = true,
    subtree = true,
    attributes = false,
    attributeFilter,
  }: {
    debounceMs?: number;
    childList?: boolean;
    subtree?: boolean;
    attributes?: boolean;
    attributeFilter?: string[];
  } = {},
): Disposer {
  const run =
    debounceMs > 0 ? debounce(callback, debounceMs) : Object.assign(callback, { cancel: () => {} });
  const observer = new MutationObserver(() => run());
  observer.observe(target, { childList, subtree, attributes, attributeFilter });
  return () => {
    observer.disconnect();
    run.cancel();
  };
}

/**
 * 삽입 노드가 리렌더로 사라지면 다시 넣는다.
 * 치지직 컨트롤바는 리렌더 시 자식을 날리므로 재삽입 감시가 필수다 (FR-03).
 */
export function keepMounted(
  containerSelectorRoot: Node,
  isMounted: () => boolean,
  mount: () => void,
  { debounceMs = 150 } = {},
): Disposer {
  const ensure = () => {
    if (!isMounted()) mount();
  };
  ensure();
  return observe(containerSelectorRoot, ensure, { debounceMs });
}

/**
 * SPA 라우팅 감지 (NFR-02).
 * 치지직은 클라이언트 라우팅이라 pushState / replaceState / popstate 를 모두 봐야 한다.
 */
export function onRouteChange(callback: (url: string) => void): Disposer {
  let lastUrl = location.href;
  const fire = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    callback(lastUrl);
  };

  const originalPush = history.pushState;
  const originalReplace = history.replaceState;

  try {
    history.pushState = function patchedPushState(...args) {
      const result = originalPush.apply(this, args);
      fire();
      return result;
    };
    history.replaceState = function patchedReplaceState(...args) {
      const result = originalReplace.apply(this, args);
      fire();
      return result;
    };
  } catch (e) {
    warning('failed to patch history API, falling back to polling', e);
  }

  window.addEventListener('popstate', fire);
  // history 패치가 막힌 환경(CSP 등)에 대비한 저비용 폴백.
  const poll = setInterval(fire, 1_000);

  return () => {
    history.pushState = originalPush;
    history.replaceState = originalReplace;
    window.removeEventListener('popstate', fire);
    clearInterval(poll);
  };
}

/**
 * 여러 정리 함수를 **각각 독립적으로** 실행한다.
 *
 * 🔴 정리 단계를 그냥 나열하면 앞 단계가 던질 때 뒤 단계가 실행되지 않는다.
 * 실제 위험: `chatWidth` 의 disposer 에서 `stopArbiter()` 가 4번째 문장인데 앞이 던지면
 * 폭 조정자 참조 카운트가 **영구히 +1 누수**되고, 그러면 마지막 해제가 영원히 오지 않아
 * 주입한 폭 CSS 가 새로고침까지 남는다. 호출부의 `guard()` 는 disposer 전체를 감싸므로
 * 중간에서 잡아 주지 못한다.
 */
export function disposeAll(...fns: (Disposer | undefined)[]): void {
  for (const fn of fns) {
    if (!fn) continue;
    try {
      fn();
    } catch (e) {
      error('a disposal step threw and was isolated', e);
    }
  }
}
