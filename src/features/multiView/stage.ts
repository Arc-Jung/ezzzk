/**
 * FR-14 멀티뷰 스테이지 — 슬롯 iframe 배치 + 채팅 스트립 + 하단 컨트롤.
 *
 * 실측 근거
 * - iframe 4개 동시 재생 **PASS**. `X-Frame-Options`·CSP `frame-ancestors` 모두 없고
 *   프레임 버스팅도 관찰되지 않았다 → `declarativeNetRequest` 로 헤더를 위조할 필요가 없다.
 * - iframe 내부 `contentDocument` 는 `null`(크로스 오리진) → 슬롯 제어는 postMessage 로만 한다.
 * - 스테이지는 `document.body` 직계 + 최상위 z-index. 페이지 리렌더에 지워지지 않는다.
 *
 * 레이아웃 값은 **크기 변화마다 재계산하고 캐시하지 않는다** (FR-12.1).
 */

import { BETA_BADGE_TEXT, OURS } from '../../constants/class';
import type { MultiViewSlot, Settings, SlotIndex } from '../../constants/storage';
import type { DeviceDecision } from '../../device';
import { upsertStyle, removeStyle } from '../../utils/dom';
import { readViewport } from '../../utils/viewport';
import { info, warning } from '../../utils/log';
import { AudioRouter, slotFromAudioShortcut } from './audioRouter';
import {
  MV_CHANNEL,
  parseMvMessage,
  slotFrameUrl,
  type ParentToSlot,
  type SlotToParent,
} from './messages';
import {
  computeSlotRects,
  resolveSlotChatLines,
  stripHeight,
  stripMetrics,
  INACTIVE_SLOT_QUALITY,
  SLOT_GAP,
  type Orientation,
} from './slotLayout';

const STAGE_STYLE_ID = 'cm-multiview-stage-style';
/** 슬롯 컨트롤러가 이 시간 안에 `ready` 를 보내지 않으면 해당 슬롯을 실패로 표시한다. */
const FRAME_LOAD_TIMEOUT_MS = 15_000;

/**
 * 사이드 채팅(BETA)을 켰을 때 무대에 남아야 하는 최소 폭.
 *
 * 🔴 사용자 지적 그대로 — "멀티뷰일 때 채팅은 생각보다 비효율적일 수 있다". 채팅을 켜면 슬롯이
 * 그만큼 좁아지므로, 2분할 기준으로 슬롯 하나가 16:9 로 읽을 수 있는 최소치를 남긴다.
 * 480px(슬롯 하나 약 240px) 미만이 되면 채팅을 아예 켜지 않는다 — 모바일·분할 화면·세로가 여기 걸린다.
 */
const MIN_STAGE_WIDTH_PX = 480;

/**
 * 사이드 채팅에 담을 줄 수. 슬롯 스트립(0~5줄)과 **같은 `chat` 메시지를 공유**하므로,
 * 활성 슬롯에는 스트립 줄 수와 이 값 중 큰 값을 요청하고 스트립은 뒤쪽 N줄만 쓴다.
 * 새 프로토콜·추가 폴링 없이 흐름을 읽을 만큼(약 한 화면) 확보하는 값이다.
 */
const SIDE_CHAT_LINES = 40;

export type StageCallbacks = {
  onRequestConfig: () => void;
  onExit: (activeChannelId: string | null) => void;
  onActiveSlotChange: (slot: SlotIndex) => void;
  onVolumeChange: (percent: number) => void;
  onChatLinesChange: (lines: number) => void;
  /**
   * 전체 화면에서 기존 채팅 aside 에 줄 폭. 0 이면 접는다.
   * 폭 적용은 layoutArbiter 를 쥐고 있는 쪽(index.ts)이 한다 — 폭 결정 지점을 한 곳으로 묶는다.
   */
  onChatWidthChange: (widthPx: number) => void;
};

type SlotRuntime = {
  slot: SlotIndex;
  channelId: string;
  channelName: string;
  cell: HTMLElement;
  frame: HTMLIFrameElement;
  strip: HTMLElement;
  header: HTMLElement;
  /** iframe `load` 이벤트가 발화했는가. **로드 성공을 뜻하지 않는다** (아래 `ready` 주석 참조). */
  loaded: boolean;
  /**
   * 슬롯 컨트롤러가 `ready` 를 보내왔는가 = **이 슬롯이 실제로 살아 있다**는 유일한 신호.
   *
   * 🔴 2026-08-16 실측 결함: 네트워크 오류로 슬롯 문서가 뜨지 않아도 크롬은 오류 페이지를
   * 커밋하며 iframe 에 `load` 를 발화시킨다. 그래서 `loaded` 로 실패를 판정하면
   * **영원히 실패로 잡히지 않고 사용자는 검은 칸만 본다**
   * (`probe-multiview-slot-failure`: 22초 뒤에도 `.cm-slot__error` 없음,
   * `slot 2 controller started` 로그도 없었다).
   */
  ready: boolean;
  failed: boolean;
};

/**
 * 스테이지 컨테이너의 폭은 CSS 에 박지 않고 `layout()` 이 무대 폭으로 인라인 지정한다.
 *
 * 멀티뷰 중에는 기존 우측 채팅을 비활성화하므로(2026-08-12 결정) 현재 무대 폭 = 뷰포트 폭이다.
 * 그래도 `inset: 0` 대신 인라인 폭을 쓰는 이유: 무대 폭이 뷰포트와 달라지는 구성이 다시
 * 생기면 **컨테이너가 무대보다 넓어 검은 띠(죽은 공간)가 남는 버그**가 되살아난다.
 * 실제로 그 버그를 겪었다 — 사이드 채팅 353px 을 남겼을 때 컨테이너가 그 위를 덮어
 * 채팅은 안 보이고 폭만 368px 낭비됐다 (`multiview-shots/`). 폭 결정 지점을 한 곳으로 묶어 둔다.
 */
