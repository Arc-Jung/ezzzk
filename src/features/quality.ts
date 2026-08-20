/**
 * FR-01 화질 자동 선택 (라이브 · VOD · 모바일 웹).
 *
 * 실측 근거 (2026-08-11, 분석 문서 §3.2)
 * - 목록은 `li.pzp-ui-setting-quality-item`, 선택 표시는 **`--checked` 클래스뿐**이다.
 *   `aria-checked` 속성은 존재하지 않는다.
 * - 항목 텍스트에 탭·개행이 섞인다: `"1080p(원본) \n\t\t HD   \n\t\t60fps"`.
 *   → 공백 정규화 후 **접두어 매칭**(`/^1080p/`). 정확히 일치 비교는 실패한다.
 * - 목록 구성이 페이지마다 다르다 → **최고 화질 폴백이 필수**다.
 *   (재실측 2026-08-15 `quality-vod-mobile-shots/report.json` — VOD·모바일 구성 재확인)
 *   · 라이브: `1080p(원본)` `720p` `480p` `360p`
 *   · VOD: `자동 (1080p) HD 60fps` `1080p(원본) HD 60fps` `720p HD 60fps` `144p`
 *     ← 480p·360p 없음, **중복 매칭 없음**(4개)
 *   · 모바일: `자동` `1080p(원본)` `720p` `480p` `360p` `144p` — **각 항목이 2회 중복 매칭**
 *     (12개 = 6종×2). 초기 화질이 **항상 360p** 로 시작하므로 이 기능의 효과가 가장 크다.
 * - 정책: `자동 (1080p…)` 처럼 괄호 안 해상도가 목표와 같으면 **이미 목표 달성**으로 보고
 *   클릭하지 않는다. 불필요한 클릭으로 치지직 자동 화질 선택을 깨지 않기 위함이다.
 * - 🔴 설정 버튼은 `button.pzp-pc__setting-button` 이 **3개 매칭**되고 첫 번째가 0×0 /
 *   `display:none` 이라 폴백이 조용히 실패한다 → `aria-label` 기반 셀렉터 + `qsVisible`.
 * - 🔴 **항목 활성화는 `click()` 이 아니라 합성 `keydown` Enter 로 한다** (실측 2026-08-15).
 *   근거·수치는 `activateQualityItem` 주석 참조.
 */

import { ID, PLAYER } from '../constants/class';
import { MOBILE_PLAYER } from '../constants/classMobile';
import type { QualityTarget } from '../constants/storage';
import { hasPlayer, type PageType } from '../pageType';
import { normalizeText, qs, qsa, qsVisible, retry, sleep } from '../utils/dom';
import { guardAsync, info, warning } from '../utils/log';
import { observe } from '../utils/observe';
import { AD } from './adSkip';
import type { Feature } from './types';

export type ParsedQuality = {
  /** `자동` 으로 시작하는 항목인가 */
  isAuto: boolean;
  /** 항목이 특정 해상도를 뜻할 때의 높이(px). `자동` 계열은 null */
  heightPx: number | null;
  /** `자동 (1080p)` 의 괄호 안 해상도. 그 외는 null */
  autoResolution: number | null;
};

export type QualityPick = { index: number; reason: string };

/** 목표 화질 → 해상도 높이(px). `auto`(=끄기)·`best`(=최고화질)는 특정 높이가 없다. */
const TARGET_HEIGHT: Record<string, number> = { '1080p': 1080, '720p': 720, '480p': 480 };

export function targetHeightPx(target: QualityTarget): number | null {
  return TARGET_HEIGHT[target] ?? null;
}

/** 탭·개행이 섞인 원본 텍스트를 비교 가능한 형태로 정규화한다. */
export function normalizeQualityLabel(raw: string): string {
  return normalizeText(raw);
}

