/**
 * FR-10 초광폭 가로 모드 레이아웃 (19.5:9 급 스마트폰 가로 기준).
 *
 * 실측 근거 (2026-08-11, 분석 문서 §5.3 · §5.5 — 실험 PASS)
 * | 환경 | 상태 | 채팅 폭 | 실제 영상 | 레터박스 | 필러박스 |
 * |---|---|---|---|---|---|
 * | 2340×1080 | 넓은 화면 + 계산폭 | 420px | 1919×1079 | 0 | 0 |
 * | 915×412 | 넓은 화면 + 계산폭 + min-width:0 | 183px | 731×411 | 0 | 0 |
 *
 * 🔴 **적용 순서를 반드시 지킨다.**
 * 1. 넓은 화면을 먼저 켠다 — 켜지 않으면 레터박스가 남는다(915×412 에서 48px 실측).
 *    토글 로직은 복제하지 않고 `wideScreen.ts` 의 `ensureWideScreen` 을 그대로 쓴다.
 * 2. `min-width: 0` 을 주입한다 (조기 스타일 + arbiter 가 함께 담당).
 * 3. 계산된 폭을 aside 에 적용한다 → `layoutArbiter` 에 `ultraWide` 로 주장한다.
 *
 * ⚠️ 모든 값은 크기 변화마다 재계산하고 **캐시하지 않는다** (FR-12.1).
 * ⚠️ IME 로 높이만 줄어든 경우는 재배치하지 않고 스크롤만 보정한다.
 * ⚠️ `m.chzzk` 에는 채팅 UI 자체가 없어 이 기능이 성립하지 않는다 → `supports` 가 false.
 */

import { CHZZK, ID } from '../constants/class';
import { CHAT_FONT_RANGE } from '../constants/storage';
import { hasSideChat } from '../pageType';
import {
  claimWidth,
  ensureLayoutArbiter,
  onActiveWidthChange,
  releaseWidth,
} from '../layoutArbiter';
import { qs, removeStyle, upsertStyle } from '../utils/dom';
import { keepMounted, disposeAll } from '../utils/observe';
import {
  computeChatWidthPx,
  onViewportChange,
  readViewport,
  shouldApplyUltraWide,
} from '../utils/viewport';
import { guardAsync, info } from '../utils/log';
import { isScrolledToBottom } from './chatFont';
import { ensureWideScreen } from './wideScreen';
import type { Feature } from './types';

// TODO(consolidate into constants/class.ts OURS)
const ULTRA_WIDE_STYLE_ID = 'cm-ultrawide-style';
// TODO(consolidate into constants/class.ts OURS)
const CHAT_INPUT_TOGGLE_ID = 'cm-chat-input-toggle';
/** 입력창 접힘 상태를 나타내는 aside 속성. CSS 만으로 접기/펼치기를 표현한다. */
const CHAT_INPUT_STATE_ATTR = 'data-cm-chat-input';

/**
 * 치지직 기본 aside 폭(px). 뷰포트와 무관한 고정 실측값이라 상수로 둘 수 있다
 * (실측 2026-08-11: 353px). 폰트 축소 비율의 기준선으로만 쓴다.
 */
const REFERENCE_ASIDE_WIDTH_PX = 353;

/**
 * FR-10.2 오버레이 폴백 판정. **순수 함수.**
 * 계산된 폭이 최소 가독 폭 미만이면 사이드 배치를 포기하고 영상 위 오버레이로 전환한다.
 * 설정에서 폴백을 끄면 좁아도 사이드 배치를 유지한다.
 */
export function needsOverlayFallback(
  chatWidthPx: number,
  minChatPx: number,
  overlayEnabled: boolean,
): boolean {
  if (!overlayEnabled) return false;
  if (!Number.isFinite(chatWidthPx)) return false;
  return chatWidthPx < minChatPx;
}

/**
 * FR-10.2 폭에 비례한 채팅 글자 크기. **순수 함수.**
 * - 하한 11px (설정 범위 최소값과 같다)
 * - 기준 폭(353px) 이상이면 원래 크기를 유지한다 — 넓은데 굳이 줄이지 않는다.
 */
export function scaledChatFont(chatWidthPx: number, basePx: number): number {
  const floor = CHAT_FONT_RANGE.side.min;
  if (!Number.isFinite(chatWidthPx) || !Number.isFinite(basePx)) return floor;
  const base = Math.max(floor, Math.round(basePx));
  if (chatWidthPx >= REFERENCE_ASIDE_WIDTH_PX) return base;
  const scaled = Math.round((base * chatWidthPx) / REFERENCE_ASIDE_WIDTH_PX);
  return Math.min(base, Math.max(floor, scaled));
}

