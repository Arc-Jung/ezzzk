/**
 * FR-04 자주 쓰는 채팅 저장 및 바로 쓰기.
 *
 * 실측 근거 (2026-08-11, 분석 문서 §4.6)
 * - 입력창은 **`contenteditable` 이 아니라 `textarea`** 다 (`CHZZK.chatInput`).
 * - 전송 버튼 텍스트는 `채팅` 이고 **비로그인 시 `disabled: true`** 다.
 * - 값 주입은 **네이티브 value setter + `input` 이벤트**를 기본으로 한다. 단순 대입이 통한 것은
 *   비로그인(비제어) 상태였기 때문일 가능성이 크므로 의존하지 않는다 (`utils/dom` 의 `setNativeValue`).
 * - 전송은 전송 버튼 클릭을 우선하고, 불가하면 `Enter` 키 이벤트로 폴백한다.
 *
 * ❌ 채팅 클라이언트의 내부 `send()` 는 **호출하지 않는다.** `accessToken`·`extraToken` 을 다루는
 *    경로여서 오작동 시 계정 리스크가 있고 시그니처가 언제든 바뀐다.
 *
 * 이모지·이모티콘 코드는 **어떤 변환도 없이 원문 그대로** 저장·전송한다.
 */

import { CHZZK, ID, OURS } from '../constants/class';
import { createIconElement } from '../ui/icons';
import { RADIUS } from '../ui/tokens';
import { LIMITS, type ChatPreset, type Settings } from '../constants/storage';
import { hasSideChat } from '../pageType';
import { saveSettings } from '../storage';
import { qs, setNativeValue, upsertStyle, removeStyle } from '../utils/dom';
import { keepMounted } from '../utils/observe';
import { guardAsync, info, warning } from '../utils/log';
import { findChatClient } from '../utils/reactFiber';
import type { Feature } from './types';

/**
 * 길이 상한 폴백. **하드코딩된 상한이 아니다** — 클라이언트의 `textLimitCount`(실측 400)를 읽는 것이
 * 원칙이고, 클라이언트에 접근할 수 없을 때만 이 값을 쓴다.
 */
export const FALLBACK_TEXT_LIMIT = 400;

/** 라벨 자동 생성 시 잘라내는 글자 수 */
const LABEL_MAX = 12;

/**
 * 개수·화살표까지 붙인 토글 버튼의 실측 폭 + 여유.
 * 2026-08-21 재실측(실사이트, laptop13·mobile-portrait 동일): font-size 13px·padding 6px
 * 로 줄인 뒤 픽스처 `문구 3 ▾` = 57.79px(부동소수는 서브픽셀 렌더링). 예전 62px(2026-08-15,
 * 폰트 크기 미지정 상태) 대비 축소분을 반영해 68 → 64 로 낮춘다.
 * 도구 행에 이만큼 여유가 없으면 라벨만 남겨 44px(최소 터치 타겟)로 줄인다.
 */
const FULL_LABEL_PX = 64;

/** 패널과 채팅 영역 위 끝 사이에 남기는 여백(px). 경계에 딱 붙으면 1px 반올림에 걸린다. */
const PANEL_EDGE_GAP = 4;

/**
 * 도구 행에 우리 묶음이 더 들어갈 수 있는 여유 폭(px).
 * 자식 하나가 늘면 gap 도 하나 늘기 때문에 gap 을 자식 수만큼 뺀다.
 *
 * FR-05 폭 조절 묶음(`chatWidth`)도 같은 게이트를 쓴다 — 판정이 갈라지면 한쪽만 넘친다.
 */
export function freeWidthIn(tools: Element): number {
  const gap = Number.parseFloat(getComputedStyle(tools).columnGap) || 0;
  const used = Array.from(tools.children).reduce(
    (sum, el) => sum + el.getBoundingClientRect().width,
    0,
  );
  return tools.clientWidth - used - gap * tools.children.length;
}

const STYLE_ID = `${OURS.chatPresetBarId}-style`;

/** 라벨 생략 시 본문 앞부분으로 만든다. */
export function deriveLabel(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= LABEL_MAX) return flat;
  return `${flat.slice(0, LABEL_MAX)}…`;
}

export function validatePresetText(
  text: string,
  textLimitCount: number,
): { ok: boolean; reason?: string } {
  if (text.trim().length === 0) return { ok: false, reason: '빈 문구는 저장할 수 없습니다' };
  const limit = textLimitCount > 0 ? textLimitCount : FALLBACK_TEXT_LIMIT;
  if (text.length > limit) {
    return { ok: false, reason: `문구가 너무 깁니다 (${text.length}/${limit}자)` };
  }
  return { ok: true };
}

/** 도배 방지 — 치지직 서버 제한과 별개로 클라이언트에서도 최소 간격을 강제한다. */
export function canSendNow(lastSentAt: number, now: number, minIntervalMs: number): boolean {
  if (lastSentAt <= 0) return true;
  return now - lastSentAt >= minIntervalMs;
}

