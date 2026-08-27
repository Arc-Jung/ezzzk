/**
 * FR-02 음소거 자동 해제 + 기본 볼륨 · FR-03 오버레이 `−` / % / `+` 볼륨 컨트롤.
 *
 * 실측 근거 (2026-08-11, 분석 문서 §3.3)
 * - ✅ `video.volume` **직접 대입만으로** PrismPlayer UI 가 완전히 동기화된다
 *   (`--pzp-ui-progress__scale` · `aria-valuenow` · `aria-valuetext` 모두 따라오고
 *   `volumechange` 도 발생). → 포인터 이벤트 합성 같은 우회는 쓰지 않는다.
 * - ✅ 영속 저장 위치를 함께 갱신해야 한다. 안 하면 다음 진입 시 치지직이 옛 값으로 되돌린다.
 *   `localStorage['player-volume'] = {"value":0.5}` · `['player-volume-muted'] = "false"`
 * - ⚠️ **음소거 판별에 `volume === 0` 을 쓰면 틀린다.** VOD 실측: `muted=true` 인데
 *   `volume=0.1758`, 슬라이더는 `30` 표시. → `video.muted` 또는 볼륨 버튼 `aria-label`
 *   (`음소거`=소리 켜짐 / `음소거 해제`=음소거됨)로 판별한다.
 * - ⚠️ 음소거 상태가 localStorage 로 라이브↔VOD 간 전파된다 → 이동마다 재적용.
 * - 🔴 **`localStorage` 는 origin 전체가 공유한다 — 슬롯 iframe 에서는 절대 쓰지 않는다**
 *   (사용자 보고 2026-08-23: "멀티뷰 → 싱글뷰 전환 시 음소거가 되는 문제"). 슬롯도 같은
 *   `chzzk.naver.com` 페이지를 iframe 으로 불러와 이 기능이 그대로 도는데, 슬롯이 이
 *   전역 키에 쓰면 호스트 페이지·다른 슬롯의 값을 덮어쓴다. 특히 슬롯은 매번 새로 로드되는
 *   페이지라 "자동재생 차단 → 강제 음소거" 경로를 자주 타는데, 그때마다 `player-volume-muted`
 *   를 전역으로 `true` 로 써 버리면 멀티뷰를 나간 뒤(또는 다음 새로고침) 호스트 페이지가
 *   그 값을 읽어 음소거로 시작한다 — 실측(2026-08-23): 멀티뷰 세션 중 `localStorage` 값이
 *   `true` 로 관측됨, 대조군(멀티뷰 미사용)은 새로고침해도 항상 `false` 유지.
 * - 초기 음소거가 페이지마다 다르다: 라이브 데스크톱 `false` / VOD `true` / 모바일 `true`.
 * - ⚠️ 삽입 노드는 컨트롤바 자동 숨김을 **따라가지 않는다** (1600×900 · 1920×1080 모두
 *   네이티브 opacity 0 / 우리 노드 1).
 *   → 실측(2026-08-12 `chzzk-dom-24`)으로 신호를 확정했다: 플레이어 루트의 `pzp-pc--controls`
 *   modifier 가 있으면 네이티브 opacity 1, 없으면 0 이다. 동기화는 **같은 modifier 를 쓰는 CSS**
 *   (`features/controlBar.ts`)가 처리한다. opacity 를 JS 로 따라 읽는 방식은 실측에서 실패했다.
 * - 치지직 네이티브 단축키 `space` `k` `m` `f` 는 절대 쓰지 않는다 → `Shift+↑` / `Shift+↓`.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ID, OURS, PLAYER } from '../constants/class';
import { MOBILE_PLAYER } from '../constants/classMobile';
import { hasPlayer, type PageType } from '../pageType';
import { updateSection } from '../storage';
import { CompressorIcon } from '../ui/icons';
import { ACCENT } from '../ui/tokens';
import { normalizeText, qs, qsVisible, sleep } from '../utils/dom';
import { guard, guardAsync, info, warning } from '../utils/log';
import { debounce, observe, type Disposer } from '../utils/observe';
import { isUserInitiatedStrict, markSyntheticInput } from './multiView/userIntent';
import {
  MAX_BOOST_PERCENT,
  applyBoost,
  applyCompressorParams,
  ensureGraph,
  isBoosted,
  isClippingRisk,
  resumeGraph,
  setCompressorEnabled,
  volumeGaugeColor,
} from './audioPipeline';
import { createIconElement, type IconName } from '../ui/icons';
import { CONTROL_ITEM_CLASS, ensureControlBarAutoHideCss } from './controlBar';
import type { Feature } from './types';

/** 컴프레서 토글 아이콘 — 정적 SVG 문자열로 미리 렌더한다 (매 버튼 생성 시 재계산할 필요가 없다). */
const COMPRESSOR_ICON_MARKUP = renderToStaticMarkup(createElement(CompressorIcon, { size: 14 }));

/** 치지직/PrismPlayer 가 볼륨을 복원하는 localStorage 키 (실측). */
export const VOLUME_STORAGE_KEYS = {
  volume: 'player-volume',
  muted: 'player-volume-muted',
} as const;

/** 설정에서 허용하는 증감 폭 (FR-03). */
export const VOLUME_STEPS = [5, 10, 20] as const;

/** 0~100 클램프. NaN·Infinity 는 0 으로 본다. */
export function clampVolumePercent(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.min(MAX_BOOST_PERCENT, Math.max(0, Math.round(p)));
}

/**
 * `video.volume` 에 넣을 값 (0~1). **100% 를 넘는 부분은 여기서 잘린다** — 그 몫은 Web Audio
 * 게인이 담당한다 (`audioPipeline`). `video.volume = 2` 는 IndexSizeError 다 (실측 2026-08-20).
 */
export function percentToElementUnit(percent: number): number {
  return Math.min(100, clampVolumePercent(percent)) / 100;
}

/**
 * 한 번의 증감. `delta` 는 **방향**(양수=올림, 음수=내림, 0=변화 없음)이고 크기는 `step` 이 정한다.
 * 잘못된 step 은 기본값 10 으로 되돌린다.
 */
export function stepVolume(current: number, delta: number, step: number): number {
  const amount = Number.isFinite(step) && step > 0 ? Math.round(step) : 10;
  const direction = delta === 0 || !Number.isFinite(delta) ? 0 : delta > 0 ? 1 : -1;
  return clampVolumePercent(clampVolumePercent(current) + direction * amount);
}

/** 퍼센트 → 단위(0~2). 증폭 구간까지 그대로 표현한다 (요소에는 `percentToElementUnit` 을 쓴다). */
export function percentToUnit(percent: number): number {
  return clampVolumePercent(percent) / 100;
}

/** `video.volume` 단위(0~1) → 퍼센트(0~100). */
export function unitToPercent(unit: number): number {
  if (!Number.isFinite(unit)) return 0;
  return clampVolumePercent(unit * 100);
}

/**
 * 볼륨 버튼 `aria-label` 로 음소거 여부를 판별한다.
 * `음소거 해제` = 지금 음소거됨(누르면 해제) / `음소거` = 지금 소리 켜짐.
 */
export function isMutedByLabel(ariaLabel: string | null | undefined): boolean {
  const text = normalizeText(ariaLabel);
  if (text.length === 0) return false;
  return text.includes('해제');
}

/** localStorage 에 쓸 실측 형태의 값을 만든다. */
export function volumeStorageValues(
  percent: number,
  muted: boolean,
): { volume: string; muted: string } {
  return {
    /*
     * 🔴 치지직 플레이어가 이 값을 읽어 `video.volume` 에 그대로 넣는다 — **1 을 넘기면 안 된다.**
     * 증폭(100% 초과)은 Web Audio 게인의 몫이므로 여기서는 요소 단위로 자른다.
     */
    volume: JSON.stringify({ value: percentToElementUnit(percent) }),
    muted: muted ? 'true' : 'false',
  };
}

