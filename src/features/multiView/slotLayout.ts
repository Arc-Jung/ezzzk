/**
 * FR-14 슬롯 그리드 계산 + FR-14.2 채팅 스트립 높이·영상 손실 계산.
 *
 * 실측 기준값 (2026-08-12, `chzzk-dom-20-multiview-1920.json`, 뷰포트 1920×1080)
 * - 4분할 슬롯 **959×539** (gap 2px) → 이미 16:9 라 여백 0, 화면 활용 99.8%
 * - 2분할(좌우) 슬롯 **959×1080** → 비율 0.888 이라 세로로 270px 씩 남는다
 * - 슬롯 채팅 스트립 높이 = `16 × 줄수 + 9` (12px 폰트 기준)
 * - 예약 배치 손실: 4분할 3줄 → 857×482 (20.0%), 5줄 → 800×450 (30.3%)
 * - 2분할 예약 배치 5줄 → 959×539 (**손실 0%** — 남는 270px 을 쓰기 때문)
 */

import { DEVICE_PROFILES, type DeviceClass } from '../../constants/device';
import type { SlotIndex, SlotLines, SplitCount } from '../../constants/storage';
import { pictureSize } from '../../utils/viewport';

/** 슬롯 사이 간격(px). 실측에서 4분할 959 = (1920 − 2) / 2 로 확인된 값. */
export const SLOT_GAP = 2;

/** 스트립 상하 패딩 합(px). 실측식 `16 × 줄수 + 9` 의 상수항. */
const STRIP_PADDING = 9;

/** 슬롯 스트립(압축 렌더)의 폰트별 한 줄 높이. 실측: 11px→15, 12px→16, 13px→18. */
const SLOT_LINE_HEIGHT: Record<number, number> = { 11: 15, 12: 16, 13: 18 };

export type Orientation = 'landscape' | 'portrait';

