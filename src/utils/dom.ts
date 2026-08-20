/** DOM 유틸. 셀렉터 실패는 예외가 아니라 null 로 다뤄 기능 단위 비활성으로 이어지게 한다. */

export function qs<E extends Element = Element>(
  selector: string,
  root: ParentNode = document,
): E | null {
  try {
    return root.querySelector<E>(selector);
  } catch {
    return null;
  }
}

export function qsa<E extends Element = Element>(
  selector: string,
  root: ParentNode = document,
): E[] {
  try {
    return Array.from(root.querySelectorAll<E>(selector));
  } catch {
    return [];
  }
}

/** 공백(탭·개행 포함)을 단일 스페이스로 정규화하고 앞뒤를 자른다. */
export function normalizeText(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim();
}

/** 요소가 실제로 보이는지. 0×0 / display:none 요소를 클릭해 조용히 실패하는 것을 막는다. */
export function isVisible(el: Element | null): boolean {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

/**
 * 보이는 요소만 골라 첫 번째를 돌려준다.
 * ⚠️ `.pzp-pc__setting-button` 처럼 여러 개 매칭되고 첫 번째가 숨겨져 있는 경우가 실제로 있다.
 */
export function qsVisible<E extends Element = Element>(
  selector: string,
  root: ParentNode = document,
): E | null {
  return qsa<E>(selector, root).find(isVisible) ?? null;
}

/** 요소가 렌더될 때까지 기다린다. 없으면 null. */
export function waitFor<E extends Element = Element>(
  selector: string,
  { timeoutMs = 10_000, root = document }: { timeoutMs?: number; root?: Document | Element } = {},
): Promise<E | null> {
  const existing = qs<E>(selector, root);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let done = false;
    const finish = (value: E | null) => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(value);
    };

    const observer = new MutationObserver(() => {
      const found = qs<E>(selector, root);
      if (found) finish(found);
    });
    observer.observe(root, { childList: true, subtree: true });

    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}

/** 지수 백오프 재시도. fn 이 truthy 를 돌려주면 성공으로 본다. */
export async function retry<T>(
  fn: () => Promise<T> | T,
  { attempts = 5, baseDelayMs = 200, maxDelayMs = 3_000 } = {},
): Promise<T | undefined> {
  for (let i = 0; i < attempts; i += 1) {
    const result = await fn();
    if (result) return result;
    if (i === attempts - 1) break;
    const delay = Math.min(baseDelayMs * 2 ** i, maxDelayMs);
    await sleep(delay);
  }
  return undefined;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `<style>` 태그를 id 로 한 개만 유지하고 내용만 교체한다.
 * 노드를 매번 새로 만들면 head 가 누적되고 재계산이 멱등하지 않게 된다 (FR-12.1).
 */
export function upsertStyle(id: string, css: string): HTMLStyleElement {
  let style = document.getElementById(id) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = id;
    document.head.appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;
  return style;
}

export function removeStyle(id: string): void {
  document.getElementById(id)?.remove();
}

/**
 * React 제어 컴포넌트에 값을 넣는다.
 * 단순 대입은 비로그인(비제어) 상태에서만 통하므로, 네이티브 setter + input 이벤트를 기본으로 쓴다.
 */
export function setNativeValue(el: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  const proto = Object.getPrototypeOf(el) as object;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor?.set) {
    descriptor.set.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 요소의 computed opacity 를 읽는다. 컨트롤바 자동 숨김 동기화에 쓴다. */
export function computedOpacity(el: Element | null): number {
  if (!el) return 1;
  const raw = Number.parseFloat(getComputedStyle(el).opacity);
  return Number.isFinite(raw) ? raw : 1;
}