/** 설정값 정규화 — 5/10/20 이외의 값이 들어오면 10 을 쓴다. */
export function normalizeStep(step: number): number {
  return (VOLUME_STEPS as readonly number[]).includes(step) ? step : 10;
}

/** 표시 문자열. 0% 는 음소거로 표시한다 (FR-03). */
export function formatVolumeLabel(percent: number, muted: boolean): string {
  return muted || percent === 0 ? '음소거' : `${clampVolumePercent(percent)}%`;
}

/**
 * 볼륨 컨트롤을 우측 버튼 그룹의 **가장 왼쪽**에 놓는다 (FR-03 · FR-10.5).
 *
 * 🔴 실측 결함 (2026-08-15, `scripts/probe-controlbar-order.mjs mobile-landscape`)
 * 이전 구현은 `appendChild` 로 그룹의 **오른쪽 끝**에 넣었다. `pzp-pc__bottom-buttons-right` 는
 * 우측 정렬(그룹의 오른쪽 끝 720 고정)이라, 탭으로 볼륨 컨트롤(136px)이 나타나는 순간
 * 그 **왼쪽에 있던 형제 전부가 136px 만큼 왼쪽으로 밀렸다**:
 *   before display:none → 멀티뷰 492 / 설정 544 / 네이티브 596·640·684
 *   after  display:flex → 멀티뷰 356 / 설정 408 / 네이티브 460·504·548 (볼륨 584)
 * 플레이어 `pointerdown` 이 볼륨을 노출시키므로 **설정 버튼을 누른 그 탭이** 버튼을 손가락
 * 아래에서 빼내 `click` 이 컨테이너에 떨어졌다 → 첫 탭이 통째로 삼켜졌다.
 *
 * 가장 왼쪽(첫 자식)에 넣으면 그룹은 왼쪽으로 자라고 **오른쪽 형제들의 x 는 그대로**다
 * (실측: 설정 544 불변). DOM 순서만으로는 부족하다 — 설정·멀티뷰 버튼도
 * `insertBefore(firstChild)` 로 다시 붙으므로(`controlBar.ts`) 컨트롤바 리렌더 뒤 우리 볼륨보다
 * 앞에 낀다(실측에서 실제로 그렇게 됐다). 레이아웃 순서를 `order: -1` 로 고정해 어떤 삽입
 * 경합에서도 볼륨이 항상 맨 왼쪽에 그려지게 한다.
 * (다른 삽입 노드와 네이티브 버튼은 모두 `order: 0` 이다 — 위 실측의 `order` 필드로 확인.)
 *
 * ⚠️ 이것만으로는 부족하다. 그룹이 **줄바꿈**되는 좁은 화면(`mobile-portrait`, 그룹 폭 192px)에서는
 * "오른쪽 끝 고정" 성질이 성립하지 않아 삽입 위치와 무관하게 재배치된다. 좌표 고정을 실제로
 * 보장하는 것은 `syncTapVisibility` 의 **공간 예약**(`visibility: hidden`)이다 — 아래 주석 참조.
 */
export function insertVolumeControl(container: Element, node: HTMLElement): void {
  node.style.order = '-1';
  if (node.parentElement !== container) container.insertBefore(node, container.firstChild);
}

type VolumeDom = {
  root: string;
  video: string;
  volumeButton: string;
  buttonsRight: string;
  /** 플레이어 재생/일시정지 버튼. 자동재생이 막힌 상태를 풀 때 우리가 대신 누른다. */
  playbackSwitch: string;
  /**
   * 플레이어를 감싸는 **바깥 컨테이너**. 옵저버 앵커로만 쓴다.
   * 플레이어 루트(`.pzp-pc`)는 리렌더로 통째로 교체되므로 그것을 관찰 대상으로 잡으면
   * 교체되는 순간 감시가 끊긴다 (`multiView/hostPlayer.ts` 가 같은 이유로 `#live_player_layout`
   * 을 앵커로 쓴다). VOD 는 컨테이너 ID 가 다르므로 둘을 함께 건다 (실측 2026-08-11).
   */
  layout: string;
};

function domFor(page: PageType): VolumeDom {
  if (page === 'mobile-web') {
    return {
      root: MOBILE_PLAYER.root,
      video: MOBILE_PLAYER.video,
      volumeButton: MOBILE_PLAYER.volumeButton,
      buttonsRight: MOBILE_PLAYER.bottomButtonsRight,
      /* 모바일 웹에는 전용 재생 버튼 셀렉터가 없다 — 데스크톱과 같은 pzp 버튼을 쓴다 (실측). */
      playbackSwitch: PLAYER.playbackSwitch,
      layout: MOBILE_PLAYER.playerLayout,
    };
  }
  return {
    root: PLAYER.rootPc,
    video: PLAYER.video,
    volumeButton: PLAYER.volumeButton,
    buttonsRight: PLAYER.bottomButtonsRight,
    playbackSwitch: PLAYER.playbackSwitch,
    layout: `${ID.livePlayerLayout}, ${ID.vodPlayerLayout}`,
  };
}

/**
 * `video` 가 나타나기를 기다리는 상한 (2분).
 *
 * 🔴 근거 (사용자 보고 2026-08-16: "볼륨 조절 `+`/`−` 가 사라졌다", 실사이트 프로브
 * `scripts/probe-volume-control.mjs` 로 재현 — 3개 프로필 전부 `missing` + 로그
 * `volume feature disabled: video element not found`).
 * 이전 구현은 `start()` 시점에 `video` 가 없으면 재시도도 옵저버도 없이 **그 페이지에서 영구
 * 포기**했다. 콘텐츠 스크립트는 플레이어보다 먼저 뜨고, 프리롤 광고 중에는 본 `<video>` 가
 * 늦게 붙는다. 화질 기능(`quality.ts`)이 같은 부류를 이미 2분 상한으로 해결했으므로
 * **값과 근거를 그대로 따른다** — 프리롤 광고가 1분을 넘는 경우까지 감안한 값이다.
 */
const READY_WINDOW_MS = 120_000;

/**
 * 재시도 라운드 상한. 시간 상한만 두면 "컨트롤바는 이미 있는데 `video` 가 끝내 안 붙는" 상태에서
 * 2분 내내 재시도한다 → 라운드 수로도 막는다.
 *
 * ⚠️ 라운드는 **컨트롤바가 렌더된 뒤에만** 센다 (`playerReady`). 광고 구간에는 컨트롤바 DOM 이
 * 아예 없으므로(프로젝트 규칙 · 실측) 광고 시간이 예산을 갉아먹지 않는다. `quality.ts` 가
 * `playerReady()` 로 무관한 DOM 변화를 걸러내는 것과 같은 장치다.
 * 성공하면 0 으로 되돌린다 — 전체화면 전환처럼 `video` 가 잠깐 교체되는 구간이 예산을 소모하고
 * 끝나면 안 된다.
 */
const MAX_READY_ROUNDS = 30;

/**
 * 막힌 자동재생 폴백 시도 상한. 치지직이 계속 멈춰 있는 상황(방송 종료·오류)에서 재생 버튼을
 * 무한히 누르지 않게 한다. 성공하면 `mutedForAutoplay` 가 재시도를 막는다.
 */
const AUTOPLAY_RESCUE_MAX_TRIES = 3;

/**
 * 붙은 뒤 이 시간 안에서만 폴백을 시도한다. 진입 직후의 "자동재생 차단"만 대상으로 삼고,
 * 한참 보다가 사용자가 멈춘 경우를 되살리지 않기 위한 이중 안전장치다.
 */
