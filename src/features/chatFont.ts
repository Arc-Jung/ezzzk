/**
 * FR-15 채팅 폰트 크기 조절.
 *
 * 실측 근거 (2026-08-12, `chzzk-dom-21-chat-font-1920.json`)
 * - 사이드 채팅 11~24px (기본 14 = 치지직 원본과 동일 → 켜도 기본 상태에서 변화 없음)
 * - 슬롯 스트립 10~16px (기본 12)
 * - 🔴 `item` 에만 font-size 를 주면 `button`·`span` 자식이 자기 14px 를 유지한다 → **자손(`*`) 포함 필수**
 * - 🔴 이모티콘 이미지가 18×18 고정이라 폰트만 키우면 상대적으로 작아진다 → `1.3em` 으로 함께 스케일
 *   (검증: 11px→14×14, 14px→18×18(원본과 동일), 20px→26×26, 24px→31×31)
 * - ⚠️ 폰트 변경은 줄 높이를 바꿔 가상 스크롤 위치에 영향을 준다 → 변경 직후 맨 아래로 재고정,
 *   단 사용자가 위로 올려 과거 로그를 보던 중이면 그 위치를 유지한다.
 */

import { CHZZK, ID, OURS } from '../constants/class';
import { CHAT_FONT_RANGE } from '../constants/storage';
import { hasSideChat } from '../pageType';
import { qs, upsertStyle, removeStyle } from '../utils/dom';
import { observe } from '../utils/observe';
import { info } from '../utils/log';
import type { Feature } from './types';

/** 폰트 크기별 한 줄 높이(px). 실측 스윕값에 맞춘 근사식. */
const MEASURED_LINE_HEIGHT: Record<number, number> = {
  11: 22,
  12: 24,
  14: 26,
  16: 29,
  18: 31,
  20: 34,
  24: 39,
};

/**
 * 한 줄 높이. 실측값이 있으면 그것을 쓰고, 없으면 `line-height: 1.3` + 패딩을 반영한 선형 보간을 쓴다.
 * 줄 높이는 폰트 메트릭만 따르므로 뷰포트와 무관하다 (실측 확인).
 */
export function lineHeightForFont(fontPx: number): number {
  const exact = MEASURED_LINE_HEIGHT[fontPx];
  if (exact !== undefined) return exact;

  const keys = Object.keys(MEASURED_LINE_HEIGHT)
    .map(Number)
    .sort((a, b) => a - b);
  const lower = [...keys].reverse().find((k) => k < fontPx);
  const upper = keys.find((k) => k > fontPx);

  if (lower !== undefined && upper !== undefined) {
    const lo = MEASURED_LINE_HEIGHT[lower] as number;
    const hi = MEASURED_LINE_HEIGHT[upper] as number;
    const t = (fontPx - lower) / (upper - lower);
    return Math.round(lo + (hi - lo) * t);
  }
  // 실측 범위 밖 — 관측된 기울기(약 1.3배)를 그대로 적용한다.
  return Math.round(fontPx * 1.3 + 7.8);
}

/**
 * 스크롤 영역 높이에서 보이는 줄 수.
 * ⚠️ 스크롤 영역 높이는 로드 직후 871px 로 측정되다가 통나무 랭킹·공지가 채워지면 761px 로
 * 안정화된다. 계산은 **안정화 이후 값**으로 해야 한다.
 */
export function visibleLines(scrollerHeightPx: number, fontPx: number): number {
  const lineH = lineHeightForFont(fontPx);
  if (lineH <= 0) return 0;
  return Math.floor(scrollerHeightPx / lineH);
}

/** 이모티콘 렌더 크기(px). `1.3em` 스케일의 결과 — 검증 기준값과 일치해야 한다. */
export function emojiSizeForFont(fontPx: number): number {
  return Math.round(fontPx * 1.3);
}

export function clampSideFont(px: number): number {
  return clamp(Math.round(px), CHAT_FONT_RANGE.side.min, CHAT_FONT_RANGE.side.max);
}

export function clampSlotFont(px: number): number {
  return clamp(Math.round(px), CHAT_FONT_RANGE.slot.min, CHAT_FONT_RANGE.slot.max);
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * 주입 CSS. 단일 `<style>` 태그 하나에 값만 교체한다 — 노드를 매번 만들지 않는다.
 * 슬롯 스트립(FR-14.2)과 필터 패널(FR-11)도 같은 변수를 참조해 크기가 어긋나지 않게 한다.
 */
export function buildChatFontCss(sidePx: number, slotPx: number): string {
  const side = clampSideFont(sidePx);
  const slot = clampSlotFont(slotPx);
  return `
:root { --cm-chat-font-side: ${side}px; --cm-chat-font-slot: ${slot}px; }

/* 🔴 자손(*)까지 덮어야 한다. item 에만 주면 button·span 자식이 자기 14px 를 유지한다. */
${CHZZK.chatItem},
${CHZZK.chatItem} * { font-size: ${side}px !important; line-height: 1.3 !important; }

/* 🔴 이모티콘은 18×18 고정이라 폰트에 비례해 함께 스케일한다. */
${CHZZK.chatItem} img { width: 1.3em !important; height: 1.3em !important; }

/* FR-11 필터 패널 · FR-14.2 슬롯 스트립이 같은 값을 참조한다. */
#${OURS.chatFilterPanelId} { font-size: ${side}px; line-height: 1.3; }
#${OURS.multiViewStageId} .cm-slot-chat-strip { font-size: ${slot}px; line-height: 1.3; }
`.trim();
}

/** 스크롤이 사실상 맨 아래인지. 사용자가 위로 올려둔 상태를 침범하지 않기 위한 판정. */
export function isScrolledToBottom(
  el: {
    scrollTop: number;
    clientHeight: number;
    scrollHeight: number;
  },
  tolerancePx = 24,
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= tolerancePx;
}

export const chatFontFeature: Feature = {
  id: 'chatFont',
  watches: ['chatFont'],
  supports: (ctx) => hasSideChat(ctx.page.type) && !ctx.page.isSlotFrame,
  start: (ctx) => {
    const apply = () => {
      const scroller = qs<HTMLElement>(CHZZK.chatScroller);
      // 폰트 변경 전 스크롤 위치를 기억한다 — 줄 높이가 바뀌면 위치가 어긋난다.
      const wasAtBottom = scroller ? isScrolledToBottom(scroller) : true;

      upsertStyle(
        OURS.chatFontStyleId,
        buildChatFontCss(ctx.settings.chatFont.sidePx, ctx.settings.chatFont.slotPx),
      );

      if (scroller && wasAtBottom) {
        // 레이아웃 확정 후 맨 아래로 재고정. 위로 올려둔 상태였다면 건드리지 않는다.
        requestAnimationFrame(() => {
          scroller.scrollTop = scroller.scrollHeight;
        });
      }
    };

    apply();
    info(
      `chat font applied: side ${ctx.settings.chatFont.sidePx}px, slot ${ctx.settings.chatFont.slotPx}px`,
    );

    // 페이지 리렌더로 style 이 지워지는 것에 대비해 재적용한다.
    const aside = qs(ID.asideChatting);
    const stopObserve = aside
      ? observe(aside, apply, {
          debounceMs: ctx.device.profile.relaxObservers ? 600 : 300,
        })
      : undefined;

    return () => {
      stopObserve?.();
      removeStyle(OURS.chatFontStyleId);
    };
  },
};
