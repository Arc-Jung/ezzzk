/**
 * chrome.storage.local 스키마와 기본값. (요구사항 §5.3)
 * 단일 네임스페이스, 키 접두어 `ezzzk.`
 */

import type { DeviceClass } from './device';

export const STORAGE_KEY = 'ezzzk.settings';
export const SCHEMA_VERSION_KEY = 'ezzzk.schemaVersion';
export const SCHEMA_VERSION = 1;
/**
 * 직전 쓰기를 **어느 창(탭)이** 했는지 남기는 키. 설정 본문과 **같은 `set` 호출**로 쓴다 —
 * 그래야 `onChanged` 한 이벤트 안에 두 변경이 함께 도착해 다른 탭도 작성자를 알 수 있다.
 *
 * `origin`(= 쓴 기능의 id)은 쓴 탭의 메모리(`pendingWrites`)에만 있어 다른 탭에서는 언제나
 * `null` 로 보인다. 창을 구분하려면 **저장 payload 에 실려 오는 값**이 따로 있어야 한다.
 */
export const WRITER_KEY = 'ezzzk.lastWriter';

export type QualityTarget = 'auto' | '1080p' | '720p' | '480p' | 'best';
export type SlotLines = 0 | 1 | 2 | 3 | 4 | 5;
export type SlotIndex = 1 | 2 | 3 | 4;
export type SplitCount = 2 | 3 | 4;

export type ChatPreset = { id: string; label: string; text: string; order: number };

export type MultiViewSlot = {
  index: SlotIndex;
  channelId: string;
  channelName: string;
  /** 슬롯별 override. 없으면 전체 기본값을 쓴다. */
  chatLines?: SlotLines;
};

export type MultiViewSet = {
  id: string;
  name: string;
  slots: { index: SlotIndex; channelId: string; channelName: string }[];
};

