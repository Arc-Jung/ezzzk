/**
 * FR-05 `+` / `-` 채팅창 점유율 조절.
 *
 * 실측 근거 (2026-08-11, 분석 문서 §5.2 — 실험 PASS)
 * - `div[class*="_wrapper_wj4te"]`(flex row) 의 두 형제 = `main`(영상) + `aside#aside-chatting`.
 * - aside 는 클래스로 353px 고정 + `flex: 0 0 auto` 다. CSS 변수는 쓰이지 않는다.
 *   → `width` + `flex` 를 `!important` 로 함께 덮어야 한다. 520px 강제 시 영상이 자동 리사이즈됐고
 *     원복도 정상이었다.
 * - ⚠️ 실제 스타일 주입은 **여기서 하지 않는다.** FR-10 · FR-14 와 폭이 경합하므로
 *   `layoutArbiter` 에만 주장(claim)을 넣는다 (FR-10.7 우선순위: 멀티뷰 > FR-10 > FR-05).
 * - 폭이 바뀌면 채팅 스크롤 위치가 튄다 → 변경 전 위치를 기억해 복원한다.
 * - **데스크톱 라이브 페이지 전용.** VOD·모바일 웹에는 `#aside-chatting` 이 없다.
 */

import { CHZZK, ID, OURS } from '../constants/class';
import { hasSideChat } from '../pageType';
import { freeWidthIn, resolveToolsSlot } from './chatPreset';
import { claimWidth, ensureLayoutArbiter, releaseWidth } from '../layoutArbiter';
import { DEFAULT_SETTINGS } from '../constants/storage';
import { updateSection } from '../storage';
import { qs, upsertStyle, removeStyle } from '../utils/dom';
import { debounce, keepMounted, observe, type Disposer, disposeAll } from '../utils/observe';
import { onViewportChange, pictureSize, readViewport } from '../utils/viewport';
import { guardAsync, info } from '../utils/log';
import { isScrolledToBottom } from './chatFont';
import type { Feature } from './types';

// TODO(consolidate into constants/class.ts OURS)
const CONTROL_ID = 'cm-chat-width-control';
// TODO(consolidate into constants/class.ts OURS)
const CONTROL_STYLE_ID = 'cm-chat-width-control-style';

/**
 * 비율(%)을 설정 범위로 자른다.
 * NaN 은 최소값으로 본다(손상된 값에서 채팅이 화면을 덮지 않게). ±Infinity 는 그냥 잘린다.
 */
export function clampChatRatio(ratio: number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (Number.isNaN(ratio)) return lo;
  return Math.min(hi, Math.max(lo, ratio));
}

/**
 * `+` / `-` 한 번의 결과 비율(%). `delta` 는 +1 / -1 이다.
 * 단계가 유효하지 않으면 현재 값을 범위 안으로만 정리한다.
 */
export function stepChatRatio(
  current: number,
  delta: number,
  step: number,
  min: number,
  max: number,
): number {
  const base = clampChatRatio(current, min, max);
  if (!Number.isFinite(step) || step <= 0 || Number.isNaN(delta)) return base;
  return clampChatRatio(base + Math.sign(delta) * step, min, max);
}

/**
 * 비율(%) → 픽셀. 뷰포트 폭 기준이며 **캐시하지 않는다** (FR-12.1).
 * 반올림한다 — 내림하면 1px 여백이 남는다.
 */
export function ratioToPx(ratio: number, viewportWidth: number): number {
  if (!Number.isFinite(ratio) || !Number.isFinite(viewportWidth) || viewportWidth <= 0) return 0;
  return Math.max(0, Math.round((viewportWidth * ratio) / 100));
}

/**
 * 실제로 쓸 점유율.
 *
 * FR-12 표는 채팅 기본 점유율을 **기기 유형별로** 지정한다(데스크톱 25~30 / 노트북 25 /
 * 태블릿13 25 / 태블릿10 22 / 7인치·모바일은 FR-10 계산값). 전역 값 하나만 쓰면 이 요구를
 * 지킬 수 없다 — 실측에서 노트북 1440×900 에 30% 를 적용해 영상이 1007×566 으로 줄고
 * 레터박스가 334px 생기는 것을 확인했다.
 *
 * - `ratioSource: 'auto'` → 기기 프로필의 기본 점유율을 쓴다.
 *   프로필이 `null`(7인치·모바일)이면 FR-10 이 폭을 정하므로 저장된 값을 그대로 둔다.
 * - `ratioSource: 'manual'` → 사용자가 직접 조절한 값이 우선한다.
 */
export function effectiveChatRatio(
  settings: { ratio: number; ratioSource: 'auto' | 'manual' },
  profile: { chatRatioLandscape: number | null },
  min: number,
  max: number,
): number {
  if (settings.ratioSource === 'manual' || profile.chatRatioLandscape === null) {
    return clampChatRatio(settings.ratio, min, max);
  }
  return clampChatRatio(profile.chatRatioLandscape, min, max);
}

export type ChatPlacement = 'right' | 'bottom';

/** 세로 자세인가. 정사각(1:1)은 가로로 본다 — 오른쪽 배치가 성립하는 폭이다. */
export function isPortraitViewport(width: number, height: number): boolean {
  return height > width;
}

/**
 * 하단 배치에서 **영상 그림이 최소한 지켜야 할 몫**. 유효 상한(`chatRatioRangeFor`)의 근거다.
 *
 * 0.5 = "그림 높이의 절반까지는 사용자가 채팅에 내줄 수 있다". 이 값을 낮추면 상한이 올라가
 * 채팅이 영상을 거의 다 먹을 수 있고, 1.0 으로 두면 상한이 자동값과 같아져 `+` 가 죽는다.
 */
export const BOTTOM_MIN_PICTURE_SHARE = 0.5;

/** 소수 첫째 자리로 **내린다.** 올리면 aside 가 남는 높이를 넘어 그만큼 영상 그림을 깎는다. */
function floorTenth(value: number): number {
  return Math.floor(value * 10) / 10;
}

