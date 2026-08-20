/**
 * FR-12 기기 유형별 프리셋 테이블.
 * 유형별 값을 여기 한 곳에 모아 개별 기능 모듈에 분기 로직이 흩어지지 않게 한다.
 */

export type DeviceClass = 'desktop' | 'laptop' | 'tablet-13' | 'tablet-10' | 'tablet-7' | 'mobile';

export const DEVICE_CLASSES: readonly DeviceClass[] = [
  'desktop',
  'laptop',
  'tablet-13',
  'tablet-10',
  'tablet-7',
  'mobile',
] as const;

export type DeviceProfile = {
  /** 최소 터치 타겟(px). 터치 기기는 44 (FR-12) */
  touchTargetPx: number;
  /** 채팅 기본 점유율(%) — 가로 기준. null = FR-10 계산값을 쓴다. */
  chatRatioLandscape: number | null;
  /**
   * 세로 자세에서 자동 하단 배치를 쓰는가. `null` = 쓰지 않음.
   *
   * ⚠️ 2026-08-16 이후 **숫자 값 자체는 점유율로 쓰이지 않는다.** 하단 점유율은
   * "뷰포트 높이 − 영상 그림 높이" 로 계산한다(`autoBottomChatRatio`) — 고정 비율로는
   * 영상과 채팅 사이에 죽은 공백이 남기 때문이다(412×915 에서 316px 실측).
   * 값은 자동 배치 대상 프로필을 구분하는 표시로만 읽히며 기존 숫자를 그대로 둔다.
   */
  chatRatioPortrait: number | null;
  /** FR-03 볼륨 컨트롤 상시 노출 여부 */
  volumeAlwaysVisible: boolean;
  /** 키보드 단축키 정책 */
  shortcuts: 'on' | 'off' | 'if-physical-keyboard';
  /** 호버 기반 UI 허용 여부 — 터치 기기는 금지 */
  allowHover: boolean;
  /** 설정 UI 우선 경로 */
  settingsUi: 'popup' | 'popup+sheet' | 'sheet';
  /** FR-14 최대 분할 수 */
  maxSplit: 2 | 4;
  /** FR-14.2 슬롯 채팅 줄 상한 */
  maxSlotChatLines: 2 | 3 | 5;
  /** 채팅 프리셋 표시 방식 */
  chatPresetUi: 'chips' | 'chips-2rows' | 'sheet';
  /** 저사양 대응 — 옵저버 디바운스를 늘리고 애니메이션을 줄인다 */
  relaxObservers: boolean;
};