export type Settings = {
  quality: { enabled: boolean; target: QualityTarget; applyToVod: boolean };
  /**
   * FR-19 오디오 처리 (2026-08-20). 구현 참조: chzzk-plus (kyechan99/chzzk-plus, MIT).
   * 컴프레서는 방송마다 들쭉날쭉한 음량을 눌러 균일하게 만든다. 기본은 켜짐(2026-08-22 변경) —
   * 방송마다 음량 편차가 커 대부분의 시청 환경에서 바로 도움이 된다.
   */
  audio: {
    compressor: {
      enabled: boolean;
      /** dB, -100~0 */
      threshold: number;
      /** dB, 0~40 */
      knee: number;
      /** 1~20 */
      ratio: number;
      /** 초, 0~1 */
      attack: number;
      /** 초, 0~1 */
      release: number;
    };
  };
  volume: {
    autoUnmute: boolean;
    /** 0~200 — 100 을 넘는 구간은 Web Audio 게인으로 증폭한다 (FR-03.2) */
    defaultLevel: number;
    /** 5 | 10 | 20 */
    step: number;
    restoreLast: boolean;
    lastLevel: number;
  };
  chatPresets: ChatPreset[];
  chatPresetBehavior: 'send' | 'fill';
  /** FR-15 — 사이드 11~24(기본 14 = 치지직 원본), 슬롯 10~16(기본 12) */
  chatFont: { sidePx: number; slotPx: number };
  chatWidth: {
    enabled: boolean;
    /** 전체 폭 대비 비율(%) */
    ratio: number;
    /**
     * 채팅 배치 위치. `right` = 영상 오른쪽(기본), `bottom` = 영상 아래.
     * 채팅 폭 컨트롤의 위치 버튼이 두 값을 번갈아 바꾼다 (2026-08-12 요청).
     */
    placement: 'right' | 'bottom';
    /**
     * `auto` 면 기기 유형별 기본 점유율(FR-12 표: 데스크톱 28 / 노트북 25 / 태블릿10 22 …)을 쓴다.
     * 사용자가 `+`/`-` 로 직접 조절하면 `manual` 이 되어 그 값이 우선한다.
     * 단일 전역 값만 두면 노트북·태블릿에서 FR-12 가 지정한 점유율을 지킬 수 없다.
     */
    ratioSource: 'auto' | 'manual';
    /**
     * 배치를 사용자가 직접 정했는가. `auto` 면 자세에 맞춰 자동으로 정한다
     * (세로 + 프로필의 `chatRatioPortrait` 가 있으면 `bottom`).
     *
     * 🔴 `ratioSource` 와 **분리해야 한다.** 하나로 묶으면 `+`/`−` 로 폭만 바꿔도 배치까지
     * 저장값으로 되돌아가, 세로 화면의 자동 하단 배치가 풀린다
     * (실측 2026-08-15 `ratio-9to16/S-06`: 하단 336 → `+` 한 번에 오른쪽 189px).
     */
    placementSource: 'auto' | 'manual';
    step: number;
    min: number;
    max: number;
    collapsed: boolean;
  };
  wideScreen: { enabled: boolean };
  powerCollect: { enabled: boolean };
  ultraWide: {
    enabled: boolean;
    minChatPx: number;
    overlayFallback: boolean;
    /**
     * 초광폭 판정(뷰포트 비율 ≥1.8, `ULTRA_WIDE_HYSTERESIS`)이 적용되는 동안 영상을 어디에
     * 붙일지. 21:9(2.33)·32:9(3.56) 데스크톱 모니터뿐 아니라 이 비율 조건을 만족하는 모든
     * 디스플레이(맥시마이즈한 16:9 노트북, 태블릿 가로 등)에 동일하게 적용된다 — 특정 비율에
     * 하드코딩돼 있지 않다.
     *
     * `left`(기본)는 그림을 왼쪽 끝에 붙여 남는 폭을 채팅에 몰아준다
     * (`layoutArbiter.ts` `buildVideoAlignCss` 참고). `center`는 치지직 기본값(가운데)을
     * 그대로 둔다 — 좌우 필러박스가 넓게 남는 대신 영상이 시야 중앙에 온다.
     */
    videoAlign: 'left' | 'center';
  };
  chatUserFilter: { enabled: boolean; persistPerChannel: boolean };
  /**
   * 치지직 내장 클린봇(욕설 필터)을 우리 확장이 기본으로 꺼 준다. 자체 필터를 만드는 게
   * 아니다 — 치지직 계정 설정의 클린봇 토글 자체를 끈다.
   *
   * 🔴 **기본값은 끄기다(= 클린봇을 그대로 켜 둔다).** 확장이 기본값으로 사용자의 네이버 계정
   * 설정을 바꾸는 동작이라 크롬 웹스토어 심사에서 거부·게시중단 위험이 크다(2026-09-03 검토).
   * 클린봇이 정상 발언까지 가린다고 느끼는 사용자는 설정에서 직접 켜서 쓴다.
   */
  chzzkCleanBot: { disable: boolean };
  /**
   * FR-16 채팅 영역 부가 요소 숨김. 기본값은 모두 숨김(true).
   * ⚠️ 광고 배너는 대상이 아니다 — 본 확장은 광고를 차단하지 않는다 (FR-13 과 같은 범위 원칙).
   */
  chatClutter: {
    header: boolean;
    ranking: boolean;
    drops: boolean;
    /** FR-17 채팅 aside 광고 배너 */
    adBanner: boolean;
    /** `무료 치즈 받기` 프로모션 툴팁 */
    freeCheese: boolean;
    /**
     * `쾌적한 시청 환경을 위해 일부 메시지는 필터링 됩니다` 클린 라이브 안내.
     * 실측에서 채팅 목록의 상당 부분을 가려 기본 숨김으로 둔다 (2026-08-12 요청).
     */
    cleanLive: boolean;
    /**
     * 비로그인 입력창의 `채팅에 참여하려면 로그인 해주세요` placeholder 를 `로그인` 으로 줄인다.
     * 좁은 채팅 폭에서 두 줄을 먹어 입력 영역을 밀어낸다.
     */
    shortLoginPlaceholder: boolean;
  };
  /** FR-18 광고 SKIP 버튼 자동 클릭. 기본 켜기 */
  adSkip: { enabled: boolean };
  device: { override: 'auto' | DeviceClass };
  promoHide: { banner: boolean; playerTooltip: boolean };
  multiView: {
    enabled: boolean;
    defaultSplit: SplitCount;
    /**
     * 비활성 슬롯 화질을 720p 로 낮출지. **기본 끄기**(2026-08-12 요청) —
     * 비활성 슬롯도 목표 화질로 재생한다. 켜면 대역폭·CPU 를 아낀다.
     */
    lowerInactiveQuality: boolean;
    restoreLastLayout: boolean;
    /**
     * 멀티뷰 스테이지의 **사이드 채팅 패널(BETA)** 을 쓸지. `'none'` 이면 만들지 않는다.
     *
     * 🔴 기본값은 `'none'` 이다 (2026-08-20 요청). 켜 두면 무대 오른쪽을 채팅이 가져가
     * 슬롯이 그만큼 좁아진다 — 멀티뷰를 켠 목적은 영상을 여러 개 보는 것이지 채팅이 아니다.
     * 필요한 사람은 스테이지 조작 바에서 켜면 된다.
     *
     * ⚠️ 기존 우측 채팅(FR-05 aside)과는 다른 것이다. 그쪽은 멀티뷰 중 **항상** 비활성이며
     * 이 값과 무관하다 (2026-08-12 — 스테이지가 덮어 "보이지도 않는데 폭만 차지"했다).
     */
    chatMode: 'active' | 'none';
    slotChatLines: SlotLines;
    slotChatLinesActive: SlotLines;
    slotChatPlacement: 'overlay' | 'reserve';
    slots: MultiViewSlot[];
    activeSlot: SlotIndex;
    /** 최대 10개 */
    sets: MultiViewSet[];
    recentChannels: { channelId: string; channelName: string; usedAt: number }[];
  };
  optionPresets: {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    values: Partial<Settings>;
  }[];
  activePresetId: string | null;
  debug: boolean;
};