/** 지금 뷰포트에서 영상이 실제로 그리는 높이(px). 폭에 걸린 16:9 상한이 곧 이 값이다. */
function videoPictureHeight(viewport: { width: number; height: number }): number | null {
  const { width, height } = viewport;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  // `pictureSize` 는 `min(h, w / (16/9))` 를 준다 — 세로 화면에서는 언제나 폭이 잡는 값이다.
  return pictureSize(width, height).height;
}

/**
 * 세로 **하단 배치**의 자동 점유율(%). **순수 함수 — 테스트 대상.**
 *
 * 🔴 근거 (실측 2026-08-16, `probe-bottom-gap/report.json`, 412×915 실사이트).
 * 하단 배치에서 영상과 채팅 사이에 **316px 검은 공백**이 남았다.
 *
 * | 요소 | 실측 |
 * |---|---|
 * | `main` | 412×**549** |
 * | `#live_player_layout` / `video` | 412×**232** (= 412 ÷ 16×9, 폭이 잡는 16:9 상한) |
 * | `#aside-chatting` | 412×366 (= 915 의 40%, `chatRatioPortrait`) |
 *
 * `main` 은 `flex: 1 1 auto` 로 남는 높이를 전부 먹는데 영상은 232px 를 넘길 수 없으므로
 * **549 − 232 = 317px 이 죽는다.** 점유율을 기기 프로필의 고정값(30~40%)으로 잡는 한 이
 * 공백은 사라지지 않는다.
 *
 * → 점유율을 **"뷰포트 높이 − 영상 그림 높이"** 에서 유도한다. 412×915 면
 * `(915 − 231.75) / 915 = 74.6%` → aside 683px, `main` 232px 로 공백이 0 이 된다.
 * **영상 그림은 전혀 줄지 않는다** — 어차피 폭이 16:9 상한을 잡고 있어 그 위 공간은
 * 영상이 쓸 수 없는 자리였기 때문이다. 이것이 이 방향의 근거다.
 *
 * ⚠️ 이 값은 기기 프로필의 `chatRatioPortrait` 를 **대체한다.** 그 필드는 이제 값이 아니라
 * "이 프로필에서 세로 자동 하단 배치를 쓰는가"의 on/off 표시로만 읽힌다(`null` = 쓰지 않음).
 */
export function autoBottomChatRatio(viewport: { width: number; height: number }): number {
  const picture = videoPictureHeight(viewport);
  if (picture === null) return 0;
  return Math.max(0, floorTenth(((viewport.height - picture) / viewport.height) * 100));
}

/**
 * 배치별 **유효 점유율 범위**. **순수 함수 — 테스트 대상.**
 *
 * 🔴 저장 스키마(`chatWidth.min` / `chatWidth.max` = 15~50)는 **그대로 둔다.** 상한을 저장값으로
 * 올리면 오른쪽 배치에도 그대로 먹어 가로에서 채팅이 화면 절반을 넘게 덮는다. 배치는 회전
 * 한 번에 바뀌는 값이라 저장에 섞으면 되돌릴 근거가 사라진다 → **파생값으로만 올린다.**
 *
 * 하단 배치의 상한은 `autoBottomChatRatio` 보다 **반드시 커야 한다.** 그러지 않으면 자동값이
 * 범위 밖이라 첫 `−` 클릭에서 상한으로 끌려 내려가며 값이 튄다
 * (412×915 에서 자동 74.6% → 상한 50% 로 클램프되면 aside 683 → 457px).
 * 그래서 고정 상수가 아니라 **영상 그림 높이에서 유도**한다 —
 * `(H − 그림높이 × BOTTOM_MIN_PICTURE_SHARE) / H`. 그림의 절반까지만 내주므로
 * 언제나 자동값(그림을 온전히 지키는 값)보다 크고, 뷰포트가 아무리 길어져도 이 관계가 깨지지 않는다.
 *
 * - 412×915 → 자동 74.6% / 상한 87.3% (`+` 를 두 번 더 누를 여유가 남는다)
 * - 540×960 → 자동 68.3% / 상한 84.1%
 * - 가로(915×412)에서 사용자가 하단을 고른 경우 → 그림이 높이에 걸리므로 상한은 50% = 기존값
 */
export function chatRatioRangeFor(
  placement: ChatPlacement,
  viewport: { width: number; height: number },
  min: number,
  max: number,
): { min: number; max: number } {
  if (placement !== 'bottom') return { min, max };
  const picture = videoPictureHeight(viewport);
  if (picture === null) return { min, max };
  const cap = floorTenth(
    ((viewport.height - picture * BOTTOM_MIN_PICTURE_SHARE) / viewport.height) * 100,
  );
  // 오른쪽 배치의 기존 범위를 밑돌지 않게 한다 (상한은 **올리기만** 한다).
  return { min, max: Math.max(max, cap) };
}

/**
 * 자세에 맞는 배치와 점유율. **순수 함수 — 테스트 대상.**
 *
 * 🔴 근거 (실측 2026-08-15, `portrait-shots/`. 사용자 보고 "9:16 비율에서 문제가 있다").
 * 세로 화면인데 채팅이 오른쪽 세로 띠로 붙어 영상과 채팅이 **둘 다** 쓸 수 없게 됐다.
 *
 * | 뷰포트 | 채팅 | 영상 그림 |
 * |---|---|---|
 * | 540×960 (9:16) | 119px = 폭의 22% | 421×237 = **높이의 24.7%** |
 * | 720×1280 (9:16) | 180px = 폭의 25% | 540×304 = **높이의 23.7%** |
 * | 412×915 (폰 세로) | 124px = 폭의 30% | 288×162 = **높이의 17.7%** |
 *
 * 119px 폭에서는 닉네임이 잘리고 한 줄 메시지가 두 줄로 쪼개진다(스크린샷 확인).
 *
 * 원인은 **FR-12 의 `chatRatioPortrait` 가 죽은 설정이었다는 것**이다 — 정의만 있고
 * 코드 어디에서도 읽히지 않아 세로에서도 가로용 값(`chatRatioLandscape`)이 쓰였다.
 * `layoutArbiter` 에는 이미 `bottom`(영상 아래 쌓기) 모드가 있으므로 자세에 맞춰 그것을 쓴다.
 *
 * ⚠️ **사용자가 직접 정한 배치·폭은 건드리지 않는다.** 위치 버튼(▦/▤)이나 `+`/`−` 를 누른
 * 사용자에게 회전할 때마다 자동값을 덮어씌우면 그 조작이 무의미해진다.
 *
 * 🔴 단, **폭 오버라이드와 배치 오버라이드는 서로 다른 결정이다** (실측 2026-08-15
 * `ratio-9to16/S-06`, 540×960). 하나의 플래그로 묶었더니 세로 화면에서 점유율 `+` 를 누르는
 * 순간 자동 하단 배치가 풀리고 저장된 `placement: 'right'` 로 되돌아갔다
 * (하단 336px → 오른쪽 189px 세로 띠). 폭만 정한 사용자는 배치를 정한 적이 없다.
 * → 배치와 점유율을 **각각** 정한다.
 */