export function buildStageCss(touchTargetPx: number, alwaysShowHeader: boolean): string {
  return `
#${OURS.multiViewStageId} {
  position: fixed;
  top: 0;
  left: 0;
  height: 100%;
  z-index: ${OURS.topZIndex - 2};
  background: #000;
  font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', -apple-system, sans-serif;
  color: #e9ecef;
  font-size: 12px;
}
#${OURS.multiViewStageId} .cm-slot {
  position: absolute;
  overflow: hidden;
  background: #000;
  outline: 1px solid #1c1f22;
}
#${OURS.multiViewStageId} .cm-slot--active { outline: 2px solid #00ffa3; }
#${OURS.multiViewStageId} .cm-slot iframe {
  display: block;
  border: 0;
  width: 100%;
}
#${OURS.multiViewStageId} .cm-slot__head {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  background: linear-gradient(#000c, transparent);
  z-index: 2;
  /* 터치 기기는 호버로만 드러나는 요소를 두지 않는다 (FR-12). */
  opacity: ${alwaysShowHeader ? 1 : 0};
  transition: opacity 120ms;
}
#${OURS.multiViewStageId} .cm-slot:hover .cm-slot__head { opacity: 1; }
#${OURS.multiViewStageId} .cm-slot__head button {
  min-width: ${touchTargetPx}px;
  min-height: ${touchTargetPx}px;
  border: 1px solid #2a2d31;
  border-radius: 5px;
  background: #1c1f22cc;
  color: #e9ecef;
  cursor: pointer;
}
/* 슬롯 채팅 스트립 — 1줄 고정, 말줄임, 이미지 미렌더 (FR-14.2) */
#${OURS.multiViewStageId} .cm-slot-chat-strip {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
  padding: 4px 6px;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 0;
}
#${OURS.multiViewStageId} .cm-slot-chat-strip--overlay {
  background: linear-gradient(transparent, #000c);
  text-shadow: 0 1px 2px #000;
}
#${OURS.multiViewStageId} .cm-slot-chat-strip--reserve { background: #0e0f11; }
#${OURS.multiViewStageId} .cm-slot-chat-line {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#${OURS.multiViewStageId} .cm-slot-chat-line b { font-weight: 600; margin-right: 4px; }
#${OURS.multiViewStageId} .cm-slot__error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 12px;
  color: #ffb454;
}
/**
 * 스테이지 조작 바. **가운데 상단**에 둔다 (사용자 요청 2026-08-15).
 * 하단 가운데에 두면 플레이어 컨트롤바·채팅 스트립과 같은 자리를 다퉈 다른 버튼을 가린다.
 *
 * 바가 차지하는 위쪽 띠는 stageTopInset() 이 슬롯 배치에서 떼어 낸다 — 슬롯 헤더 버튼이
 * 바에 덮여 눌리지 않던 회귀(2026-08-16)를 배치 단계에서 구조적으로 막는다.
 * 그래서 top 값은 그대로 띠 높이에 반영되니 불필요하게 키우지 않는다.
 */
/*
  🔴 바는 절대 뷰포트를 넘지 않는다 (실측 회귀 2026-08-18: 412px 세로에서 좌우가 잘려
  멀티뷰 해제 버튼을 누를 수 없었다). 넘치면 줄바꿈한다 — 늘어난 높이는 stageTopInset() 이
  슬롯 배치 띠로 환산하므로 슬롯과 겹치지 않는다.
*/
#${OURS.multiViewStageId} .cm-stage-bar {
  max-width: calc(100vw - 8px);
  flex-wrap: wrap;
  justify-content: center;
  position: absolute;
  left: 50%;
  top: 6px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  background: #16181be6;
  border: 1px solid #2a2d31;
  border-radius: 8px;
  z-index: 3;
}
#${OURS.multiViewStageId} .cm-stage-bar button {
  min-width: ${touchTargetPx}px;
  min-height: ${touchTargetPx}px;
  border: 1px solid #2a2d31;
  border-radius: 5px;
  background: #1c1f22;
  color: #e9ecef;
  cursor: pointer;
}
#${OURS.multiViewStageId} .cm-stage-bar output { min-width: 40px; text-align: center; }
/*
  BETA 뱃지. 조작 바의 **정적 텍스트**라 스크린 리더가 조작마다 반복해 읽지 않는다
  (버튼 안이 아니므로 aria-hidden 을 쓰지 않는다).
  🔴 바 높이를 키우지 않게 버튼(min-height: touchTargetPx)보다 낮게 유지한다 —
  바 높이는 stageTopInset() 을 통해 슬롯 배치 띠로 그대로 환산된다.
*/
#${OURS.multiViewStageId} .cm-stage-bar .${OURS.betaBadgeClass} {
  flex: 0 0 auto;
  padding: 1px 5px;
  border: 1px solid #00ffa3;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 700;
  line-height: 1.4;
  letter-spacing: 0.04em;
  color: #00ffa3;
}
/*
  사이드 채팅 패널 (BETA, 요청 2026-08-18).
  🔴 무대 오른쪽 **바깥**에 붙인다. 컨테이너 폭은 layout() 이 viewport - chatWidth 로 줄이므로
  패널은 그 옆 빈 자리를 차지한다 — 슬롯을 덮지 않는다(겹침 판정이 이것을 감시한다).
  치지직 원본 aside 는 계속 접힌 상태다: 그것은 호스트 채널 채팅이라 활성 슬롯과 어긋난다.
*/
#${OURS.multiViewStageId} .cm-stage-chat {
  position: absolute;
  top: 0;
  left: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: #141517;
  border-left: 1px solid #2a2d31;
  color: #e6e6e6;
  font-size: 12px;
  overflow: hidden;
}
#${OURS.multiViewStageId} .cm-stage-chat__head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid #2a2d31;
  font-weight: 700;
  white-space: nowrap;
}
#${OURS.multiViewStageId} .cm-stage-chat__title {
  overflow: hidden;
  text-overflow: ellipsis;
}
#${OURS.multiViewStageId} .cm-stage-chat__head .${OURS.betaBadgeClass} {
  flex: 0 0 auto;
  padding: 1px 5px;
  border: 1px solid #00ffa3;
  border-radius: 4px;
  font-size: 9px;
  line-height: 1.4;
  letter-spacing: 0.04em;
  color: #00ffa3;
}
/* 목록만 스크롤한다 — 헤더가 밀려 올라가면 어느 방송 채팅인지 알 수 없다. */
#${OURS.multiViewStageId} .cm-stage-chat__list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 6px 8px;
  line-height: 1.5;
}
#${OURS.multiViewStageId} .cm-stage-chat__line {
  overflow-wrap: anywhere;
}
#${OURS.multiViewStageId} .cm-stage-chat__line b {
  margin-right: 4px;
  font-weight: 600;
}
/* 전체 화면 전용 채팅 폭 컨트롤 */
#${OURS.multiViewStageId} .cm-stage-chat-controls {
  display: none;
  align-items: center;
  gap: 4px;
  padding-left: 8px;
  border-left: 1px solid #2a2d31;
}
#${OURS.multiViewStageId} .cm-stage-chat-controls output { min-width: 48px; }
`.trim();
}