export const DEVICE_PROFILES: Record<DeviceClass, DeviceProfile> = {
  desktop: {
    touchTargetPx: 32,
    chatRatioLandscape: 28,
    chatRatioPortrait: null,
    volumeAlwaysVisible: true,
    shortcuts: 'on',
    allowHover: true,
    settingsUi: 'popup',
    maxSplit: 4,
    maxSlotChatLines: 5,
    chatPresetUi: 'chips',
    relaxObservers: false,
  },
  laptop: {
    touchTargetPx: 32,
    chatRatioLandscape: 25,
    chatRatioPortrait: null,
    volumeAlwaysVisible: true,
    shortcuts: 'on',
    allowHover: true,
    settingsUi: 'popup',
    maxSplit: 4,
    maxSlotChatLines: 5,
    chatPresetUi: 'chips',
    relaxObservers: false,
  },
  'tablet-13': {
    touchTargetPx: 44,
    chatRatioLandscape: 25,
    chatRatioPortrait: 30,
    volumeAlwaysVisible: true,
    shortcuts: 'if-physical-keyboard',
    allowHover: false,
    settingsUi: 'popup+sheet',
    maxSplit: 4,
    maxSlotChatLines: 5,
    chatPresetUi: 'chips',
    relaxObservers: false,
  },
  'tablet-10': {
    touchTargetPx: 44,
    chatRatioLandscape: 22,
    chatRatioPortrait: 35,
    volumeAlwaysVisible: true,
    shortcuts: 'if-physical-keyboard',
    allowHover: false,
    settingsUi: 'popup+sheet',
    maxSplit: 2,
    maxSlotChatLines: 3,
    chatPresetUi: 'chips-2rows',
    relaxObservers: true,
  },
  'tablet-7': {
    touchTargetPx: 44,
    chatRatioLandscape: null,
    chatRatioPortrait: 40,
    volumeAlwaysVisible: false,
    shortcuts: 'off',
    allowHover: false,
    settingsUi: 'sheet',
    maxSplit: 2,
    maxSlotChatLines: 2,
    chatPresetUi: 'sheet',
    relaxObservers: true,
  },
  mobile: {
    touchTargetPx: 44,
    chatRatioLandscape: null,
    /**
     * 🔴 `null` 이면 안 된다 (실측 2026-08-16, 실사이트 412×915).
     * `null` 은 "세로 자동 하단 배치를 쓰지 않는다"는 뜻이라 **폰 세로가 그대로 오른쪽 배치**로
     * 남았고, 치지직 자체 래퍼(`_wrapper_wj4te_16`)가 좁은 폭에서 `flex-direction: column` 이라
     * 우리 `flex: 0 0 124px` 이 **높이**로 해석돼 채팅 aside 가 124×124 상자로 찌그러졌다
     * (채팅 목록 높이 0, 입력 영역 125px 가 넘쳐 `로그인` 이 두 줄로 접힘).
     * `chatWidth.ts` 의 근거 표가 문제 사례로 든 412×915 가 정확히 이 값 때문에 빠져 있었다.
     * 값은 기기가 작을수록 크게 잡는 기존 흐름(13인치 30 · 10인치 35 · 7인치 40)을 따른다.
     */
    chatRatioPortrait: 40,
    volumeAlwaysVisible: false,
    shortcuts: 'off',
    allowHover: false,
    settingsUi: 'sheet',
    maxSplit: 2,
    maxSlotChatLines: 2,
    chatPresetUi: 'sheet',
    relaxObservers: true,
  },
};

/**
 * 크기 계층 경계 (CSS 픽셀, 가로 기준 긴 변). 요구사항 FR-12 표.
 * ⚠️ 인치 판정은 원리적으로 추정이다. 인접 유형 간에는 기능 차이를 두지 않고
 * 밀도·크기·터치 타겟만 다르게 한다.
 *
 * 🔴 **문서 모순 해소 (2026-08-12)**: 요구사항 FR-12 표는 `tablet-13` 을 1100~1440 으로 적었는데,
 * §8.0 필수 검증 프로필은 **1180×820 → `tablet-10`** 을 기대값으로 못 박았다. 1180 은 1100 이상이라
 * 두 규정이 충돌한다. §11 미결정 2 가 "노트북/태블릿-13 경계(1200~1440 구간)를 에뮬레이터 실측으로
 * 확정"이라고 남겨 둔 항목이므로, **판정 기준인 §8.0 프로필을 채택해 경계를 1200 으로 둔다.**
 * 결과: 1180×820 → tablet-10, 1366×1024(iPad Pro 12.9") → tablet-13.
 */
export const SIZE_TIERS = {
  desktopMin: 1680,
  laptopMin: 1200,
  tablet13Min: 1200,
  tablet10Min: 800,
  tablet7Min: 600,
  /** 세로 기준 짧은 변이 이 값 미만이면 mobile 후보 */
  mobileShortSide: 480,
} as const;

/** FR-12.1 창 크기 변화 대응 */
export const RESIZE = {
  /** 회전·분할 직후 값이 요동치므로 트레일링 디바운스로 확정한다. */
  debounceMs: 150,
  /** 저사양 기기는 재계산 주기를 늘린다. */
  debounceMsRelaxed: 300,
} as const;

/** FR-10 히스테리시스 — 임계에서 깜빡임(flapping)을 막는다. */
export const ULTRA_WIDE_HYSTERESIS = { applyAbove: 1.8, releaseBelow: 1.76 } as const;

/** 16:9 */
export const VIDEO_ASPECT = 16 / 9;