const AUTOPLAY_RESCUE_WINDOW_MS = 20_000;

/**
 * 음소거 자동 해제 재시도 상한. 상한을 넘기면 자동 재시도를 멈추고 **사용자 제스처 대기**로
 * 내려앉는다 (영구 포기가 아니다 — `scheduleUnmuteRetry` 주석 참조).
 */
const UNMUTE_MAX_ATTEMPTS = 8;

/**
 * 재시도 간격(ms). 지수 백오프 후 5초에서 멈춘다. 마지막 값은 상한까지 반복해서 쓴다.
 * 앞쪽을 짧게 둔 이유: 슬롯 진입 직후 치지직이 스스로 음소거를 되돌리는 구간이 수백 ms 안이다.
 */
const UNMUTE_RETRY_DELAYS_MS = [400, 800, 1_600, 3_200, 5_000] as const;

/**
 * 부모(멀티뷰 스테이지)가 자기 프레임에서 받은 사용자 제스처를 슬롯으로 중계할 때 쓰는
 * 커스텀 이벤트. 슬롯 컨트롤러(`multiView/slotFrame.ts`)가 받아 `window` 에 발화시킨다.
 * `constants/class.ts` 의 `OURS.userGestureEvent` 와 같은 문자열을 쓴다.
 */
const USER_GESTURE_EVENT = OURS.userGestureEvent;

/**
 * **호스트 페이지**에서 멀티뷰가 원본 플레이어를 일부러 음소거해 둔 상태인가.
 *
 * 🔴 이 판정이 없으면 새 재시도 로직이 `multiView/hostPlayer.ts` 의 `suspendHostPlayer` 와
 * 정면으로 싸운다 — 저쪽은 소리 겹침을 막으려 호스트를 계속 음소거로 유지하는데, 이쪽이
 * 그때마다 다시 풀면 슬롯 소리 위에 원본 소리가 겹쳐 난다(FR-14 가 막으려던 바로 그 증상).
 * 슬롯 프레임 안에는 스테이지가 없으므로 슬롯의 자동 해제는 그대로 살아 있다.
 */
function hostMutedByMultiView(): boolean {
  return document.getElementById(OURS.multiViewStageId) !== null;
}

function writeVolumeStorage(percent: number, muted: boolean): void {
  const values = volumeStorageValues(percent, muted);
  try {
    localStorage.setItem(VOLUME_STORAGE_KEYS.volume, values.volume);
    localStorage.setItem(VOLUME_STORAGE_KEYS.muted, values.muted);
  } catch (e) {
    // 시크릿 모드·저장 용량 초과 등. 볼륨 자체는 이미 적용됐으므로 계속 진행한다.
    warning('failed to persist player volume to localStorage', e);
  }
}