export function effectiveChatLayout(
  settings: { ratio: number; ratioSource: 'auto' | 'manual'; placement: ChatPlacement },
  profile: { chatRatioLandscape: number | null; chatRatioPortrait: number | null },
  viewport: { width: number; height: number },
  min: number,
  max: number,
  {
    widthOverride = false,
    placementOverride = false,
  }: { widthOverride?: boolean; placementOverride?: boolean } = {},
): { placement: ChatPlacement; ratio: number } {
  const autoBottom =
    isPortraitViewport(viewport.width, viewport.height) && profile.chatRatioPortrait !== null;

  const placement: ChatPlacement = placementOverride || !autoBottom ? settings.placement : 'bottom';

  // 범위는 **정해진 배치**를 따른다 — 하단에서만 상한이 올라간다 (`chatRatioRangeFor`).
  const range = chatRatioRangeFor(placement, viewport, min, max);

  const ratio = widthOverride
    ? clampChatRatio(settings.ratio, range.min, range.max)
    : autoBottom && placement === 'bottom'
      ? clampChatRatio(autoBottomChatRatio(viewport), range.min, range.max)
      : effectiveChatRatio(withoutBottomLeftover(settings, max), profile, range.min, range.max);

  return { placement, ratio };
}

/**
 * 🔴 회전으로 **하단 → 오른쪽**으로 돌아왔을 때 하단 자동 점유율이 새어 들어오는 것을 막는다
 * (실측 회귀 2026-08-16 `verify-user-scenarios` mobile-landscape/S-06).
 *
 * 저장 필드 `chatWidth.ratio` 는 하나인데 하단(높이 기준)과 오른쪽(폭 기준)은 의미가 다르다.
 * 하단 자동값(412×915 → 74.6%)이 저장된 상태로 가로가 되면 오른쪽 범위(15~50)로 클램프되어
 * **상한 50% 에 눌러앉고 `+` 가 영구 비활성**이 됐다 (설정 패널 스테퍼 클릭이 타임아웃).
 *
 * 자동값은 언제든 다시 계산되므로 물려받을 이유가 없다 → `auto` 인데 저장 상한을 넘는 값은
 * "하단이 남긴 찌꺼기"로 보고 기본값에서 다시 시작한다.
 * `manual`(사용자가 직접 정한 값)은 건드리지 않는다 — 그건 사용자의 결정이다.
 */
function withoutBottomLeftover<T extends { ratio: number; ratioSource: 'auto' | 'manual' }>(
  settings: T,
  storedMax: number,
): T {
  if (settings.ratioSource !== 'auto' || !(settings.ratio > storedMax)) return settings;
  return { ...settings, ratio: DEFAULT_SETTINGS.chatWidth.ratio };
}

/**
 * 비율을 px 로 환산할 때 기준이 되는 변.
 *
 * 🔴 하단 배치에서 claim 값은 **높이**로 해석된다(`layoutArbiter` 의 `bottom` 모드).
 * 그런데 폭 기준으로 계산하면 세로 화면에서 터무니없는 높이가 나온다
 * (540×960 에서 35% → 189px 를 높이로 쓰게 된다. 실제로 원하는 값은 336px 다).
 */
export function ratioBasisPx(
  placement: ChatPlacement,
  viewport: { width: number; height: number },
) {
  return placement === 'bottom' ? viewport.height : viewport.width;
}

/** 펼쳤을 때 나오는 `+ − ⟩ ▦` 묶음. 접힘이 기본이라 평소에는 토글 하나만 보인다. */
const ITEMS_CLASS = 'cm-chat-width-items';

/** 버튼 사이 간격(px). 여유 폭 판정과 CSS 가 **같은 값**을 써야 판정이 어긋나지 않는다. */
const CONTROL_GAP_PX = 4;

/** 펼쳤을 때 나오는 버튼 수 (`+` `−` `⟩` `▦`). */
const ITEM_COUNT = 4;

/**
 * 떠 있는 묶음을 영상 위에 놓을 때 쓰는 값들.
 *
 * - `FLOATING_TOP_PX` 96 — 치지직 헤더(60px)와 채팅 헤더 아래. 컨트롤바는 영상 **아래쪽**이라
 *   위쪽에 두면 겹치지 않는다 (실측 2026-08-15: 915×412 에서도 컨트롤바 y≈376 이라 여유가 있다).
 * - `OVERLAY_SIDE_MIN_PX` 160 — 채팅 왼쪽에 이만큼도 안 남으면 옆으로 비킬 자리가 없다고 본다
 *   (버튼 4개 = 최대 4×48 + 여백 기준).
 */
const FLOATING_TOP_PX = 96;
const OVERLAY_GAP_PX = 8;
const OVERLAY_SIDE_MIN_PX = 160;

/**
 * 폭 조절 묶음을 어디에 어떻게 둘지.
 *
 * - `inline` — 도구 행에 4개까지 그대로 펼친다.
 * - `popover` — 도구 행에는 토글만 두고, 펼치면 **위로 열리는 팝오버**로 띄운다.
 * - `floating` — 토글 하나조차 못 들어가면 도구 행을 쓰지 않고 화면 오른쪽 플로팅으로 폴백한다.
 */
export type ControlAnchor = 'inline' | 'popover' | 'floating';

