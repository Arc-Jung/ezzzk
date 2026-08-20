/**
 * 치지직 내장 클린봇(욕설 필터)을 기본으로 꺼 준다.
 *
 * 🔴 자체 필터를 새로 만드는 게 아니다 — 치지직 계정 설정의 클린봇 토글 자체를 끈다
 * (자체 필터를 만들었다가 되돌린 이력이 있다).
 *
 * 실측 근거 (2026-08-20, `etc/probe/chzzk-cleanbot.json`, 비로그인, 라이브 2채널)
 * - 진입 경로: 채팅 aside 헤더의 `더보기 메뉴`(⋮) 버튼 → 드롭다운의 `클린봇` 항목 → `클린봇 활성화`
 *   확인 다이얼로그 → 토글 스위치 + `확인` 버튼. 톱니(⚙) 아이콘이 아니다.
 * - 상태 판별: 드롭다운 `클린봇` 항목의 textContent 에 `켜짐`/`꺼짐` 이 그대로 붙어 나온다.
 *   확인 다이얼로그를 열면 `#toggle_cleanbot` 체크박스의 `checked` 로도 읽을 수 있다(해시 없는
 *   리터럴 id — 이 조사에서 찾은 가장 안정적인 식별자).
 * - 저장 위치: `localStorage['cleanbot']` = `'true' | 'false'` (문자열). 새로고침·채널 이동에도
 *   유지된다(실측 확인). 로그인 계정 동기화 여부는 미검증.
 *
 * 🔴 **`chatClutterHideFeature` 와의 충돌**: 그 기능은 기본값(`chatClutter.header=true`)으로
 * 채팅 헤더 전체(`더보기 메뉴` 버튼을 포함)를 `display: none` 으로 숨긴다. 좌표 기반 마우스
 * 클릭으로는 기본 설정에서 이 버튼을 절대 누를 수 없다. 실측(`chzzk-cleanbot.json`)에서
 * `HTMLElement.click()` 네이티브 메서드는 조상이 `display: none` 이어도 React `onClick` 을
 * 그대로 발화시키는 것을 확인했다 — 그래서 이 파일은 좌표 클릭이 아니라 전부 `.click()` 호출만
 * 쓴다.
 *
 * 🔴 **이미 꺼져 있으면 절대 누르지 않는다** — 누르면 오히려 켜진다. 드롭다운 항목 텍스트로
 * 먼저 상태를 읽고, `켜짐`일 때만 다이얼로그를 열어 끈다.
 * 🔴 재시도 상한(`MAX_ATTEMPTS`)을 넘기면 조용히 포기한다. 무한 재시도하지 않는다.
 */

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

/**
 * 클린봇이 켜져 있으면 한 번 끈다. **이미 꺼져 있으면 아무것도 누르지 않는다.**
 *
 * @returns 실행 후 상태. `true` = 꺼짐(목표 달성), `false` = 끄기 실패, `null` = UI 를 찾지
 *   못했거나 상태 판정 불가(이 경우 아무것도 누르지 않는다).
 */
export async function ensureCleanBotDisabled(
  options: { isCancelled?: () => boolean } = {},
): Promise<boolean | null> {
  const { isCancelled = () => false } = options;

  const moreButton = findMoreMenuButton();
  if (!moreButton) return null;

  moreButton.click();
  await sleep(MENU_SETTLE_MS);
  if (isCancelled()) return null;

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
  if (!state) {
    info('cleanbot already off, no toggle');
    moreButton.click();
    return true;
  }

  // 켜져 있다 — 다이얼로그를 열어 끈다.
  menuItem.click();
  await sleep(DIALOG_SETTLE_MS);
  if (isCancelled()) return null;

  const dialog = qs(CONFIRM_DIALOG);
  const checkbox = document.getElementById(TOGGLE_CHECKBOX_ID) as HTMLInputElement | null;
  const label = qs<HTMLElement>(TOGGLE_LABEL);
  if (!dialog || !checkbox || !label) {
    warning('cleanbot confirm dialog not found as expected');
    return null;
  }

  label.click();
  await sleep(CONFIRM_SETTLE_MS);
  if (isCancelled()) return null;

  const confirmButton = findConfirmButton(dialog);
  if (!confirmButton) {
    warning('cleanbot confirm button not found');
    return null;
  }
  confirmButton.click();
  await sleep(CONFIRM_SETTLE_MS);

  return checkbox.checked === false;
}

export const chzzkCleanBotFeature: Feature = {
  id: 'chzzkCleanBot',
  watches: ['chzzkCleanBot'],
  supports: (ctx) =>
    ctx.settings.chzzkCleanBot.disable && hasSideChat(ctx.page.type) && !ctx.page.isSlotFrame,
  start: (_ctx) => {
    let disposed = false;

    const run = async () => {
      const aside = await waitFor<HTMLElement>(ID.asideChatting, { timeoutMs: 15_000 });
      if (!aside || disposed) return;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        if (disposed) return;
        const result = await ensureCleanBotDisabled({ isCancelled: () => disposed });
        if (disposed) return;

        if (result === true) {
          info(`cleanbot disabled (attempt ${attempt})`);
          return;
        }
        if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS);
      }
      warning(`cleanbot not disabled after ${MAX_ATTEMPTS} attempts`);
    };

    void guardAsync('chzzkCleanBot.ensure', run);

    return () => {
      disposed = true;
    };
  },
};
