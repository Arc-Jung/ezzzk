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
import { Sheet, SHEET_CSS, SHEET_MAX_H } from './Sheet';

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

/**
 * 시트 높이 — 고정 대신 콘텐츠에 맞춰 줄고 늘되 상하한을 지킨다 (UI 감사 #4·#5, 2026-08-20).
 * jsdom 은 실제 레이아웃을 계산하지 않으므로 CSS 문자열의 규칙 모양만 검증한다 —
 * 실제 화면 크기 변화는 docs/ui-audit/settings-*-laptop13.png 로 육안 확인했다.
 */
describe('Sheet — 높이(콘텐츠에 맞춰 줄고 늘되 튀지 않게)', () => {
  it('.cm-sheet 는 고정 height 대신 max-height/min-height 로 상하한만 준다', () => {
    const rule = SHEET_CSS.slice(
      SHEET_CSS.indexOf('.cm-sheet:not(:has(.cm-mv-columns))'),
      SHEET_CSS.indexOf('.cm-sheet:has(.cm-mv-columns)'),
    );
    expect(rule).toContain(`max-height: min(${SHEET_MAX_H}px, 80vh)`);
    // 최소 높이는 짧은 탭과 긴 탭 사이 탭 전환 시 시트 크기가 크게 튀지 않도록 두는 바닥값이다
    // (재생 296px ~ 채팅 470px, 실측 근거는 SHEET_CSS 의 .cm-sheet 규칙 주석 참조).
    expect(rule).toContain('min-height: min(500px, 70vh)');
    const baseRule = SHEET_CSS.slice(
      SHEET_CSS.indexOf('.cm-sheet {'),
      SHEET_CSS.indexOf('}', SHEET_CSS.indexOf('.cm-sheet {')),
    );
    expect(baseRule).not.toContain('height:');
  });

  it('멀티뷰 구성 시트(:has(.cm-mv-columns))는 예전과 같은 고정 height 를 그대로 쓴다', () => {
    // configSheetCss.ts 의 860px/92vh 좁은 화면 오버라이드가 이 값을 대체해야 하는데,
    // 여기서 max-height 까지 걸면 그 오버라이드가 600px 로 도로 눌린다 — 그래서 멀티뷰는
    // max-height/min-height 규칙에서 빼고 height 고정을 유지한다.
    const rule = SHEET_CSS.slice(
      SHEET_CSS.indexOf('.cm-sheet:has(.cm-mv-columns)'),
      SHEET_CSS.indexOf('.cm-sheet__head'),
    );
    expect(rule).toContain(`height: min(${SHEET_MAX_H}px, 80vh)`);
    expect(rule).not.toContain('max-height');
    expect(rule).not.toContain('min-height');
  });
});

/**
 * 전 화면 감사 회귀 (2026-09-07).
 *
 * 3프로필 × 10화면을 훑어 자동 판정에 걸린 것들이다. 눈으로는 놓치기 쉬워 CSS 계약으로 고정한다.
 */
describe('시트 버튼 — 터치 타겟과 줄바꿈', () => {
  /**
   * 🔴 min-width 가 빠져 있어 FR-12 의 44×44 가 **절반만** 성립했다. 실측에서 멀티뷰 구성
   * 시트의 슬롯 배치 버튼이 29×44, 설정 패널 되돌리기 버튼이 12×44 로 나왔다 — 폭이 좁으면
   * 손가락으로 누르기 어렵고 옆 버튼을 잘못 누른다.
   */
  it('버튼은 폭과 높이 둘 다 터치 타겟을 지킨다', () => {
    const rule = SHEET_CSS.slice(SHEET_CSS.indexOf('.cm-sheet button {'));
    const block = rule.slice(0, rule.indexOf('}'));
    expect(block).toContain('min-width: var(--cm-target');
    expect(block).toContain('min-height: var(--cm-target');
  });

  /** select·input 은 내용에 따라 넓어져야 하므로 폭 하한을 주지 않는다. */
  it('select·input 에는 폭 하한을 주지 않는다', () => {
    const rule = SHEET_CSS.slice(SHEET_CSS.indexOf('.cm-sheet select, .cm-sheet input {'));
    const block = rule.slice(0, rule.indexOf('}'));
    expect(block).not.toContain('min-width');
  });

  /**
   * 🔴 한국어 기본 줄바꿈은 음절마다 끊는다 — 좁은 화면에서 "취소" 가 "취"/"소" 로 두 줄이 됐다.
   */
  it('버튼 글자가 음절 단위로 쪼개지지 않는다', () => {
    const rule = SHEET_CSS.slice(SHEET_CSS.indexOf('.cm-sheet button {'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('word-break: keep-all');
  });
});