/**
 * FR-10.2 / FR-10.5 좁은 폭 가독성 CSS. **순수 함수 — 문자열만 만든다.**
 * 폭 자체는 여기서 쓰지 않는다 (그건 `layoutArbiter` 담당).
 */
export function computeUltraWideCss(
  chatWidthPx: number,
  basePx: number,
  { touchTargetPx = 44 }: { touchTargetPx?: number } = {},
): string {
  const fontPx = scaledChatFont(chatWidthPx, basePx);
  const target = Math.max(28, Math.round(touchTargetPx));

  return `
/* FR-10.5 노치·펀치홀 대응 */
${ID.asideChatting} {
  padding-left: env(safe-area-inset-left, 0px) !important;
  padding-right: env(safe-area-inset-right, 0px) !important;
}

/* FR-10.2 폭에 비례한 글자 크기(하한 ${CHAT_FONT_RANGE.side.min}px). 자손까지 덮어야 한다. */
${CHZZK.chatItem},
${CHZZK.chatItem} * { font-size: ${fontPx}px !important; line-height: 1.3 !important; }

/* 긴 단어가 폭을 넘기지 않게 한다. */
${CHZZK.chatMessage} { overflow-wrap: anywhere !important; word-break: break-word !important; }

/* 배지·구독 아이콘·프로필 이미지를 숨겨 닉네임 + 본문을 우선한다. */
${ID.asideChatting} [class*="_badge"],
${ID.asideChatting} [class*="_subscription"],
${ID.asideChatting} [class*="_profile"],
${ID.asideChatting} [class*="_ranking_badge"] { display: none !important; }

/* 닉네임은 1줄 말줄임. */
${CHZZK.chatNickname} {
  display: inline-block !important;
  max-width: 100% !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
}

/* 입력창은 아이콘 버튼으로 접어 두고 탭하면 펼친다 — 목록 높이를 잡아먹지 않게. */
#${CHAT_INPUT_TOGGLE_ID} {
  width: ${target}px;
  height: ${target}px;
  min-width: ${target}px;
  min-height: ${target}px;
  border: 0;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
${ID.asideChatting}[${CHAT_INPUT_STATE_ATTR}='collapsed'] ${CHZZK.chatInput},
${ID.asideChatting}[${CHAT_INPUT_STATE_ATTR}='collapsed'] ${CHZZK.chatSendButton} {
  display: none !important;
}
`.trim();
}

/** 가로 자세인가. 비율 판정만으로도 대개 충분하지만 명시적으로 확인한다. */
export function isLandscape(width: number, height: number): boolean {
  return width > height;
}

