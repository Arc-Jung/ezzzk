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

import { averageVolumeTarget, AUTO_VOLUME_TARGET } from './autoVolume';
import { OURS } from '../../constants/class';
import type { MultiViewSlot, Settings, SlotIndex, SlotLines } from '../../constants/storage';
import type { DeviceDecision } from '../../device';
import { upsertStyle, removeStyle } from '../../utils/dom';
import { info, warning } from '../../utils/log';
import { effectiveChatMode, effectiveSlotChatLines } from './chatFeature';
import { slotFromAudioShortcut } from './messages';
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

import { buildStageCss } from './stageCss';
import { readStageViewport } from './stageViewport';
import { createStageToolbar } from './stageToolbar';
import {
  barOverlapsSlots,
  sideChatWidthPx,
  stripBottomOffset,
  effectiveActiveSlot,
  nextActiveSlot,
} from './stageLayout';

const STAGE_STYLE_ID = 'cm-multiview-stage-style';
/** 슬롯 컨트롤러가 이 시간 안에 `ready` 를 보내지 않으면 재시도(또는 최종 실패)로 넘어간다. */
const FRAME_LOAD_TIMEOUT_MS = 15_000;
/**
 * 🔴 사용자 보고 (2026-08-23): "멀티뷰를 설정할 때 가끔 4개 중 1~2개 방송이 요청이 실패한다."
 * 타임아웃마다 곧장 에러로 확정하지 않고, 프레임을 다시 로드해 몇 차례 더 기회를 준다 —
 * 방송 시작 직후처럼 치지직 쪽이 일시적으로 느린 경우가 실제로 있었다(실측 없이 영구 실패로
 * 단정하지 않는다는 이 저장소 원칙).
 */
const MAX_SLOT_LOAD_RETRIES = 2;
/** 재시도 간격을 점점 늘린다 — 연속 재로드로 같은 요청을 몰아붙이지 않는다. */
const SLOT_RETRY_BACKOFF_MS = [2_000, 4_000];
/**
 * 슬롯 프레임 로드를 시작하는 간격.
 *
 * 🔴 사용자 보고 (2026-08-24): "멀티뷰에 들어갈 때 4개 요청을 한 번에 보내서 문제가 생기는 것 같다."
 * 예전에는 `open()` 이 루프를 돌며 4개 `iframe` 의 `src` 를 **같은 틱에** 대입해, 치지직 페이지
 * 4벌(문서·번들·플레이어 매니페스트·채팅 소켓)이 동시에 출발했다. 슬롯당 첫 로드 실패
 * (2026-08-23 의 재시도 로직이 생긴 원인)는 이 동시 출발과 겹칠 가능성이 있다(미검증 — 상관은
 * 관찰됐지만 인과는 실측으로 확정하지 않았다).
 *
 * 첫 슬롯은 즉시, 이후 슬롯은 인덱스마다 이만큼 미뤄 출발시킨다. 4슬롯 기준 마지막 슬롯이
 * 300ms 늦게 시작할 뿐이라 체감 지연은 없고, 로드 타임아웃(`FRAME_LOAD_TIMEOUT_MS`)은
 * **`src` 를 대입한 시점부터** 재므로 뒤쪽 슬롯이 대기 시간을 손해 보지도 않는다.
 */
const SLOT_LOAD_STAGGER_MS = 100;

/** 사용자 제스처 중계(`relayUserGesture`) 최소 간격. 연타·드래그를 슬롯 수만큼 곱하지 않는다. */
const GESTURE_RELAY_THROTTLE_MS = 500;

/** 중계 대상 입력. `userIntent.ts` 의 추적기와 같은 목록이다 (터치·마우스·키 전부). */
const GESTURE_RELAY_EVENTS = ['pointerdown', 'touchstart', 'keydown'] as const;
/**
 * 슬롯이 이 시간 이상 "재생 중 아님"으로 보고하면 안내를 띄운다.
 * 방송 시작 직후·광고 구간에도 잠깐 꺼져 보이므로 짧게 잡으면 정상 슬롯이 깜빡인다.
 */
const SLOT_OFFLINE_NOTICE_MS = 10_000;

/** 초점(활성) 슬롯 표시 클래스. `updateFocusMarks()` 가 토글한다(시각 강조는 없음, aria-pressed 용). */
export const FOCUSED_SLOT_CLASS = 'cm-slot--focused';