/**
 * **창(탭)마다 따로 가져가는 설정 섹션.** 여기 없는 섹션은 전부 전역이다.
 *
 * 🔴 근거 (사용자 보고 2026-08-15, 실측 재현): 탭 두 개를 띄우고 **A 탭에서만** 채팅 폭 `+` 를
 * 세 번 눌렀는데 B 탭의 `#aside-chatting` 폭까지 360 → 576 으로 같이 변했다. 접기도 마찬가지로
 * 두 탭이 함께 0 이 됐다. 다른 탭에는 `chrome.storage.onChanged` 만 도착하고 `origin` 은 쓴 탭의
 * 메모리에만 있어 `null` 로 해석되기 때문이다 → B 가 "내 조작이 아니다"로 보고 `chatWidth` 를
 * 재시작해 저장값을 다시 적용했다.
 *
 * FR-05 레이아웃 조작(채팅 폭 비율·접기·배치)은 **조작한 창에만** 적용한다. 저장은 계속 하되
 * 저장값은 "앞으로 새로 여는 탭의 기본값"으로만 쓴다.
 *
 * 화질·볼륨 기본값·폰트·클러터 숨김 등은 창별로 달라질 이유가 없어 전역을 유지한다(FR-08/09).
 * 창 로컬로 돌릴 섹션이 늘어나면 **여기에만** 추가한다.
 */
export const WINDOW_LOCAL_SECTIONS: readonly (keyof Settings)[] = ['chatWidth'];

/** 상한 (요구사항 FR-04 / FR-08 / FR-14) */
export const LIMITS = {
  chatPresets: 50,
  optionPresets: 20,
  multiViewSets: 10,
  recentChannels: 20,
  /** FR-04 도배 방지 — 클라이언트 측 최소 전송 간격(ms) */
  chatSendIntervalMs: 1000,
} as const;

/** FR-15 폰트 범위 */
export const CHAT_FONT_RANGE = {
  side: { min: 11, max: 24, default: 14 },
  slot: { min: 10, max: 16, default: 12 },
} as const;

/** FR-05 채팅 폭 범위(%) */
export const CHAT_WIDTH_RANGE = { min: 15, max: 50 } as const;

export const DEFAULT_SETTINGS: Settings = {
  quality: { enabled: true, target: '1080p', applyToVod: true },
  audio: {
    compressor: { enabled: true, threshold: -50, knee: 40, ratio: 12, attack: 0, release: 0.25 },
  },
  volume: { autoUnmute: true, defaultLevel: 50, step: 10, restoreLast: false, lastLevel: 50 },
  chatPresets: [],
  chatPresetBehavior: 'send',
  chatFont: { sidePx: CHAT_FONT_RANGE.side.default, slotPx: CHAT_FONT_RANGE.slot.default },
  chatWidth: {
    enabled: true,
    ratio: 30,
    placement: 'right',
    ratioSource: 'auto',
    placementSource: 'auto',
    // 🔴 5%(2026-08-24 이전 기본값)는 클릭 한 번에 너무 크게 움직인다는 사용자 보고로 절반 수준인 2로 낮췄다.
    step: 2,
    min: 15,
    max: 50,
    collapsed: false,
  },
  wideScreen: { enabled: true },
  // ⚠️ 약관·계정 리스크가 있어 기본값은 끄기다 (요구사항 FR-06 · §9 리스크).
  powerCollect: { enabled: false },
  ultraWide: { enabled: true, minChatPx: 150, overlayFallback: true, videoAlign: 'left' },
  chatUserFilter: { enabled: true, persistPerChannel: false },
  chzzkCleanBot: { disable: false },
  // 요청에 따라 기본으로 숨긴 상태로 시작한다.
  chatClutter: {
    header: true,
    ranking: true,
    drops: true,
    adBanner: true,
    freeCheese: true,
    cleanLive: true,
    shortLoginPlaceholder: true,
  },
  // 요청에 따라 기본으로 자동 스킵한다.
  adSkip: { enabled: true },
  device: { override: 'auto' },
  promoHide: { banner: true, playerTooltip: true },
  multiView: {
    enabled: false,
    defaultSplit: 4,
    // 요청에 따라 기본값은 **끄기** — 비활성 슬롯도 목표 화질(1080p)로 재생한다.
    lowerInactiveQuality: false,
    restoreLastLayout: true,
    chatMode: 'none',
    slotChatLines: 3,
    slotChatLinesActive: 5,
    // 4분할 슬롯은 이미 16:9 라 예약 배치 시 영상이 30% 줄어든다 → 오버레이가 기본값.
    slotChatPlacement: 'overlay',
    slots: [],
    activeSlot: 1,
    sets: [],
    recentChannels: [],
  },
  optionPresets: [],
  activePresetId: null,
  debug: false,
};

/** FR-08 기본 제공 프리셋 (초기 상태로 넣는다) */
export const BUILTIN_PRESETS: { name: string; values: Partial<Settings> }[] = [
  { name: '기본', values: {} },
  {
    name: '채팅 집중',
    values: { chatWidth: { ...DEFAULT_SETTINGS.chatWidth, ratio: 45 } },
  },
  {
    name: '영상 집중',
    values: { chatWidth: { ...DEFAULT_SETTINGS.chatWidth, ratio: 15 } },
  },
];