/**
 * 도구 행의 여유 폭으로 배치를 정한다. **순수 함수 — 테스트 대상.**
 *
 * 실측 여유 폭 (2026-08-15, 도구 행에 우리 묶음을 넣기 전 기준)
 * | 프로필 | 여유 | 결과 |
 * |---|---|---|
 * | 모바일 세로(채팅 124px) | 1px | floating |
 * | FR-10 오버레이(183px) | 10px | floating |
 * | 태블릿10 가로(260px) | 69px | popover |
 * | 노트북13(360px) | 169px | popover |
 * | 태블릿10 세로 하단 배치(820px) | 629px | inline |
 *
 * `freeWidthPx` 가 `null` 이면 도구 행 자체를 못 찾은 것이다 (셀렉터 실패 → NFR-05 폴백).
 */
export function resolveControlAnchor(
  freeWidthPx: number | null,
  touchTargetPx: number,
  gapPx: number = CONTROL_GAP_PX,
): ControlAnchor {
  if (freeWidthPx === null || !Number.isFinite(freeWidthPx)) return 'floating';
  const one = Math.max(28, Math.round(touchTargetPx)) + gapPx;
  if (freeWidthPx < one) return 'floating';
  return freeWidthPx >= one * (ITEM_COUNT + 1) ? 'inline' : 'popover';
}

function controlCss(touchTargetPx: number): string {
  const size = Math.max(28, Math.round(touchTargetPx));
  const gap = CONTROL_GAP_PX;
  return `
#${CONTROL_ID} { display: flex; align-items: center; gap: ${gap}px; }
/*
  폴백 배치 — 도구 행에 토글조차 못 넣을 때만 쓴다 (모바일 세로·FR-10 오버레이).
  기능이 사라지면 안 되므로 화면에 그대로 띄운다 (NFR-05).
  가로 위치(right)는 JS 가 채팅 영역 바깥으로 잡는다 (placeOverlay).
*/
#${CONTROL_ID}[data-anchor="floating"] {
  position: fixed;
  top: ${FLOATING_TOP_PX}px;
  right: 8px;
  z-index: ${OURS.topZIndex - 2};
  flex-direction: column;
  align-items: flex-end;
}
/* 도구 행 안에서는 오른쪽 끝(= 채팅 버튼 왼쪽)에 붙는다. */
#${CONTROL_ID}[data-side="right"] { margin-left: auto; }
#${CONTROL_ID} .${ITEMS_CLASS} { display: none; gap: ${gap}px; }
#${CONTROL_ID}[data-expanded="true"] .${ITEMS_CLASS} { display: flex; }
#${CONTROL_ID}[data-anchor="floating"] .${ITEMS_CLASS} { flex-direction: column; }
/*
  도구 행에 4개를 펼칠 자리가 없으면 **채팅 영역 바깥(영상 위)** 에 띄운다.
  🔴 예전에는 컨트롤 바로 위(bottom: 100%)로 열었는데, 그 자리가 정확히 치지직 입력창이라
  1180x820 · 1440x900 · 1920x950 · 915x412 전부에서 textarea 중앙을 덮었고 태블릿10 가로에서는
  입력창 펼치기 클릭이 아예 실패했다 (실측 2026-08-15 explore-shots).
  채팅 영역 위쪽도 이미 문구 패널·문구 토글이 쓰는 좁은 레인이라 그쪽으로 올려도 서로 덮는다.
  → 위치는 JS 가 채팅 영역 바깥으로 잡는다 (placeOverlay). 여기서는 띄우기만 한다.
  ⚠️ 이 문자열은 템플릿 리터럴이다 — 주석에 백틱을 쓰지 않는다 (빌드가 깨진다).
*/
#${CONTROL_ID}[data-anchor="popover"] { position: relative; }
#${CONTROL_ID}[data-anchor="popover"] .${ITEMS_CLASS} {
  position: fixed;
  z-index: ${OURS.topZIndex - 2};
  padding: ${gap}px;
  background: rgba(20, 21, 23, 0.96);
  border: 1px solid #2a2d31;
  border-radius: 8px;
}
#${CONTROL_ID} button {
  width: ${size}px;
  height: ${size}px;
  min-width: ${size}px;
  min-height: ${size}px;
  border: 0;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
#${CONTROL_ID} button:focus-visible { outline: 2px solid #00ffa3; }
`.trim();
}

/** 폭 변경 전후로 채팅 스크롤 위치를 보존한다. 맨 아래였으면 맨 아래로 재고정한다. */
function withScrollPreserved(mutate: () => void): void {
  const scroller = qs<HTMLElement>(CHZZK.chatScroller);
  const previousTop = scroller?.scrollTop ?? 0;
  const wasAtBottom = scroller ? isScrolledToBottom(scroller) : true;

  mutate();

  if (!scroller) return;
  requestAnimationFrame(() => {
    scroller.scrollTop = wasAtBottom ? scroller.scrollHeight : previousTop;
  });
}