/**
 * 사이드 채팅을 켰을 때 무대에 남아야 하는 최소 폭.
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
  onAutoVolumeChange?: (enabled: boolean) => void;
  onRequestConfig: () => void;
  onExit: (activeChannelId: string | null) => void;
  onActiveSlotChange: (slot: SlotIndex) => void;
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
  /** 지금까지 재시도한 횟수. `MAX_SLOT_LOAD_RETRIES` 에 닿으면 더 시도하지 않고 최종 에러로 넘어간다. */
  retryCount: number;
  /**
   * 슬롯이 "재생 중이 아니다"(`state.online === false`)라고 처음 보고한 시각.
   * 재생이 시작되면 `null` 로 되돌린다 — 안내를 띄울지 판단하는 유일한 근거다.
   */
  offlineSince: number | null;
  autoVolumeState?: 'off' | 'waiting' | 'active' | 'unavailable';
  autoVolumeRms?: number | null;
};

export class MultiViewStage {
  private container: HTMLElement | null = null;
  private toolbar: ReturnType<typeof createStageToolbar> | null = null;
  private autoVolumeTarget = AUTO_VOLUME_TARGET;
  /** 사이드 채팅 표시 여부. `채팅 끄기` 로 접고 다시 켤 수 있다. */
  private chatOpen = true;
  /** 사이드 채팅 패널. `chatMode: 'none'` 이거나 폭이 부족하면 만들지 않는다. */
  private chatPanel: HTMLElement | null = null;
  private chatPanelTitle: HTMLElement | null = null;
  private chatPanelList: HTMLElement | null = null;
  /** `−`/`+` 가 누적한 폭 조절 칸 수. */
  private chatSteps = 0;
  private runtimes = new Map<SlotIndex, SlotRuntime>();
  /** 재시도 후 로드 타임아웃을 다시 거는 함수. 슬롯마다 최신 타이머 클로저를 가리킨다. */
  private slotRetryRearm = new Map<SlotIndex, () => void>();
  /** 초점 슬롯(오디오 아님) 계산용 상태 — 등록 여부와 무관하게 희망 슬롯을 기억한다. */
  private focusDesired: SlotIndex = 1;
  private focusRegistered = new Set<SlotIndex>();
  private disposers: (() => void)[] = [];
  /** 마지막으로 슬롯에 제스처를 중계한 시각. 스로틀용 (`relayUserGesture`). */
  private lastGestureRelayAt = 0;

  constructor(
    private settings: Settings,
    private device: DeviceDecision,
    private callbacks: StageCallbacks,
  ) {}

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

    // 프레임 로드는 순서대로 100ms 씩 벌려 출발시킨다 (`SLOT_LOAD_STAGGER_MS`).
    slots.forEach((slot, order) => this.createSlot(slot, order));
    // 슬롯이 다 붙은 뒤 초점 표시를 한 번 찍는다 — 프레임 `load` 를 기다리면 그때까지 표시가 없다.
    this.updateFocusMarks();
    this.createBar();
    this.bindMessages();
    this.bindShortcuts();
    this.bindUserGestureRelay();

    /**
     * 전체 화면 진입·이탈마다 채팅 폭을 다시 계산한다.
     * 진입 시 `chatOpen` 을 되살리는 이유: ✕ 로 끈 뒤 전체 화면을 나갔다 들어오면
     * 되돌릴 UI 가 없어 채팅을 다시 켤 방법이 사라진다.
     */
    const onFullscreenChange = () => {
      this.updateFullscreenButton();
      if (this.isFullscreen()) this.chatOpen = true;
      this.syncChatWidth();
    };
    // 플레이어가 대상 요소에서 전파를 막아도 실제 전체화면 상태를 먼저 읽는다.
    document.addEventListener('fullscreenchange', onFullscreenChange, true);
    this.disposers.push(() =>
      document.removeEventListener('fullscreenchange', onFullscreenChange, true),
    );

