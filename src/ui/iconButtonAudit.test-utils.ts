/**
 * 아이콘 전용 버튼 접근성 전수 검사 (계획: `docs/chzzk-tone-ui-plan.md` §7 「접근성」).
 *
 * P3 에서 문자·이모지(`＋ − ✕ ↔ ⟩ ▦ ⚙ 🔴`)를 SVG 로 바꾸면서 버튼의 **보이는 텍스트가
 * 사라졌다.** 텍스트가 없는 버튼은 `aria-label` 이 유일한 접근성 이름이므로, 하나라도
 * 빠지면 스크린리더에서 그냥 "버튼"으로 읽힌다. 눈으로는 멀쩡해 보여서 시각 검증으로는
 * 절대 잡히지 않는다 — 그래서 각 UI 를 이미 마운트하고 있는 테스트에서 이 함수를 불러
 * 라벨 생존을 회귀로 고정한다.
 *
 * ⚠️ 테스트 전용이다. `vitest.config.ts` 의 include 는 `*.test.ts(x)` 라 이 파일은 테스트로
 * 수집되지 않고, 제품 코드가 import 하지 않으므로 번들에도 들어가지 않는다.
 */
import { expect } from 'vitest';

/** 버튼으로 취급할 요소. `role="button"` 을 단 div 도 스크린리더에는 버튼이다. */
const BUTTON_SELECTOR = 'button, [role="button"]';

export type IconButtonAudit = {
  /** 검사한 아이콘 전용 버튼 수. */
  auditedIconButtons: number;
  /** 함께 훑은 전체 버튼 수 (텍스트가 있는 것 포함). */
  totalButtons: number;
};

/**
 * 스크린리더가 읽는 이름을 근사한다.
 *
 * jsdom 에는 접근성 트리가 없어 실제 계산을 쓸 수 없다. `aria-label` →
 * `aria-labelledby` → 보이는 텍스트 순으로 본다 — 이 세 가지가 우리 코드가 실제로
 * 쓰는 전부다. `title` 은 **이름으로 치지 않는다**: 터치 기기에서 뜨지 않아
 * 모바일 우선인 이 저장소에서는 라벨 대체물이 될 수 없다.
 */
function accessibleName(button: Element, root: ParentNode): string {
  const label = button.getAttribute('aria-label');
  if (label !== null && label.trim() !== '') return label.trim();

  const labelledBy = button.getAttribute('aria-labelledby');
  if (labelledBy !== null && labelledBy.trim() !== '') {
    const scope = 'getElementById' in root ? (root as Document) : button.ownerDocument;
    const named = labelledBy
      .split(/\s+/)
      .map((id) => scope.getElementById(id)?.textContent?.trim() ?? '')
      .filter((text) => text !== '')
      .join(' ');
    if (named !== '') return named;
  }

  return button.textContent?.trim() ?? '';
}

/** 아이콘(SVG)만 들어 있어 보이는 텍스트가 없는 버튼인가. */
function isIconOnly(button: Element): boolean {
  return (button.textContent?.trim() ?? '') === '' && button.querySelector('svg') !== null;
}

/**
 * `root` 아래 모든 버튼의 접근성 이름과 아이콘 숨김 처리를 검사한다.
 *
 * @param expectAtLeast 최소 아이콘 버튼 수. **0 을 넘겨서는 안 된다** — 마운트가 조용히
 *   실패해 버튼이 하나도 없는데 "전부 통과"가 되는 거짓 양성을 막는 장치다.
 */
export function auditIconButtons(
  root: ParentNode,
  { expectAtLeast, context }: { expectAtLeast: number; context: string },
): IconButtonAudit {
  const buttons = Array.from(root.querySelectorAll(BUTTON_SELECTOR));
  const iconButtons = buttons.filter(isIconOnly);

  const unlabeled = iconButtons
    .filter((button) => accessibleName(button, root) === '')
    .map((button) => button.outerHTML.slice(0, 160));
  expect(unlabeled, `${context}: 아이콘 전용 버튼에 접근성 이름이 없다`).toEqual([]);

  // 아이콘이 이름 계산에 끼어들면 라벨이 오염된다 → 아이콘은 항상 숨긴다.
  const exposedIcons = buttons
    .flatMap((button) => Array.from(button.querySelectorAll('svg')))
    .filter((svg) => svg.getAttribute('aria-hidden') !== 'true')
    .map((svg) => svg.outerHTML.slice(0, 120));
  expect(exposedIcons, `${context}: 버튼 속 SVG 가 aria-hidden 이 아니다`).toEqual([]);

  // 🔴 색만으로 상태를 표시하지 않는다는 규약. `aria-pressed` 를 달았다면 값이 유효해야 한다
  //    — 빈 문자열이나 `null` 문자열이면 상태를 못 읽는다.
  const brokenPressed = buttons
    .filter((button) => button.hasAttribute('aria-pressed'))
    .filter((button) => !['true', 'false'].includes(button.getAttribute('aria-pressed') ?? ''))
    .map((button) => button.outerHTML.slice(0, 120));
  expect(brokenPressed, `${context}: aria-pressed 값이 true/false 가 아니다`).toEqual([]);

  expect(
    iconButtons.length,
    `${context}: 아이콘 버튼이 ${expectAtLeast}개 이상이어야 하는데 ${iconButtons.length}개다 (마운트 실패 의심)`,
  ).toBeGreaterThanOrEqual(expectAtLeast);

  return { auditedIconButtons: iconButtons.length, totalButtons: buttons.length };
}