export type SlotRect = {
  index: SlotIndex;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** 슬롯 스트립 한 줄 높이. 실측 범위 밖은 관측 기울기(약 1.33배)로 외삽한다. */
export function slotLineHeight(fontPx: number): number {
  return SLOT_LINE_HEIGHT[fontPx] ?? Math.round(fontPx * 1.33 + 0.5);
}

/**
 * 슬롯 채팅 스트립 높이. 0줄이면 0 이다 (표시 안 함).
 * 12px 폰트에서 `16 × 줄수 + 9` 를 재현한다.
 */
export function stripHeight(lines: number, fontPx = 12): number {
  if (lines <= 0) return 0;
  return slotLineHeight(fontPx) * lines + STRIP_PADDING;
}

/**
 * 기기별 최대 분할 수 (FR-14 표).
 * 상한을 넘는 분할은 UI 에서 선택 자체를 비활성화한다 — 에러 대신 사전 차단.
 */
export function maxSplitFor(deviceClass: DeviceClass): 2 | 4 {
  return DEVICE_PROFILES[deviceClass].maxSplit;
}

/** 요청한 분할 수를 기기 상한으로 클램프한다. */
export function clampSplit(requested: SplitCount, deviceClass: DeviceClass): SplitCount {
  const max = maxSplitFor(deviceClass);
  if (requested <= max) return requested;
  // 상한이 2 인 기기에서 3·4 분할은 개별 영상이 가독 한계 이하가 되므로 제공하지 않는다.
  return max === 2 ? 2 : 4;
}

/** 해당 분할 수를 이 기기에서 선택할 수 있는가 (UI 비활성 판정). */
export function isSplitAvailable(split: SplitCount, deviceClass: DeviceClass): boolean {
  return split <= maxSplitFor(deviceClass);
}

/**
 * 슬롯 사각형 배치.
 *
 * - 2분할: 가로에서는 좌우, 세로에서는 상하 (모바일·7인치급 세로 자세 대응)
 * - 3분할: 좌측 1개가 두 행을 차지하고 우측에 2개를 쌓는다.
 *   우측 슬롯은 1920×1080 에서 959×539 = 정확히 16:9 가 되어 여백이 0 이다.
 * - 4분할: 2×2. 1920×1080 에서 959×539 로 이미 16:9 다.
 *
 * 🔴 `topInset` — **스테이지 조작 바 전용 띠**를 무대 위쪽에서 떼어 낸다 (2026-08-16 회귀).
 * 조작 바는 가운데 상단에 있고 슬롯 헤더(`.cm-slot__head`)도 각 슬롯의 `top: 0` 이라,
 * 띠가 없으면 좁은 프로필에서 바가 헤더 버튼을 덮어 **버튼이 눌리지 않았다**
 * (실측 mobile-portrait: `슬롯 1 채팅 줄 수 늘리기` 중심점의 `elementFromPoint` = `div.cm-stage-bar`).
 * 띠만큼 가용 높이를 줄인 뒤 같은 계산을 하므로 어떤 분할·어떤 프로필에서도 구조적으로 겹치지 않고,
 * 16:9·여백 최소 계약은 줄어든 높이 안에서 그대로 유지된다.
 */
export function computeSlotRects(
  split: SplitCount,
  stageW: number,
  stageH: number,
  orientation: Orientation = 'landscape',
  gap: number = SLOT_GAP,
  topInset = 0,
): SlotRect[] {
  if (stageW <= 0 || stageH <= 0) return [];

  // 띠가 무대보다 크면 슬롯이 사라진다 — 띠를 무대 안으로 클램프한다.
  const inset = Math.max(0, Math.min(Math.floor(topInset), stageH - 1));
  const usableH = stageH - inset;

  const halfW = Math.max(0, Math.floor((stageW - gap) / 2));
  const halfH = Math.max(0, Math.floor((usableH - gap) / 2));
  const rightX = stageW - halfW;
  const bottomY = usableH - halfH;

  const rects = ((): SlotRect[] => {
    if (split === 2) {
      if (orientation === 'portrait') {
        return [
          { index: 1, x: 0, y: 0, width: stageW, height: halfH },
          { index: 2, x: 0, y: bottomY, width: stageW, height: usableH - bottomY },
        ];
      }
      return [
        { index: 1, x: 0, y: 0, width: halfW, height: usableH },
        { index: 2, x: rightX, y: 0, width: stageW - rightX, height: usableH },
      ];
    }

    if (split === 3) {
      return [
        { index: 1, x: 0, y: 0, width: halfW, height: usableH },
        { index: 2, x: rightX, y: 0, width: stageW - rightX, height: halfH },
        { index: 3, x: rightX, y: bottomY, width: stageW - rightX, height: usableH - bottomY },
      ];
    }

    return [
      { index: 1, x: 0, y: 0, width: halfW, height: halfH },
      { index: 2, x: rightX, y: 0, width: stageW - rightX, height: halfH },
      { index: 3, x: 0, y: bottomY, width: halfW, height: usableH - bottomY },
      { index: 4, x: rightX, y: bottomY, width: stageW - rightX, height: usableH - bottomY },
    ];
  })();

  if (inset === 0) return rects;
  return rects.map((rect) => ({ ...rect, y: rect.y + inset }));
}

/**
 * 슬롯 폭에 따른 줄 수 상한.
 * - 슬롯 폭 < 400px 이면 최대 3줄 (3·4분할에서 슬롯이 좁아지므로)
 * - 모바일·7인치급은 기기 프로필 상한(2줄)이 우선
 */
export function maxSlotChatLines(slotWidthPx: number, deviceClass: DeviceClass): SlotLines {
  const deviceCap = DEVICE_PROFILES[deviceClass].maxSlotChatLines;
  const widthCap = slotWidthPx < 400 ? 3 : 5;
  return Math.min(deviceCap, widthCap) as SlotLines;
}

/** 설정값을 슬롯 폭·기기 상한으로 클램프한 실제 표시 줄 수. */
export function resolveSlotChatLines(
  requested: SlotLines,
  slotWidthPx: number,
  deviceClass: DeviceClass,
): SlotLines {
  const cap = maxSlotChatLines(slotWidthPx, deviceClass);
  return Math.max(0, Math.min(requested, cap)) as SlotLines;
}

export type StripMetrics = {
  stripHeightPx: number;
  /** 스트립을 뺀 뒤 영상에 남는 영역 */
  videoAreaW: number;
  videoAreaH: number;
  /** 실제 그림 크기 (컨테이너가 아니다) */
  pictureW: number;
  pictureH: number;
  /** 좌우 필러박스 총 폭 */
  pillarbox: number;
  /** 스트립이 없을 때 대비 영상 면적 손실률 (0~1) */
  areaLoss: number;
};

/**
 * 배치 모드별 영상 손실 계산.
 *
 * - `overlay`: 영상 위에 반투명으로 얹는다 → **영상 크기가 변하지 않는다 (손실 0%)**. 기본값.
 * - `reserve`: 영상 밑에 별도 영역을 확보한다 → 슬롯 세로가 짧아지며 16:9 영상이 폭을 못 채워
 *   **좌우 필러박스**가 생긴다(레터박스가 아니다). 4분할에서 1줄만 켜도 9.0% 줄어든다.
 */
export function stripMetrics(
  slotW: number,
  slotH: number,
  lines: number,
  placement: 'overlay' | 'reserve',
  fontPx = 12,
): StripMetrics {
  const base = pictureSize(slotW, slotH);
  const baseArea = base.width * base.height;
  const h = stripHeight(lines, fontPx);

  if (placement === 'overlay') {
    return {
      stripHeightPx: h,
      videoAreaW: slotW,
      videoAreaH: slotH,
      pictureW: base.width,
      pictureH: base.height,
      pillarbox: base.pillarbox,
      areaLoss: 0,
    };
  }

  const videoAreaH = Math.max(0, slotH - h);
  const picture = pictureSize(slotW, videoAreaH);
  const area = picture.width * picture.height;
  return {
    stripHeightPx: h,
    videoAreaW: slotW,
    videoAreaH,
    pictureW: picture.width,
    pictureH: picture.height,
    pillarbox: picture.pillarbox,
    areaLoss: baseArea > 0 ? 1 - area / baseArea : 0,
  };
}

/**
 * 분할 수별 권장 배치 모드.
 * - 4분할 슬롯은 이미 16:9 라 여유가 없다 → 오버레이
 * - 2분할 슬롯은 세로로 270px 남는다 → 예약 배치가 손실 0% 이므로 오버레이로 둘 이유가 없다
 */
export function recommendedPlacement(split: SplitCount): 'overlay' | 'reserve' {
  return split === 2 ? 'reserve' : 'overlay';
}

/** 비활성 슬롯 화질 하향 목표. 대역폭 보호용이며 설정에서 끌 수 있다. */
export const INACTIVE_SLOT_QUALITY = '720p' as const;

/**
 * 구성 시트 채널 목록 스크롤 영역의 높이. **순수 함수 — 테스트 대상.**
 *
 * 🔴 남은 높이를 그대로 쓰면 **마지막 행이 잘린 채 걸친다.** 잘린 행의 슬롯 배치 버튼
 * (①②③④)은 중심점이 스크롤 상자 밖이라 클릭이 하단 푸터로 가서 눌리지 않는다
 * (실측 2026-08-15 laptop13 1440×900: 행 상단 679.6 · 스크롤 바닥 682 · 푸터 상단 696).
 * → 남은 높이를 **행 간격의 배수로 내림**해 스크롤 상자 안에 항상 온전한 행만 남긴다.
 *
 * 행 하나도 못 넣을 만큼 좁으면 남은 높이를 그대로 돌려준다 — 목록을 감추는 것보다 낫다.
 *
 * @param available 스크롤 영역에 줄 수 있는 최대 높이(px). 본문 가시 높이에서 위쪽 옵션을 뺀 값.
 * @param headOffset 스크롤 내용 중 첫 행 위에 붙은 고정 부분(제목 등) 높이(px)
 * @param rowPitch 행 하나가 차지하는 세로 간격(px). 행 높이 + 행 사이 gap.
 */
export function fitListScrollHeight(
  available: number,
  headOffset: number,
  rowPitch: number,
): number {
  if (!Number.isFinite(available)) return 0;
  const fallback = Math.max(0, available);
  if (!Number.isFinite(headOffset) || !Number.isFinite(rowPitch)) return fallback;
  if (rowPitch <= 0 || headOffset < 0) return fallback;
  const rows = Math.floor((available - headOffset) / rowPitch);
  if (rows < 1) return fallback;
  return headOffset + rows * rowPitch;
}