/** 입력 중이면 단축키를 삼키지 않는다 (채팅 입력창에서 Shift+↑ 는 선택 확장이다). */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export const volumeFeature: Feature = {
  id: 'volume',
  watches: ['volume'],
  supports: (ctx) => hasPlayer(ctx.page.type),
  start: (ctx) => {
    const dom = domFor(ctx.page.type);
    const step = normalizeStep(ctx.settings.volume.step);
    /**
     * `localStorage['player-volume'/'player-volume-muted']` 는 origin 전체가 공유한다.
     * 슬롯 프레임은 이 전역 값을 절대 쓰지 않는다 — 위 파일 머리말 주석 참조.
     */
    const persistNative = (percent: number, muted: boolean): void => {
      if (ctx.page.isSlotFrame) return;
      writeVolumeStorage(percent, muted);
    };

    const disposers: (() => void)[] = [];
    let disposed = false;
    let started = false;
    /**
     * 막힌 자동재생을 **음소거로** 되살린 상태인가.
     * 🔴 참이면 음소거 자동 해제를 **미룬다.** 여기서 소리를 켜면 브라우저가 곧바로 다시 멈춰
     * "재생 버튼을 눌러야 하는" 원래 증상으로 돌아간다 (유닛 판정으로 고정).
     * 첫 사용자 제스처(`armGestureRetry`)에서 해제하고 이 값을 내린다.
     */
    let mutedForAutoplay = false;
    /**
     * 폴백 시도 횟수. 상한을 두어 치지직이 계속 멈춰 있는 상황에서 버튼을 무한히 누르지 않는다.
     * 🔴 준비 상태와 무관하게 시도해야 한다 — 차단된 순간의 `video` 는 **`readyState = 0`** 이다
     * (실측 2026-08-19). 예전 구현은 `readyState >= 2` 분기에만 폴백을 붙여 **정작 차단된
     * 상태에서는 한 번도 실행되지 않았다** (라이브 A/B 9회 중 3회 차단, 폴백 로그 0건).
     */
    let autoplayRescueTries = 0;
    /** 마지막 `pause` 가 사용자 제스처의 결과였는가. 폴백이 사용자 조작을 덮지 않게 하는 근거다. */
    let pauseWasUserGesture = false;
    /** 현재 `video` 에 붙은 시각. 폴백은 붙은 직후 창 안에서만 시도한다. */
    let attachedAt = 0;
    let unmuteAttempts = 0;
    /** 대기 중인 음소거 해제 재시도. 한 번에 하나만 둔다 (중복 예약 금지). */
    let unmuteTimer: ReturnType<typeof setTimeout> | undefined;
    let percent = clampVolumePercent(
      ctx.settings.volume.restoreLast
        ? ctx.settings.volume.lastLevel
        : ctx.settings.volume.defaultLevel,
    );

    /**
     * 지금 붙어 있는 `video`. **참조를 고정하지 않는다** — 플레이어가 리렌더되면(전체화면 전환이
     * 대표적) 요소가 통째로 교체되어 옛 참조는 죽은 노드가 된다 (`hostPlayer.ts` 의 `watched` 와
     * 같은 취급). 아직 없을 수도 있으므로 모든 사용처에서 null 을 허용한다.
     */
    let video: HTMLVideoElement | null = null;
    /**
     * 컴프레서 켜짐 여부의 로컬 사본. `ctx.settings` 는 시작 시점 스냅샷이라 사용자가 방금
     * 누른 토글을 반영하지 못한다 — `applyAudioGraph` 는 항상 이 값을 읽는다.
     * 저장은 별도(`toggleCompressor`)로 하고, 그래프 반영은 이 값으로 즉시 한다.
     */
    let compressorEnabled = ctx.settings.audio?.compressor?.enabled === true;
    /** 컴프레서 토글 버튼. `aria-pressed`·`aria-label`·색을 함께 갱신한다. */
    let compressorButtonEl: HTMLElement | null = null;

    const volumeButton = (): HTMLElement | null => qsVisible<HTMLElement>(dom.volumeButton);
    /** ⚠️ `volume === 0` 으로 판별하면 틀린다 (VOD 실측). */
    const isMuted = (): boolean =>
      video?.muted === true || isMutedByLabel(volumeButton()?.getAttribute('aria-label'));

    /**
     * `lastLevel` 저장.
     *
     * 🔴 **`restoreLast` 가 꺼져 있으면 저장하지 않는다** (실측 결함).
     * `lastLevel` 은 "이전 볼륨 유지" 옵션에서만 읽는 값이라 꺼진 상태에서는 쓸 데가 없는데,
     * 저장하면 `chrome.storage.onChanged` → 이 기능 재시작 → `restoreLast: false` 기준으로
     * **기본 볼륨을 다시 적용**해 사용자가 올린 볼륨이 되돌아간다.
     * (기본값이 `restoreLast: false` 라서 설치 직후 치지직 볼륨 슬라이더가 먹지 않는 증상이었다.)
     */
    const persist = debounce((value: number) => {
      if (!ctx.settings.volume.restoreLast) return;
      // origin 을 붙이면 이 쓰기로 볼륨 기능이 재시작되지 않는다 (자기 값을 되돌리는 것을 막는다).
      void updateSection('volume', { lastLevel: value }, { origin: 'volume' }).catch((e: unknown) =>
        warning('failed to persist volume level', e),
      );
    }, 400);

    // ── FR-03 오버레이 컨트롤 ────────────────────────────────────────────────
    const touchSize = ctx.device.profile.touchTargetPx;
    let node: HTMLElement | null = null;
    let valueEl: HTMLElement | null = null;
    let tapVisible = false;
    let tapTimer: number | undefined;

    const host = (): HTMLElement | null => qs<HTMLElement>(dom.buttonsRight);
    ensureControlBarAutoHideCss();

    const render = () => {
      if (!node || !valueEl) return;
      const label = formatVolumeLabel(percent, isMuted());
      if (valueEl.textContent !== label) valueEl.textContent = label;
      node.setAttribute('aria-label', `볼륨 조절, 현재 ${label}`);
      /*
       * 게이지 색은 세 단계다 (2026-08-20 요청으로 빨강 단계 추가).
       *   ~100%  흰색   기본
       *   >100%  주황   증폭 — 원본보다 크게 트는 상태
       *   >150%  빨강   과증폭 — 찢어짐(클리핑) 위험
       * 색만으로 정보를 주지 않도록 `aria-label` 에도 같은 구분을 남긴다.
       */
      const boosted = isBoosted(percent);
      const clipping = isClippingRisk(percent);
      valueEl.style.color = volumeGaugeColor(percent);
      valueEl.dataset.boosted = boosted ? 'true' : 'false';
      valueEl.dataset.clipping = clipping ? 'true' : 'false';
      if (clipping) node.setAttribute('aria-label', `볼륨 조절, 현재 ${label} (과증폭)`);
      else if (boosted) node.setAttribute('aria-label', `볼륨 조절, 현재 ${label} (증폭)`);
    };

    /**
     * 증폭·컴프레서를 실제 오디오 그래프에 반영한다.
     * 그래프는 **증폭이나 컴프레서가 필요할 때 처음 만든다** — 필요 없는 사용자에게는 만들지 않는다.
     */
    const applyAudioGraph = () => {
      const el = video;
      if (!el) return;
      const compressor = ctx.settings.audio?.compressor;
      // 🔴 켜짐 여부는 설정 스냅샷이 아니라 로컬 상태(`compressorEnabled`)로 판단한다 —
      // 컨트롤바 토글은 재시작 없이 즉시 반영돼야 한다 (아래 `toggleCompressor` 참조).
      const needsGraph = percent > 100 || compressorEnabled;
      if (!needsGraph) return;

      const graph = ensureGraph(el);
      if (!graph) return;
      resumeGraph(graph);
      applyBoost(graph, percent);
      if (compressor) {
        applyCompressorParams(graph, compressor);
        setCompressorEnabled(graph, compressorEnabled);
      }
    };

    /** 컴프레서 버튼의 `aria-label`·`aria-pressed`·색·`data-*` 를 지금 상태로 맞춘다. */
    const updateCompressorButton = () => {
      if (!compressorButtonEl) return;
      compressorButtonEl.setAttribute('aria-pressed', compressorEnabled ? 'true' : 'false');
      compressorButtonEl.setAttribute(
        'aria-label',
        compressorEnabled ? '음량 평탄화 끄기' : '음량 평탄화 켜기',
      );
      // 🔴 색만으로 상태를 전달하지 않는다 — `aria-pressed` 와 `data-enabled` 를 함께 남긴다.
      compressorButtonEl.dataset.enabled = compressorEnabled ? 'true' : 'false';
      compressorButtonEl.style.color = compressorEnabled ? ACCENT : '#fff';
    };

    /**
     * 사용자가 컴프레서 토글을 눌렀을 때만 호출한다 (버튼 클릭 핸들러 전용).
     * 그래프에는 즉시 반영하고, 저장은 `origin: 'volume'` 으로 해 자기 자신의 재시작을 막는다
     * (`volume` 은 `audio` 섹션을 `watches` 하지 않아 재시작되지도 않지만, 다른 창에는
     * 이 값이 그대로 전파돼야 하므로 저장 자체는 반드시 한다).
     */
    const toggleCompressor = () => {
      const current = ctx.settings.audio?.compressor;
      if (!current) return;
      compressorEnabled = !compressorEnabled;
      updateCompressorButton();
      applyAudioGraph();
      void updateSection(
        'audio',
        { compressor: { ...current, enabled: compressorEnabled } },
        { origin: 'volume' },
      ).catch((e: unknown) => warning('failed to persist compressor toggle', e));
    };

    /**
     * @param persistToSettings 설정에 저장할지. **초기 적용에서는 반드시 false 다.**
     *
     * 🔴 초기 적용에서 저장하면 무한 재초기화 루프가 생긴다:
     * `start()` → `setPercent` → `updateSection` → `chrome.storage.onChanged`
     * → `content.tsx` 의 `restart()` → `start()` → … (약 400ms 주기로 전 기능 재시작).
     * `chrome.storage` 는 값이 같아도 `set` 하면 `onChanged` 를 발생시키므로 값 비교로는 막히지 않는다.
     * 저장은 **사용자가 실제로 볼륨을 바꿨을 때만** 한다.
     */
    const setPercent = (next: number, persistToSettings = true) => {
      percent = clampVolumePercent(next);
      // `video` 가 아직(또는 잠시) 없어도 표시값은 갱신한다 — 붙는 순간 그대로 적용된다.
      if (video) {
        /*
         * 🔴 100% 초과는 `video.volume` 으로 못 올린다 (IndexSizeError, 실측 2026-08-20).
         * 요소에는 100% 까지만 넣고, 넘는 몫은 Web Audio 게인이 곱한다. 게인 그래프는 **필요할 때만**
         * 만든다 — 그래프에 연결하는 순간 소리가 그 경로로만 나오므로, 증폭을 안 쓰는 사용자에게는
         * 위험을 지우지 않는다.
         */
        video.volume = percentToElementUnit(percent);
        applyAudioGraph();
        // 0% 는 표시만 음소거다 — `muted` 플래그는 건드리지 않아 사용자의 음소거 토글과 싸우지 않는다.
        persistNative(Math.min(100, percent), video.muted);
      }
      render();
      if (persistToSettings) persist(percent);
    };

    /**
     * `−`/`+`(와 `Shift+↑`/`Shift+↓`)로 볼륨을 조절할 때 **음소거를 먼저 푼다**
     * (사용자 요청 2026-08-27: 음소거 상태에서 볼륨을 올려도 소리가 안 나서 고장으로 보인다).
     *
     * - 이 경로는 **항상 사용자 제스처**다 → 자동재생 정책이 소리를 막지 않는다. 그래서
     *   `attemptUnmute` 의 조심스러운 절차(150ms 대기 → 다시 멈췄으면 되돌리기)가 필요 없다.
     * - 같은 이유로 자동재생을 살리려고 걸어 둔 잠금(`mutedForAutoplay`)도 여기서 내린다.
     *   내리지 않으면 이후 `attemptUnmute` 가 계속 즉시 반환해 음소거로 굳는다.
     * - `video.muted` 대입만으로 치지직 UI(볼륨 버튼 `aria-label`·슬라이더)가 따라온다
     *   (파일 머리말 실측 §3.3) → 네이티브 버튼을 합성 클릭하지 않는다.
     * - 저장은 `setPercent` 가 이어서 한다 (`persistNative(…, video.muted)` — 이미 false 다).
     */
    const unmuteForAdjust = () => {
      if (!isMuted()) return;
      mutedForAutoplay = false;
      if (video) video.muted = false;
      info('unmuted because the user adjusted the volume');
    };

    /** `−`/`+` 와 단축키가 공유하는 조절 경로. 음소거 해제 → 증감 순서를 지킨다. */
    const nudgeVolume = (direction: 1 | -1) => {
      unmuteForAdjust();
      setPercent(stepVolume(percent, direction, step));
    };

    const makeButton = (icon: IconName, ariaLabel: string, onPress: () => void): HTMLElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cm-volume-button';
      // NFR-10 — 삽입한 모든 조작 요소에 aria-label 을 준다.
      button.setAttribute('aria-label', ariaLabel);
      button.appendChild(createIconElement(icon));
      button.style.cssText = [
        `min-width:${touchSize}px`,
        `min-height:${touchSize}px`,
        'display:inline-flex',
        'align-items:center',
        'justify-content:center',
        'background:transparent',
        'border:0',
        'padding:0',
        'color:#fff',
        'font-size:16px',
        'line-height:1',
        'cursor:pointer',
      ].join(';');
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        guard('volume:button', onPress);
      });
      return button;
    };
    /** SVG 아이콘을 담는 토글 버튼. `makeButton` 과 달리 텍스트가 아니라 마크업을 넣는다. */
    const makeIconButton = (
      markup: string,
      ariaLabel: string,
      onPress: () => void,
    ): HTMLElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cm-volume-button';
      // NFR-10 — 삽입한 모든 조작 요소에 aria-label 을 준다. 아이콘은 aria-hidden 이라
      // 이 라벨이 유일한 접근성 이름이다.
      button.setAttribute('aria-label', ariaLabel);
      button.innerHTML = markup;
      button.style.cssText = [
        `min-width:${touchSize}px`,
        `min-height:${touchSize}px`,
        'display:inline-flex',
        'align-items:center',
        'justify-content:center',
        'background:transparent',
        'border:0',
        'padding:0',
        'color:#fff',
        'cursor:pointer',
      ].join(';');
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        guard('volume:button', onPress);
      });
      return button;
    };

    const buildNode = (): HTMLElement => {
      const el = document.createElement('div');
      el.id = OURS.volumeControlId;
      el.className = CONTROL_ITEM_CLASS;
      el.setAttribute('role', 'group');
      el.style.cssText = [
        'display:inline-flex',
        'align-items:center',
        'gap:2px',
        'flex:0 0 auto',
      ].join(';');

      const minus = makeButton('minus', '볼륨 낮추기', () => nudgeVolume(-1));
      const value = document.createElement('span');
      value.className = 'cm-volume-value';
      value.setAttribute('aria-live', 'polite');
      value.style.cssText = [
        'min-width:44px',
        'text-align:center',
        'color:#fff',
        'font-size:12px',
        'font-variant-numeric:tabular-nums',
      ].join(';');
      const plus = makeButton('plus', '볼륨 높이기', () => nudgeVolume(1));
      const compressorButton = makeIconButton(COMPRESSOR_ICON_MARKUP, '음량 평탄화 켜기', () =>
        toggleCompressor(),
      );
      compressorButtonEl = compressorButton;

      el.append(minus, value, plus, compressorButton);
      valueEl = value;
      updateCompressorButton();
      return el;
    };

    /**
     * 컨트롤바 자동 숨김은 **CSS 가 맡는다** (`features/controlBar.ts` 의
     * `.pzp-pc:not(.pzp-pc--controls)` 규칙). 네이티브와 같은 신호를 쓰므로 페이드가 정확히 맞다.
     * 여기서는 기기별 탭 노출 정책만 처리한다:
     * tablet-7 · mobile 은 상시 노출이 아니라 탭할 때만 보여 준다 (FR-10.5).
     *
     * 🔴 **`display:none` 이 아니라 `visibility:hidden` 으로 숨긴다 — 공간을 예약한다.**
     * 실측 (2026-08-15, `scripts/probe-controlbar-order.mjs`):
     * - 노출 트리거가 플레이어 `pointerdown` 이라 **설정 버튼을 누른 바로 그 탭**이 볼륨
     *   컨트롤(136px)을 먼저 띄운다. 그 레이아웃 변화로 버튼이 손가락 아래에서 빠져나가면
     *   `click` 이 버튼이 아니라 컨테이너에 떨어져 **첫 탭이 통째로 삼켜진다**.
     * - `mobile-landscape` 는 그룹이 한 줄이라 맨 왼쪽 삽입(`insertVolumeControl`)만으로
     *   오른쪽 형제 좌표가 고정됐다 (설정 544 불변).
     * - 그러나 `mobile-portrait` 는 그룹 폭이 192px 뿐이라 **줄바꿈**(`flex-wrap: wrap`,
     *   `controlBar.ts`)이 일어난다. 줄바꿈이 있으면 "오른쪽 끝 고정" 성질이 깨져서
     *   삽입 위치와 무관하게 재배치된다 (설정 144 → 100, 실측). 그래서 위치를 바꾸는 것만으로는
     *   부족하고, **숨김 상태에서도 박스를 유지**해 노출 시 리플로우 자체를 없앤다.
     * 판정 하네스의 `visible()` 도 `visibility: hidden` 을 안 보이는 것으로 세므로
     * 숨김의 의미는 그대로다.
     */
    const syncTapVisibility = () => {
      if (!node) return;
      const tapHidden = !ctx.device.profile.volumeAlwaysVisible && !tapVisible;
      node.style.display = 'inline-flex';
      node.style.visibility = tapHidden ? 'hidden' : 'visible';
    };

    const mount = () => {
      const container = host();
      if (!container) return;
      if (!node) node = buildNode();
      insertVolumeControl(container, node);
      syncTapVisibility();
      render();
    };

    const isMounted = (): boolean => {
      const existing = document.getElementById(OURS.volumeControlId);
      return existing !== null && existing.isConnected;
    };

    /**
     * 자동 숨김 동기화에 옵저버를 쓰지 않는 이유 (실측으로 방식을 바꿨다):
     * 이전 구현은 플레이어 루트의 class 변화를 관찰해 네이티브 형제의 computed opacity 를
     * 읽어 반영했는데, **실측에서 동기화되지 않았다**(네이티브 0 / 우리 1 —
     * `chzzk-dom-22`, `chzzk-dom-24`). 관찰 대상을 시작 시점에 한 번 잡아 두면 플레이어가
     * 재생성될 때 감시가 끊기고, transition 중간값을 읽는 문제도 있었다.
     * → 지금은 네이티브와 **같은 신호(`pzp-pc--controls`)를 쓰는 CSS 규칙**이 처리한다
     *   (`features/controlBar.ts`). 항상 정확하고 옵저버 비용이 0 이다.
     */
    const showOnTap = () => {
      tapVisible = true;
      if (tapTimer !== undefined) clearTimeout(tapTimer);
      tapTimer = window.setTimeout(() => {
        tapVisible = false;
        syncTapVisibility();
      }, 3_000);
      syncTapVisibility();
    };

    /**
     * 탭 노출 리스너를 **현재의** 플레이어 루트에 붙인다.
     *
     * 🔴 시작 시점의 `.pzp-pc` 참조를 붙들면 안 된다. 전체화면 전환 등으로 플레이어가 리렌더되면
     * 그 참조는 문서에서 떨어진 죽은 노드가 되어 탭이 영영 감지되지 않는다.
     * (`hostPlayer.ts` 가 `video` 요소 교체에 대해 쓰는 재부착 패턴과 같다.)
     */
    let tapRoot: HTMLElement | null = null;
    const ensureTapListener = () => {
      if (ctx.device.profile.volumeAlwaysVisible) return;
      const root = qs<HTMLElement>(dom.root);
      if (!root || root === tapRoot) return;
      tapRoot?.removeEventListener('pointerdown', showOnTap, true);
      tapRoot = root;
      root.addEventListener('pointerdown', showOnTap, true);
    };
    disposers.push(() => tapRoot?.removeEventListener('pointerdown', showOnTap, true));

    // ── FR-03 키보드 단축키 ──────────────────────────────────────────────────
    // 네이티브 `space` `k` `m` `f` 는 건드리지 않는다. `off` 프로필에서는 아예 걸지 않는다.
    if (ctx.device.profile.shortcuts !== 'off') {
      const onKeyDown = (e: KeyboardEvent) => {
        if (!e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        if (isTextEntry(e.target)) return;
        e.preventDefault();
        guard('volume:shortcut', () => nudgeVolume(e.key === 'ArrowUp' ? 1 : -1));
      };
      window.addEventListener('keydown', onKeyDown, true);
      disposers.push(() => window.removeEventListener('keydown', onKeyDown, true));
    }

    // ── FR-02 음소거 해제 · 기본 볼륨 ────────────────────────────────────────
    const attemptUnmute = async (): Promise<boolean> => {
      // 음소거로 겨우 재생을 살린 상태다 — 사용자 제스처 전에는 소리를 켜지 않는다.
      if (mutedForAutoplay) return false;
      /*
       * 🔴 멀티뷰가 호스트 플레이어를 일부러 음소거해 둔 상태에서는 어떤 경로로도 풀지 않는다.
       * 제스처 재시도 핸들러가 이 함수를 직접 부르므로 `scheduleUnmuteRetry` 의 가드만으로는
       * 새지 않는다는 보장이 없다 — 여기가 유일한 길목이라 여기서 한 번 더 막는다.
       */
      if (hostMutedByMultiView()) return false;
      // ⚠️ `await` 를 사이에 두므로 요소 참조를 지역에 고정한다 — 그 사이 교체되면 옛 요소를
      //    건드리게 되고, 새 요소는 재부착 경로가 다시 처리한다.
      const el = video;
      if (!el) return false;
      if (!isMuted()) return true;
      unmuteAttempts += 1;

      const wasPlaying = !el.paused;
      el.muted = false;
      // 🔴 요소에는 100% 까지만 넣는다 — `video.volume = 1.5` 는 IndexSizeError 다 (실측 2026-08-20).
      el.volume = percentToElementUnit(percent);
      persistNative(percent, false);
      await sleep(150);

      if (el.muted) return false;
      if (wasPlaying && el.paused) {
        // 자동재생 정책으로 정지됐다 → 원상 복구하고 사용자 제스처를 기다린다. 재생을 끊지 않는다.
        el.muted = true;
        persistNative(percent, true);
        try {
          await el.play();
        } catch (e) {
          warning('failed to resume playback after unmute attempt', e);
        }
        return false;
      }
      info(`unmuted, volume set to ${percent}%`);
      return true;
    };

    /**
     * 사용자 제스처를 기다렸다가 다시 해제한다.
     *
     * 🔴 **다시 걸 수 있어야 한다.** 예전 구현은 한 번 실패하면 `warning` 만 남기고 끝이라,
     * 제스처 한 번으로 안 풀리면(그 클릭이 슬롯 iframe 밖이었다거나, 플레이어가 곧바로 다시
     * 음소거를 되돌렸다거나) 그 페이지에서는 영영 음소거였다. 실패하면 백오프 재시도로 넘긴다.
     */
    let gestureArmed = false;
    const armGestureRetry = () => {
      if (disposed || gestureArmed) return;
      gestureArmed = true;
      const handler = () => {
        detach();
        void guardAsync('volume:unmute-retry', async () => {
          // 사용자가 조작했다 → 이제 소리를 켜도 브라우저가 막지 않는다.
          mutedForAutoplay = false;
          const ok = await attemptUnmute();
          if (!ok) scheduleUnmuteRetry('after user gesture');
          render();
        });
      };
      const detach = () => {
        gestureArmed = false;
        window.removeEventListener('click', handler, true);
        window.removeEventListener('keydown', handler, true);
        window.removeEventListener(USER_GESTURE_EVENT, handler, true);
      };
      window.addEventListener('click', handler, true);
      window.addEventListener('keydown', handler, true);
      /*
       * 🔴 멀티뷰 슬롯은 **자기 프레임 안에서 클릭이 일어나지 않는다.** 사용자가 다른 슬롯을
       * 누르면 그 프레임만 활성화를 받고 나머지 슬롯의 `click` 리스너는 영영 조용하다 —
       * 멀티뷰에서 음소거가 안 풀린 채로 남던 경로다. 부모 스테이지가 자기 제스처를 슬롯
       * 전체에 중계하면(`multiView/messages.ts` 의 `userGesture`) 여기서 함께 깨어난다.
       */
      window.addEventListener(USER_GESTURE_EVENT, handler, true);
      disposers.push(detach);
    };

    /**
     * 음소거 자동 해제 재시도.
     *
     * 🔴 예전에는 **2회 실패 = 그 페이지에서 영구 포기**였다. 멀티뷰에서 이게 그대로 드러났다:
     * 슬롯은 매번 새로 로드되는 페이지라 초기 두 번이 자동재생 정책에 걸려 소진되기 쉽고,
     * 슬롯 안 치지직 플레이어는 `localStorage['player-volume-muted']` 를 읽어 **나중에 스스로
     * 다시 음소거**하기도 한다(슬롯은 전역 오염을 피하려 이 키를 쓰지 않으므로 호스트가 남긴
     * 값을 그대로 물려받는다 — 파일 머리말 §🔴 참조). 두 경우 모두 재시도가 없으면 끝이다.
     *
     * → 지수 백오프로 상한(`UNMUTE_MAX_ATTEMPTS`)까지 다시 시도하고, 그마저 소진되면
     *   **사용자 제스처 대기로 넘긴다** — 포기하지 않고 값싼 대기 상태로 내려앉는다.
     */
    const scheduleUnmuteRetry = (reason: string) => {
      if (disposed) return;
      /*
       * 🔴 판정 근거를 남긴다 (프로젝트 규칙 — 디버그 로그로 "왜 그 값이 됐는가"를 볼 수 있어야
       * 한다). 실측 2026-08-27 1차 프로브에서 재시도가 **한 번도 걸리지 않았는데** 로그가 없어
       * 어느 가드에서 멈췄는지 코드만 보고는 좁힐 수 없었다.
       */
      if (!ctx.settings.volume.autoUnmute) {
        info(`unmute retry skipped (${reason}): auto unmute is off`);
        return;
      }
      // 호스트 플레이어를 멀티뷰가 일부러 음소거해 둔 상태다 — 여기서 풀면 소리가 겹친다.
      if (hostMutedByMultiView()) {
        info(`unmute retry skipped (${reason}): multiview keeps the host player muted`);
        return;
      }
      /*
       * 🔴 자동재생을 살리려고 **우리가** 건 음소거는 시간이 지난다고 풀리지 않는다
       * (풀면 브라우저가 곧바로 다시 멈춘다). 이때 백오프를 걸면 `attemptUnmute` 가 시도
       * 횟수를 올리지 않고 즉시 false 를 돌려주므로 상한에 영원히 닿지 않는 무한 타이머가 된다.
       * 이 상태의 주인은 제스처 재시도다.
       */
      if (mutedForAutoplay) {
        info(`unmute retry deferred (${reason}): muted to keep blocked autoplay alive`);
        armGestureRetry();
        return;
      }
      if (unmuteTimer !== undefined) return;
      if (unmuteAttempts >= UNMUTE_MAX_ATTEMPTS) {
        // 자동 재시도는 끝났지만 사용자가 무언가를 누르면 그때 한 번 더 해 본다.
        warning(
          `auto unmute still blocked after ${unmuteAttempts} attempts (${reason}); waiting for a user gesture`,
        );
        armGestureRetry();
        return;
      }
      const delay =
        UNMUTE_RETRY_DELAYS_MS[Math.min(unmuteAttempts, UNMUTE_RETRY_DELAYS_MS.length - 1)] ??
        5_000;
      info(`unmute retry #${unmuteAttempts + 1} in ${delay}ms (${reason})`);
      unmuteTimer = setTimeout(() => {
        unmuteTimer = undefined;
        void guardAsync('volume:unmute-retry', async () => {
          if (disposed || !video) return;
          if (!isMuted()) return;
          const ok = await attemptUnmute();
          if (!ok) scheduleUnmuteRetry(reason);
          render();
        });
      }, delay);
    };
    disposers.push(() => {
      if (unmuteTimer !== undefined) clearTimeout(unmuteTimer);
      unmuteTimer = undefined;
    });

    const applyAll = async () => {
      // 초기·재적용에서는 저장하지 않는다 (위 무한 루프 주석 참조).
      setPercent(percent, false);
      if (!ctx.settings.volume.autoUnmute || hostMutedByMultiView() || !isMuted()) {
        render();
        return;
      }
      const ok = await attemptUnmute();
      // 실패했으면 제스처 대기 + 백오프 재시도를 **함께** 건다. 어느 쪽이 먼저 성공해도 된다.
      if (!ok) {
        armGestureRetry();
        scheduleUnmuteRetry('initial apply failed');
      }
      render();
    };

    /** 플레이어 자체 복원 로직과의 경합을 피해 초기화 후 1회 재확인한다. */
    const applyAndVerify = () => {
      if (started || disposed) return;
      started = true;
      void guardAsync('volume', async () => {
        await applyAll();
        await sleep(800);
        if (disposed || !video) return;
        const drifted = unitToPercent(video.volume) !== percent;
        const stillMuted =
          ctx.settings.volume.autoUnmute && isMuted() && unmuteAttempts < UNMUTE_MAX_ATTEMPTS;
        if (drifted || stillMuted) await applyAll();
      });
    };

    /**
     * 🔴 자동재생이 막혀 **재생 버튼을 눌러야 하는 상태**를 우리가 대신 풀어 준다
     * (사용자 보고 2026-08-19 "새로고침하거나 새 탭으로 열면 바로 재생이 안 된다").
     *
     * 실측 근거 (`scripts/probe-autoplay-ab.mjs`, 3프로필 A/B):
     * - **확장 없이도 발생한다** — 엄격 정책(`--autoplay-policy=user-gesture-required`)의 대조군에서
     *   `paused=true · muted=false · readyState=0 · currentTime=0` 으로 재생이 시작조차 안 됐다.
     *   즉 우리가 만든 결함이 아니라 치지직 + 브라우저 정책의 결과다.
     * - 그 상태에서 **음소거 후 `video.play()` 는 듣지 않는다** (오류도 없이 그대로 paused).
     *   `readyState=0` 이라 치지직이 스트림을 아직 붙이지 않았기 때문이다 → 우리가 직접 재생시킬 수
     *   없고, **치지직 자신의 재생 경로**(플레이어 재생 버튼)를 밟아야 한다.
     * - 정책은 "음소거 재생"은 허용하므로 먼저 음소거로 만든 뒤 누른다. 소리는 첫 사용자 제스처에서
     *   되돌린다 (FR-02 의 기존 계약과 같다 — `armGestureRetry`).
     *
     * ⚠️ **사용자가 직접 멈춘 것을 다시 재생시키지 않는다.** `navigator.userActivation.hasBeenActive`
     * 가 참이면(= 이 페이지에서 사용자가 한 번이라도 조작했다) 손대지 않는다. 구현이 없는 환경에서는
     * 보수적으로 아무것도 하지 않는다.
     */
    const rescueBlockedAutoplay = () => {
      const el = video;
      if (disposed || !el || !el.paused) return;
      if (mutedForAutoplay || autoplayRescueTries >= AUTOPLAY_RESCUE_MAX_TRIES) return;

      /*
       * ⚠️ **사용자가 직접 멈춘 것은 건드리지 않는다.** 기준을 두 번 갈아 끼운 끝에 남은 규칙이다.
       * ① `navigator.userActivation.hasBeenActive` — 못 쓴다. 사람이 아무것도 누르지 않은 첫 샘플부터
       *    참이었다 (실측 2026-08-19, 자동화·합성 클릭으로 오염된다).
       * ② `currentTime === 0` — 못 쓴다. **라이브는 붙는 순간 currentTime 이 라이브 엣지**(실측 3597초)라
       *    항상 0 이 아니다. 이 조건 때문에 폴백이 한 번도 걸리지 않았다.
       * ③ 지금 규칙: **`pause` 이벤트 시점의 일시적 활성화**(`userActivation.isActive`)로 가른다.
       *    사용자가 방금 누른 결과의 pause 만 참이 되므로, 자동재생 차단으로 멈춘 것과 구분된다.
       *    우리가 붙기 전부터 멈춰 있던 경우(pause 이벤트 미관측)는 진입 직후 창 안에서만 되살린다.
       */
      if (pauseWasUserGesture) return;
      if (Date.now() - attachedAt > AUTOPLAY_RESCUE_WINDOW_MS) return;

      /*
       * 🔴 **보이는 것만 찾으면 안 된다.** 재생 버튼은 자동 숨김 컨트롤바 안에 있어 평소 rect 가
       * 0×0 이다 — 실측(2026-08-19)에서 차단된 모바일 프로필의 폴백이 이것 때문에 한 번도
       * 실행되지 않았다. 숨어 있어도 `click()` 은 치지직 핸들러에 도달하므로 존재만 확인한다.
       */
      const button =
        qsVisible<HTMLElement>(dom.playbackSwitch) ?? qs<HTMLElement>(dom.playbackSwitch);
      if (!button) return;

      const wasMuted = el.muted;
      autoplayRescueTries += 1;
      el.muted = true;
      mutedForAutoplay = true;
      /*
       * 🔴 이 합성 클릭은 **프레임에 일시적 사용자 활성화를 만든다.** 표시해 두지 않으면
       * 바로 다음 `volumechange` 가 "사용자가 음소거했다"로 오판돼 자동 해제 재시도가 통째로
       * 막힌다 (실측 2026-08-27 — 멀티뷰 슬롯에서 실제로 그랬다).
       */
      markSyntheticInput(() => button.click());
      /*
       * 버튼만으로 안 붙는 경우가 있다 (실측: 클릭 뒤 `readyState` 는 4가 됐는데 여전히 paused).
       * 스트림이 붙은 뒤라면 음소거 재생은 정책상 허용되므로 직접 한 번 더 밀어 준다.
       * 실패는 정상 흐름으로 삼킨다 — 다음 틱에서 상한(3회)까지 다시 시도한다.
       */
      // ⚠️ `play()` 가 프로미스를 돌려주지 않는 환경(jsdom·구형)도 있다 — 옵셔널 체이닝으로 감싼다.
      void el.play()?.catch?.(() => undefined);
      persistNative(percent, true);
      info('autoplay was blocked; started muted playback via the player button');
      // 소리는 첫 사용자 제스처 뒤에 되돌린다. 음소거 자동 해제를 끈 사용자는 그대로 둔다.
      if (!wasMuted && ctx.settings.volume.autoUnmute) armGestureRetry();
    };

    // 네이티브 슬라이더·`m` 단축키로 바뀐 값도 표시와 저장에 반영한다.
    const onVolumeChange = (e: Event) => {
      const el = e.currentTarget as HTMLVideoElement | null;
      if (!el) return;
      const observed = unitToPercent(el.volume);
      if (!el.muted && observed !== percent) {
        percent = observed;
        persist(percent);
      }
      /*
       * 🔴 **플레이어가 스스로 음소거를 되돌린 경우**를 여기서 잡는다 (멀티뷰 슬롯의 주 증상).
       * 슬롯은 `localStorage['player-volume-muted']` 를 쓰지 않으므로 호스트가 남긴 `true` 를
       * 물려받아, 초기 해제에 성공한 뒤에도 리렌더·재접속 시점에 다시 음소거로 돌아간다.
       * 예전 구현은 초기 적용 이후로는 아무도 이걸 보지 않아 그대로 굳었다.
       *
       * ⚠️ 사용자가 직접 건 음소거(`m` 키·볼륨 버튼)는 되돌리지 않는다 — 일시적 사용자
       * 활성화(`isUserInitiated`)로 가른다. 자동재생 때문에 우리가 건 음소거도 건너뛴다
       * (`mutedForAutoplay`, 제스처 재시도가 담당한다).
       */
      if (el.muted && ctx.settings.volume.autoUnmute) {
        if (isUserInitiatedStrict()) info('stayed muted: the user muted it, not the player');
        else scheduleUnmuteRetry('player re-muted itself');
      }
      render();
    };

    // ── `video` 재부착 ───────────────────────────────────────────────────────
    const markPlayed = () => {
      // 재생이 시작되면 이전 pause 판정은 의미가 없다.
      pauseWasUserGesture = false;
    };

    /**
     * 멈춘 이유를 기록한다. `userActivation.isActive` 는 **사용자가 방금 조작했을 때만** 참인
     * 일시적 활성화라, 자동재생 차단으로 멈춘 것과 사용자가 누른 것을 가를 수 있다.
     */
    const markPaused = () => {
      pauseWasUserGesture = navigator.userActivation?.isActive === true;
    };

    const detachVideo = () => {
      if (!video) return;
      video.removeEventListener('volumechange', onVolumeChange);
      video.removeEventListener('playing', markPlayed);
      video.removeEventListener('pause', markPaused);
      video.removeEventListener('playing', applyAndVerify);
      video.removeEventListener('loadeddata', applyAndVerify);
      video = null;
    };
    disposers.push(detachVideo);

    /**
     * 지금 문서에 있는 `video` 를 찾아 붙는다. 이미 같은 요소면 아무것도 하지 않는다.
     *
     * 🔴 요소가 **교체된** 경우에도 동작해야 한다 (전체화면 전환이 대표적). 옛 요소의 리스너를
     * 먼저 떼고 `started`·`unmuteAttempts` 를 초기화해 새 요소에 볼륨을 다시 적용한다 —
     * `hostPlayer.ts` 의 `attach()` 와 같은 계약이다.
     *
     * @returns 지금 붙어 있는가
     */
    const attachVideo = (): boolean => {
      if (disposed) return false;
      const next = qs<HTMLVideoElement>(dom.video, qs<HTMLElement>(dom.root) ?? document);
      if (!next) return false;
      if (next === video) return true;

      detachVideo();
      video = next;
      attachedAt = Date.now();
      // 새 요소이므로 초기 적용을 다시 한다. 시도 횟수도 함께 초기화한다.
      started = false;
      unmuteAttempts = 0;
      next.addEventListener('volumechange', onVolumeChange);
      next.addEventListener('playing', markPlayed);
      next.addEventListener('pause', markPaused);
      if (next.readyState >= 2 || !next.paused) {
        applyAndVerify();
      } else {
        next.addEventListener('playing', applyAndVerify, { once: true });
        next.addEventListener('loadeddata', applyAndVerify, { once: true });
      }
      return true;
    };

    // ── 준비 대기 (상한 있음) ────────────────────────────────────────────────
    let stopGuard: Disposer | undefined;
    let guardTarget: Node | null = null;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    let readyRounds = 0;
    let gaveUp = false;

    const clearReadyWatch = () => {
      if (readyTimer === undefined) return;
      clearTimeout(readyTimer);
      readyTimer = undefined;
    };

    const stopWatching = () => {
      clearReadyWatch();
      stopGuard?.();
      stopGuard = undefined;
      guardTarget = null;
    };
    disposers.push(stopWatching);

    const giveUp = (reason: string) => {
      if (gaveUp) return;
      gaveUp = true;
      stopWatching();
      detachVideo();
      node?.remove();
      node = null;
      valueEl = null;
      compressorButtonEl = null;
      // 셀렉터 실패는 이 기능만 조용히 비활성으로 끝낸다 (NFR-05).
      warning(`volume feature disabled: video element not found (${reason})`);
    };

    /**
     * 값싼 준비 판정 — 라운드를 셀 가치가 있는 상태인가.
     * 컨트롤바가 이미 렌더됐는데 `video` 만 없는 것은 진짜 이상 상황이다. 광고 구간에는
     * 컨트롤바 DOM 이 아예 없으므로 여기서 걸러져 예산을 쓰지 않는다 (`quality.ts` 와 같은 장치).
     */
    const playerReady = (): boolean => qs(dom.buttonsRight) !== null;

    const ensureAttached = () => {
      if (disposed || gaveUp) return;
      ensureGuard();
      ensureTapListener();

      if (!attachVideo()) {
        if (!playerReady()) return;
        readyRounds += 1;
        if (readyRounds >= MAX_READY_ROUNDS) giveUp(`no video after ${readyRounds} rounds`);
        return;
      }

      readyRounds = 0;
      clearReadyWatch();
      // 자동재생이 막혀 멈춰 있으면 여기서 되살린다 (준비 상태와 무관하게 매 틱 확인).
      rescueBlockedAutoplay();
      // 컨트롤바는 리렌더 시 자식을 날린다 → 매번 존재를 확인해 다시 넣는다.
      if (!isMounted()) mount();
    };

    /**
     * 감시 대상을 **가능한 한 좁게** 잡되, 아직 없으면 문서 루트로 시작해 나중에 승격한다.
     *
     * 🔴 `.pzp-pc` 를 감시 대상으로 잡으면 안 된다 — 플레이어가 리렌더되면 그 노드가 문서에서
     * 떨어져 감시가 통째로 끊긴다. 이것이 `controlBar.ts` 가 `document.documentElement` 를 쓰는
     * 이유이자(주석에 명시), 이번 결함에서 볼륨만 사라지고 설정·멀티뷰 버튼은 남은 이유다.
     * 반대로 문서 루트를 계속 관찰하면 라이브 채팅 메시지마다 옵저버가 깨어난다 (NFR-04).
     * → 플레이어 컨테이너가 생기는 즉시 그쪽으로 옮긴다 (`hostPlayer.ts` 와 같은 앵커).
     */
    function ensureGuard(): void {
      const next: Node = qs(dom.layout) ?? document.documentElement;
      if (next === guardTarget) return;
      stopGuard?.();
      guardTarget = next;
      stopGuard = observe(next, () => guard('volume:ensure', ensureAttached), {
        debounceMs: ctx.device.profile.relaxObservers ? 400 : 200,
      });
    }

    ensureAttached();
    if (!video && !gaveUp) {
      // 여기서 끝내지 않는다 — 콘텐츠 스크립트는 플레이어보다 먼저 뜬다. 상한 안에서 기다린다.
      readyTimer = setTimeout(() => giveUp('ready window elapsed'), READY_WINDOW_MS);
    }

    return () => {
      disposed = true;
      persist.cancel();
      if (tapTimer !== undefined) clearTimeout(tapTimer);
      for (const dispose of disposers) guard('volume:dispose', dispose);
      node?.remove();
      node = null;
      valueEl = null;
      compressorButtonEl = null;
    };
  },
};