/** `1080p(원본) HD 60fps` · `자동 (1080p) HD` · `자동` · `144p` 를 모두 해석한다. */
export function parseQualityLabel(label: string): ParsedQuality {
  const text = normalizeQualityLabel(label);

  if (text.startsWith('자동')) {
    const inParens = /\((\d{2,4})p/.exec(text)?.[1];
    return {
      isAuto: true,
      heightPx: null,
      autoResolution: inParens === undefined ? null : Number(inParens),
    };
  }

  const head = /^(\d{2,4})p/.exec(text)?.[1];
  return {
    isAuto: false,
    heightPx: head === undefined ? null : Number(head),
    autoResolution: null,
  };
}

/** 접두어 매칭. `1080p(원본)` 은 `1080p` 목표에 걸린다. */
export function matchesTarget(label: string, target: QualityTarget): boolean {
  const text = normalizeQualityLabel(label);
  if (text.length === 0) return false;
  if (target === 'auto') return text.startsWith('자동');
  // 최고화질은 접두어로 특정할 수 없다 — 목록 전체 비교(pickQualityItem)로 정한다.
  if (target === 'best') return false;
  return text.startsWith(target);
}

/**
 * 이 항목이 선택된 상태라면 목표를 이미 만족하는가.
 *
 * 🔴 **`자동 (1080p)` 는 달성이 아니다** (사용자 보고 2026-08-12: "화질 자동 1080p 가 작동을 안 해").
 * `자동` 은 지금 1080p 로 재생 중이라는 뜻일 뿐이고 대역폭이 흔들리면 720p·480p 로 내려간다.
 * 목표 해상도를 **고정하는 항목이 목록에 있으면 그것을 눌러야** 한다.
 *
 * 단, 고정 항목이 아예 없는 경우(예: VOD 가 `자동 (1080p)` 만 제공)에는 그것이 최선이므로
 * 달성으로 인정한다 — 없는 항목을 찾다 실패하고 매번 설정 메뉴를 여는 것보다 낫다.
 *
 * @param availableLabels 현재 화질 목록. 비우면 고정 항목 유무를 알 수 없어 예전처럼 관대하게 본다.
 */
export function isAlreadyAchieved(
  label: string,
  target: QualityTarget,
  availableLabels: readonly string[] = [],
): boolean {
  if (matchesTarget(label, target)) return true;
  const want = targetHeightPx(target);
  if (want === null) return false;
  const parsed = parseQualityLabel(label);
  if (!parsed.isAuto || parsed.autoResolution !== want) return false;

  const hasExplicit = availableLabels.some((candidate) => matchesTarget(candidate, target));
  return !hasExplicit;
}

/**
 * 목표 매칭 → 최고 화질 폴백. 중복 항목(모바일 웹)은 제거하고 **처음 등장한 인덱스**를 돌려준다.
 * 폴백 후보에서 `자동` 항목은 제외한다 — 해상도를 특정할 수 없어 "최고"인지 판정할 수 없다.
 */
export function pickQualityItem(labels: string[], target: QualityTarget): QualityPick | null {
  const unique: { index: number; text: string }[] = [];
  const seen = new Set<string>();
  labels.forEach((raw, index) => {
    const text = normalizeQualityLabel(raw);
    if (text.length === 0 || seen.has(text)) return;
    seen.add(text);
    unique.push({ index, text });
  });
  if (unique.length === 0) return null;

  if (target !== 'best') {
    const hit = unique.find((item) => matchesTarget(item.text, target));
    if (hit) return { index: hit.index, reason: `target match "${hit.text}"` };
    // `자동` 목표는 자동 항목이 없으면 대체할 수 있는 것이 없다.
    if (target === 'auto') return null;
  }

  let best: { index: number; text: string; height: number } | null = null;
  for (const item of unique) {
    const { heightPx } = parseQualityLabel(item.text);
    if (heightPx === null) continue;
    if (best === null || heightPx > best.height) {
      best = { index: item.index, text: item.text, height: heightPx };
    }
  }
  if (best === null) return null;

  return {
    index: best.index,
    reason:
      target === 'best'
        ? `best available "${best.text}"`
        : `target ${target} unavailable, fallback to "${best.text}"`,
  };
}

/**
 * 지금 광고가 재생 중인가.
 *
 * 🔴 광고는 본 플레이어가 아니라 **별도의 레거시 네이버 광고 플레이어**로 재생되고, 그 마크업은
 * `adSkip.ts` 가 이미 실측해 두었다(`button.btn_skip` 은 광고 시작부터 DOM 에 존재하고 `display`
 * 만 바뀐다). 여기서는 **보이는지가 아니라 존재하는지**를 본다 — 카운트다운 중(숨김 상태)도
 * 광고 구간이기 때문이다. 셀렉터를 새로 만들지 않고 `adSkip.ts` 의 것을 그대로 재사용한다.
 */
export function adInProgress(root: ParentNode = document): boolean {
  return qsa(AD.skipButton, root).length > 0 || qsa(AD.advertiserLink, root).length > 0;
}

type QualityDom = {
  itemSelector: string;
  checkedClass: string;
  settingButton: string;
  /** 되돌림 판정에 쓸 `<video>`. ⚠️ 문서 전체의 첫 video 를 잡으면 안 된다 — 페이지별로 범위를 준다. */
  video: string;
};

/**
 * 초기 시도가 실패한 뒤 플레이어가 준비되기를 기다리는 상한 (2분).
 *
 * 🔴 근거 (사용자 보고 2026-08-15: "광고 차단 안내 팝업이 뜨면 1080p 자동 전환이 안 된다").
 * 최초 백오프는 5회 · 약 3초라 아래 상황을 전혀 못 넘긴다.
 * - `광고 차단 프로그램을 사용 중이신가요?` 모달이 떠 있는 동안 설정 버튼이 가려져 5회 전부 실패
 * - 광고 재생 중에는 컨트롤바 DOM 자체가 없다 (프로젝트 규칙 · 실측)
 * 프리롤 광고가 1분을 넘는 경우까지 감안해 2분을 잡는다. 그보다 오래 걸리면 정상 상태가
 * 아니라고 보고 조용히 포기한다 (NFR-05).
 */
const READY_WINDOW_MS = 120_000;

/**
 * 재시도 라운드 상한. 시간 상한만 두면 "설정 버튼은 보이는데 목록이 끝내 안 뜨는" 상태에서
 * 2분 내내 버튼을 누르게 된다 → 라운드 수로도 막는다 (라운드당 최대 2회 클릭 = 총 20회 이하).
 */
const MAX_READY_ROUNDS = 10;

/**
 * 적용에 성공한 뒤 **화질이 도로 내려갔는지** 확인하는 주기.
 *
 * 🔴 근거 (실측 2026-08-15, `adblock-shots/report.json`). 애드가드를 물려 광고 차단이 감지된
 * 상태에서 로그는 이렇게 남았다:
 * ```
 * quality applied: target match "1080p(원본) HD 60fps"   ← 우리가 적용했다(고 로그만 남았다)
 * … 잠시 뒤 실제 체크 화질은 360p
 * ```
 * ⚠️ 당시에는 이것을 "치지직이 되돌렸다"로 읽었으나 **그 진단은 틀렸다** — 실제로는 우리
 * 합성 `click()` 자체가 무효라 애초에 적용된 적이 없었다(2026-08-15 keydown 프로브로 확인).
 * 그래도 감시 자체는 남긴다: 대역폭 저하 등으로 해상도가 실제로 내려가는 경우는 여전히 있다.
 * 목록 옵저버는 `childList` 만 본다(`--checked` 는 우리 조작으로도 바뀌어 자기 트리거 루프가 된다).
 * 그래서 **목록 구성이 그대로인 채 선택만 바뀌는 되돌림을 놓친다.**
 * → DOM 속성 대신 `video.videoHeight`(실제 디코딩 해상도)로 확인한다. 설정 패널을 열 필요가 없고
 *   우리 클릭이 트리거가 되지도 않는다.
 */
const DRIFT_CHECK_MS = 5_000;

/**
 * 되돌림을 다시 고치기까지의 최소 간격.
 *
 * 🔴 **재적용 상한은 두지 않는다** (사용자 요청 2026-08-15: "1080p 포기하지 말고 계속 눌러서
 * 계속 1080p 세팅 하도록 하자"). 이전에는 5회 시도 후 물러났다.
 *
 * ⚠️ **예전에 여기 적혀 있던 "치지직이 광고 차단 감지 시 화질을 360p 로 강제 고정한다"는
 * 진단은 틀렸다.** 그때 강제 재적용 5회가 `videoHeight` 를 전혀 올리지 못한 이유는 사이트
 * 정책이 아니라 **우리 합성 `click()` 이 무효였기 때문**이다 (실측 2026-08-15,
 * `quality-ext-noui-shots/report.json`: keydown Enter 로는 애드가드가 로드된 상태에서도
 * 360p→1080p 전환이 성공했고 이후 40초 20샘플 전부 1080 을 유지했다).
 * 이제 재적용도 `activateQualityItem`(keydown 우선)을 쓰므로 실제로 효과가 있다.
 *
 * 상한이 없으므로 간격은 그만큼 중요해진다. 15초는 초 단위 핑퐁을 만들지 않으면서,
 * 회복 가능한 상황을 오래 방치하지도 않는 값이다.
 */
const DRIFT_COOLDOWN_MS = 15_000;

/**
 * 되돌림으로 인정하기까지 필요한 **연속** 샘플 수.
 *
 * 🔴 근거 (코드 리뷰 2026-08-15, M4). 광고가 본 플레이어와 같은 `<video>` 로 480p 재생되면
 * 1회 샘플만으로는 치지직의 화질 되돌림과 구분되지 않는다. 오판하면 설정 패널이 실제로
 * 열렸다 닫히며 깜빡이고, 재적용 예산(5회)도 광고가 소진한다.
 * → 광고 신호(`adInProgress`)로 한 겹, 연속 샘플로 또 한 겹 막는다.
 */
const DRIFT_CONFIRM_SAMPLES = 3;

/**
 * 되돌림으로 볼 여유 폭(px). 인코딩 사정으로 1080 대신 1072 같은 값이 오는 경우까지
 * 되돌림으로 오판하지 않게 한다.
 */
const DRIFT_TOLERANCE_PX = 60;

/** 실제 재생 해상도가 목표보다 낮아졌는가. 순수 함수 — 테스트 대상. */
export function isQualityDrifted(videoHeight: number, targetPx: number | null): boolean {
  if (targetPx === null) return false;
  // 0 은 아직 메타데이터가 없다는 뜻이다 (광고 전환·버퍼링). 되돌림으로 보지 않는다.
  if (!Number.isFinite(videoHeight) || videoHeight <= 0) return false;
  return videoHeight + DRIFT_TOLERANCE_PX < targetPx;
}

/**
 * keydown 을 보낸 뒤 `--checked` 가 옮겨갔는지 확인하기까지의 대기.
 * 실측(아래 프로브)에서 적용은 즉시 반영됐고, 200~300ms 면 렌더 지연까지 흡수한다.
 */
const ACTIVATE_VERIFY_MS = 250;

export type ActivateVia = 'keydown' | 'click';

/**
 * 화질 항목을 **활성화**한다. 클릭이 아니라 **합성 `keydown` Enter 가 1순위**다.
 *
 * 🔴 실측 근거 (2026-08-15, `quality-ext-noui-shots/report.json` — 프로브는
 * `scripts/probe-quality-keyboard.mjs` · `scripts/probe-quality-noui.mjs` ·
 * `scripts/probe-quality-ext-noui.mjs`).
 * 격리 월드(일반 콘텐츠 스크립트) + 설정 UI 를 **열지 않은** 상태에서 LCK 채널 실측:
 * ```
 * ① → 360p : rect={w:0,h:0} → checked=360p  videoHeight=360
 * ② → 1080p: rect={w:0,h:0} → checked=1080p videoHeight=1080   (적용 후 40초 20샘플 전부 1080 유지)
 * ```
 * - 같은 항목에 대한 `element.click()` 은 **실패한다** — 이것이 "확장이 화질을 못 바꾸던" 진짜 원인이다.
 * - 설정 패널을 열 필요가 없다. 0×0 숨은 항목에 보내도 동작한다.
 * - `focus()` · `keyCode`/`which` 는 불필요하고, `world:"MAIN"` 등 추가 권한도 필요 없다.
 * - 원인(추정): 항목이 Vue 컴포넌트이고(`el.__vue__`) props 에 `onClick` 과 **별도로 `onEnter`** 가 있다.
 *   클릭 경로에만 신뢰된 이벤트(`isTrusted`) 검사가 걸린 것으로 보인다(미검증).
 *
 * 세 화면 모두 실측으로 확인됐다 (2026-08-15, `scripts/probe-quality-vod-mobile.mjs` ·
 * `quality-vod-mobile-shots/report.json`):
 * | 화면 | keydown Enter | `element.click()` | 설정 패널 개봉 |
 * |---|---|---|---|
 * | 라이브 | ✓ (360↔1080) | ✗ | 불필요 |
 * | VOD | ✓ (144↔1080, 영상 2건) | ✗ (`144p→144p`, 변화 없음) | 불필요 |
 * | 모바일 웹 | ✓ (360↔1080) | ✓ | **열 수단이 아예 없음** |
 *
 * ⚠️ **클릭 폴백은 만능이 아니다.** 위 표대로 `element.click()` 은 **라이브·VOD 에서 실패가
 * 확인됐고 모바일 웹에서만 통한다.** 그래도 폴백을 남기는 이유는 비용이 0 이고(어차피 무시된다)
 * 치지직이 구현을 바꿔 keydown 이 막히는 경우의 마지막 보루이기 때문이다 (NFR-05).
 *
 * **격리 월드(콘텐츠 스크립트)** 에서의 동작 — 확장이 실제로 놓이는 조건이다:
 * - 라이브: 확인 (`quality-ext-noui-shots/report.json`)
 * - VOD: 확인 (2026-08-15 A/B 대조. 실제 `dist` 를 로드하고 **진짜 사용자 클릭**으로 144p 로
 *   내린 뒤 관찰 — 확장 있음: 약 12초 만에 1080 복구 후 39샘플 유지 /
 *   확장 없음: 90초 내내 144 고정. 사이트가 스스로 되돌리는 것이 아님이 대조로 확정됐다)
 * - ⚠️ 모바일 웹: **미검증**. 위 프로브가 main world 로만 측정했다. 순수 DOM 이벤트라 같을
 *   것으로 보이나 **추정이다**. (모바일은 `element.click()` 도 통하므로 폴백이 실효를 가진다.)
 */
export async function activateQualityItem(
  el: HTMLElement,
  checkedClass: string,
): Promise<ActivateVia> {
  /**
   * ⚠️ 이미 체크된 항목이면 keydown 이 먹었는지 **판별할 방법이 없다** (드리프트 강제 재적용이
   * 정확히 그 상황이다 — 라벨은 목표 그대로인데 실제 해상도만 낮다). 그때는 판별을 포기하고
   * 폴백까지 함께 보낸다. 실사이트에서 클릭은 어차피 무시되므로 부작용이 없다.
   */
  const wasChecked = el.classList.contains(checkedClass);
  el.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }),
  );
  await sleep(ACTIVATE_VERIFY_MS);
  if (!wasChecked && el.classList.contains(checkedClass)) return 'keydown';
  el.click();
  return 'click';
}