export const chatWidthFeature: Feature = {
  id: 'chatWidth',
  watches: ['chatWidth'],
  supports: (ctx) =>
    ctx.settings.chatWidth.enabled && hasSideChat(ctx.page.type) && !ctx.page.isSlotFrame,
  start: (ctx) => {
    const { step, min, max } = ctx.settings.chatWidth;
    /**
     * 🔴 여기서 **클램프하지 않는다.** 하단 배치의 유효 상한은 배치가 정해진 뒤에야 알 수 있다
     * (`chatRatioRangeFor`). 미리 15~50 으로 자르면 저장된 하단 점유율(예: 74.6%)이 시작
     * 시점에 50 으로 깎여 되살아나지 않는다 — 아래 `syncAutoLayout()` 은 이 지역 변수를
     * 입력으로 쓰기 때문에 한 번 깎이면 복구 경로가 없다.
     * 실제 값은 바로 아래 `syncAutoLayout()` 이 배치와 함께 정한다.
     */
    let ratio = ctx.settings.chatWidth.ratio;
    let collapsed = ctx.settings.chatWidth.collapsed;

    const stopArbiter = ensureLayoutArbiter({ relaxed: ctx.device.profile.relaxObservers });

    /**
     * 사용자가 이 **폭**을 직접 정했는가. 참이면 FR-10 계산값을 이긴다
     * (`layoutArbiter.resolveWidth`).
     *
     * 🔴 **저장된 값에서 되살릴 수 있어야 한다.** 세션 변수로만 들고 있으면 세션 상태와 저장
     * 상태가 갈라진다 — 새로고침하거나 설정 패널에서 다른 `chatWidth` 항목을 바꿔 기능이
     * 재시작되면(`content.tsx` 의 `shouldRestartFeature` 는 `watches` 만 본다) 오버라이드가
     * 사라지고 FR-10 이 다시 이긴다.
     *
     * `collapsed` 도 함께 본다 — `ratioSource: 'auto'` + `collapsed: true` 로 저장된
     * 이전 버전 값에서도 접힘이 유지돼야 한다.
     */
    let widthOverride = ctx.settings.chatWidth.ratioSource === 'manual' || collapsed;

    /**
     * 사용자가 **배치**를 직접 정했는가. 참이면 자세에 따른 자동 하단 배치를 덮는다.
     *
     * 🔴 폭과 **분리된 플래그여야 한다** (실측 2026-08-15 `ratio-9to16/S-06`). 하나로 묶었을
     * 때는 세로 화면에서 점유율 `+` 를 누르는 것만으로 `ratioSource: 'manual'` 이 서고,
     * 그 순간 자동 하단 배치가 풀려 저장된 `placement: 'right'` 로 되돌아갔다.
     *
     * 🔴 그러면서도 **저장돼야 한다.** 사용자가 위치 버튼으로 고른 `bottom` 은 새로고침·기능
     * 재시작 후에도 유지돼야 한다(이전 회귀 M1). 그래서 세션 변수가 아니라
     * `placementSource` 필드에 남긴다.
     */
    let placementOverride = ctx.settings.chatWidth.placementSource === 'manual';

    /** 폭 주장 우선순위용 — 폭이든 배치든 사용자가 정했으면 FR-10 을 이겨야 한다. */
    const userOverride = (): boolean => widthOverride || placementOverride;

    /** 지금 뷰포트로 폭을 다시 계산해 주장한다. 값은 캐시하지 않는다 (FR-12.1). */
    const apply = (): void => {
      if (collapsed) {
        // 접기는 언제나 명시적 조작이다 — 자동 계산값에 지면 버튼이 죽은 것으로 보인다.
        claimWidth('chatWidth', 0, 'collapsed by user', 'flex', { userOverride: true });
        return;
      }
      const viewport = readViewport();
      // 하단 배치에서는 claim 값이 **높이**로 해석되므로 기준 변도 높이여야 한다.
      const widthPx = ratioToPx(ratio, ratioBasisPx(placement, viewport));
      claimWidth(
        'chatWidth',
        widthPx,
        `ratio ${ratio}% (${placement})`,
        placement === 'bottom' ? 'bottom' : 'flex',
        { userOverride: userOverride() },
      );
    };

    /**
     * 자세에 맞는 자동 배치·점유율을 현재 뷰포트로 다시 정한다. **캐시하지 않는다** (FR-12.1) —
     * 회전·분할 화면으로 자세가 바뀔 때마다 다시 계산해야 한다.
     *
     * 배치와 점유율은 **각각의 오버라이드만** 존중한다. 폭만 정한 사용자는 배치를 정한 적이
     * 없으므로 세로에서는 계속 자동 하단 배치가 유지된다.
     */
    const syncAutoLayout = (): void => {
      const next = effectiveChatLayout(
        { ratio, ratioSource: ctx.settings.chatWidth.ratioSource, placement: storedPlacement },
        ctx.device.profile,
        readViewport(),
        min,
        max,
        { widthOverride, placementOverride },
      );
      if (next.placement === placement && next.ratio === ratio) return;
      const ratioChanged = next.ratio !== ratio;
      ratio = next.ratio;
      placement = next.placement;
      updatePlacementButton();
      // 자동으로 고른 점유율은 저장에도 반영한다 — 그러지 않으면 설정 패널의 스테퍼가
      // 죽은 저장값(예: 30%)을 보여 주고, `+` 첫 클릭이 실제 적용값(35%)과 같은 값을 만들어
      // "눌러도 안 커진다"가 된다 (실측 2026-08-15 `ratio-9to16`).
      // ⚠️ `placement` 는 저장하지 않는다 — 자동 하단 배치가 저장되면 가로로 돌아와도 하단에
      // 눌러앉는다. 배치는 `togglePlacement` 만 저장한다.
      if (ratioChanged && !widthOverride) persistAutoRatio();
      info(`chat layout auto-adjusted: ${ratio}% (${placement})`);
    };

    /** 자동 계산된 점유율만 저장한다 (오버라이드 플래그는 건드리지 않는다). */
    const persistAutoRatio = (): void => {
      void guardAsync('chatWidth.persistAutoRatio', () =>
        updateSection('chatWidth', { ratio }, { origin: 'chatWidth' }),
      );
    };

    const persist = (sources?: {
      ratioSource?: 'auto' | 'manual';
      placementSource?: 'auto' | 'manual';
    }): void => {
      void guardAsync('chatWidth.persist', () =>
        // origin 을 붙여 자기 재시작을 막는다 — `+`/`-` 클릭마다 컨트롤이 재생성되고
        // 폭 조정자 참조 카운트가 순환하는 것을 피한다.
        // 배치는 **사용자가 고른 값**(`storedPlacement`)만 저장한다. 자동으로 정해진 하단
        // 배치를 저장하면 가로로 돌아와도 하단에 눌러앉는다.
        updateSection(
          'chatWidth',
          { ratio, collapsed, placement: storedPlacement, ...(sources ?? {}) },
          { origin: 'chatWidth' },
        ),
      );
    };

    const changeRatio = (delta: number): void => {
      // 🔴 범위는 **지금 배치·지금 뷰포트**로 다시 구한다 (FR-12.1: 캐시하지 않는다).
      // 저장된 15~50 을 그대로 쓰면 하단 배치의 자동값(74.6%)이 범위 밖이라 첫 `−` 에서
      // 50% 로 끌려 내려가며 값이 튄다 (aside 683 → 457px).
      const range = chatRatioRangeFor(placement, readViewport(), min, max);
      const next = stepChatRatio(ratio, delta, step, range.min, range.max);
      // 🔴 클램프 경계(이미 min·max)에서도 **오버라이드 승격은 일어나야 한다.** 조기 반환하면
      // 기기 기본값이 마침 경계값인 초광폭 뷰포트에서 `+` 가 영원히 죽은 버튼으로 보인다
      // (FR-10 이 계속 이긴다). 값도 그대로고 이미 오버라이드일 때만 할 일이 없다.
      if (next === ratio && !collapsed && widthOverride) return;
      ratio = next;
      collapsed = false;
      // 여기서부터는 사용자가 정한 **폭**이다. 저장(`persist`)만으로는 부족하다 —
      // 이번 클릭의 `apply()` 가 이미 지나가 버려 화면이 안 바뀐 것처럼 보인다.
      // ⚠️ 배치 오버라이드는 세우지 않는다 — 세로 화면의 자동 하단 배치가 풀리면 안 된다.
      widthOverride = true;
      withScrollPreserved(apply);
      updateCollapseButton();
      // 사용자가 직접 조절했으므로 이후에는 기기별 기본값보다 이 값이 우선한다.
      persist({ ratioSource: 'manual' });
      info(`chat width ratio changed to ${ratio}%`);
    };

    const toggleCollapse = (): void => {
      collapsed = !collapsed;
      // 접기도 **폭** 조작이다 — 배치 오버라이드는 세우지 않는다.
      widthOverride = true;
      withScrollPreserved(apply);
      updateCollapseButton();
      // 접히면 도구 행이 사라진다 → 플로팅으로 옮겨야 펼치기 버튼이 살아 있다.
      if (controlEl?.isConnected) placeControl(controlEl);
      // 접기·펼치기도 사용자 조작이다 — `manual` 로 저장해야 재시작 후에도 오버라이드가 산다.
      // (펼치면 `collapsed` 가 false 라 이것 없이는 오버라이드 근거가 사라진다.)
      persist({ ratioSource: 'manual' });
      info(`chat width collapsed: ${String(collapsed)}`);
    };

    const makeButton = (label: string, text: string, onClick: () => void): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', label);
      button.textContent = text;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      });
      return button;
    };

    let collapseButton: HTMLButtonElement | null = null;
    let placementButton: HTMLButtonElement | null = null;
    let toggleButton: HTMLButtonElement | null = null;
    let controlEl: HTMLElement | null = null;
    let itemsEl: HTMLElement | null = null;
    /**
     * 4개 버튼이 펼쳐져 있는가. **저장하지 않는다** — 창별 독립 동작을 위해 `chatWidth` 는
     * 이미 창 로컬로 다루고 있으므로 저장을 늘리지 않는다 (2026-08-15 요청).
     */
    let expanded = false;

    /**
     * 떠 있는 묶음(팝오버·플로팅)을 **채팅 영역 바깥**에 놓는다. 값은 캐시하지 않는다 (FR-12.1).
     *
     * 🔴 채팅 영역 안에 띄우면 좁은 레인을 두고 치지직 입력창·우리 문구 패널과 다툰다
     * (실측 2026-08-15 explore-shots: 팝오버가 textarea 중앙을 덮어 4개 프로필에서 입력 불가,
     *  태블릿10 가로는 입력창 펼치기 클릭 실패). 영상 위에는 그만한 여백이 늘 있다.
     *
     * - 채팅이 **오른쪽**이면(aside 왼쪽 끝이 영상 안쪽) 채팅 왼쪽 바깥, 컨트롤과 같은 높이.
     * - 채팅이 **아래**거나 화면을 거의 다 차지하면 옆으로 비킬 자리가 없다 → 영상 위쪽
     *   오른편(`top: ${FLOATING_TOP_PX}px`)에 둔다. 치지직 컨트롤바는 영상 **아래쪽**이라 비껴간다.
     */
    const placeOverlay = (): void => {
      if (!controlEl) return;
      const anchor = controlEl.dataset['anchor'];
      const floating = anchor === 'floating';
      // 🔴 **둘 다** 지우고 시작한다. 자리를 옮길 때 예전 대상에 남은 인라인 오프셋이
      //    `position: relative` 인 도구 행 안에서 그대로 먹혀 버튼이 96px 아래(화면 밖)로
      //    밀렸다 (실측 2026-08-15: 도구 행 y=358 인데 묶음 y=454).
      for (const el of [controlEl, itemsEl]) {
        if (!el) continue;
        for (const prop of ['right', 'top', 'bottom']) el.style.removeProperty(prop);
      }
      const target = floating ? controlEl : itemsEl;
      if (!target) return;
      if (!floating && (anchor !== 'popover' || !expanded)) return;

      const asideLeft = qs<HTMLElement>(ID.asideChatting)?.getBoundingClientRect().left ?? 0;
      const viewport = readViewport();
      // 영상 쪽에 묶음을 놓을 만한 폭이 남아 있는가 (버튼 4개 + 여백 기준).
      const sideRoom = asideLeft >= OVERLAY_SIDE_MIN_PX;
      target.style.right = `${Math.round(sideRoom ? viewport.width - asideLeft + OVERLAY_GAP_PX : OVERLAY_GAP_PX)}px`;
      /**
       * 세로 위치는 **언제나 영상 위쪽**이다. 토글과 같은 높이(입력창 근처)에 두면 그 높이가
       * 곧 치지직 컨트롤바 자리라 일시정지·설정·좁은 화면 버튼을 덮는다
       * (실측 2026-08-15: 1180×820 에서 우리 설정 버튼 클릭까지 실패했다).
       */
      target.style.top = `${FLOATING_TOP_PX}px`;
    };

    /** 펼침 상태를 DOM 에 반영한다. `hidden` 을 함께 세워 CSS 없이도 접힘이 성립한다. */
    function updateToggleButton(): void {
      if (controlEl) controlEl.dataset['expanded'] = expanded ? 'true' : 'false';
      if (itemsEl) itemsEl.hidden = !expanded;
      placeOverlay();
      if (!toggleButton) return;
      toggleButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      toggleButton.setAttribute('aria-label', expanded ? '채팅 폭 조절 닫기' : '채팅 폭 조절 열기');
      toggleButton.title = expanded ? '채팅 폭 조절 닫기' : '채팅 폭 조절 열기';
    }
    /** 지금 화면에 적용 중인 배치. 자동(세로 → 하단)으로도 바뀐다. */
    let placement: ChatPlacement = ctx.settings.chatWidth.placement;
    /**
     * 사용자가 고른 배치. 위치 버튼(▦/▤)을 누를 때만 바뀌고, 자동 배치는 여기에 쓰지 않는다 —
     * 자동값을 저장하면 가로로 돌아와도 하단에 눌러앉는다.
     */
    let storedPlacement: ChatPlacement = ctx.settings.chatWidth.placement;

    function updatePlacementButton(): void {
      if (!placementButton) return;
      const next = placement === 'right' ? '아래' : '오른쪽';
      placementButton.setAttribute('aria-label', `채팅 위치를 ${next}로 옮기기`);
      placementButton.title = `채팅 위치: ${placement === 'right' ? '오른쪽' : '아래'} (누르면 ${next})`;
      // 현재 배치를 아이콘으로 보여 준다 — 다음 상태가 아니라 현재 상태다(혼동 방지).
      placementButton.textContent = placement === 'right' ? '▦' : '▤';
    }

    const togglePlacement = (): void => {
      placement = placement === 'right' ? 'bottom' : 'right';
      storedPlacement = placement;
      // 배치만 사용자 값이 된다 — 점유율은 계속 자동(기기별 기본값)을 따른다.
      placementOverride = true;
      withScrollPreserved(apply);
      updatePlacementButton();
      // 🔴 `placement` 만 저장하면 재시작 때 자동 배치가 다시 이겨 **사용자가 고른 배치가 조용히
      // 죽는다** (이전 회귀 M1: 버튼 아이콘은 ▤ 그대로라 원인을 알 수 없었다).
      // 그래서 `placementSource: 'manual'` 을 함께 저장해 재시작 후에도 복원한다.
      persist({ placementSource: 'manual' });
      info(`chat placement changed to ${placement}`);
    };

    function updateCollapseButton(): void {
      if (!collapseButton) return;
      collapseButton.setAttribute('aria-label', collapsed ? '채팅 펼치기' : '채팅 접기');
      collapseButton.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
      collapseButton.textContent = collapsed ? '⟨' : '⟩';
    }

    /**
     * 묶음을 도구 행(채팅 버튼 왼쪽)에 넣거나, 자리가 없으면 화면 오른쪽 플로팅으로 폴백한다.
     * 여유 폭 게이트는 `chatPreset` 과 **같은 `freeWidthIn`** 을 쓴다 (판정이 갈라지면 한쪽만 넘친다).
     */
    const placeControl = (container: HTMLElement): void => {
      anchorControl(container);
      // 자리(인라인/팝오버/플로팅)가 바뀌면 팝오버를 띄울 높이도 다시 재야 한다.
      placeOverlay();
    };

    const anchorControl = (container: HTMLElement): void => {
      /**
       * 🔴 접힌 상태에서는 도구 행을 쓸 수 없다 — 채팅 aside 자체가 폭 0 이라 그 안의 버튼이
       * 화면에서 사라진다. 그러면 **펼치기 버튼을 다시 누를 방법이 없다** (실측 2026-08-15,
       * 하네스에서 `채팅 펼치기` 클릭이 10개 프로필 전부 타임아웃했다).
       */
      const slot = collapsed ? null : resolveToolsSlot(document, 'right');
      /**
       * 🔴 이미 도구 행에 들어가 있으면 **우리 폭을 도로 더해** 계산한다.
       * 그러지 않으면 "들어갔더니 여유가 줄어 다시 나가고, 나갔더니 여유가 늘어 또 들어오는"
       * 진동이 생긴다.
       */
      const free = slot
        ? freeWidthIn(slot.parent) +
          (container.parentElement === slot.parent
            ? container.getBoundingClientRect().width + CONTROL_GAP_PX
            : 0)
        : null;
      const anchor = resolveControlAnchor(free, ctx.device.profile.touchTargetPx);
      const parent = anchor === 'floating' || !slot ? document.body : slot.parent;
      const before = anchor === 'floating' || !slot ? null : slot.before;

      // 같은 자리면 DOM 을 건드리지 않는다 (관찰자 churn 방지).
      if (
        container.dataset['anchor'] === anchor &&
        container.parentElement === parent &&
        container.nextElementSibling === before
      ) {
        return;
      }
      container.dataset['anchor'] = anchor;

      if (!before) {
        container.classList.remove(OURS.toolsSlotClass);
        delete container.dataset['side'];
        document.body.appendChild(container);
        return;
      }
      container.classList.add(OURS.toolsSlotClass);
      container.dataset['side'] = 'right';
      parent.insertBefore(container, before);
    };

    const mountControl = (): void => {
      upsertStyle(CONTROL_STYLE_ID, controlCss(ctx.device.profile.touchTargetPx));

      const container = document.createElement('div');
      container.id = CONTROL_ID;
      container.setAttribute('role', 'group');
      container.setAttribute('aria-label', '채팅 폭 조절');
      controlEl = container;

      /**
       * 🔴 **접힘이 기본**이다 (2026-08-15 요청). 도구 행에는 토글 하나만 나간다 —
       * 채팅 폭이 좁으면 후원하기·이모티콘·채팅만으로 이미 행이 꽉 차기 때문이다.
       * 펼침 상태는 **저장하지 않는다** (세션·창 안에서만 유지).
       */
      toggleButton = makeButton('채팅 폭 조절 열기', '↔', () => {
        expanded = !expanded;
        updateToggleButton();
      });
      container.appendChild(toggleButton);

      const items = document.createElement('div');
      items.className = ITEMS_CLASS;
      itemsEl = items;

      items.appendChild(makeButton('채팅 폭 늘리기', '+', () => changeRatio(1)));
      items.appendChild(makeButton('채팅 폭 줄이기', '−', () => changeRatio(-1)));

      collapseButton = makeButton('채팅 접기', '⟩', toggleCollapse);
      updateCollapseButton();
      items.appendChild(collapseButton);

      // `+ − ⟩` 다음에 위치 전환 버튼을 둔다 (요청).
      placementButton = makeButton('채팅 위치 바꾸기', '▦', togglePlacement);
      updatePlacementButton();
      items.appendChild(placementButton);

      container.appendChild(items);
      updateToggleButton();
      placeControl(container);
    };

    // 자세 판정이 먼저다 — 세로면 여기서 하단 배치로 바뀐 뒤 첫 주장이 나간다.
    syncAutoLayout();
    apply();

    /**
     * 🔴 채팅 폭이 **나중에** 바뀌면 도구 행의 여유도 바뀐다.
     * 우리가 마운트할 때는 aside 가 아직 기본 353px 인데 FR-10 오버레이가 뒤늦게 183px 로
     * 이기는 경우가 그렇다 — 그 상태로 두면 좁은 행에 토글이 남아 입력 영역이 화면 밖으로
     * 밀린다 (실측 2026-08-15 모바일 가로: 토글이 뷰포트 아래로 34px 잘렸다).
     * 그래서 aside 크기 변화를 듣고 인라인/팝오버/폴백을 다시 고른다.
     */
    let stopAsideResize: Disposer | undefined;
    const asideEl = qs<HTMLElement>(ID.asideChatting);
    if (asideEl && typeof ResizeObserver !== 'undefined') {
      const replace = debounce(() => {
        if (controlEl?.isConnected) placeControl(controlEl);
      }, 120);
      const observer = new ResizeObserver(replace);
      observer.observe(asideEl);
      stopAsideResize = () => observer.disconnect();
    }

    /**
     * 🔴 **도구 행은 우리보다 늦게 그려진다** (실측 2026-08-16, 실사이트).
     * 위 두 감시만으로는 첫 배치가 영원히 굳는다 — `keepMounted` 는 노드가 사라질 때만 다시
     * 부르고, aside 크기는 그대로라 `ResizeObserver` 도 다시 안 불린다. 그래서 마운트 시점에
     * 입력 영역이 없으면 `resolveToolsSlot` 이 `null` → **항상 플로팅 폴백**이었다.
     * (노트북13 1440×900: 로드 직후 `floating` @(1400, 96) → 뷰포트를 1px 흔들면 그제야
     *  `popover` @(1298, 858) 로 도구 행에 붙었다. 여유 폭은 119px 로 처음부터 충분했다.)
     * → DOM 변화를 듣고 자리를 다시 고른다. `anchorControl` 이 같은 자리면 조기 반환하므로
     *   되먹임 루프는 생기지 않는다 (인라인 스타일 변경은 `attributes: false` 라 안 듣는다).
     *
     * ⚠️ 감시 대상은 **`document.body`** 다. 채팅 aside 자체가 우리보다 늦게 붙는 경우가 있어
     *    (실측 2026-08-16: 위 `asideEl` 이 `null` 이라 ResizeObserver 도 못 붙었다)
     *    aside 를 기준으로 걸면 그 경우를 통째로 놓친다.
     */
    const replaceControl = (): void => {
      if (controlEl?.isConnected) placeControl(controlEl);
    };

    const stopPlacementWatch: Disposer = observe(document.body, replaceControl, {
      debounceMs: ctx.device.profile.relaxObservers ? 400 : 200,
    });

    /**
     * 🔴 감시만으로는 부족하다 — **채팅이 붐비면 트레일링 디바운스가 영영 안 터진다.**
     * 새 채팅 메시지가 디바운스 간격보다 자주 들어오면 타이머가 계속 밀리기 때문이다
     * (실측 2026-08-16 실사이트: 노트북13(200ms)은 도구 행으로 붙었는데 같은 코드로 모바일
     *  세로(400ms)는 12초가 지나도 폴백 그대로였고, 뷰포트를 1px 흔들자마자 붙었다).
     * → 마운트 직후 정해진 시점에 몇 번만 더 고른다. 멱등이라 여러 번 불려도 안전하다.
     */
    const retryTimers = [300, 1000, 2500, 5000, 9000].map((ms) => setTimeout(replaceControl, ms));

    // 리렌더로 사라지면 다시 넣는다. body 직계라 치지직 리렌더에는 비교적 안전하지만
    // 다른 확장·SPA 전환으로 제거될 수 있어 감시는 유지한다.
    const stopMount: Disposer = keepMounted(
      document.body,
      () => document.getElementById(CONTROL_ID) !== null,
      mountControl,
      { debounceMs: ctx.device.profile.relaxObservers ? 600 : 300 },
    );

    /**
     * 폭은 비율이므로 뷰포트가 바뀌면 픽셀도 다시 계산해야 한다.
     * IME 로 높이만 줄어든 경우는 재배치하지 않고 스크롤만 보정한다 (FR-12.1).
     */
    const stopViewport = onViewportChange(
      ({ keyboardLikely }) => {
        if (keyboardLikely) {
          withScrollPreserved(() => {});
          return;
        }
        // 회전·분할 화면으로 **자세가 바뀌면 배치까지** 다시 정한다 (세로 → 하단 배치).
        withScrollPreserved(() => {
          syncAutoLayout();
          apply();
          // 도구 행의 여유 폭도 함께 바뀐다 → 인라인/팝오버/폴백을 다시 고른다.
          if (controlEl?.isConnected) placeControl(controlEl);
        });
      },
      { relaxed: ctx.device.profile.relaxObservers },
    );

    // 각 단계를 독립 실행한다 — 앞 단계가 던져도 `stopArbiter()` 가 반드시 돌아야 한다
    // (안 돌면 폭 조정자 참조 카운트가 영구 누수되고 주입 CSS 가 남는다).
    return () =>
      disposeAll(
        stopViewport,
        stopAsideResize,
        stopPlacementWatch,
        () => retryTimers.forEach(clearTimeout),
        stopMount,
        () => releaseWidth('chatWidth'),
        stopArbiter,
        () => document.getElementById(CONTROL_ID)?.remove(),
        () => removeStyle(CONTROL_STYLE_ID),
        () => {
          collapseButton = null;
          placementButton = null;
          toggleButton = null;
          controlEl = null;
          itemsEl = null;
        },
      );
  },
};
