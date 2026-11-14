/** 멀티뷰 조작 바·채팅·활성 슬롯의 순수 계산. */
import type { SlotIndex } from '../../constants/storage';

/** 스트립과 컨트롤 바 사이 최소 간격. */
export const STRIP_BAR_GAP_PX = 6;

/**
 * 바를 영상 위로 띄울지 판정한다. **순수 함수 — 테스트 대상.**
 *
 * 요청 2026-09-07 — "영상과 최대한 안 겹치게 하되, 겹치면 오버레이처럼 띄우자".
 *
 * 세로 자세의 슬롯 배치(`portraitColumn`)는 폭이 제약일 때 남는 높이를 위아래로 나눠
 * 슬롯을 가운데에 모은다. 그 **위쪽 여백은 어차피 검은 공백**이므로, 바가 거기 들어가면
 * 영상을 하나도 가리지 않는다. 여백이 모자랄 때만 영상 위로 올라간다.
 *
 * @param bar 바의 위치·높이 (`top` 은 무대 기준).
 * @param firstSlotTop 가장 위 슬롯의 y (무대 기준). 슬롯이 없으면 null.
 * @returns 영상 위로 겹치면 true.
 */
export function barOverlapsSlots(
  bar: { top: number; height: number } | null,
  firstSlotTop: number | null,
): boolean {
  if (!bar || bar.height <= 0) return false;
  if (firstSlotTop === null) return false;
  return Math.max(0, bar.top) + bar.height > firstSlotTop;
}

/** 사이드 채팅 폭 조절 한 칸. */
export const FS_CHAT_STEP_PX = 40;
/** 채팅이 화면을 다 먹지 않게 하는 상한 비율. */
const FS_CHAT_MAX_RATIO = 0.6;
/** 이 값보다 좁으면 채팅을 읽을 수 없어 조절 하한으로 쓴다 (실측 FR-10 최소 폭 계열). */
const FS_CHAT_MIN_PX = 120;
/** 사이드 채팅 기본 점유율. FR-05 기본(25%)과 같은 감각으로 시작한다. */
const SIDE_CHAT_RATIO = 0.25;

/**
 * 사이드 채팅에 줄 폭. **순수 함수 — 테스트 대상.**
 *
 * 🔴 예전 공식(`fullscreenChatWidthPx`)은 "영상 16:9 를 유지하고 **남는 폭 전부**"였다. 무대가 영상
 * 하나였던 전체 화면 전용 시절의 규칙인데, 두 가지 문제가 있었다:
 * ① 멀티뷰 무대는 슬롯 격자라 "남는 폭" 이라는 개념이 없다.
 * ② 화면이 정확히 16:9 면 남는 폭이 0 이라 **1920×1080 모니터에서는 채팅이 아예 열리지 않았다**
 *    (컨트롤은 보이는데 폭은 0 — 왜 안 나오는지 알 수 없는 상태였다).
 * → 기본값을 **뷰포트 폭의 비율**로 바꾼다. 하한(읽을 수 있는 폭)과 상한(화면 독점 방지)은 그대로다.
 * `steps` 는 `−`/`+` 가 누적한 칸 수다.
 */
export function sideChatWidthPx(viewportW: number, viewportH: number, steps: number): number {
  if (viewportW <= 0 || viewportH <= 0) return 0;
  const max = Math.floor(viewportW * FS_CHAT_MAX_RATIO);
  const min = Math.min(FS_CHAT_MIN_PX, max);
  const raw = Math.round(viewportW * SIDE_CHAT_RATIO) + steps * FS_CHAT_STEP_PX;
  if (raw < min) return min;
  return Math.min(raw, max);
}

/**
 * 채팅 스트립을 슬롯 하단에서 얼마나 띄울지. **순수 함수 — 테스트 대상.**
 *
 * 하단 컨트롤 바와 겹치는 슬롯의 스트립만 바 위로 올린다. 겹치지 않으면 0(하단 밀착)이다.
 * 슬롯 높이·영상 크기는 바꾸지 않는다 — 목업의 슬롯 16:9(여백 0)를 유지하기 위해서다.
 */
export function stripBottomOffset(
  slot: { x: number; y: number; width: number; height: number },
  stripHeightPx: number,
  lines: number,
  bar: { left: number; right: number; top: number; bottom: number; height: number } | null,
): number {
  if (lines <= 0 || stripHeightPx <= 0) return 0;
  if (!bar || bar.height <= 0) return 0;

  // 바가 이 슬롯의 가로 범위와 겹치지 않으면 올릴 이유가 없다.
  if (bar.right <= slot.x || bar.left >= slot.x + slot.width) return 0;

  const slotBottom = slot.y + slot.height;
  const stripTop = slotBottom - stripHeightPx;
  // 세로로도 겹쳐야 한다 (위쪽 행 슬롯은 바와 무관하다).
  if (bar.top >= slotBottom || bar.bottom <= stripTop) return 0;

  const offset = slotBottom - bar.top + STRIP_BAR_GAP_PX;
  // 슬롯 밖으로 밀려나면 의미가 없으므로 스트립이 들어갈 수 있는 만큼만 올린다.
  return Math.max(0, Math.min(offset, slot.height - stripHeightPx));
}

/**
 * 실제로 초점을 받을 슬롯. **순수 함수** — 테스트 대상.
 *
 * 🔴 **희망 슬롯이 아직 등록되지 않았을 수 있다** (실측 결함, 옛 오디오 라우터에서 옮겨 옴).
 * `stage.open()` 은 iframe 이 `load` 되기 **전에** 초점 슬롯을 지정한다. 등록된 프레임이
 * 없다고 지정을 버리면 저장된 `activeSlot` 이 사라진다.
 * → 희망 슬롯이 등록되어 있으면 그것을, 아니면 **등록된 가장 앞 슬롯**을 쓴다.
 *
 * ⚠️ 2026-08-20 정책 변경 이후 이 값은 **오디오와 무관하다** — 모든 슬롯이 항상 소리를
 * 낸다. 사이드 채팅 대상·비활성 슬롯 화질 하향·나가기 버튼 채널 선택에만 쓴다.
 */
export function effectiveActiveSlot(registered: SlotIndex[], desired: SlotIndex): SlotIndex | null {
  if (registered.length === 0) return null;
  if (registered.includes(desired)) return desired;
  return [...registered].sort((a, b) => a - b)[0] ?? null;
}

/** 초점 슬롯을 다음 후보로 옮긴다 (슬롯이 비워졌을 때). */
export function nextActiveSlot(slots: SlotIndex[], current: SlotIndex): SlotIndex {
  if (slots.includes(current)) return current;
  return [...slots].sort((a, b) => a - b)[0] ?? 1;
}
