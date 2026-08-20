/**
 * 시트 공용 컴포넌트 회귀.
 *
 * 🔴 2026-08-16 실측 결함: 시트 안의 **포커스 불가 요소(제목·설명 문단)를 클릭하면**
 * `document.activeElement` 가 `body` 로 떨어지는데, Esc 리스너가 시트 노드에만 걸려 있어
 * 그 뒤로 Esc 가 완전히 먹통이 됐다. `probe-multiview-beta` 로 4개 프로필 전부에서 재현했다
 * (mobile-landscape · mobile-portrait · lowres-1024 · laptop13, focus "body (시트 밖)").
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Sheet } from './Sheet';

declare global {
  // React 18 이 act 지원 환경임을 알리는 표준 플래그. 없으면 경고가 쏟아진다.
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(node: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(node);
  });
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  document.body.replaceChildren();
});

const pressEscape = (target: EventTarget) => {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  });
};

describe('Sheet — Esc 닫기', () => {
  it('포커스가 시트 안일 때 닫힌다', () => {
    const onClose = vi.fn();
    mount(
      <Sheet title="멀티뷰 구성" beta onClose={onClose}>
        <p>본문</p>
      </Sheet>,
    );
    const button = document.querySelector('.cm-sheet__close') as HTMLElement;
    button.focus();
    pressEscape(button);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('포커스가 시트 밖(body)으로 빠져도 닫힌다 — 2026-08-16 회귀', () => {
    const onClose = vi.fn();
    mount(
      <Sheet title="멀티뷰 구성" beta onClose={onClose}>
        <p>본문</p>
      </Sheet>,
    );
    // 제목처럼 포커스를 받지 못하는 요소를 클릭한 뒤의 상태를 그대로 재현한다.
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    pressEscape(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('닫힌 뒤에는 문서 리스너가 남지 않는다 (누수 방지)', () => {
    const onClose = vi.fn();
    mount(
      <Sheet title="멀티뷰 구성" onClose={onClose}>
        <p>본문</p>
      </Sheet>,
    );
    act(() => root?.unmount());
    root = null;
    pressEscape(document.body);
    expect(onClose).not.toHaveBeenCalled();
  });
});
