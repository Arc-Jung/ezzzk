/** 치지직 내장 클린봇을 명시적으로 선택한 상태에 맞춘다. 기본 설정은 원본 상태 유지. */
import type { Settings } from '../constants/storage';
import { ID } from '../constants/class';
import { hasSideChat } from '../pageType';
import { qs, sleep, waitFor } from '../utils/dom';
import { guardAsync, info, warning } from '../utils/log';
import type { Feature } from './types';

/** 채팅 헤더의 더보기(⋮) 메뉴 버튼. `chatClutter.header` 가 숨겨도 `.click()` 은 동작한다. */
const MORE_MENU_BUTTON = `${ID.asideChatting} button[aria-label="더보기 메뉴"]`;
/** 더보기 메뉴 드롭다운. `더보기 메뉴` 버튼과 같은 헤더 서브트리 안에 렌더된다(포털 아님). */
const MORE_MENU_PANEL = `${ID.asideChatting} [class*="_container_11w2f"]`;
/** 확인 다이얼로그. `role=alertdialog` 는 표준 속성, `_cleanbot_` 은 접두어 부분 일치로만 쓴다. */
const CONFIRM_DIALOG = '[role="alertdialog"][class*="_cleanbot_"]';
/** 토글 체크박스. 해시 없는 리터럴 id — 이 조사에서 가장 안정적인 식별자. */
const TOGGLE_CHECKBOX_ID = 'toggle_cleanbot';
const TOGGLE_LABEL = `label[for="${TOGGLE_CHECKBOX_ID}"]`;

const MENU_SETTLE_MS = 300;
const DIALOG_SETTLE_MS = 300;
const CONFIRM_SETTLE_MS = 300;
/** 재시도 상한. 무한 재시도하지 않는다 — 그래도 안 되면 조용히 포기한다. */
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_000;

function findMoreMenuButton(): HTMLElement | null {
  return qs<HTMLElement>(MORE_MENU_BUTTON);
}

function findCleanBotMenuItem(): HTMLElement | null {
  const panel = qs(MORE_MENU_PANEL);
  if (!panel) return null;
  return (
    Array.from(panel.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      (b.textContent ?? '').includes('클린봇'),
    ) ?? null
  );
}

/**
 * 드롭다운 항목의 표시 문구로 현재 켜짐/꺼짐을 판정한다. **순수 함수.**
 * 그 외 문구는 판정 불가(null) — 잘못 누르면 꺼진 것을 켠다.
 */
export function isCleanBotOn(menuItemText: string | null): boolean | null {
  const text = menuItemText ?? '';
  if (text.includes('꺼짐')) return false;
  if (text.includes('켜짐')) return true;
  return null;
}

function findConfirmButton(dialog: Element): HTMLElement | null {
  return (
    Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => (b.textContent ?? '').trim() === '확인',
    ) ?? null
  );
}

/** undefined는 원본 상태 유지. 과거 '항상 끄기' 설정은 그대로 지원한다. */
export function cleanBotTarget(settings: Settings['chzzkCleanBot']): boolean | undefined {
  return typeof settings.enabled === 'boolean'
    ? settings.enabled
    : settings.disable
      ? false
      : undefined;
}

/** 치지직이 저장한 상태. 없거나 접근할 수 없으면 판정하지 않는다. */
export function readCleanBotState(): boolean | null {
  try {
    const value = window.localStorage.getItem('cleanbot');
    return value === 'true' ? true : value === 'false' ? false : null;
  } catch {
    return null;
  }
}

/** 목표 상태와 다를 때만 변경한다. true=성공, false=실패, null=판정/조작 불가. */
export async function ensureCleanBotState(
  enabled: boolean,
  options: { isCancelled?: () => boolean } = {},
): Promise<boolean | null> {
  const { isCancelled = () => false } = options;

  const moreButton = findMoreMenuButton();
  if (!moreButton) return null;

  if (isCancelled()) return null;
  const cancel = () => {
    const dialog = qs(CONFIRM_DIALOG);
    if (dialog) {
      Array.from(dialog.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.trim() === '취소')
        ?.click();
    } else {
      moreButton.click();
    }
    return null;
  };
  moreButton.click();
  await sleep(MENU_SETTLE_MS);
  if (isCancelled()) return cancel();

  const menuItem = findCleanBotMenuItem();
  if (!menuItem) {
    // 못 찾았으니 열어 둔 메뉴를 닫는다(같은 버튼이 열고 닫기를 겸한다).
    moreButton.click();
    return null;
  }

  const state = isCleanBotOn(menuItem.textContent);
  if (state === null) {
    warning('cleanbot state is unknown from menu item text, not toggling');
    moreButton.click();
    return null;
  }
  if (state === enabled) {
    info('cleanbot already matches preference, no toggle');
    moreButton.click();
    return true;
  }

  // 원하는 상태와 다를 때만 확인 다이얼로그를 연다.
  menuItem.click();
  await sleep(DIALOG_SETTLE_MS);
  if (isCancelled()) return cancel();

  const dialog = qs(CONFIRM_DIALOG);
  const checkbox = document.getElementById(TOGGLE_CHECKBOX_ID) as HTMLInputElement | null;
  const label = qs<HTMLElement>(TOGGLE_LABEL);
  if (!dialog || !checkbox || !label) {
    warning('cleanbot confirm dialog not found as expected');
    return cancel();
  }

  if (checkbox.checked !== enabled) label.click();
  await sleep(CONFIRM_SETTLE_MS);
  if (isCancelled()) return cancel();

  const confirmButton = findConfirmButton(dialog);
  if (!confirmButton) {
    warning('cleanbot confirm button not found');
    return cancel();
  }
  confirmButton.click();
  await sleep(CONFIRM_SETTLE_MS);

  return checkbox.checked === enabled;
}

/** 과거 호출부와 테스트에서 사용하는 끄기 전용 진입점. */
export function ensureCleanBotDisabled(options: { isCancelled?: () => boolean } = {}) {
  return ensureCleanBotState(false, options);
}

// 빠르게 켜고 꺼도 이전 실행이 연 메뉴/다이얼로그와 다음 실행이 충돌하지 않게 한다.
let pendingRun: Promise<void> = Promise.resolve();

export const chzzkCleanBotFeature: Feature = {
  id: 'chzzkCleanBot',
  watches: ['chzzkCleanBot'],
  supports: (ctx) =>
    cleanBotTarget(ctx.settings.chzzkCleanBot) !== undefined &&
    hasSideChat(ctx.page.type) &&
    !ctx.page.isSlotFrame,
  start: (ctx) => {
    const enabled = cleanBotTarget(ctx.settings.chzzkCleanBot);
    if (enabled === undefined) return;
    let disposed = false;

    const run = async () => {
      if (disposed) return;
      const aside = await waitFor<HTMLElement>(ID.asideChatting, { timeoutMs: 15_000 });
      if (!aside || disposed) return;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        if (disposed) return;
        const result = await ensureCleanBotState(enabled, { isCancelled: () => disposed });
        if (disposed) return;

        if (result === true) {
          info(`cleanbot ${enabled ? 'enabled' : 'disabled'} (attempt ${attempt})`);
          return;
        }
        if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS);
      }
      warning(`cleanbot preference not applied after ${MAX_ATTEMPTS} attempts`);
    };

    pendingRun = pendingRun.then(() => guardAsync('chzzkCleanBot.ensure', run));

    return () => {
      disposed = true;
    };
  },
};