/**
 * 우리 버튼 묶음을 치지직 **도구 행**에 넣을 자리를 고른다 (2026-08-15).
 *
 * 판정 (순수 함수 — DOM 을 읽기만 하고 바꾸지 않는다)
 * - 입력창(`textarea`) → 그 부모(`_area_` 입력 영역) → 그 안의 도구 행(`_tools_`)
 * - `side: 'left'`(기본) → `_donation_`(후원 관련 버튼 묶음) **앞**. 문구 버튼이 쓴다.
 * - `side: 'right'` → `_send_button_`(채팅) **앞**. FR-05 폭 조절 묶음이 쓴다 (2026-08-15 요청).
 * - 하나라도 없으면 `null` — 호출부는 기존 플로팅 배치로 **조용히 폴백**한다 (NFR-05).
 *
 * 🔴 **왜 이모티콘 버튼 옆이 아닌가** (실측 정정, 2026-08-21, 실사이트 비로그인
 * mobile-portrait 412×915 · laptop13 1440×900): 이모티콘 버튼은 이 도구 행(`_donation_`/
 * `_send_button_`) 안에 없다 — 입력창의 **형제**로 입력 컨테이너 안에 있고(`aria-haspopup`
 * 만 있고 텍스트·aria-label 은 blind 스팬뿐), 그 컨테이너의 실측 여유폭은 26px 로
 * 최소 터치 타겟(모바일 44px / 랩탑 32px)보다 작다. 거기 넣으면 `freeWidthIn` 게이트가
 * 거의 항상 플로팅 폴백으로 보내 사용자 눈에는 안 보인다 — 요구 문구를 글자 그대로
 * 만족시키는 것보다 실제로 보이는 배치가 우선이다. 그래서 문구 버튼은 여전히 이
 * 도구 행의 `_donation_` 앞에 둔다. 원 자료는 `etc/probe/chat-tools-row.json`.
 */
/**
 * 입력창이 속한 **입력 영역**(`_area_`)을 찾는다.
 *
 * 🔴 `input.parentElement` 로는 안 된다. 실측 계층은
 * `_area_b8csn_49 > _container_1k5b6_2 > textarea` 이고 도구 행은 `_container_1k5b6_2` 의
 * **형제**다 (2026-08-11 `chzzk-dom-25-chat-clutter.json`: area 353×105, 입력 컨테이너 313×42,
 * 도구 행 313×32). 부모만 보면 실사이트에서 도구 행을 못 찾아 우리 버튼이 **항상 플로팅으로
 * 폴백**한다 — 픽스처만 통과하고 실사이트에서 실패하는 전형적인 함정이다.
 *
 * 클래스 접미 해시가 바뀌어도 살아남게, 영역을 못 찾으면 **도구 행을 품은 조상**을 대신 쓴다.
 */