/** 스트립과 컨트롤 바 사이 최소 간격. */
export const STRIP_BAR_GAP_PX = 6;

/**
 * 조작 바 전용 띠의 높이. **순수 함수 — 테스트 대상.**
 *
 * 🔴 2026-08-16 회귀: 가운데 상단 조작 바가 슬롯 헤더 버튼(`슬롯 N 소리 활성`·`채팅 줄 수 …`)을
 * 덮어 **버튼 중심점의 `elementFromPoint` 가 `div.cm-stage-bar`** 가 됐다 — 눌리지 않았다
 * (mobile-landscape·mobile-portrait·tablet10-landscape·laptop13 4건).
 * 바의 자리를 슬롯 배치에서 아예 떼어 내면 분할 수·프로필과 무관하게 겹칠 수 없다.
 * 바가 없거나 아직 렌더 전(높이 0)이면 0 — 띠를 만들지 않는다.
 */
export function stageTopInset(bar: { top: number; height: number } | null): number {
  if (!bar || bar.height <= 0) return 0;
  return Math.ceil(Math.max(0, bar.top) + bar.height + STRIP_BAR_GAP_PX);
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

export class MultiViewStage {
  private container: HTMLElement | null = null;
  /** 하단 컨트롤 바. 스트립이 이 바를 피하도록 좌표를 읽는다. */
  private bar: HTMLElement | null = null;
  /** 사이드 채팅 표시 여부. `채팅 끄기` 로 접고 다시 켤 수 있다. */
  private chatOpen = true;
  /** 사이드 채팅 패널(BETA). `chatMode: 'none'` 이거나 폭이 부족하면 만들지 않는다. */
  private chatPanel: HTMLElement | null = null;
  private chatPanelTitle: HTMLElement | null = null;
  private chatPanelList: HTMLElement | null = null;
  /** `−`/`+` 가 누적한 폭 조절 칸 수. */
  private chatSteps = 0;
  /** 전체 화면 전용 컨트롤 묶음 (채팅 폭 조절). */
  private chatControls: HTMLElement | null = null;
  private chatLabel: HTMLElement | null = null;
  /** 사이드 채팅 토글. 지금 동작(켜기/끄기)에 맞춰 label 을 바꿔 줘야 한다. */
  private chatToggle: HTMLElement | null = null;
  /** 마지막 배치에 쓴 조작 바 높이. 줄바꿈으로 높이가 바뀌면 한 번 더 배치한다. */
  private lastBarHeight = 0;
  private runtimes = new Map<SlotIndex, SlotRuntime>();
  private router = new AudioRouter();
  private disposers: (() => void)[] = [];
  private volumePercent: number;

  constructor(
    private settings: Settings,
    private device: DeviceDecision,
    private callbacks: StageCallbacks,
  ) {
    this.volumePercent = settings.volume.defaultLevel;
  }

  /** 스테이지를 만들고 슬롯 iframe 을 붙인다. */
  open(slots: MultiViewSlot[]): void {
    upsertStyle(
      STAGE_STYLE_ID,
      buildStageCss(this.device.profile.touchTargetPx, !this.device.profile.allowHover),
    );

    let container = document.getElementById(OURS.multiViewStageId);
    if (!container) {
      container = document.createElement('div');
      container.id = OURS.multiViewStageId;
      container.setAttribute('role', 'region');
      container.setAttribute('aria-label', '멀티뷰');
      document.body.appendChild(container);
    }
    container.replaceChildren();
    this.container = container;
    // replaceChildren 로 이전 바 노드가 사라졌다 — 참조를 남기면 떼어낸 노드의 좌표를 읽는다.
    this.bar = null;

    for (const slot of slots) this.createSlot(slot);
    this.createBar();
    this.bindMessages();
    this.bindShortcuts();

    /**
     * 전체 화면 진입·이탈마다 채팅 폭을 다시 계산한다.
     * 진입 시 `chatOpen` 을 되살리는 이유: ✕ 로 끈 뒤 전체 화면을 나갔다 들어오면
     * 되돌릴 UI 가 없어 채팅을 다시 켤 방법이 사라진다.
     */
    const onFullscreenChange = () => {
      if (this.isFullscreen()) this.chatOpen = true;
      this.syncChatWidth();
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    this.disposers.push(() => document.removeEventListener('fullscreenchange', onFullscreenChange));

    this.router.setActive(this.settings.multiView.activeSlot);
    this.markActiveSlot();
    this.updateChatControls();
    this.layout();
    info(`multiview stage opened with ${slots.length} slot(s)`);
  }

  close(): void {
    this.disposers.forEach((dispose) => dispose());
    this.disposers = [];
    for (const runtime of this.runtimes.values()) {
      this.post({ channel: MV_CHANNEL, dir: 'p2s', kind: 'exitSlotMode', slot: runtime.slot });
    }
    this.runtimes.clear();
    this.container?.remove();
    this.container = null;
    this.bar = null;
    this.chatControls = null;
    this.chatLabel = null;
    this.chatToggle = null;
    this.chatPanel = null;
    this.chatPanelTitle = null;
    this.chatPanelList = null;
    // 스테이지가 사라졌으니 폭 주장도 되돌린다 (남기면 aside 가 접힌 채 방치된다).
    this.callbacks.onChatWidthChange(0);
    removeStyle(STAGE_STYLE_ID);
    info('multiview stage closed');
  }

  /**
   * 설정을 갈아 끼운다.
   *
   * 🔴 이 메서드가 없으면 스테이지가 **생성 시점 스냅샷에 영구히 갇힌다.**
   * 멀티뷰는 `watches: []` 라 설정 변경으로 재시작되지 않는데(iframe 4개 재로드를 막기 위함),
   * 그러면 설정 패널의 `slotChatLines`·`slotChatPlacement`·`chatMode`·`lowerInactiveQuality`·
   * `chatFont.slotPx`·`volume.step` 이 **조용히 먹지 않는다.**
   * 재시작 대신 여기서 제자리 반영한다.
   */
  updateSettings(next: Settings): void {
    this.settings = next;
    this.layout();
    for (const runtime of this.runtimes.values()) this.applyQuality(runtime.slot);
  }

  /**
   * 무대 크기. **화면 전체를 쓴다.**
   * 멀티뷰 중에는 기존 우측 채팅을 비활성화하므로(2026-08-12 결정) 폭을 뺄 이유가 없다.
   * 슬롯 채팅은 슬롯마다 붙는 스트립(FR-14.2)이 담당한다.
   */
  private stageSize(): { width: number; height: number; orientation: Orientation } {
    const { width, height } = readViewport();
    const chatWidth = this.currentChatWidth();
    return {
      width: Math.max(0, width - chatWidth),
      height,
      orientation: width >= height ? 'landscape' : 'portrait',
    };
  }

  /**
   * 사이드 채팅 패널 폭 (BETA, 요청 2026-08-18).
   *
   * 🔴 **효율을 인정하고 자동으로 접는다.** 채팅을 켜면 슬롯이 그만큼 좁아진다. 남는 무대 폭이
   * `MIN_STAGE_WIDTH_PX` 미만이면 0 을 돌려줘 아예 켜지지 않게 한다 — 모바일·분할 화면·세로에서
   * 슬롯이 읽을 수 없을 만큼 작아지는 것을 막는다(FR-14 기기 상한과 같은 취지).
   * 폭 계산은 `sideChatWidthPx` (뷰포트 비율 기반) 가 한다.
   */
  private currentChatWidth(): number {
    if (!this.chatOpen || this.settings.multiView.chatMode === 'none') return 0;
    if (!this.sideChatFits()) return 0;
    const { width, height } = readViewport();
    return sideChatWidthPx(width, height, this.chatSteps);
  }

  /**
   * 이 화면에 사이드 채팅이 들어갈 수 있는가. `chatOpen`(사용자 토글)과 무관하다 —
   * 껐다 켜는 컨트롤을 보여 줘야 하는지 판단하는 데도 쓴다.
   */
  private sideChatFits(): boolean {
    const { width, height } = readViewport();
    const chat = sideChatWidthPx(width, height, this.chatSteps);
    return chat > 0 && width - chat >= MIN_STAGE_WIDTH_PX;
  }

  private isFullscreen(): boolean {
    return document.fullscreenElement !== null;
  }

  /** 채팅 폭을 다시 계산해 적용하고 무대를 재배치한다. */
  private syncChatWidth(): void {
    this.callbacks.onChatWidthChange(this.currentChatWidth());
    this.updateChatControls();
    this.layout();
  }

  /**
   * 채팅 폭 컨트롤은 **항상** 보여 준다 (BETA 사이드 채팅, 요청 2026-08-18).
   * 예전에는 전체 화면에서만 보였는데, 일반 멀티뷰에서 채팅을 켤 방법이 없었다.
   * `chatMode: 'none'` 이면 기능 자체를 끈 것이므로 컨트롤도 감춘다.
   */
  private updateChatControls(): void {
    if (!this.chatControls) return;
    /*
     * 🔴 **켤 수 없는 화면에서는 컨트롤도 감춘다** (실측 회귀 2026-08-18).
     * 컨트롤을 상시 노출로 바꾸자 412px 세로 모바일에서 조작 바가 뷰포트보다 넓어져
     * `볼륨 줄이기`·`전체 화면 전환`·`멀티뷰 해제` 가 화면 밖으로 밀려 **해제조차 못 누르는**
     * 상태가 됐다 (하네스 M-01: inViewport false, 해제 클릭 타임아웃).
     * 사이드 채팅이 들어갈 수 없는 폭이면(자동 접힘) 컨트롤도 만들지 않는다.
     */
    const enabled = this.settings.multiView.chatMode !== 'none' && this.sideChatFits();
    this.chatControls.style.display = enabled ? 'inline-flex' : 'none';
    const width = this.currentChatWidth();
    if (this.chatLabel) {
      this.chatLabel.textContent = width > 0 ? `${width}px` : '꺼짐';
    }
    if (this.chatToggle) {
      this.chatToggle.setAttribute('aria-label', this.chatOpen ? '채팅 끄기' : '채팅 켜기');
      this.chatToggle.textContent = this.chatOpen ? '✕' : '💬';
    }
  }

  /**
   * 슬롯 위치·크기와 스트립 높이를 다시 계산해 적용한다.
   * 캐시하지 않는다 — 회전·분할 화면·자유 창·주소창 접힘마다 호출된다 (FR-12.1).
   */
  layout(): void {
    this.layoutOnce();
    /*
     * 🔴 **한 번 더 재야 하는 경우가 있다.** 사이드 채팅을 켜면 무대가 좁아지고, 그러면 조작 바가
     * 줄바꿈되어 높이가 커진다(모바일·세로 태블릿). 그 높이는 `stageTopInset()` 으로 슬롯 띠에
     * 환산되는데, 첫 계산은 줄바꿈 **전** 높이를 썼기 때문에 슬롯이 바를 덮는다 — 실측 2026-08-19
     * 세로 태블릿에서 조작 바 버튼 8개가 전부 눌리지 않았다(`채팅 끄기`·`멀티뷰 해제` 포함).
     * 높이가 바뀌었으면 그 값으로 한 번만 다시 배치한다 (재귀 방지: 1회 한정).
     */
    const barHeight = this.bar?.getBoundingClientRect().height ?? 0;
    if (barHeight > 0 && barHeight !== this.lastBarHeight) {
      this.lastBarHeight = barHeight;
      this.layoutOnce();
    }
  }

  private layoutOnce(): void {
    if (!this.container) return;
    const { width, height, orientation } = this.stageSize();
    const split = Math.max(2, this.runtimes.size) as 2 | 3 | 4;
    /**
     * 조작 바는 가운데 상단에 있고 슬롯 헤더도 슬롯 `top: 0` 이라 같은 y 대역을 다툰다.
     * 바가 차지하는 띠를 배치에서 떼어 내 슬롯을 그 아래에서 시작시킨다 (`stageTopInset`).
     */
    const barRect = this.bar?.getBoundingClientRect() ?? null;
    const rects = computeSlotRects(
      split,
      width,
      height,
      orientation,
      SLOT_GAP,
      stageTopInset(barRect),
    );

    /**
     * 컨테이너 폭을 무대 폭과 일치시킨다. 사이드 채팅을 켜면 그 폭만큼 비워 두어야
     * 기존 채팅 aside 가 실제로 보인다 (위 CSS 주석의 실측 버그).
     */
    this.container.style.width = `${width}px`;
    this.ensureChatPanel();

    /*
     * 🔴 **슬롯 번호는 연속이 아닐 수 있다.** 구성 시트에서 가운데 슬롯을 빼면 남는 번호가
     * 1·3·4 처럼 띄어진다. 예전 구현은 `runtimes.get(rect.index)` 로 찾아 번호가 비면 `continue`
     * 했고, 그러면 **배치를 못 받은 슬롯이 옛 좌표에 그대로 남아** 다른 슬롯과 겹쳤다.
     * 실측(2026-08-19, 시나리오 M-10): 3슬롯에서 겹침 27,600px², 그 슬롯이 조작 바까지 덮어
     * 세로 태블릿에서 조작 바 버튼 8개가 전부 눌리지 않았다.
     * → 번호가 아니라 **정렬된 순서**로 사각형을 나눠 준다.
     */
    const ordered = [...this.runtimes.values()].sort((a, b) => a.slot - b.slot);
    for (const [position, rect] of rects.entries()) {
      const runtime = ordered[position];
      if (!runtime) continue;

      runtime.cell.style.left = `${rect.x}px`;
      runtime.cell.style.top = `${rect.y}px`;
      runtime.cell.style.width = `${rect.width}px`;
      runtime.cell.style.height = `${rect.height}px`;

      const lines = this.linesFor(runtime.slot, rect.width);
      const placement = this.settings.multiView.slotChatPlacement;
      const metrics = stripMetrics(
        rect.width,
        rect.height,
        lines,
        placement,
        this.settings.chatFont.slotPx,
      );

      // 예약 배치는 영상 영역을 줄이고, 오버레이는 영상 크기를 그대로 둔다.
      runtime.frame.style.height =
        placement === 'reserve' ? `${metrics.videoAreaH}px` : `${rect.height}px`;

      runtime.strip.style.height = lines > 0 ? `${metrics.stripHeightPx}px` : '0px';
      runtime.strip.style.display = lines > 0 ? 'flex' : 'none';
      runtime.strip.className = `cm-slot-chat-strip cm-slot-chat-strip--${placement}`;
      runtime.strip.style.bottom = `${stripBottomOffset(rect, metrics.stripHeightPx, lines, barRect)}px`;

      /*
       * 사이드 채팅이 켜져 있으면 **활성 슬롯에만** 더 많은 줄을 요청한다. 스트립은 뒤쪽 N줄만
       * 쓰므로(`renderStrip`) 표시가 달라지지 않고, 비활성 슬롯의 부담도 늘지 않는다.
       */
      const isActive = runtime.slot === this.router.getActive();
      const requestLines = isActive && this.chatPanel ? Math.max(lines, SIDE_CHAT_LINES) : lines;
      this.post({
        channel: MV_CHANNEL,
        dir: 'p2s',
        kind: 'setChatLines',
        slot: runtime.slot,
        lines: requestLines,
      });
    }
  }

  private linesFor(slot: SlotIndex, slotWidth: number): number {
    const config = this.settings.multiView;
    const override = config.slots.find((s) => s.index === slot)?.chatLines;
    const requested =
      override ??
      (slot === this.router.getActive() ? config.slotChatLinesActive : config.slotChatLines);
    return resolveSlotChatLines(requested, slotWidth, this.device.deviceClass);
  }

  private createSlot(slot: MultiViewSlot): void {
    if (!this.container) return;

    const cell = document.createElement('div');
    cell.className = 'cm-slot';
    cell.dataset.slot = String(slot.index);

    const header = document.createElement('div');
    header.className = 'cm-slot__head';
    const title = document.createElement('span');
    title.textContent = `${slot.index} ${slot.channelName}`;
    header.appendChild(title);

    const audioButton = document.createElement('button');
    audioButton.type = 'button';
    audioButton.setAttribute('aria-label', `슬롯 ${slot.index} 소리 활성`);
    audioButton.textContent = '🔊';
    audioButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setActiveSlot(slot.index);
    });
    header.appendChild(audioButton);

    for (const [label, delta] of [
      ['줄 수 줄이기', -1],
      ['줄 수 늘리기', 1],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', `슬롯 ${slot.index} 채팅 ${label}`);
      button.textContent = delta < 0 ? '−' : '+';
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const current = this.settings.multiView.slots.find(
          (s) => s.index === slot.index,
        )?.chatLines;
        const base = current ?? this.settings.multiView.slotChatLines;
        this.callbacks.onChatLinesChange(Math.max(0, Math.min(5, base + delta)));
      });
      header.appendChild(button);
    }

    const frame = document.createElement('iframe');
    frame.src = slotFrameUrl(slot.channelId, slot.index);
    frame.title = `${slot.channelName} 슬롯 ${slot.index}`;
    frame.allow = 'autoplay; fullscreen';

    const strip = document.createElement('div');
    strip.className = 'cm-slot-chat-strip cm-slot-chat-strip--overlay';
    strip.setAttribute('aria-hidden', 'true');

    cell.append(frame, strip, header);
    // 슬롯 클릭 = 오디오·채팅 활성 전환
    cell.addEventListener('click', () => this.setActiveSlot(slot.index));
    this.container.appendChild(cell);

    const runtime: SlotRuntime = {
      slot: slot.index,
      channelId: slot.channelId,
      channelName: slot.channelName,
      cell,
      frame,
      strip,
      header,
      loaded: false,
      ready: false,
      failed: false,
    };
    this.runtimes.set(slot.index, runtime);

    frame.addEventListener('load', () => {
      runtime.loaded = true;
      this.router.register(slot.index, frame);
      // 등록으로 실효 활성 슬롯이 바뀔 수 있다 (희망 슬롯이 이번에야 등록된 경우).
      this.markActiveSlot();
      this.post({ channel: MV_CHANNEL, dir: 'p2s', kind: 'enterSlotMode', slot: slot.index });
      this.applyQuality(slot.index);
    });

    /**
     * 치지직이 이후 iframe 임베드를 차단하면(X-Frame-Options·CSP 추가) 이 경로가 무력화된다.
     * 그때는 멀티뷰만 degrade 하고 다른 기능은 계속 동작시킨다.
     */
    const timer = setTimeout(() => {
      // 성공 판정은 `ready` 로 한다 — `loaded` 는 오류 페이지에서도 참이 된다.
      if (runtime.ready) return;
      runtime.failed = true;
      const error = document.createElement('div');
      error.className = 'cm-slot__error';
      error.textContent = '이 슬롯을 불러올 수 없습니다. 치지직이 임베드를 차단했을 수 있습니다.';
      cell.appendChild(error);
      warning(
        `slot ${slot.index} did not report ready within ${FRAME_LOAD_TIMEOUT_MS}ms (loaded=${runtime.loaded})`,
      );
    }, FRAME_LOAD_TIMEOUT_MS);
    this.disposers.push(() => clearTimeout(timer));
  }

  private createBar(): void {
    if (!this.container) return;
    const bar = document.createElement('div');
    bar.className = 'cm-stage-bar';

    // 멀티뷰가 아직 불안정함을 스테이지에서도 알린다 (2026-08-16). 조작 요소가 아니다.
    const beta = document.createElement('span');
    beta.className = OURS.betaBadgeClass;
    beta.textContent = BETA_BADGE_TEXT;
    bar.appendChild(beta);

    const volumeLabel = document.createElement('output');
    volumeLabel.textContent = `${this.volumePercent}%`;

    for (const [label, delta] of [
      ['볼륨 줄이기', -1],
      ['볼륨 늘리기', 1],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', label);
      button.textContent = delta < 0 ? '−' : '+';
      button.addEventListener('click', () => {
        const step = this.settings.volume.step;
        this.volumePercent = Math.max(0, Math.min(100, this.volumePercent + delta * step));
        volumeLabel.textContent = `${this.volumePercent}%`;
        this.router.setVolume(this.volumePercent);
        this.callbacks.onVolumeChange(this.volumePercent);
      });
      bar.appendChild(button);
    }
    bar.appendChild(volumeLabel);

    const configButton = document.createElement('button');
    configButton.type = 'button';
    configButton.setAttribute('aria-label', '멀티뷰 구성 열기');
    configButton.textContent = '구성';
    configButton.addEventListener('click', () => this.callbacks.onRequestConfig());
    bar.appendChild(configButton);

    /**
     * 사이드 채팅 컨트롤 — `−`/`+`(폭 조절) · 토글.
     * BETA 사이드 채팅이 생기면서 **전체 화면 전용이 아니게** 됐다 (요청 2026-08-18).
     * 실제 노출 여부는 `updateChatControls()` 가 `chatMode` 로 결정한다.
     */
    const chatControls = document.createElement('span');
    chatControls.className = 'cm-stage-chat-controls';
    chatControls.style.display = 'none';

    const chatLabel = document.createElement('output');
    chatLabel.setAttribute('aria-live', 'polite');

    const narrow = document.createElement('button');
    narrow.type = 'button';
    narrow.setAttribute('aria-label', '채팅 영역 좁히기');
    narrow.textContent = '−';
    narrow.addEventListener('click', () => {
      this.chatSteps -= 1;
      this.syncChatWidth();
    });

    const widen = document.createElement('button');
    widen.type = 'button';
    widen.setAttribute('aria-label', '채팅 영역 넓히기');
    widen.textContent = '+';
    widen.addEventListener('click', () => {
      this.chatSteps += 1;
      this.syncChatWidth();
    });

    const chatOff = document.createElement('button');
    chatOff.type = 'button';
    chatOff.setAttribute('aria-label', '채팅 끄기');
    chatOff.textContent = '✕';
    chatOff.addEventListener('click', () => {
      /*
       * 🔴 토글이다. 예전에는 끄기만 있고 다시 켜는 경로가 **전체 화면 재진입** 뿐이어서,
       * 일반 멀티뷰에서 한 번 끄면 되돌릴 방법이 없었다 (요청 2026-08-18로 사이드 채팅이
       * 상시 기능이 되며 드러난 문제다).
       */
      this.chatOpen = !this.chatOpen;
      this.syncChatWidth();
    });

    chatControls.append(document.createTextNode('채팅'), narrow, chatLabel, widen, chatOff);
    bar.appendChild(chatControls);
    this.chatControls = chatControls;
    this.chatLabel = chatLabel;
    this.chatToggle = chatOff;

    /**
     * ⛶ 전체 화면 — 목업 화면 ③ 하단 바에 있는 버튼이다.
     *
     * 모바일(특히 Edge for Android 가로 모드)에서 **주소창이 화면을 크게 가리는데, 확장이
     * 브라우저 UI 를 직접 숨길 방법은 없다.** 전체 화면 API 가 유일한 수단이고 이 API 는
     * **사용자 제스처가 있어야** 허용되므로(회전 이벤트로는 자동 호출이 거부된다) 버튼으로 둔다.
     */
    const fullscreenButton = document.createElement('button');
    fullscreenButton.type = 'button';
    fullscreenButton.setAttribute('aria-label', '전체 화면 전환 (주소창 숨김)');
    fullscreenButton.textContent = '⛶';
    fullscreenButton.addEventListener('click', () => {
      void this.toggleFullscreen();
    });
    bar.appendChild(fullscreenButton);

    const exitButton = document.createElement('button');
    exitButton.type = 'button';
    exitButton.setAttribute('aria-label', '멀티뷰 해제');
    exitButton.textContent = '해제';
    exitButton.addEventListener('click', () => {
      const active = this.runtimes.get(this.router.getActive());
      this.callbacks.onExit(active?.channelId ?? null);
    });
    bar.appendChild(exitButton);

    this.container.appendChild(bar);
    this.bar = bar;
  }

  /**
   * 스테이지를 전체 화면으로 전환한다.
   * 실패해도 조용히 넘긴다 — 제스처 없이 호출되면 브라우저가 거부하는 것이 정상이다.
   */
  private async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      /**
       * 🔴 스테이지 컨테이너가 아니라 **문서 루트**를 올린다.
       * 전체 화면은 대상 요소의 서브트리만 렌더하므로, 스테이지만 올리면 그 밖에 있는
       * 기존 채팅 aside 가 아예 그려지지 않아 "전체 화면에서 채팅 표시"가 불가능해진다.
       */
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch (e) {
      warning('fullscreen request was rejected', e);
    }
  }

  /**
   * 소리가 나는 슬롯에 초록 아웃라인을 붙인다.
   *
   * 🔴 2026-08-16 실측 결함: 스테이지를 **열자마자는 어느 슬롯에도 아웃라인이 없었다**
   * (`probe-multiview-beta` 03-stage: 두 슬롯 모두 `cm-slot--active` 없음).
   * 클래스 토글이 `setActiveSlot()` 안에만 있어서 **사용자가 한 번 누르기 전까지**
   * "지금 어느 방송의 소리가 나는가"를 화면에서 알 수 없었다.
   *
   * 기준은 `router.getActive()` 다 — 저장된 활성 슬롯이 이번 구성에 없으면
   * `effectiveActiveSlot` 이 실제로 소리 내는 슬롯으로 대체하므로, 희망값을 쓰면
   * **소리는 1번에서 나는데 아웃라인은 3번에** 붙는 어긋남이 생긴다.
   * iframe 이 등록될 때마다 실효 활성 슬롯이 바뀔 수 있어 `load` 시점에도 다시 부른다.
   */
  private markActiveSlot(): void {
    const active = this.router.getActive();
    for (const runtime of this.runtimes.values()) {
      runtime.cell.classList.toggle('cm-slot--active', runtime.slot === active);
    }
  }

  setActiveSlot(slot: SlotIndex): void {
    this.router.setActive(slot);
    this.markActiveSlot();
    /*
     * 사이드 채팅은 활성 슬롯을 따라간다. 채널이 바뀌면 이전 채널의 줄이 섞이지 않게 비우고,
     * 새 활성 슬롯의 첫 배치가 오기를 기다린다(200ms 배치 — `slotFrame.ts`).
     */
    this.chatPanelList?.replaceChildren();
    this.updateChatPanelTitle();
    // 활성 슬롯의 줄 수가 다를 수 있으므로 (활성 5줄 / 비활성 2줄) 재계산한다.
    this.layout();
    for (const runtime of this.runtimes.values()) this.applyQuality(runtime.slot);
    this.callbacks.onActiveSlotChange(slot);
  }

  /** 비활성 슬롯 화질 하향 — 대역폭 보호. 기본 켜기이며 설정에서 끌 수 있다. */
  private applyQuality(slot: SlotIndex): void {
    const isActive = slot === this.router.getActive();
    const target =
      !isActive && this.settings.multiView.lowerInactiveQuality
        ? INACTIVE_SLOT_QUALITY
        : this.settings.quality.target === 'auto'
          ? '1080p'
          : this.settings.quality.target;
    this.post({ channel: MV_CHANNEL, dir: 'p2s', kind: 'setQuality', slot, target });
  }

  private bindMessages(): void {
    const onMessage = (event: MessageEvent) => {
      const message = parseMvMessage(event.data, event.origin, 's2p') as SlotToParent | null;
      if (!message) return;
      const runtime = this.runtimes.get(message.slot);
      if (!runtime) return;

      if (message.kind === 'chat') {
        this.renderStrip(runtime, message.messages);
        this.renderChatPanel(runtime, message.messages);
        return;
      }
      /**
       * 🔴 슬롯 컨트롤러는 iframe `load` 보다 **늦게** 기동한다 (실측 2026-08-15:
       * `multiview stage opened` 로그가 `slot controller started` 보다 먼저 찍힌다).
       * `load` 시점에 보낸 `setAudio`·`enterSlotMode` 는 아직 리스너가 없어 그대로 유실되고,
       * 그 결과 **활성 슬롯까지 음소거로 남아 아무 소리도 나지 않았다.**
       * 준비 신호를 받은 지금 지시문을 다시 보낸다 (모두 멱등하다).
       */
      if (message.kind === 'ready') {
        info(`slot ${message.slot} controller is ready; re-sending slot directives`);
        runtime.ready = true;
        this.post({ channel: MV_CHANNEL, dir: 'p2s', kind: 'enterSlotMode', slot: message.slot });
        this.router.register(message.slot, runtime.frame);
        this.markActiveSlot();
        this.applyQuality(message.slot);
        // 채팅 줄 수(`setChatLines`)도 여기서 다시 나간다.
        this.layout();
        return;
      }
      /**
       * 슬롯 안에서 오디오 단축키를 눌렀다 (포커스가 iframe 으로 넘어가면 부모 keydown 이
       * 죽으므로 프레임이 넘겨 준다 — 실측 2026-08-18). **단축키 사용 여부 판정은 여기서** 한다.
       */
      if (message.kind === 'audioShortcut') {
        if (this.device.profile.shortcuts === 'off') return;
        if (this.router.getActive() === message.slot) return;
        info(`slot ${message.slot} activated by audio shortcut forwarded from a slot frame`);
        this.setActiveSlot(message.slot);
        return;
      }
      /** 사용자가 이 슬롯의 음소거를 직접 풀었다 → 의도대로 활성 슬롯을 옮긴다. */
      if (message.kind === 'requestAudio') {
        if (this.router.getActive() === message.slot) return;
        info(`slot ${message.slot} requested audio focus (unmuted by the user)`);
        this.setActiveSlot(message.slot);
        return;
      }
      if (message.kind === 'state') {
        if (!message.online) {
          runtime.header.dataset.offline = 'true';
        } else {
          delete runtime.header.dataset.offline;
        }
        return;
      }
      if (message.kind === 'error') {
        warning(`slot ${message.slot} reported an error: ${message.reason}`);
        // 고장난 슬롯이 오디오를 쥐고 있으면 아무 소리도 안 난다 → 라우팅에서 빼 다른 슬롯으로 넘긴다.
        this.router.unregister(message.slot);
      }
    };
    window.addEventListener('message', onMessage);
    this.disposers.push(() => window.removeEventListener('message', onMessage));
  }

  /**
   * 스트립 렌더 — 한 메시지는 **1줄로 제한**하고 넘치면 말줄임한다.
   * 줄바꿈으로 높이가 늘어나면 "N줄" 계약이 깨진다. 최신이 맨 아래이고 넘치는 줄은 버린다.
   */
  /**
   * 사이드 채팅 패널(BETA) — **활성 슬롯 채널의 채팅**을 흘린다 (요청 2026-08-18).
   *
   * 치지직 원본 aside 를 쓰지 않는다: 그것은 **호스트 채널** 채팅이라 활성 슬롯과 다른 방송의
   * 채팅이 보인다(전체 화면 경로에서 실제로 그랬다). 데이터는 이미 있는 슬롯 → 부모 `chat`
   * 메시지를 그대로 쓴다 — 새 프로토콜도, 추가 폴링도 없다.
   */
  private ensureChatPanel(): void {
    if (!this.container) return;
    const width = this.currentChatWidth();

    if (width <= 0) {
      this.chatPanel?.remove();
      this.chatPanel = null;
      this.chatPanelTitle = null;
      this.chatPanelList = null;
      return;
    }

    if (!this.chatPanel) {
      const panel = document.createElement('aside');
      panel.className = 'cm-stage-chat';
      panel.setAttribute('aria-label', '멀티뷰 사이드 채팅');

      const head = document.createElement('div');
      head.className = 'cm-stage-chat__head';
      const title = document.createElement('span');
      title.className = 'cm-stage-chat__title';
      head.appendChild(title);
      // BETA 뱃지 — 멀티뷰 3지점과 같은 클래스·문구를 쓴다 (요청 2026-08-18).
      const badge = document.createElement('span');
      badge.className = OURS.betaBadgeClass;
      badge.textContent = BETA_BADGE_TEXT;
      head.appendChild(badge);

      const list = document.createElement('div');
      list.className = 'cm-stage-chat__list';

      panel.append(head, list);
      this.container.appendChild(panel);
      this.chatPanel = panel;
      this.chatPanelTitle = title;
      this.chatPanelList = list;
    }

    this.chatPanel.style.width = `${width}px`;
    this.updateChatPanelTitle();
  }

  private updateChatPanelTitle(): void {
    if (!this.chatPanelTitle) return;
    const active = this.router.getActive();
    const runtime = active === null ? undefined : this.runtimes.get(active);
    this.chatPanelTitle.textContent = runtime ? `${runtime.slot} ${runtime.channelName}` : '채팅';
  }

  /** 활성 슬롯의 채팅만 패널에 넣는다. 비활성 슬롯 메시지는 스트립에서만 쓴다. */
  private renderChatPanel(
    runtime: SlotRuntime,
    messages: { nickname: string; text: string; color: string | null }[],
  ): void {
    if (!this.chatPanelList) return;
    if (this.router.getActive() !== runtime.slot) return;

    const nodes = messages.slice(-SIDE_CHAT_LINES).map((message) => {
      const line = document.createElement('div');
      line.className = 'cm-stage-chat__line';
      const nickname = document.createElement('b');
      nickname.textContent = message.nickname;
      if (message.color) nickname.style.color = message.color;
      line.append(nickname, document.createTextNode(message.text));
      return line;
    });
    this.chatPanelList.replaceChildren(...nodes);
    // 최신 메시지가 아래에 쌓이므로 항상 끝으로 붙여 둔다.
    this.chatPanelList.scrollTop = this.chatPanelList.scrollHeight;
  }

  private renderStrip(
    runtime: SlotRuntime,
    messages: { nickname: string; text: string; color: string | null }[],
  ): void {
    const rect = runtime.cell.getBoundingClientRect();
    const lines = this.linesFor(runtime.slot, rect.width);
    if (lines <= 0) {
      runtime.strip.replaceChildren();
      return;
    }
    const visible = messages.slice(-lines);
    const nodes = visible.map((message) => {
      const line = document.createElement('div');
      line.className = 'cm-slot-chat-line';
      const nickname = document.createElement('b');
      nickname.textContent = message.nickname;
      if (message.color) nickname.style.color = message.color;
      line.append(nickname, document.createTextNode(message.text));
      return line;
    });
    runtime.strip.replaceChildren(...nodes);
    runtime.strip.style.height = `${stripHeight(lines, this.settings.chatFont.slotPx)}px`;
  }

  private bindShortcuts(): void {
    if (this.device.profile.shortcuts === 'off') return;
    const onKeyDown = (event: KeyboardEvent) => {
      const slot = slotFromAudioShortcut(event);
      if (slot === null) return;
      if (!this.runtimes.has(slot)) return;
      event.preventDefault();
      this.setActiveSlot(slot);
    };
    window.addEventListener('keydown', onKeyDown);
    this.disposers.push(() => window.removeEventListener('keydown', onKeyDown));
  }

  private post(message: ParentToSlot): void {
    const frame = this.runtimes.get(message.slot)?.frame;
    frame?.contentWindow?.postMessage(message, 'https://chzzk.naver.com');
  }
}
