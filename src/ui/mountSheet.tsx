/**
 * 시트를 `document.body` 직계에 React 루트로 붙인다.
 * 치지직 DOM 밖에 두므로 페이지 리렌더에 지워지지 않는다 (공통 UI 규칙).
 */

import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { upsertStyle } from '../utils/dom';
import { SHEET_CSS } from './Sheet';

const SHEET_STYLE_ID = 'cm-sheet-style';

export type SheetHandle = {
  /** 내용을 갈아 끼운다. 루트를 다시 만들지 않는다. */
  render: (node: ReactNode) => void;
  close: () => void;
  isOpen: () => boolean;
};

/**
 * id 당 하나의 컨테이너·루트만 유지한다.
 * 같은 시트를 다시 열 때 노드를 새로 만들지 않아 재적용이 멱등하다.
 */
export function mountSheet(containerId: string): SheetHandle {
  upsertStyle(SHEET_STYLE_ID, SHEET_CSS);

  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    document.body.appendChild(container);
  }

  const roots = rootRegistry();
  let root: Root | undefined = roots.get(containerId);
  if (!root) {
    root = createRoot(container);
    roots.set(containerId, root);
  }

  let open = false;

  return {
    render: (node: ReactNode) => {
      open = true;
      root?.render(node);
    },
    close: () => {
      open = false;
      root?.render(null);
    },
    isOpen: () => open,
  };
}

/**
 * React 루트는 컨테이너당 한 번만 만들어야 한다(두 번 만들면 경고와 함께 상태가 깨진다).
 * content script 는 모듈 스코프가 프레임마다 유지되므로 모듈 레벨 Map 으로 충분하다.
 */
const ROOTS = new Map<string, Root>();
function rootRegistry(): Map<string, Root> {
  return ROOTS;
}
