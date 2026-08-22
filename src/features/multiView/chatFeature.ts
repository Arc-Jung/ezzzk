/**
 * 멀티뷰 채팅(슬롯 스트립 + 사이드 패널) **임시 전면 비활성화 스위치** (2026-08-22 요청).
 *
 * 🔴 2026-08-22 실측 조사에서 멀티뷰 채팅 경로에만 결함이 몰려 나왔다.
 * - 폴백 셀렉터가 닉네임 span 을 본문으로 잡아 모든 줄이 `<닉네임> <닉네임>` 으로 찍힌다
 *   (`slotFrame.ts` `collectRecentChat`).
 * - 설정으로 사이드 채팅을 켜면 조작 바의 채팅 컨트롤이 갱신되지 않아 **다시 끌 수 없다**
 *   (`stage.ts` `updateSettings`).
 *
 * 개별 수정 대신 **기능 진입점만 막는다.** 렌더·수집 코드는 그대로 두고, 여기 한 곳에서
 * "채팅 모드는 항상 없음 · 슬롯 채팅 줄 수는 항상 0" 으로 강제한다. 원인을 고친 뒤
 * `MULTIVIEW_CHAT_ENABLED` 를 `true` 로 되돌리면 그대로 되살아난다.
 *
 * ⚠️ **저장 스키마는 건드리지 않는다.** 이미 `chatMode: 'active'` 로 저장된 사용자가 있어도
 * 마이그레이션하지 않고 런타임에서만 무시한다 — 되살릴 때 설정을 잃지 않기 위해서다.
 */

/** 멀티뷰 채팅 기능 전체 스위치. 되살릴 때는 이 값만 `true` 로 바꾼다. */
export const MULTIVIEW_CHAT_ENABLED = false;

/** 저장된 채팅 모드를 실제 동작값으로 바꾼다. 비활성화 중에는 항상 `'none'`. */
export function effectiveChatMode(mode: 'active' | 'none'): 'active' | 'none' {
  return MULTIVIEW_CHAT_ENABLED ? mode : 'none';
}

/** 저장된 슬롯 채팅 줄 수를 실제 표시 줄 수로 바꾼다. 비활성화 중에는 항상 0줄. */
export function effectiveSlotChatLines(lines: number): number {
  return MULTIVIEW_CHAT_ENABLED ? lines : 0;
}