export function resolveInputArea(input: Element): Element | null {
  const area = input.closest(CHZZK.chatInputArea);
  if (area) return area;
  let node = input.parentElement;
  for (let depth = 0; node !== null && depth < 4; depth += 1) {
    if (qs(CHZZK.chatTools, node)) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * 도구 행에서 우리 요소를 끼울 자리를 찾는다.
 *
 * | side | 자리 |
 * | --- | --- |
 * | `left` | `_donation_`(후원 묶음) **앞** |
 * | `after-donation` | `_donation_` **바로 뒤** = 후원하기 오른쪽 |
 * | `right` | `_send_button_`(채팅 전송) **앞** |
 *
 * 🔴 `after-donation` 과 `right` 는 **같은 틈**(`_donation_`~`_send_button_` 사이)을 쓴다.
 * 문구 버튼(`after-donation`)이 먼저, 채팅 폭 컨트롤(`right`)이 뒤에 놓여 순서가 정해진다 —
 * 둘 다 `before` 기준이 다르므로 서로를 밀어내지 않는다.
 *
 * 도구 행 실측 구조 (2026-08-21, 비로그인 · mobile-portrait · laptop13):
 * `_tools_ > [_donation_(= _donation_text_ + _tooltip_ + _action_), _send_button_]`
 * 원 자료는 `etc/probe/chat-tools-row.json`.
 */
export function resolveToolsSlot(
  root: ParentNode = document,
  side: 'left' | 'right' | 'after-donation' = 'left',
): { parent: Element; before: Element | null } | null {
  const input = qs<HTMLTextAreaElement>(CHZZK.chatInput, root);
  const area = input ? resolveInputArea(input) : null;
  if (!area) return null;
  const tools = qs(CHZZK.chatTools, area);
  if (!tools) return null;

  if (side === 'after-donation') {
    const donation = qs(CHZZK.chatDonation, tools);
    if (!donation || donation.parentElement !== tools) return null;
    // `nextElementSibling` 이 없으면(후원 묶음이 마지막) 맨 뒤에 붙인다.
    return { parent: tools, before: donation.nextElementSibling };
  }

  const anchor = qs(side === 'right' ? CHZZK.chatSendButton : CHZZK.chatDonation, tools);
  if (!anchor || anchor.parentElement !== tools) return null;
  return { parent: tools, before: anchor };
}

export function sortByOrder(presets: ChatPreset[]): ChatPreset[] {
  return [...presets].sort((a, b) => a.order - b.order);
}

/** `order` 를 0부터 촘촘하게 다시 매긴다. 저장 전에 항상 통과시킨다. */
function renumber(presets: ChatPreset[]): ChatPreset[] {
  return presets.map((preset, index) => ({ ...preset, order: index }));
}

export function reorderPresets(
  presets: ChatPreset[],
  id: string,
  direction: 'up' | 'down',
): ChatPreset[] {
  const sorted = sortByOrder(presets);
  const from = sorted.findIndex((preset) => preset.id === id);
  if (from < 0) return sorted;

  const to = direction === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= sorted.length) return sorted;

  const next = [...sorted];
  const moved = next[from];
  const swapped = next[to];
  if (!moved || !swapped) return sorted;
  next[from] = swapped;
  next[to] = moved;
  return renumber(next);
}

export function addPreset(
  presets: ChatPreset[],
  text: string,
  cap: number = LIMITS.chatPresets,
): { presets: ChatPreset[]; error?: string } {
  const sorted = sortByOrder(presets);
  if (sorted.length >= cap) {
    return { presets: sorted, error: `문구는 최대 ${cap}개까지 저장할 수 있습니다` };
  }
  if (text.trim().length === 0) {
    return { presets: sorted, error: '빈 문구는 저장할 수 없습니다' };
  }
  const preset: ChatPreset = {
    id: newId(),
    label: deriveLabel(text),
    // 이모티콘 코드가 깨지지 않게 원문 그대로 보관한다 (trim 도 하지 않는다).
    text,
    order: sorted.length,
  };
  return { presets: renumber([...sorted, preset]) };
}

export function updatePreset(
  presets: ChatPreset[],
  id: string,
  patch: { label?: string; text?: string },
): ChatPreset[] {
  return sortByOrder(presets).map((preset) => {
    if (preset.id !== id) return preset;
    const text = patch.text ?? preset.text;
    const label =
      patch.label !== undefined && patch.label.trim().length > 0
        ? patch.label
        : patch.text !== undefined
          ? deriveLabel(text)
          : preset.label;
    return { ...preset, label, text };
  });
}

export function removePreset(presets: ChatPreset[], id: string): ChatPreset[] {
  return renumber(sortByOrder(presets).filter((preset) => preset.id !== id));
}

function newId(): string {
  try {
    return `p-${crypto.randomUUID()}`;
  } catch {
    return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

/** 기기 프로필에 맞춘 최소 스타일. 폰트는 FR-15 의 CSS 변수를 그대로 쓴다. */
/**
 * ⚠️ **이 함수가 돌려주는 문자열은 템플릿 리터럴이다 — 주석에 백틱을 쓰지 않는다.**
 * 백틱을 넣으면 문자열이 끊겨 빌드가 깨진다 (이 저장소에서 세 번 겪었다).
 *
 * `#aside-chatting` 에 position: relative 를 주는 이유: 플로팅 아이콘·패널의 절대 배치
 * 기준점이 필요하다. important 를 붙이지 않는 이유는 FR-10.2 오버레이 모드가 aside 를
 * position: fixed important 로 만드는데 fixed 도 컨테이닝 블록이라 그대로 동작하고,
 * 우리가 이기려 들면 오버레이가 깨지기 때문이다.
 */
function buildCss(touchTargetPx: number): string {
  const bar = `#${OURS.chatPresetBarId}`;
  const slot = `.${OURS.toolsSlotClass}`;
  return `
#aside-chatting { position: relative; }
/*
  🔴 바 자체는 **흐름을 차지하지 않는다** (높이 0). 실측 요청 2026-08-13:
  이전에는 입력창 앞에 일반 흐름으로 들어가 세로 공간을 먹어 채팅 레이아웃이 어긋났다.
  아이콘은 절대 배치로 떠 있고, 펼친 내용은 위로 열리는 오버레이다.
*/
${bar} { position: relative; height: 0; padding: 0; margin: 0; }
/*
  폴백 배치 — 치지직 도구 행을 찾지 못했을 때만 쓰는 **플로팅 아이콘**.
  바 안에 남아 있을 때(= data-anchor="fallback")만 적용된다.
  🔴 오른쪽에 두지 않는다. FR-05 채팅 폭 조절 컨트롤이 position: fixed 로
  화면 오른쪽 끝(top 96px, right 8px)에 붙어 채팅 상단~중단을 지나간다
  (실측 2026-08-13, ui-profile-shots/mobile-landscape--base.png 에서 겹침 확인).
*/
${bar} .cm-preset-actions {
  position: absolute; left: 6px; bottom: 4px; z-index: 2;
  display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end;
}
/*
  치지직 도구 행(입력창 아래 _tools_)에 끼워 넣은 **우리 버튼 묶음**의 공통 규칙.
  문구 버튼 전용이 아니다 — FR-05 폭 조절 묶음 등이 더 들어와도 같은 규칙을 쓴다
  (2026-08-15 실측: 도구 행은 display:flex; align-items:center).
  왼쪽 묶음은 _donation_(후원하기) 앞, 오른쪽 묶음은 _send_button_(채팅) 앞에 둔다.
*/
${slot} { display: flex; align-items: center; gap: 4px; flex: 0 1 auto; min-width: 0; }
${slot}[data-side="right"] { margin-left: auto; }
/*
  🔴 좁은 채팅 폭(FR-10 오버레이 183px)에서 버튼이 잘리지 않게 도구 행을 줄바꿈시킨다.
  우리 묶음이 실제로 들어간 행에만 적용해 치지직 원본 레이아웃 변경을 최소화한다.
*/
#aside-chatting [class*="_tools_"]:has(> ${slot}) { flex-wrap: wrap; row-gap: 4px; }
/* 펼친 내용 — 위쪽으로 열린다. 흐름을 밀지 않는다 */
${bar} .cm-preset-panel {
  position: absolute; left: 0; bottom: 100%; z-index: 1;
  display: flex; flex-direction: column; gap: 4px;
  width: 100%; max-width: 100%; max-height: 46vh; overflow-y: auto;
  /* 실제 상한은 채팅 영역 높이에 맞춰 JS 가 다시 정한다 (clampPanelHeight). */
  padding: 6px; box-sizing: border-box;
  background: rgba(20, 21, 23, 0.96);
  border: 1px solid #2a2d31; border-radius: 8px;
}
/*
  🔴 폴백(플로팅) 배치에서는 토글이 패널의 **왼쪽 아래 모서리를 덮는다.**
  바는 높이 0 이라 패널(bottom:100%)의 아래 끝과 토글(bottom:4px)이 같은 자리에서 만나고,
  하필 그 자리에 현재 입력 저장 · 편집 버튼이 있다 — 클릭이 토글에 가로채였다
  (실측 2026-08-15 explore-shots: 모바일 세로 "채팅 문구 편집" 7회 덮임,
   모바일 가로 "현재 입력창 내용을 문구로 저장" 18회 덮임 + 클릭 2회 실패).
  → 패널을 토글 높이(${touchTargetPx}px)만큼 더 위로 띄운다.
*/
${bar}[data-anchor="fallback"] .cm-preset-panel { margin-bottom: ${touchTargetPx + 8}px; }
${bar}[data-collapsed="true"] .cm-preset-panel { display: none; }
${bar} .cm-preset-chips { display: flex; flex-wrap: wrap; gap: 4px; overflow: hidden; }
${bar}[data-mode="chips-2rows"] .cm-preset-chips { max-height: ${touchTargetPx * 2 + 8}px; }
/*
  현재 입력 저장 · 편집 버튼은 **패널 안**에 둔다 (2026-08-15).
  도구 행에는 토글 하나만 나가야 좁은 폭에서 넘치지 않는다. 접힘/펼침 노출 규칙은
  그대로다 — 패널 자체가 접히면 숨으므로 이전과 보이는 시점이 같다.
*/
${bar} .cm-preset-tools { display: flex; flex-wrap: wrap; gap: 4px; }
/*
  치지직 도구 행 네이티브 버튼 실측(2026-08-21, etc/probe/chat-tools-row.json 의
  nativeButtonSizes): _donation_text_·_send_button_ font-size 13px, _send_button_
  border-radius 8px. 옆에서 튀어 보이지 않게 폰트·라운드를 그 톤에 맞춘다.
  🔴 히트 영역(min-height/min-width)은 그대로 ${touchTargetPx}px 다 — 보이는 글자만 줄인다.
*/
${bar} button, ${slot} button {
  min-height: ${touchTargetPx}px; min-width: ${touchTargetPx}px;
  padding: 0 8px; border-radius: ${RADIUS.md}; border: 1px solid currentColor;
  background: transparent; color: inherit; font: inherit; font-size: 13px; cursor: pointer;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* 도구 행 안에서는 좌우 여백을 줄인다 — 최소 터치 타겟 ${touchTargetPx}px 는 유지한다 */
${slot} button { padding: 0 6px; }
/*
  자리가 모자라면 개수·화살표를 떼고 라벨만 남긴다 (실측 2026-08-15, 2026-08-21 재실측).
  58px → 44px 로 줄어 FR-10 오버레이(채팅 183px)에서 도구 행이 한 줄에 들어간다.
*/
${slot}[data-compact="true"] .cm-preset-toggle-extra { display: none; }
${bar} .cm-preset-editor { display: flex; flex-direction: column; gap: 4px; }
${bar} .cm-preset-row { display: flex; gap: 4px; align-items: center; }
${bar} .cm-preset-row input {
  flex: 1 1 0; min-width: 0; min-height: ${touchTargetPx}px;
  background: transparent; color: inherit; font: inherit;
  border: 1px solid currentColor; border-radius: 6px; padding: 0 6px;
}
${bar} .cm-preset-notice { opacity: 0.8; }
`.trim();
}

type SendMode = Settings['chatPresetBehavior'];

export const chatPresetFeature: Feature = {
  id: 'chatPreset',
  watches: ['chatPresets', 'chatPresetBehavior'],
  // VOD·모바일 웹에는 채팅 입력이 없다 → UI 를 삽입하지 않는다.
  supports: (ctx) => hasSideChat(ctx.page.type) && !ctx.page.isSlotFrame,
  start: (ctx) => {
    const aside = qs(ID.asideChatting);
    if (!aside) {
      info('chat preset: #aside-chatting not found, feature idle');
      return;
    }

    const profile = ctx.device.profile;
    let presets = sortByOrder(ctx.settings.chatPresets);
    let behavior: SendMode = ctx.settings.chatPresetBehavior;
    let lastSentAt = 0;
    let editing = false;
    /**
     * 🔴 기본은 **접힘**이다 (2026-08-12 요청).
     * 이전에는 좁은 화면에서만 접혔고 `현재 입력 저장`·`편집` 은 **모든 화면에서 항상 노출**돼
     * 채팅 영역을 상시 차지했다. 이제 토글 하나를 눌러야 문구·저장·편집이 함께 열린다.
     */
    let collapsed = true;
    let notice = '';
    let bar: HTMLElement | null = null;
    /** 도구 행에 끼워 넣은 버튼 묶음. 바 밖에 있을 수 있어 별도로 추적·정리한다. */
    let actionsEl: HTMLElement | null = null;

    if (behavior !== 'send' && behavior !== 'fill') {
      warning(`unknown chatPresetBehavior "${String(behavior)}", falling back to send`);
      behavior = 'send';
    }

    upsertStyle(STYLE_ID, buildCss(profile.touchTargetPx));

    /** 길이 상한은 클라이언트의 `textLimitCount` 를 우선한다. 폴백은 접근 불가일 때만. */
    const textLimit = (): number => {
      const input = qs<HTMLTextAreaElement>(CHZZK.chatInput);
      const limit = input ? findChatClient(input)?.textLimitCount : undefined;
      return limit !== undefined && limit > 0 ? limit : FALLBACK_TEXT_LIMIT;
    };

    const persist = (next: ChatPreset[]): void => {
      presets = next;
      render();
      void guardAsync('chatPreset.persist', async () => {
        // origin 을 붙여 자기 재시작을 막는다 — 안 붙이면 저장 순간 편집 상태가 사라진다.
        await saveSettings({ chatPresets: next }, { origin: 'chatPreset' });
      });
    };

    const setNotice = (message: string): void => {
      notice = message;
      render();
    };

    /** 문구를 입력창에 넣고, 설정에 따라 전송까지 한다. */
    const applyText = (text: string): void => {
      const input = qs<HTMLTextAreaElement>(CHZZK.chatInput);
      if (!input) {
        setNotice('채팅 입력창을 찾지 못했습니다');
        return;
      }

      const check = validatePresetText(text, textLimit());
      if (!check.ok) {
        setNotice(check.reason ?? '문구를 전송할 수 없습니다');
        return;
      }

      // 이모티콘 코드를 그대로 넣는다 — 어떤 치환도 하지 않는다.
      setNativeValue(input, text);

      if (behavior === 'fill') {
        input.focus();
        return;
      }

      const now = Date.now();
      if (!canSendNow(lastSentAt, now, LIMITS.chatSendIntervalMs)) {
        setNotice('너무 빠릅니다. 잠시 후 다시 시도하세요');
        return;
      }

      const button = qs<HTMLButtonElement>(CHZZK.chatSendButton);
      if (button && !button.disabled) {
        button.click();
      } else {
        // 폴백 — 전송 버튼이 없거나 disabled(비로그인 등)인 경우.
        input.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            bubbles: true,
          }),
        );
      }
      lastSentAt = now;
      if (notice !== '') setNotice('');
    };

    const saveCurrentInput = (): void => {
      const input = qs<HTMLTextAreaElement>(CHZZK.chatInput);
      const text = input?.value ?? '';
      const check = validatePresetText(text, textLimit());
      if (!check.ok) {
        setNotice(check.reason ?? '현재 입력을 저장할 수 없습니다');
        return;
      }
      const result = addPreset(presets, text, LIMITS.chatPresets);
      if (result.error) {
        setNotice(result.error);
        return;
      }
      notice = '';
      persist(result.presets);
    };

    const button = (
      label: string,
      ariaLabel: string,
      onClick: () => void,
      extra: { className?: string; keyShortcut?: string } = {},
    ): HTMLButtonElement => {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = label;
      el.setAttribute('aria-label', ariaLabel);
      if (extra.className) el.className = extra.className;
      if (extra.keyShortcut) el.setAttribute('aria-keyshortcuts', extra.keyShortcut);
      el.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      });
      return el;
    };

    const renderEditor = (parent: HTMLElement): void => {
      const editor = document.createElement('div');
      editor.className = 'cm-preset-editor';

      for (const preset of presets) {
        const row = document.createElement('div');
        row.className = 'cm-preset-row';

        const labelInput = document.createElement('input');
        labelInput.type = 'text';
        labelInput.value = preset.label;
        labelInput.setAttribute('aria-label', '문구 라벨');
        labelInput.placeholder = '라벨';

        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.value = preset.text;
        textInput.setAttribute('aria-label', '문구 본문');
        textInput.placeholder = '문구';

        const deleteButton = button('', `${preset.label} 삭제`, () =>
          persist(removePreset(presets, preset.id)),
        );
        deleteButton.appendChild(createIconElement('close', 14));

        row.append(
          button('↑', `${preset.label} 위로 이동`, () =>
            persist(reorderPresets(presets, preset.id, 'up')),
          ),
          button('↓', `${preset.label} 아래로 이동`, () =>
            persist(reorderPresets(presets, preset.id, 'down')),
          ),
          labelInput,
          textInput,
          button('저장', `${preset.label} 수정 저장`, () => {
            const check = validatePresetText(textInput.value, textLimit());
            if (!check.ok) {
              setNotice(check.reason ?? '저장할 수 없습니다');
              return;
            }
            notice = '';
            persist(
              updatePreset(presets, preset.id, {
                label: labelInput.value,
                text: textInput.value,
              }),
            );
          }),
          deleteButton,
        );
        editor.appendChild(row);
      }

      const newRow = document.createElement('div');
      newRow.className = 'cm-preset-row';
      const newInput = document.createElement('input');
      newInput.type = 'text';
      newInput.setAttribute('aria-label', '새 문구 본문');
      newInput.placeholder = '새 문구';
      newRow.append(
        newInput,
        button('추가', '새 문구 추가', () => {
          const result = addPreset(presets, newInput.value, LIMITS.chatPresets);
          if (result.error) {
            setNotice(result.error);
            return;
          }
          notice = '';
          persist(result.presets);
        }),
      );
      editor.appendChild(newRow);

      parent.appendChild(editor);
    };

    const render = (): void => {
      if (!bar) return;
      bar.textContent = '';
      bar.dataset['mode'] = profile.chatPresetUi;
      bar.dataset['collapsed'] = collapsed ? 'true' : 'false';

      const chips = document.createElement('div');
      chips.className = 'cm-preset-chips';
      chips.setAttribute('role', 'group');
      chips.setAttribute('aria-label', '저장된 채팅 문구');

      presets.forEach((preset, index) => {
        const action = behavior === 'send' ? '전송' : '입력창에 채우기';
        const chip = button(
          preset.label,
          `${preset.label} ${action}`,
          () => applyText(preset.text),
          {
            className: 'cm-preset-chip',
            // 상위 9개는 Alt+1~9 로도 실행된다.
            keyShortcut: index < 9 ? `Alt+${index + 1}` : undefined,
          },
        );
        chip.title = preset.text;
        chips.appendChild(chip);
      });

      if (presets.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'cm-preset-notice';
        empty.textContent = '저장된 문구가 없습니다';
        chips.appendChild(empty);
      }

      const actions = document.createElement('div');
      actions.className = 'cm-preset-actions';
      /**
       * 토글은 화면 크기와 무관하게 **항상** 둔다. 접힌 상태에서는 이 버튼만 보이고
       * 문구 칩·`현재 입력 저장`·`편집` 이 모두 숨는다 (CSS `[data-collapsed]`).
       */
      const toggle = button(
        '문구',
        collapsed ? '채팅 문구 도구 펼치기' : '채팅 문구 도구 접기',
        () => {
          collapsed = !collapsed;
          // 접을 때 편집 모드도 함께 끝낸다 — 다시 펼쳤을 때 편집 중인 상태로 남으면 혼란스럽다.
          if (collapsed) editing = false;
          render();
        },
      );
      // 개수·화살표는 별도 span 이다 — 좁은 도구 행에서는 CSS 로 이것만 떼어 44px 로 줄인다.
      const extra = document.createElement('span');
      extra.className = 'cm-preset-toggle-extra';
      extra.textContent = collapsed ? ` ${presets.length > 0 ? `${presets.length} ` : ''}▾` : ' ▴';
      toggle.appendChild(extra);
      toggle.classList.add('cm-preset-toggle');
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      actions.appendChild(toggle);

      /**
       * `현재 입력 저장`·`편집` 은 패널 안에 둔다 (2026-08-15).
       * 도구 행에는 후원하기·이모티콘·채팅이 이미 있어 버튼을 더 내보내면 좁은 폭에서 넘친다.
       * 보이는 시점은 이전과 같다 — 접히면 패널째 숨는다.
       */
      const presetTools = document.createElement('div');
      presetTools.className = 'cm-preset-tools';
      presetTools.append(
        button('현재 입력 저장', '현재 입력창 내용을 문구로 저장', saveCurrentInput),
        button(editing ? '편집 완료' : '편집', '채팅 문구 편집', () => {
          editing = !editing;
          render();
        }),
      );

      /**
       * 🔴 구조를 **플로팅 아이콘 + 오버레이 패널**로 나눈다 (2026-08-13 요청).
       *
       * 이전에는 칩·액션·에디터가 모두 일반 흐름에 있어 세로 공간을 먹었고, 접힌 상태에서도
       * 토글 한 줄이 그대로 자리를 차지해 좁은 화면에서 채팅 레이아웃이 어긋났다.
       * 이제 `바`는 높이 0 이고, 액션은 절대 배치로 떠 있고, 펼친 내용은 위로 열리는 패널이다.
       */
      const panel = document.createElement('div');
      panel.className = 'cm-preset-panel';
      panel.append(chips, presetTools);
      if (editing && !collapsed) renderEditor(panel);

      if (notice !== '') {
        const noticeEl = document.createElement('div');
        noticeEl.className = 'cm-preset-notice';
        noticeEl.setAttribute('role', 'status');
        noticeEl.textContent = notice;
        panel.appendChild(noticeEl);
      }

      bar.append(panel);
      placeActions(actions);
      clampPanelHeight(panel);
    };

    /**
     * 패널은 위로 열리므로 **채팅 영역 밖까지 자랄 수 있다.**
     * 하단 배치(FR-05 ▤)에서 채팅이 짧아지면 CSS 상한 46vh 가 영역 높이보다 커서 패널이 영상
     * 위로 올라가 치지직 컨트롤바(일시정지·음소거·설정·좁은 화면)를 통째로 덮었다
     * (실측 2026-08-15 `explore-shots/mobile-landscape/25-…위치를_아래로_옮기기-0-after.png`,
     *  915×412). → 채팅 영역 안에 남을 만큼으로 상한을 다시 정한다.
     * 값은 **캐시하지 않는다** (FR-12.1) — 회전·분할 화면·폭 조절마다 다시 잰다.
     */
    const clampPanelHeight = (panel: HTMLElement): void => {
      if (!bar) return;
      // 폴백 배치에서는 패널을 토글 높이만큼 더 올리므로 그만큼 쓸 수 있는 높이가 준다.
      const lift = bar.dataset['anchor'] === 'fallback' ? profile.touchTargetPx + 8 : 0;
      const available =
        bar.getBoundingClientRect().top - aside.getBoundingClientRect().top - lift - PANEL_EDGE_GAP;
      panel.style.maxHeight = `${Math.max(0, Math.round(available))}px`;
    };

    /**
     * 버튼 묶음을 치지직 도구 행(`_donation_` 앞)에 넣는다. 자리를 못 찾으면 예전처럼
     * 바 안의 플로팅으로 **조용히 폴백**한다 — 셀렉터 실패로 기능이 사라지면 안 된다 (NFR-05).
     */
    const placeActions = (actions: HTMLElement): void => {
      if (!bar) return;
      actionsEl?.remove();
      actionsEl = actions;

      const slot = resolveToolsSlot(document, 'after-donation');
      /**
       * 🔴 최소 크기 버튼조차 못 들어가면 도구 행을 **쓰지 않는다** (실측 2026-08-15).
       * 채팅 124px 에서는 치지직의 후원하기+채팅만으로 이미 107/108px 을 쓴다. 억지로 넣으면
       * 줄바꿈으로 입력 영역이 46px → 94px 로 커져 버튼이 화면 밖으로 밀린다
       * (/tmp 실측 · ui-profile-shots 모바일 세로에서 확인).
       */
      /**
       * 🔴 이미 도구 행에 들어가 있으면 **우리 폭을 도로 더해** 계산한다 — 그러지 않으면
       * "들어갔더니 여유가 줄어 다시 나가는" 진동이 생긴다 (chatWidth 의 placeControl 과 같은 이유).
       */
      const free = slot
        ? freeWidthIn(slot.parent) +
          (actions.parentElement === slot.parent ? actions.getBoundingClientRect().width : 0)
        : 0;
      if (slot && free >= profile.touchTargetPx) {
        actions.classList.add(OURS.toolsSlotClass);
        actions.dataset['side'] = 'left';
        // 여유가 빠듯하면 라벨만 남겨 줄바꿈을 막는다 (실측 근거는 CSS 주석 참고).
        if (free < FULL_LABEL_PX) actions.dataset['compact'] = 'true';
        else delete actions.dataset['compact'];
        bar.dataset['anchor'] = 'tools';
        slot.parent.insertBefore(actions, slot.before);
        return;
      }
      actions.classList.remove(OURS.toolsSlotClass);
      delete actions.dataset['side'];
      delete actions.dataset['compact'];
      bar.dataset['anchor'] = 'fallback';
      bar.appendChild(actions);
    };

    const mount = (): void => {
      const input = qs<HTMLTextAreaElement>(CHZZK.chatInput);
      // 바는 **입력 영역 앞**에 둔다 — 입력창의 부모(`_container_1k5b6_2`)가 아니다.
      // 그래야 위로 열리는 패널이 입력 영역 전체를 비켜 채팅 목록 위에 뜬다.
      const anchor = input ? (resolveInputArea(input) ?? input.parentElement) : null;
      if (!anchor) return;

      // 부분적으로만 남아 있는 이전 노드를 먼저 걷어낸다 (도구 행만 리렌더된 경우).
      document.getElementById(OURS.chatPresetBarId)?.remove();
      actionsEl?.remove();
      actionsEl = null;

      bar = document.createElement('div');
      bar.id = OURS.chatPresetBarId;
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', '이지직 채팅 문구');
      // 패널은 채팅 폭 전체를 쓰고 위로 열려야 하므로 바 자체는 입력 영역 앞에 그대로 둔다.
      anchor.insertAdjacentElement('beforebegin', bar);
      // 삽입 후에 그려야 도구 행 자리 탐색이 실제 DOM 위치를 기준으로 된다.
      render();
      info(
        `chat preset bar mounted (${presets.length} presets, ui ${profile.chatPresetUi}, anchor ${String(bar.dataset['anchor'])})`,
      );
    };

    // 채팅 영역이 리렌더되면 삽입 노드가 사라진다 → 재삽입을 감시한다.
    // 바만 남고 도구 행의 버튼 묶음이 날아가는 경우도 있어 둘 다 확인한다.
    const stopKeepMounted = keepMounted(
      aside,
      () =>
        document.getElementById(OURS.chatPresetBarId) !== null && actionsEl?.isConnected === true,
      mount,
      { debounceMs: profile.relaxObservers ? 400 : 200 },
    );

    /**
     * 채팅 영역 크기가 바뀌면(FR-05 폭 조절·오른쪽↔아래 전환·FR-10 오버레이) 패널이 쓸 수 있는
     * 높이도 바뀐다. 열려 있는 패널의 상한을 다시 잰다 — 안 그러면 아래 배치로 바꾼 순간
     * 이전 높이 그대로 컨트롤바를 덮는다.
     */
    let stopAsideResize: (() => void) | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        /**
         * 🔴 자리(도구 행 ↔ 플로팅)도 다시 고른다. 폭이 바뀌었는데 그대로 두면, 좁을 때 정한
         * 플로팅 토글이 **넓어진 뒤에도** 남아 채팅 영역 위(= 치지직 컨트롤바 자리)에 뜬다
         * (실측 2026-08-15: 915×412 아래 배치에서 토글이 일시정지 버튼을 덮었다).
         */
        if (actionsEl) placeActions(actionsEl);
        const panel = bar?.querySelector<HTMLElement>('.cm-preset-panel');
        if (panel) clampPanelHeight(panel);
      });
      observer.observe(aside);
      stopAsideResize = () => observer.disconnect();
    }

    // 단축키 Alt+1~9 — 기기 프로필이 'off' 면 아예 걸지 않는다.
    let stopShortcuts: (() => void) | undefined;
    if (profile.shortcuts !== 'off') {
      const onKeyDown = (event: KeyboardEvent): void => {
        if (!event.altKey || event.ctrlKey || event.metaKey) return;
        if (!/^[1-9]$/.test(event.key)) return;
        const index = Number(event.key) - 1;
        const preset = presets[index];
        if (!preset) return;
        event.preventDefault();
        applyText(preset.text);
      };
      document.addEventListener('keydown', onKeyDown, true);
      stopShortcuts = () => document.removeEventListener('keydown', onKeyDown, true);
    } else {
      info('chat preset shortcuts disabled by device profile');
    }

    return () => {
      stopKeepMounted();
      stopAsideResize?.();
      stopShortcuts?.();
      document.getElementById(OURS.chatPresetBarId)?.remove();
      actionsEl?.remove();
      actionsEl = null;
      bar = null;
      removeStyle(STYLE_ID);
    };
  },
};