export const ultraWideFeature: Feature = {
  id: 'ultraWide',
  watches: ['ultraWide'],
  supports: (ctx) =>
    ctx.settings.ultraWide.enabled && hasSideChat(ctx.page.type) && !ctx.page.isSlotFrame,
  start: (ctx) => {
    const { minChatPx, overlayFallback } = ctx.settings.ultraWide;
    const basePx = ctx.settings.chatFont.sidePx;

    /** 히스테리시스 판정에 쓰는 현재 적용 상태. 폭 값 자체는 캐시하지 않는다. */
    let applied = false;
    let wideScreenRequested = false;

    const stopArbiter = ensureLayoutArbiter({ relaxed: ctx.device.profile.relaxObservers });

    const correctScroll = (): void => {
      const scroller = qs<HTMLElement>(CHZZK.chatScroller);
      if (!scroller || !isScrolledToBottom(scroller)) return;
      requestAnimationFrame(() => {
        scroller.scrollTop = scroller.scrollHeight;
      });
    };

    /**
     * `onActiveWidthChange` 로 마지막에 CSS 를 만든 폭. 같은 값이면 다시 만들지 않는다.
     * `reapply()` 가 캐시를 무효화하므로 조정자 옵저버가 깰 때마다(초당 3~10회) 같은 폭으로
     * 1.5KB CSS 문자열을 새로 만드는 것을 막는다.
     */
    let lastSyncedWidthPx: number | null = null;

    const release = (): void => {
      if (!applied) return;
      applied = false;
      lastSyncedWidthPx = null;
      releaseWidth('ultraWide');
      removeStyle(ULTRA_WIDE_STYLE_ID);
      info('ultra wide layout released');
    };

    /** 크기 변화마다 전부 다시 계산한다. 같은 크기 두 번이면 결과도 같다 (멱등). */
    const recompute = (): void => {
      const { width, height, ratio } = readViewport();
      const shouldApply = isLandscape(width, height) && shouldApplyUltraWide(ratio, applied);

      if (!shouldApply) {
        release();
        return;
      }

      // 순서 1: 넓은 화면이 먼저다. 없으면 레터박스가 남는다.
      if (!wideScreenRequested) {
        wideScreenRequested = true;
        void guardAsync('ultraWide.wideScreen', async () => {
          const state = await ensureWideScreen();
          // 넓은 화면 전환으로 레이아웃이 바뀌므로 폭을 다시 계산한다 (FR-10.7 순서 보장).
          recompute();
          return state;
        });
      }

      // 순서 2·3: min-width 해제 + 계산된 폭. 둘 다 arbiter 가 한 번에 쓴다.
      const widthPx = computeChatWidthPx(width, height);
      const overlay = needsOverlayFallback(widthPx, minChatPx, overlayFallback);

      upsertStyle(
        ULTRA_WIDE_STYLE_ID,
        computeUltraWideCss(widthPx, basePx, {
          touchTargetPx: ctx.device.profile.touchTargetPx,
        }),
      );
      // 지금 CSS 를 만든 폭을 기록해 둔다 — 아래 구독자가 같은 폭으로 또 만들지 않게.
      lastSyncedWidthPx = widthPx;
      claimWidth(
        'ultraWide',
        widthPx,
        `viewport ${Math.round(width)}x${Math.round(height)} ratio ${ratio.toFixed(3)}`,
        overlay ? 'overlay' : 'flex',
      );

      applied = true;
      info(`ultra wide layout applied: ${widthPx}px, overlay ${String(overlay)}`);
    };

    /** 입력창 접기/펼치기 버튼. 좁은 폭에서 목록 높이를 지키기 위한 것이다. */
    const mountInputToggle = (): void => {
      const input = qs<HTMLElement>(CHZZK.chatInput);
      const aside = qs<HTMLElement>(ID.asideChatting);
      if (!input?.parentElement || !aside) return;

      aside.setAttribute(CHAT_INPUT_STATE_ATTR, 'collapsed');

      const button = document.createElement('button');
      button.id = CHAT_INPUT_TOGGLE_ID;
      button.type = 'button';
      button.textContent = '💬';
      button.setAttribute('aria-label', '채팅 입력창 펼치기');
      button.setAttribute('aria-expanded', 'false');
      button.addEventListener('click', (event) => {
        event.preventDefault();
        const expanded = aside.getAttribute(CHAT_INPUT_STATE_ATTR) !== 'collapsed';
        aside.setAttribute(CHAT_INPUT_STATE_ATTR, expanded ? 'collapsed' : 'expanded');
        button.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        button.setAttribute('aria-label', expanded ? '채팅 입력창 펼치기' : '채팅 입력창 접기');
      });

      input.parentElement.insertBefore(button, input);
    };

    recompute();

    /**
     * FR-05 가 사용자 조작으로 폭을 가져가면(`userOverride`) 우리 계산값은 화면에 없는 값이 된다.
     * 그 값으로 글자 크기를 줄이면 **넓힌 채팅창에 깨알 글씨**가 남으므로, 실제 적용된 폭으로
     * 우리 CSS 만 다시 만든다. ⚠️ 여기서 폭을 다시 주장하면 arbiter 가 재진입해 루프가 된다.
     */
    const stopWidthSync = onActiveWidthChange((claim) => {
      if (!applied || claim === null || claim.source === 'ultraWide') return;
      if (claim.widthPx === lastSyncedWidthPx) return;
      lastSyncedWidthPx = claim.widthPx;
      upsertStyle(
        ULTRA_WIDE_STYLE_ID,
        computeUltraWideCss(claim.widthPx, basePx, {
          touchTargetPx: ctx.device.profile.touchTargetPx,
        }),
      );
    });

    const aside = qs(ID.asideChatting);
    const stopMount = aside
      ? keepMounted(
          aside,
          () => document.getElementById(CHAT_INPUT_TOGGLE_ID) !== null,
          mountInputToggle,
          { debounceMs: ctx.device.profile.relaxObservers ? 600 : 300 },
        )
      : undefined;

    const stopViewport = onViewportChange(
      ({ keyboardLikely }) => {
        // IME 로 높이만 줄어든 경우 폭·배치를 유지하고 스크롤만 보정한다.
        if (keyboardLikely) {
          correctScroll();
          return;
        }
        recompute();
        correctScroll();
      },
      { relaxed: ctx.device.profile.relaxObservers },
    );

    // 각 단계를 독립 실행한다 — `stopArbiter()` 누락은 참조 카운트 영구 누수로 이어진다.
    return () =>
      disposeAll(
        stopViewport,
        stopWidthSync,
        stopMount,
        release,
        stopArbiter,
        () => document.getElementById(CHAT_INPUT_TOGGLE_ID)?.remove(),
        () => qs<HTMLElement>(ID.asideChatting)?.removeAttribute(CHAT_INPUT_STATE_ATTR),
      );
  },
};