function domFor(page: PageType): QualityDom {
  if (page === 'mobile-web') {
    return {
      itemSelector: MOBILE_PLAYER.qualityItem,
      checkedClass: MOBILE_PLAYER.qualityItemChecked,
      settingButton: MOBILE_PLAYER.settingButton,
      video: `${MOBILE_PLAYER.playerLayout} ${MOBILE_PLAYER.video}`,
    };
  }
  return {
    itemSelector: PLAYER.qualityItem,
    checkedClass: PLAYER.qualityItemChecked,
    settingButton: PLAYER.settingButton,
    // ⚠️ VOD 는 플레이어 컨테이너 ID 가 다르다 (`#player_layout`, 실측 2026-08-11).
    video:
      page === 'vod'
        ? `${ID.vodPlayerLayout} ${PLAYER.video}`
        : `${ID.livePlayerLayout} ${PLAYER.video}`,
  };
}

export const qualityFeature: Feature = {
  id: 'quality',
  watches: ['quality'],
  supports: (ctx) => {
    if (!ctx.settings.quality.enabled) return false;
    // 설정 표기가 `자동(끄기)` 이므로 auto 는 "적용하지 않음" 을 뜻한다.
    if (ctx.settings.quality.target === 'auto') return false;
    if (!hasPlayer(ctx.page.type)) return false;
    // 멀티뷰 슬롯의 화질은 FR-14(비활성 슬롯 화질 하향)가 관리한다 — 여기서 끼어들면 서로 싸운다.
    if (ctx.page.isSlotFrame) return false;
    if (ctx.page.type === 'vod' && !ctx.settings.quality.applyToVod) return false;
    return true;
  },
  start: (ctx) => {
    const dom = domFor(ctx.page.type);
    const target = ctx.settings.quality.target;

    let disposed = false;
    let running = false;
    let openedByUs = false;
    let stopObserve: (() => void) | undefined;
    let stopReadyObserve: (() => void) | undefined;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    let readyRounds = 0;
    let gaveUp = false;
    let driftTimer: ReturnType<typeof setInterval> | undefined;
    let driftReapplies = 0;
    let driftStreak = 0;
    let lastAppliedAt = 0;
    let firstRound = true;

    /** 우리가 열었을 때만 되닫는다 — 사용자가 열어 둔 설정 패널을 닫아 버리면 안 된다. */
    const closeSettingsIfOpened = () => {
      if (!openedByUs) return;
      openedByUs = false;
      qsVisible<HTMLElement>(dom.settingButton)?.click();
    };

    /**
     * @param force 조기 반환을 건너뛰고 목표 항목을 **반드시 다시 클릭**한다.
     *
     * 🔴 근거 (코드 리뷰 2026-08-15, M2). 이 기능이 근거로 삼은 실측 상황이 바로
     * "라벨은 `1080p(원본)` 인데 실제 해상도는 360p" 다. 라벨만 보고 `isAlreadyAchieved` 로
     * 조기 반환하면 되돌림 재적용이 **아무것도 누르지 않는 no-op** 이 되고, 재적용 예산과
     * 쿨다운만 소모하다 상한에서 물러난다. 드리프트 경로에서는 반드시 force 로 부른다.
     */
    const applyOnce = async (force = false): Promise<boolean> => {
      /**
       * 🔴 **숨은 항목(0×0)도 그대로 쓴다.** keydown Enter 는 패널을 열지 않아도 먹기 때문이다
       * (`activateQualityItem` 의 실측 근거 참조). 그래서 예전의 2단계 메뉴 개봉
       * (`설정 버튼 클릭` → `.pzp-setting-intro-quality` 클릭 → 되닫기)은 **불필요하고**,
       * 사용자 화면에 설정 패널이 깜빡이는 부작용만 있었다 → 걷어냈다.
       *
       * **라이브·VOD·모바일 웹 세 화면 모두 개봉이 불필요하다**는 것이 실측으로 확인됐다
       * (2026-08-15, `quality-vod-mobile-shots/report.json`). VOD 는 페이지 로드 직후 패널을
       * 한 번도 열지 않은 `rect 0×0` 항목에 keydown 을 보내 성공했다.
       *
       * 다만 **목록이 DOM 에 아예 없는 경우**(초기 렌더 전 등)에는 렌더를 유발할 방법이 없으므로
       * 그때만 설정 버튼을 누른다. 목록이 이미 있으면 절대 패널을 열지 않는다.
       */
      let items = qsa<HTMLElement>(dom.itemSelector);

      if (items.length === 0) {
        /**
         * ⚠️ **모바일 웹에는 설정 버튼이 아예 없다** (실측 2026-08-15). `classMobile.ts` 의
         * `settingButton: 'button[aria-label="설정"]'` 은 현재 m.chzzk DOM 과 맞지 않아
         * 프로브의 `page.click` 이 4회 시도 전부 timeout 났다 (실제로 있는 버튼은 `미러링`
         * `PIP 보기` `공유하기` `더보기` 뿐이다).
         * → 여기서는 셀렉터가 안 맞으면 **조용히 false 로 끝난다** (NFR-05). 반복 클릭·대기를
         *   유발하지 않는다. 모바일은 화질 목록이 항상 DOM 에 있어(12개 = 6종×2) 이 경로에
         *   애초에 들어오지 않는다.
         */
        const settingButton = qsVisible<HTMLElement>(dom.settingButton);
        if (!settingButton) return false;
        settingButton.click();
        openedByUs = true;
        await sleep(200);
        items = qsa<HTMLElement>(dom.itemSelector);
      }
      if (items.length === 0) {
        closeSettingsIfOpened();
        return false;
      }

      const labels = items.map((el) => normalizeQualityLabel(el.textContent ?? ''));
      const checkedIndex = items.findIndex((el) => el.classList.contains(dom.checkedClass));
      const checkedLabel = checkedIndex >= 0 ? labels[checkedIndex] : undefined;

      if (!force && checkedLabel !== undefined && isAlreadyAchieved(checkedLabel, target, labels)) {
        info(`quality already at target "${checkedLabel}"`);
        closeSettingsIfOpened();
        return true;
      }

      const pick = pickQualityItem(labels, target);
      if (!pick) {
        closeSettingsIfOpened();
        return false;
      }
      if (!force && pick.index === checkedIndex) {
        closeSettingsIfOpened();
        return true;
      }

      const item = items[pick.index];
      if (!item) {
        closeSettingsIfOpened();
        return false;
      }
      const via = await activateQualityItem(item, dom.checkedClass);
      info(`quality applied${force ? ' (forced)' : ''} via ${via}: ${pick.reason}`);
      closeSettingsIfOpened();
      return true;
    };

    /**
     * 방송 중 해상도 목록이 바뀌면 재적용한다.
     * ⚠️ `attributes` 는 보지 않는다 — `--checked` 클래스는 우리 클릭으로도 바뀌므로
     * 속성까지 관찰하면 자기 자신이 트리거가 되어 루프가 된다. 목록 변경은 childList 로 잡힌다.
     */
    const attachListObserver = () => {
      if (disposed || stopObserve) return;
      const list = qsa<HTMLElement>(dom.itemSelector)[0]?.parentElement;
      if (!list) return;
      // ⚠️ `run` 을 그대로 넘기면 MutationRecord 배열이 옵션 인자로 들어간다 — 래핑한다.
      stopObserve = observe(list, () => run(), {
        debounceMs: ctx.device.profile.relaxObservers ? 800 : 400,
        childList: true,
        subtree: false,
      });
    };

    /** 재시도 경로 정리. 성공·포기·해제 어디서 불려도 옵저버와 타이머가 남지 않게 한다. */
    const clearReadyWatch = () => {
      stopReadyObserve?.();
      stopReadyObserve = undefined;
      if (readyTimer !== undefined) clearTimeout(readyTimer);
      readyTimer = undefined;
    };

    /** 되돌림 감시 정리. 성공·포기·해제 어디서 불려도 인터벌이 남지 않게 한다. */
    const clearDriftWatch = () => {
      if (driftTimer === undefined) return;
      clearInterval(driftTimer);
      driftTimer = undefined;
    };

    const giveUp = (reason: string) => {
      if (gaveUp) return;
      gaveUp = true;
      clearReadyWatch();
      // 정리 함수의 계약: 성공·포기·해제 어디서 불려도 타이머가 남지 않게 한다.
      clearDriftWatch();
      // 셀렉터 실패는 이 기능만 조용히 비활성으로 끝낸다 (NFR-05).
      warning(`quality list not found (${reason}), feature disabled for this page`);
    };

    /**
     * 값싼 준비 판정. 라이브 페이지의 body 는 채팅 때문에 쉬지 않고 변하므로,
     * 무관한 변화로 재시도 라운드를 소모하지 않도록 먼저 걸러낸다.
     */
    const playerReady = (): boolean =>
      qsa(dom.itemSelector).length > 0 || qsVisible(dom.settingButton) !== null;

    /**
     * 초기 시도가 실패했을 때 플레이어가 나타나기를 기다린다.
     * ⚠️ 여기서도 `attributes` 는 보지 않는다 — `--checked` 클래스가 우리 클릭으로 바뀌어
     * 자기 자신이 트리거가 되는 루프가 된다. 노드 삽입(childList)만으로 충분하다.
     */
    const attachReadyObserver = () => {
      if (disposed || gaveUp || stopReadyObserve) return;
      stopReadyObserve = observe(
        document.body,
        () => {
          if (disposed || gaveUp || running) return;
          if (!playerReady()) return;
          run();
        },
        {
          debounceMs: ctx.device.profile.relaxObservers ? 1_000 : 500,
          childList: true,
          subtree: true,
        },
      );
      if (readyTimer === undefined) {
        readyTimer = setTimeout(() => giveUp('ready window elapsed'), READY_WINDOW_MS);
      }
    };

    /**
     * 적용 후 치지직이 화질을 도로 낮추는지 감시한다.
     * ⚠️ 설정 패널을 열지 않는다 — `video.videoHeight` 만 읽는다. 사용자 화면을 건드리지 않는
     * 유일한 확인 방법이고, 우리 클릭이 다시 트리거가 되는 루프도 생기지 않는다.
     */
    const startDriftWatch = () => {
      if (disposed || driftTimer !== undefined) return;
      const want = targetHeightPx(target);
      // `best` 처럼 목표 높이가 정해지지 않는 값은 되돌림을 판정할 기준이 없다.
      if (want === null) return;

      driftTimer = setInterval(() => {
        if (disposed || running) return;
        // 광고는 같은 `<video>` 로 낮은 해상도로 재생된다 → 되돌림으로 오판하지 않는다 (M4).
        if (adInProgress()) {
          driftStreak = 0;
          return;
        }

        const video = qs<HTMLVideoElement>(dom.video);
        if (!video || !isQualityDrifted(video.videoHeight, want)) {
          driftStreak = 0;
          return;
        }

        // 1회 샘플로는 광고·버퍼링과 구분되지 않는다 → 연속으로 관측될 때만 인정한다 (M4).
        driftStreak += 1;
        if (driftStreak < DRIFT_CONFIRM_SAMPLES) return;
        if (Date.now() - lastAppliedAt < DRIFT_COOLDOWN_MS) return;

        driftStreak = 0;
        driftReapplies += 1;
        // 상한이 없으므로 몇 번째 시도인지 남긴다 — 로그만으로 "계속 지고 있다"를 알 수 있어야 한다.
        info(
          `quality dropped to ${video.videoHeight}p, reapplying target ${target} (attempt ${driftReapplies})`,
        );
        // 🔴 force 로 부른다 — 라벨은 목표 그대로인 채 실제 해상도만 내려간 것이 실측 상황이다 (M2).
        run({ force: true });
      }, DRIFT_CHECK_MS);
    };

    /**
     * 🔴 `readyRounds` 는 **준비 대기 경로 전용 카운터**다 (코드 리뷰 2026-08-15, M3).
     * 예전 구현은 `run` 이 불릴 때마다 무조건 증가시켰는데, `run` 은 ① 초기 재시도 ② 목록 옵저버
     * ③ 드리프트 재적용 세 곳에서 불린다. 성공 후에도 라운드가 쌓여 상한을 넘긴 뒤 한 번만
     * 실패하면 그 페이지에서 화질 기능이 영구 비활성이 되고 로그도 사실과 달라진다.
     * → **실패했을 때만 증가**시키고 **성공하면 0 으로 리셋**한다.
     */
    function run(options: { force?: boolean } = {}): void {
      if (disposed || running || gaveUp) return;
      running = true;
      const isFirstRound = firstRound;
      firstRound = false;
      void guardAsync('quality', async () => {
        // 렌더 지연에 대비한 지수 백오프 재시도.
        // 재시도 라운드는 시도 횟수를 줄인다 — 옵저버가 준비 신호를 보고 다시 부르기 때문이다.
        const ok = await retry(() => applyOnce(options.force === true), {
          attempts: isFirstRound ? 5 : 2,
          baseDelayMs: 200,
          maxDelayMs: 2_000,
        });
        if (disposed) return;
        if (ok) {
          readyRounds = 0;
          lastAppliedAt = Date.now();
          clearReadyWatch();
          attachListObserver();
          startDriftWatch();
          return;
        }
        readyRounds += 1;
        if (readyRounds >= MAX_READY_ROUNDS) {
          giveUp(`no quality list after ${readyRounds} rounds`);
          return;
        }
        // 광고·광고 차단 모달로 플레이어가 아직 없을 수 있다 → 나타나면 다시 시도한다.
        attachReadyObserver();
      }).finally(() => {
        running = false;
      });
    }

    run();

    return () => {
      disposed = true;
      stopObserve?.();
      clearReadyWatch();
      clearDriftWatch();
    };
  },
};