    this.focusDesired = this.settings.multiView.activeSlot;
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
    this.slotRetryRearm.clear();
    this.container?.remove();
    this.container = null;
    this.toolbar = null;
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
    const autoVolumeChanged = next.multiView.autoVolume !== this.settings.multiView.autoVolume;
    this.settings = next;
    if (autoVolumeChanged) this.syncAutoVolume();
    this.layout();
    for (const runtime of this.runtimes.values()) this.applyQuality(runtime.slot);
  }

  /** 접힘·펼침 때 iframe과 재생 상태를 유지한 채 프로필·배치만 갱신한다. */
  updateDevice(next: DeviceDecision): void {
    this.device = next;
    upsertStyle(
      STAGE_STYLE_ID,
      buildStageCss(next.profile.touchTargetPx, !next.profile.allowHover),
    );
    this.syncChatWidth();
  }

  /**
   * 무대 크기. **화면 전체를 쓴다.**
   * 멀티뷰 중에는 기존 우측 채팅을 비활성화하므로(2026-08-12 결정) 폭을 뺄 이유가 없다.
   * 슬롯 채팅은 슬롯마다 붙는 스트립(FR-14.2)이 담당한다.
   */
  private stageSize() {
    const { width, height, zoom, compact } = readStageViewport();
    const chatWidth = this.currentChatWidth();
    return {
      width: Math.max(0, width - chatWidth),
      height,
      orientation: (width >= height ? 'landscape' : 'portrait') as Orientation,
      zoom,
      compact,
    };
  }

  /**
   * 사이드 채팅 패널 폭 (요청 2026-08-18).
   *
   * 🔴 **효율을 인정하고 자동으로 접는다.** 채팅을 켜면 슬롯이 그만큼 좁아진다. 남는 무대 폭이
   * `MIN_STAGE_WIDTH_PX` 미만이면 0 을 돌려줘 아예 켜지지 않게 한다 — 모바일·분할 화면·세로에서
   * 슬롯이 읽을 수 없을 만큼 작아지는 것을 막는다(FR-14 기기 상한과 같은 취지).
   * 폭 계산은 `sideChatWidthPx` (뷰포트 비율 기반) 가 한다.
   */
  private currentChatWidth(): number {
    // 멀티뷰 채팅 임시 비활성화 중에는 저장값과 무관하게 폭 0 이다 (`chatFeature.ts`).
    if (!this.chatOpen || effectiveChatMode(this.settings.multiView.chatMode) === 'none') return 0;
    if (!this.sideChatFits()) return 0;
    const { width, height } = readStageViewport();
    return sideChatWidthPx(width, height, this.chatSteps);
  }

  /**
   * 이 화면에 사이드 채팅이 들어갈 수 있는가. `chatOpen`(사용자 토글)과 무관하다 —
   * 껐다 켜는 컨트롤을 보여 줘야 하는지 판단하는 데도 쓴다.
   */
  private sideChatFits(): boolean {
    const { width, height } = readStageViewport();
    const chat = sideChatWidthPx(width, height, this.chatSteps);
    return chat > 0 && width - chat >= MIN_STAGE_WIDTH_PX;
  }

  private isFullscreen(): boolean {
    return Boolean(document.fullscreenElement);
  }

  private updateFullscreenButton(): void {
    this.toolbar?.setFullscreen(this.isFullscreen());
  }

  private syncAutoVolume(): void {
    for (const slot of this.runtimes.keys()) {
      this.post({
        channel: MV_CHANNEL,
        dir: 'p2s',
        kind: 'setAutoVolume',
        slot,
        enabled: this.settings.multiView.autoVolume,
        targetRms: this.autoVolumeTarget,
      });
    }
    this.updateAutoVolumeButton();
  }

  private updateAutoVolumeButton(): void {
    if (!this.toolbar) return;
    const enabled = this.settings.multiView.autoVolume;
    const active = [...this.runtimes.values()].filter(
      (runtime) => runtime.autoVolumeState === 'active',
    ).length;
    const unavailable = [...this.runtimes.values()].some(
      (runtime) => runtime.autoVolumeState === 'unavailable',
    );
    const status = unavailable
      ? '일부 방송 측정 불가'
      : `${active}/${this.runtimes.size}개 방송 조정 중`;
    this.toolbar.setAutoVolume(enabled, status);
  }

  /** 채팅 폭을 다시 계산해 적용하고 무대를 재배치한다. */
  private syncChatWidth(): void {
    this.callbacks.onChatWidthChange(this.currentChatWidth());
    this.updateChatControls();
    this.layout();
  }

  /**
   * 채팅 폭 컨트롤은 **항상** 보여 준다 (사이드 채팅, 요청 2026-08-18).
   * 예전에는 전체 화면에서만 보였는데, 일반 멀티뷰에서 채팅을 켤 방법이 없었다.
   * `chatMode: 'none'` 이면 기능 자체를 끈 것이므로 컨트롤도 감춘다.
   */
  private updateChatControls(): void {
    if (!this.toolbar) return;
    const enabled =
      effectiveChatMode(this.settings.multiView.chatMode) !== 'none' && this.sideChatFits();
    this.toolbar.setSideChat(enabled, this.chatOpen, this.currentChatWidth());
  }

  /**
   * 슬롯 위치·크기와 스트립 높이를 다시 계산해 적용한다.
   * 캐시하지 않는다 — 회전·분할 화면·자유 창·주소창 접힘마다 호출된다 (FR-12.1).
   */
  layout(): void {
    if (!this.container) return;
    const { width, height, orientation, zoom, compact } = this.stageSize();
    this.container.style.zoom = zoom === 1 ? '' : String(zoom);
    this.container.style.width = `${width}px`;
    this.container.style.height = zoom === 1 ? '' : `${height}px`;
    this.container.dataset['compact'] = String(compact);
    const split = Math.max(2, this.runtimes.size) as 2 | 3 | 4;
    /**
     * 🔴 예전에는 바가 차지하는 띠를 배치에서 통째로 떼어 냈다(`stageTopInset`) — 바 높이만큼
     * 슬롯이 작아졌다. 지금은 **띠를 떼지 않고 슬롯이 무대 전체를 쓴다** (요청 2026-09-07:
     * 오버레이 형태로).
     *
     * 세로 자세는 슬롯을 가운데에 모으므로 위쪽에 검은 여백이 남는다 — 바는 대개 그 여백에
     * 들어가 **영상을 하나도 가리지 않는다**. 여백이 모자랄 때만 영상 위로 올라가고, 그때는
     * `data-overlay` 가 서서 반투명해진다.
     */
    const bar = this.toolbar?.element.getBoundingClientRect();
    const barRect = bar
      ? {
          left: bar.left / zoom,
          right: bar.right / zoom,
          top: bar.top / zoom,
          bottom: bar.bottom / zoom,
          height: bar.height / zoom,
        }
      : null;
    const rects = computeSlotRects(
      split,
      width,
      height,
      orientation,
      SLOT_GAP,
      0,
      this.settings.multiView.layout,
    );

    /*
     * 🔴 2026-08-16 회귀 재발 방지 — 바가 슬롯 헤더 버튼을 덮으면 버튼이 눌리지 않는다.
     * 겹칠 때는 헤더를 바 아래로 밀어 내려 클릭 경로를 비워 둔다 (아래 CSS
     * `.cm-slot[data-under-bar='true'] .cm-slot__head`).
     */
    const overlaps = barOverlapsSlots(barRect, rects[0]?.y ?? null);
    if (this.toolbar) this.toolbar.element.dataset['overlay'] = String(overlaps);
    const barOverlapHeight = overlaps && barRect ? Math.ceil(barRect.top + barRect.height) : 0;

    /**
     * 컨테이너 폭을 무대 폭과 일치시킨다. 사이드 채팅을 켜면 그 폭만큼 비워 두어야
     * 기존 채팅 aside 가 실제로 보인다 (위 CSS 주석의 실측 버그).
     */
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
      /*
       * 바가 이 슬롯을 덮는가. 덮으면 헤더를 바 아래로 밀어 헤더 버튼의 클릭 경로를
       * 비워 둔다 (2026-08-16 회귀 방지). CSS 변수로 넘겨 슬롯마다 다른 값을 쓰지 않는다 —
       * 바는 무대 최상단에 하나뿐이라 덮는 높이도 하나다.
       */
      const coveredByBar = barOverlapHeight > rect.y;
      runtime.cell.dataset['underBar'] = coveredByBar ? 'true' : 'false';
      if (coveredByBar) {
        runtime.cell.style.setProperty(
          '--cm-bar-overlap',
          `${Math.max(0, barOverlapHeight - rect.y)}px`,
        );
      } else {
        runtime.cell.style.removeProperty('--cm-bar-overlap');
      }
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
      const isActive = runtime.slot === this.getFocusedSlot();
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
    const requested = effectiveSlotChatLines(
      override ??
        (slot === this.getFocusedSlot() ? config.slotChatLinesActive : config.slotChatLines),
    );
    return resolveSlotChatLines(requested as SlotLines, slotWidth, this.device.deviceClass);
  }

  /**
   * @param order 무대에서의 순서(0부터). 프레임 로드 출발 시각을 `order * SLOT_LOAD_STAGGER_MS`
   *   만큼 미룬다 — 4개를 한 틱에 몰아 보내지 않는다. 0 이면 즉시 출발한다.
   */
  private createSlot(slot: MultiViewSlot, order = 0): void {
    if (!this.container) return;

    const cell = document.createElement('div');
    cell.className = 'cm-slot';
    cell.dataset.slot = String(slot.index);

    const header = document.createElement('div');
    header.className = 'cm-slot__head';
    const title = document.createElement('span');
    title.textContent = `${slot.index} ${slot.channelName}`;
    header.appendChild(title);

    // `src` 는 아래에서 순서에 맞춰 대입한다 — 여기서 넣으면 4개가 같은 틱에 출발한다.
    const frame = document.createElement('iframe');
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
      retryCount: 0,
      offlineSince: null,
    };
    this.runtimes.set(slot.index, runtime);

    frame.addEventListener('load', () => {
      /**
       * `src` 를 대입하기 전의 `load` 는 브라우저가 프레임을 붙일 때 커밋하는 `about:blank` 다
       * (stagger 로 출발이 늦어진 슬롯에서 실제로 먼저 온다). 이걸 로드 성공으로 세면 아직
       * 아무것도 요청하지 않은 슬롯이 초점에 등록되고 `about:blank` 로 지시가 나간다.
       */
      if (!frame.src) return;
      runtime.loaded = true;
      this.registerFocus(slot.index);
      this.post({ channel: MV_CHANNEL, dir: 'p2s', kind: 'enterSlotMode', slot: slot.index });
      this.applyQuality(slot.index);
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const armLoadTimeout = () => {
      timer = setTimeout(
        () => this.handleSlotLoadTimeout(runtime, cell, slot),
        FRAME_LOAD_TIMEOUT_MS,
      );
    };
    // 재시도가 새 타이머를 다시 걸므로, 정리 시점의 최신 타이머를 읽도록 함수로 감싼다.
    this.disposers.push(() => clearTimeout(timer));
    this.slotRetryRearm.set(slot.index, armLoadTimeout);

    /**
     * 🔴 로드 타임아웃은 **`src` 대입과 같은 시점에** 건다. 프레임을 만들 때 미리 걸어 두면
     * 뒤쪽 슬롯은 대기 시간(`FRAME_LOAD_TIMEOUT_MS`)에서 stagger 만큼을 그냥 잃는다.
     */
    const startLoad = () => {
      frame.src = slotFrameUrl(slot.channelId, slot.index);
      armLoadTimeout();
    };
    const delay = order * SLOT_LOAD_STAGGER_MS;
    if (delay <= 0) {
      startLoad();
    } else {
      const startTimer = setTimeout(startLoad, delay);
      // 출발 전에 스테이지가 닫히면 요청 자체를 내지 않는다.
      this.disposers.push(() => clearTimeout(startTimer));
    }
  }

  /**
   * 치지직이 이후 iframe 임베드를 차단하면(X-Frame-Options·CSP 추가) 이 경로가 무력화된다.
   * 그때는 멀티뷰만 degrade 하고 다른 기능은 계속 동작시킨다.
   *
   * 🔴 사용자 보고 (2026-08-23): "멀티뷰를 설정할 때 가끔 4개 중 1~2개 방송이 요청이 실패한다."
   * 타임아웃 = 곧장 실패가 아니라 `MAX_SLOT_LOAD_RETRIES` 만큼 프레임을 다시 로드해 본다.
   */
  private handleSlotLoadTimeout(
    runtime: SlotRuntime,
    cell: HTMLElement,
    slot: MultiViewSlot,
  ): void {
    // 성공 판정은 `ready` 로 한다 — `loaded` 는 오류 페이지에서도 참이 된다.
    if (runtime.ready) return;

    if (runtime.retryCount < MAX_SLOT_LOAD_RETRIES) {
      runtime.retryCount += 1;
      const backoff =
        SLOT_RETRY_BACKOFF_MS[runtime.retryCount - 1] ?? SLOT_RETRY_BACKOFF_MS.at(-1)!;
      warning(
        `slot ${slot.index} did not report ready within ${FRAME_LOAD_TIMEOUT_MS}ms — retrying ` +
          `(${runtime.retryCount}/${MAX_SLOT_LOAD_RETRIES})`,
      );
      this.showSlotRetryStatus(cell, runtime.retryCount);
      const rearm = this.slotRetryRearm.get(slot.index);
      const retryTimer = setTimeout(() => {
        runtime.loaded = false;
        runtime.frame.src = slotFrameUrl(slot.channelId, slot.index);
        rearm?.();
      }, backoff);
      this.disposers.push(() => clearTimeout(retryTimer));
      return;
    }

    runtime.failed = true;
    const error = document.createElement('div');
    error.className = 'cm-slot__error';
    error.textContent = '방송을 불러올 수 없습니다. 새로고침해 주세요.';
    cell.appendChild(error);
    warning(
      `slot ${slot.index} gave up after ${MAX_SLOT_LOAD_RETRIES} retries (loaded=${runtime.loaded})`,
    );
  }

  /**
   * 로드는 됐는데 **재생이 시작되지 않는** 슬롯 안내.
   *
   * 광고가 보이는 시간은 제외한다. 방송 종료, 성인 인증·로그인, 지역 제한은 모두
   * 같은 신호(`pzp-pc--onlive` 없음)로 오기 때문이다(실측 2026-08-24: 비로그인 프로필에서
   * 라이브 목록에 뜬 채널 하나가 프레임 안에서 플레이어를 아예 만들지 않았다).
   */
  private showSlotOfflineNotice(runtime: SlotRuntime): void {
    if (runtime.failed) return;
    if (runtime.cell.querySelector('.cm-slot__notice')) return;
    const notice = document.createElement('div');
    notice.className = 'cm-slot__notice';
    notice.textContent = '재생이 시작되지 않았습니다. 방송 페이지에서 상태를 확인해 주세요.';
    runtime.cell.appendChild(notice);
    warning(`slot ${runtime.slot} has been ready but not playing for ${SLOT_OFFLINE_NOTICE_MS}ms`);
  }

  private showSlotAdNotice(runtime: SlotRuntime): void {
    if (runtime.failed || runtime.cell.querySelector('.cm-slot__ad-notice')) return;
    const notice = document.createElement('div');
    notice.className = 'cm-slot__ad-notice';
    notice.setAttribute('role', 'status');
    const badge = document.createElement('strong');
    badge.textContent = '광고';
    notice.append(badge, document.createTextNode(' 재생 중'));
    runtime.cell.appendChild(notice);
  }

  /** 재시도 중임을 알리는 일시 상태. 다음 로드가 붙거나 최종 실패로 넘어가면 스스로 사라진다. */
  private showSlotRetryStatus(cell: HTMLElement, attempt: number): void {
    cell.querySelector('.cm-slot__retry')?.remove();
    const status = document.createElement('div');
    status.className = 'cm-slot__retry';
    status.textContent = `불러오는 데 실패했습니다. 다시 시도하는 중… (${attempt}/${MAX_SLOT_LOAD_RETRIES})`;
    cell.appendChild(status);
  }

  private createBar(): void {
    if (!this.container) return;
    const toolbar = createStageToolbar({
      configure: () => this.callbacks.onRequestConfig(),
      settings: () => window.dispatchEvent(new Event(OURS.openSettingsEventName)),
      autoVolume: () => {
        const enabled = !this.settings.multiView.autoVolume;
        this.settings = {
          ...this.settings,
          multiView: { ...this.settings.multiView, autoVolume: enabled },
        };
        this.syncAutoVolume();
        this.callbacks.onAutoVolumeChange?.(enabled);
      },
      // Reload the host as well as the slots. The saved layout is restored on load.
      reload: () => location.reload(),
      resizeChat: (steps) => {
        this.chatSteps += steps;
        this.syncChatWidth();
      },
      toggleChat: () => {
        this.chatOpen = !this.chatOpen;
        this.syncChatWidth();
      },
      fullscreen: () => void this.toggleFullscreen(),
      exit: () => {
        const active = this.runtimes.get(this.getFocusedSlot());
        this.callbacks.onExit(active?.channelId ?? null);
      },
    });
    this.container.appendChild(toolbar.element);
    this.toolbar = toolbar;
    this.updateFullscreenButton();
    this.updateAutoVolumeButton();

    // The chat overlay feature can insert its button after the stage has opened.
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.layout());
      observer.observe(toolbar.element);
      this.disposers.push(() => observer.disconnect());
    }
  }

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
    } finally {
      this.updateFullscreenButton();
    }
  }

  /**
   * 초점 슬롯(오디오 아님) — 사이드 채팅 대상·화질 우선순위·나가기 버튼 채널에 쓴다.
   * 등록된 프레임이 없으면 희망 슬롯을 그대로 돌려준다.
   *
   * ⚠️ 2026-08-20 정책 변경: 오디오는 더 이상 이 값을 따르지 않는다 — 모든 슬롯이 항상
   * 소리를 낸다. 초록 아웃라인 표시도 의미가 없어져 제거했다.
   */
  private getFocusedSlot(): SlotIndex {
    return effectiveActiveSlot([...this.focusRegistered], this.focusDesired) ?? this.focusDesired;
  }

  /** 슬롯 프레임이 떴다. 희망 슬롯이 이번에야 등록됐으면 실효 초점이 바뀔 수 있다. */
  private registerFocus(slot: SlotIndex): void {
    this.focusRegistered.add(slot);
    this.updateFocusMarks();
  }

  /** 고장난 슬롯을 초점 후보에서 뺀다 — 초점이 남은 슬롯으로 넘어갈 수 있다. */
  private unregisterFocus(slot: SlotIndex): void {
    this.focusRegistered.delete(slot);
    this.focusDesired = nextActiveSlot([...this.focusRegistered], this.focusDesired);
    this.updateFocusMarks();
  }

  /**
   * 초점 슬롯을 **화면에 드러낸다** (2026-08-22 수정).
   *
   * 초점은 사이드 채팅 대상·화질 우선순위를 실제로 바꾸는 상태다. 헤더의 전용 `초점` 버튼은
   * 채팅이 임시 비활성화된 뒤로 쓸모가 없어져 제거했다(2026-08-23) — 슬롯을 직접 클릭해도
   * 같은 경로(`setActiveSlot`)로 초점이 옮겨간다.
   *
   * ⚠️ 이 표시는 "소리 나는 슬롯"이 아니다 (2026-08-20 정책: 오디오는 모든 슬롯이 낸다).
   */
  private updateFocusMarks(): void {
    const focused = this.getFocusedSlot();
    for (const runtime of this.runtimes.values()) {
      runtime.cell.classList.toggle(FOCUSED_SLOT_CLASS, runtime.slot === focused);
    }
  }

  setActiveSlot(slot: SlotIndex): void {
    this.focusDesired = slot;
    // 초점이 어디로 갔는지 즉시 보이게 한다 — 표시가 없으면 버튼이 먹통으로 보인다.
    this.updateFocusMarks();
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
    const isActive = slot === this.getFocusedSlot();
    const isDowngrade = !isActive && this.settings.multiView.lowerInactiveQuality;
    const target = isDowngrade
      ? INACTIVE_SLOT_QUALITY
      : this.settings.quality.target === 'auto'
        ? '1080p'
        : this.settings.quality.target;
    // 🔴 활성 슬롯은 목표가 없으면 최고 화질로 올려도 되지만, 비활성 하향 지시는
    // 반대로 올리면 안 된다(대역폭 보호가 목적이므로) — slotFrame.ts 의 applySlotQuality 참조.
    this.post({
      channel: MV_CHANNEL,
      dir: 'p2s',
      kind: 'setQuality',
      slot,
      target,
      raiseIfMissing: !isDowngrade,
    });
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
       * `load` 시점에 보낸 `enterSlotMode` 는 아직 리스너가 없어 그대로 유실된다.
       * 준비 신호를 받은 지금 지시문을 다시 보낸다 (모두 멱등하다).
       */
      if (message.kind === 'ready') {
        info(`slot ${message.slot} controller is ready; re-sending slot directives`);
        runtime.ready = true;
        runtime.autoVolumeState = 'waiting';
        runtime.autoVolumeRms = null;
        runtime.cell.querySelector('.cm-slot__retry')?.remove();
        this.post({ channel: MV_CHANNEL, dir: 'p2s', kind: 'enterSlotMode', slot: message.slot });
        this.registerFocus(message.slot);
        this.applyQuality(message.slot);
        this.post({
          channel: MV_CHANNEL,
          dir: 'p2s',
          kind: 'setAutoVolume',
          slot: message.slot,
          enabled: this.settings.multiView.autoVolume,
          targetRms: this.autoVolumeTarget,
        });
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
        if (this.getFocusedSlot() === message.slot) return;
        info(`slot ${message.slot} activated by audio shortcut forwarded from a slot frame`);
        this.setActiveSlot(message.slot);
        return;
      }
      /** 사용자가 이 슬롯의 음소거를 직접 풀었다 → 의도대로 활성 슬롯을 옮긴다. */
      if (message.kind === 'requestAudio') {
        /*
         * 🔴 이 메시지는 슬롯 프레임이 받은 `pointerdown` 도 그대로 실어 온다
         * (`slotFrame.ts` 의 `onPointerDown`) — 즉 **사용자가 방금 조작했다**는 신호다.
         * 부모 문서에는 그 입력이 도달하지 않으므로(iframe 이 삼킨다) `bindUserGestureRelay`
         * 만으로는 이 경우를 놓친다. 여기서 나머지 슬롯에 중계해 음소거 해제 재시도를 깨운다.
         */
        this.relayUserGesture();
        if (this.getFocusedSlot() === message.slot) return;
        info(`slot ${message.slot} requested audio focus (unmuted by the user)`);
        this.setActiveSlot(message.slot);
        return;
      }
      if (message.kind === 'state') {
        runtime.autoVolumeState = message.autoVolumeState;
        runtime.autoVolumeRms = message.autoVolumeRms;
        const target = averageVolumeTarget(
          [...this.runtimes.values()].map((r) =>
            r.autoVolumeState === 'active' ? r.autoVolumeRms : null,
          ),
        );
        if (
          this.settings.multiView.autoVolume &&
          Math.abs(target - this.autoVolumeTarget) > 0.001
        ) {
          this.autoVolumeTarget = target;
          this.syncAutoVolume();
        }
        this.updateAutoVolumeButton();
        if (message.advertising === true) this.showSlotAdNotice(runtime);
        else runtime.cell.querySelector('.cm-slot__ad-notice')?.remove();
        if (!message.online && message.advertising !== true) {
          runtime.header.dataset.offline = 'true';
          /**
           * 🔴 실측 확정 (2026-08-24, `etc/probe/multiview-report2.json`): 4슬롯 중 하나가
           * **끝까지 검은 칸으로만 남는데 아무 설명이 없었다.** 프레임 문서는 정상 로드돼
           * `ready` 까지 왔으므로(`slot 3 controller is ready`) 로드 타임아웃 경로
           * (`.cm-slot__error`)는 영원히 발화하지 않고, 유일한 신호였던
           * `header.dataset.offline` 은 **대응하는 CSS 가 없어 화면에 아무 변화도 주지 못했다**
           * (헤더 자체도 비터치 기기에서는 hover 전까지 `opacity: 0` 이다).
           * → 사용자는 "왜 한 칸만 까맣지"를 알 방법이 없다. 실제로 안내를 띄운다.
           */
          runtime.offlineSince ??= Date.now();
          if (Date.now() - runtime.offlineSince >= SLOT_OFFLINE_NOTICE_MS) {
            this.showSlotOfflineNotice(runtime);
          }
        } else {
          delete runtime.header.dataset.offline;
          runtime.offlineSince = null;
          runtime.cell.querySelector('.cm-slot__notice')?.remove();
        }
        return;
      }
      if (message.kind === 'error') {
        warning(`slot ${message.slot} reported an error: ${message.reason}`);
        // 고장난 슬롯이 초점을 쥐고 있으면 사이드 채팅·화질 우선순위가 죽은 슬롯을 가리킨다 → 뺀다.
        this.unregisterFocus(message.slot);
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
   * 사이드 채팅 패널 — **활성 슬롯 채널의 채팅**을 흘린다 (요청 2026-08-18).
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
    const active = this.getFocusedSlot();
    const runtime = active === null ? undefined : this.runtimes.get(active);
    this.chatPanelTitle.textContent = runtime ? `${runtime.slot} ${runtime.channelName}` : '채팅';
  }

  /** 활성 슬롯의 채팅만 패널에 넣는다. 비활성 슬롯 메시지는 스트립에서만 쓴다. */
  private renderChatPanel(
    runtime: SlotRuntime,
    messages: { nickname: string; text: string; color: string | null }[],
  ): void {
    if (!this.chatPanelList) return;
    if (this.getFocusedSlot() !== runtime.slot) return;

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
    const lines = this.linesFor(runtime.slot, rect.width / readStageViewport().zoom);
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

  /**
   * 부모 프레임의 사용자 제스처를 **모든 슬롯에** 알린다 (2026-08-27).
   *
   * 🔴 없으면 멀티뷰에서 음소거 자동 해제가 슬롯 단위로 굳는다. 자동재생 정책에 걸려 음소거로
   * 시작한 슬롯의 `volume.ts` 는 "사용자 제스처가 오면 다시 해제"를 기다리는데, 제스처는
   * **누른 그 프레임에만** 도달한다 — 사용자가 슬롯 1 을 눌러도 2·3·4 는 영영 깨어나지 않고,
   * 스테이지 조작 바(부모 프레임)를 눌렀을 때는 **어떤 슬롯도** 깨어나지 않는다.
   *
   * 스로틀을 두는 이유: 드래그·연타로 초당 수십 번 오는 `pointerdown` 을 슬롯 4개에 그대로
   * 곱하지 않는다. 재시도는 백오프를 갖고 있으므로 이 정도 해상도면 충분하다.
   */
  private relayUserGesture(): void {
    const now = Date.now();
    if (now - this.lastGestureRelayAt < GESTURE_RELAY_THROTTLE_MS) return;
    this.lastGestureRelayAt = now;
    for (const slot of this.runtimes.keys()) {
      this.post({ channel: MV_CHANNEL, dir: 'p2s', kind: 'userGesture', slot });
    }
  }

  private bindUserGestureRelay(): void {
    // 캡처 단계 + passive — 치지직·우리 UI 어느 쪽 조작도 방해하지 않는다.
    const onInput = () => this.relayUserGesture();
    for (const type of GESTURE_RELAY_EVENTS) {
      document.addEventListener(type, onInput, { capture: true, passive: true });
    }
    this.disposers.push(() => {
      for (const type of GESTURE_RELAY_EVENTS) {
        document.removeEventListener(type, onInput, { capture: true });
      }
    });
  }
}
