/**
 * 채팅 aside 폭의 단일 결정 지점 (요구사항 FR-05 · FR-10.7 · FR-14).
 *
 * FR-05(수동 조절)·FR-10(초광폭 계산값)·FR-14(멀티뷰)가 모두 같은 `#aside-chatting` 폭을
 * 건드리려 한다. 각 기능이 직접 스타일을 쓰면 마지막에 실행된 쪽이 이기는 경합이 되고
 * 재계산이 멱등하지 않게 된다 → **폭을 쓰는 곳은 이 모듈 하나뿐이다.**
 *
 * 우선순위: `멀티뷰 활성 > FR-10 > FR-05` (요구사항 FR-10.7)
 *
 * 설계: 순수 판정(`resolveWidth`) + 얇은 적용(`applyClaims`).
 * 적용은 항상 단일 `<style>`(`OURS.layoutStyleId`) 의 내용 교체다 — 노드를 누적하지 않고
 * 인라인 스타일도 쌓지 않는다 (FR-12.1 멱등성).
 *
 * 적용 CSS 는 실험으로 검증된 것을 그대로 쓴다 (분석 문서 §5.5, 2026-08-11 PASS).
 * ⚠️ `div[class*="_wrapper_wj4te"]` 의 `width: 100vw` 는 **초광폭(FR-10) 에서만** 넣는다.
 *    항상 넣으면 데스크톱에서 좌측 사이드바 폭까지 침범한다.
 */

import { CHZZK, ID, OURS, PLAYER } from './constants/class';
import { RESIZE } from './constants/device';
import { qs, removeStyle, upsertStyle } from './utils/dom';
import { observe, type Disposer } from './utils/observe';
import { info } from './utils/log';

export type WidthSource = 'multiView' | 'ultraWide' | 'chatWidth';

/**
 * 배치 방식.
 * - `flex`: flex 형제로 나란히 (기본)
 * - `overlay`: 영상 위 반투명 오버레이 (FR-10.2 좁은 폭 폴백)
 * - `bottom`: 영상 **아래**로 쌓기 (2026-08-12 요청 — 위치 전환 버튼)
 *
 * ⚠️ `bottom` 에서는 `widthPx` 를 **높이**로 해석한다. 쌓는 축이 세로로 바뀌기 때문이다.
 */
export type WidthMode = 'flex' | 'overlay' | 'bottom';

export type WidthClaim = {
  source: WidthSource;
  /** 0 이면 접힌 상태(FR-05 접기 토글) */
  widthPx: number;
  reason: string;
  mode?: WidthMode;
  /**
   * 🔴 **사용자가 직접 조작해서 만든 주장**인가 (FR-05 `+`/`−`/접기, 설정 패널 스테퍼).
   *
   * 이 표시가 없으면 FR-10 이 항상 이겨서 **뷰포트 비율 1.8 이상에서 폭 조절이 완전히 먹통**이 된다
   * (실측 2026-08-15 `chat-width-shots/report.json`: 노트북 1920×950 비율 2.021 에서 `+` 를 세 번
   * 눌러도 aside 가 231px 고정, 로그는 매번 `applied 231px from ultraWide`).
   * 16:9 노트북에서 브라우저를 최대화하면 브라우저 UI 높이 때문에 비율이 2.0 전후가 되므로
   * **평범한 사용 조건이 그대로 이 구간**이다.
   *
   * FR-10 의 계산값은 어디까지나 **기본값**이고, 사용자가 명시적으로 조절한 값은 그보다 우선한다.
   */
  userOverride?: boolean;
  /**
   * 영상 그림을 어디에 붙일지 (21:9·32:9 초광폭 설정, `ultraWide.videoAlign`).
   * 생략하면 기존 동작(`left`)을 유지한다 — `ultraWide` 이외의 source(`multiView`·`chatWidth`)는
   * 이 값을 세팅하지 않으므로 이번 옵션 도입 전과 결과가 같다.
   */
  videoAlign?: VideoAlign;
};

export type VideoAlign = 'left' | 'center';

/**
 * 🔴 영상 그림 정렬. 우리가 폭을 주장하는 동안에만 적용된다.
 *
 * 실측으로 확정한 기전 (2026-08-13, `chzzk-dom-36-fullscreen-chat.json`, 모바일 가로 실사이트):
 *
 * 채팅 폭이 최소값보다 좁아지면 FR-10.2 가 **오버레이 모드**로 전환한다. 오버레이에서 aside 는
 * `position: fixed` 라 **흐름에서 빠지고**, 그러면 `main` 이 뷰포트 전체 폭으로 늘어난다.
 * 플레이어도 그만큼 넓어지는데 `video` 는 `object-fit: contain` + `object-position: 50% 50%` 이라
 * **그림이 그 넓은 영역의 가운데** 놓인다.
 *
 * | 뷰포트 | main | video 요소 | 그림 | aside(오버레이) |
 * |---|---|---|---|---|
 * | 915×412 | 732 | 731 | 731 (여백 0) | 183 (흐름 안) |
 * | 915×480 | **915** | 914 | **853** | **62** (fixed) |
 *
 * 915×480 에서 그림은 `(914−853)/2 ≈ 30px` 오른쪽으로 밀려 **오른쪽 30px 이 채팅 오버레이 밑에
 * 가려지고 왼쪽 30px 은 아무도 쓰지 않는 죽은 공간**이 된다. 사용자가 보고한
 * "영상이 가운데 출력되어 우측 채팅 공간이 매우 좁음"이 바로 이것이다.
 *
 * → 그림을 왼쪽 끝에 붙이면 남는 폭이 **오른쪽에 한 덩어리로** 모여 채팅이 그 폭을 온전히 쓴다.
 *
 * 2026-08-23: 21:9·32:9 데스크톱 모니터도 같은 히스테리시스(비율 ≥1.8)로 이 경로를 타는데,
 * 데스크톱은 오버레이가 아니라 흐름 안 사이드 배치라 "가운데가 낫다"는 사용자가 있었다
 * → `ultraWide.videoAlign` 설정으로 왼쪽/가운데를 고를 수 있게 열어 둔다. 기본값은 기존 동작
 * 그대로 `left` 다.
 *
 * ⚠️ `object-position` 은 **rect 를 바꾸지 않는다.** 그래서 이 수정은 좌표로 검증할 수 없고
 * 픽셀 비교로 확인해야 한다 (`scripts/probe-fullscreen-chat.mjs` 의 픽셀 판정).
 */
export function buildVideoAlignCss(align: VideoAlign = 'left'): string {
  const position = align === 'center' ? '50% 50%' : '0% 50%';
  return [
    `${PLAYER.rootPc} ${PLAYER.video},`,
    `${ID.livePlayerLayout} ${PLAYER.video},`,
    `${ID.vodPlayerLayout} ${PLAYER.video} { object-position: ${position} !important; }`,
  ].join('\n');
}

/** 앞에 있을수록 우선한다 (FR-10.7). */
export const WIDTH_PRIORITY: readonly WidthSource[] = ['multiView', 'ultraWide', 'chatWidth'];

/**
 * 폭 주장들 중 실제로 적용할 하나를 고른다. **순수 함수 — 부수효과 없음.**
 * 같은 source 가 여러 번 들어오면 **마지막 것**을 그 source 의 최신 주장으로 본다.
 *
 * 예외 하나: `userOverride` 가 붙은 주장은 **멀티뷰를 제외한 모두를 이긴다.**
 * 사용자가 방금 누른 버튼의 결과가 자동 계산값에 먹히면 기능이 고장 난 것으로 보인다.
 * 멀티뷰만 예외인 이유는 슬롯 레이아웃이 aside 를 아예 접어 버리는 별개의 화면 모드이기 때문이다.
 *
 * ⚠️ override 가 여럿이면 **우선순위가 높은 쪽**이 이긴다. 배열 순서로 고르면
 * `currentClaims()` 가 우선순위 순으로 주는 배열에서 **가장 낮은** override 를 뽑게 되어
 * 우선순위가 조용히 뒤집힌다 (지금은 `chatWidth` 만 override 를 세팅해 증상이 없다).
 */
export function resolveWidth(claims: WidthClaim[]): WidthClaim | null {
  // 같은 source 가 중복되면 마지막 것이 그 source 의 최신 주장이다.
  const latest = (source: WidthSource): WidthClaim | null => {
    let found: WidthClaim | null = null;
    for (const claim of claims) {
      if (claim.source === source) found = claim;
    }
    return found;
  };

  const multiView = latest('multiView');
  if (multiView) return multiView;

  for (const source of WIDTH_PRIORITY) {
    const claim = latest(source);
    if (claim?.userOverride === true) return claim;
  }
  for (const source of WIDTH_PRIORITY) {
    const claim = latest(source);
    if (claim) return claim;
  }
  return null;
}

/** 접힌 상태(0%) 인가. */
export function isCollapsedWidth(widthPx: number): boolean {
  return !Number.isFinite(widthPx) || widthPx <= 0;
}

/**
 * 적용 CSS 를 만든다. **순수 함수 — 문자열만 돌려준다.**
 * 주장이 없으면 빈 문자열이다(= 조기 스타일의 `min-width: 0` 만 남는다).
 */
export function buildLayoutCss(claim: WidthClaim | null): string {
  if (!claim) return '';

  const width = Math.max(0, Math.round(claim.widthPx));
  const collapsed = isCollapsedWidth(claim.widthPx);
  const overlay = claim.mode === 'overlay';

  // ⚠️ min-width 해제는 항상 필요하다. 없으면 flex 축소가 막혀 가로 스크롤이 남는다.
  const base = [
    `${ID.root}, ${ID.layoutBody}, main,`,
    `${CHZZK.layoutSection}, ${CHZZK.layoutWrapper} { min-width: 0 !important; }`,
  ].join('\n');

  /**
   * 초광폭에서만 래퍼를 화면 폭에 맞춘다 (분석 문서 §5.5 실험 CSS).
   *
   * 🔴 `100vw` 를 쓰면 안 된다 (2026-08-12 실측 버그). `100vw` 는 **세로 스크롤바 폭을 포함**해서
   * 스크롤바가 있으면 항상 clientWidth 보다 커진다 → 모바일 가로 915×412 에서 래퍼가 915px 이 되고
   * clientWidth 는 900px 이라 **상시 15px 가로 스크롤**이 생겼다. FR-10 이 없애려던 바로 그 증상이다.
   * 위 base 규칙이 `#root`·`#layout-body`·`main`·section·wrapper 의 `min-width` 를 0 으로 풀어
   * 조상이 이미 화면 폭까지 늘어나므로 `100%` 로 충분하다.
   *
   * ✅ **초광폭에서 `chatWidth` 가 이겨 이 규칙이 빠져도 가로 스크롤은 재발하지 않는다 (실측).**
   * `userOverride` 도입으로 새로 생긴 경로라 확인이 필요했다 —
   * `node scripts/verify-chat-width-buttons.mjs` (2026-08-15, 10 프로필 × 9 단계 전수)에서
   * `documentElement.scrollWidth === clientWidth` 였다: 915×412 → 915/915,
   * 1920×950(비율 2.021) → 1920/1920, 1536×740(비율 2.076) → 1536/1536.
   * 초과분 0px. 위 base 의 `min-width: 0` 만으로 충분하다는 뜻이다.
   * (하네스가 매 단계 이 값을 판정하므로 재발하면 즉시 실패한다.)
   */
  const wrapper =
    claim.source === 'ultraWide' ? `${CHZZK.layoutWrapper} { width: 100% !important; }` : '';

  /**
   * 하단 배치 — 래퍼를 세로 흐름으로 바꾸고 aside 는 폭 100%, 높이를 claim 값으로 쓴다.
   * 영상은 남는 높이를 먹는다. 세로로 긴 창에서 오른쪽 배치보다 영상이 커진다.
   */
  if (claim.mode === 'bottom' && !collapsed) {
    return [
      base,
      `${CHZZK.layoutWrapper} { flex-direction: column !important; }`,
      `${ID.asideChatting} {
  width: 100% !important;
  height: ${width}px !important;
  flex: 0 0 ${width}px !important;
  min-width: 0 !important;
  min-height: 0 !important;
}`,
      `${CHZZK.mainContainer} { min-width: 0 !important; min-height: 0 !important; flex: 1 1 auto !important; }`,
    ].join('\n');
  }

  const asideRule = collapsed
    ? `${ID.asideChatting} {
  width: 0 !important;
  flex: 0 0 0 !important;
  min-width: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  overflow: hidden !important;
}`
    : overlay
      ? `${ID.asideChatting} {
  position: fixed !important;
  top: 0 !important;
  right: 0 !important;
  height: 100% !important;
  width: ${width}px !important;
  flex: 0 0 ${width}px !important;
  min-width: 0 !important;
  z-index: ${OURS.topZIndex - 1} !important;
  background: rgba(0, 0, 0, 0.45) !important;
  padding-right: env(safe-area-inset-right, 0px) !important;
  padding-left: env(safe-area-inset-left, 0px) !important;
  pointer-events: auto !important;
}`
      : `${ID.asideChatting} {
  width: ${width}px !important;
  flex: 0 0 ${width}px !important;
  min-width: 0 !important;
}`;

  // 영상 쪽은 남는 폭을 모두 먹어야 한다. flex: 1 1 0% 기본값으로는 축소가 어긋난다.
  const mainRule = `${CHZZK.mainContainer} { min-width: 0 !important; flex: 1 1 auto !important; }`;

  /**
   * 🔴 옆에 세울 때는 래퍼 방향을 **가로로 못 박는다** (실측 2026-08-16, 실사이트 412×915).
   * 치지직 자체 래퍼는 좁은 폭에서 `flex-direction: column` 이 된다. 그 상태에서 우리
   * `flex: 0 0 124px` 은 폭이 아니라 **높이**로 먹어 aside 가 124×124 상자로 찌그러졌다
   * (채팅 목록 높이 0 → 영상 아래가 통째로 비어 보임).
   * 접힘(폭 0)·오버레이(`position: fixed`)는 방향과 무관하므로 넣지 않는다.
   */
  const direction =
    collapsed || overlay ? '' : `${CHZZK.layoutWrapper} { flex-direction: row !important; }`;

  return [base, wrapper, direction, asideRule, mainRule, buildVideoAlignCss(claim.videoAlign)]
    .filter((part) => part.length > 0)
    .join('\n');
}

/* ------------------------------------------------------------------ */
/* 레지스트리 — 여기서만 실제 스타일을 쓴다.                          */
/* ------------------------------------------------------------------ */

const claims = new Map<WidthSource, WidthClaim>();

let refCount = 0;
let stopObserve: Disposer | undefined;
let lastAppliedCss: string | null = null;

/** 현재 등록된 주장 목록. 등록 순서가 아니라 우선순위 순으로 돌려준다. */
export function currentClaims(): WidthClaim[] {
  return WIDTH_PRIORITY.map((source) => claims.get(source)).filter(
    (claim): claim is WidthClaim => claim !== undefined,
  );
}

/** 지금 이기고 있는 주장. */
export function activeClaim(): WidthClaim | null {
  return resolveWidth(currentClaims());
}

/**
 * 폭을 주장한다. 우선순위에서 이기면 즉시 적용된다.
 * 같은 값으로 다시 불러도 스타일 노드는 늘지 않는다 (멱등).
 */
export function claimWidth(
  source: WidthSource,
  widthPx: number,
  reason: string,
  mode: WidthMode = 'flex',
  { userOverride = false, videoAlign }: { userOverride?: boolean; videoAlign?: VideoAlign } = {},
): void {
  claims.set(source, { source, widthPx, reason, mode, userOverride, videoAlign });
  applyClaims();
}

/** 주장을 철회한다. 남은 주장 중 최우선이 다시 적용된다. */
export function releaseWidth(source: WidthSource): void {
  if (!claims.delete(source)) return;
  applyClaims();
}

export { claimWidth as claim, releaseWidth as release };

/**
 * 이긴 주장이 바뀔 때 알림을 받는다. FR-10 이 **실제 적용된 폭**에 맞춰 글자 크기를 다시 계산하는 데 쓴다
 * (자기 계산값이 졌는데 그 값으로 폰트를 줄이면 넓은 채팅창에 깨알 글씨가 남는다).
 *
 * 구독자는 폭을 주장하면 안 된다 — 주장하면 `applyClaims` 가 재진입해 루프가 된다.
 */
const widthListeners = new Set<(claim: WidthClaim | null) => void>();

export function onActiveWidthChange(listener: (claim: WidthClaim | null) => void): Disposer {
  widthListeners.add(listener);
  return () => {
    widthListeners.delete(listener);
  };
}

/** 현재 주장들로 스타일을 갱신한다. 같은 결과면 아무것도 하지 않는다. */
export function applyClaims(): void {
  const winner = activeClaim();
  const css = buildLayoutCss(winner);

  if (css === lastAppliedCss) return;
  lastAppliedCss = css;

  if (css.length === 0) {
    removeStyle(OURS.layoutStyleId);
    info('layout arbiter: no width claim, override removed');
  } else {
    upsertStyle(OURS.layoutStyleId, css);
    info(
      `layout arbiter: applied ${winner?.widthPx}px from ${winner?.source} (${winner?.reason}), mode ${winner?.mode ?? 'flex'}`,
    );
  }

  // 🔴 알림은 **스타일 적용 뒤**다. 먼저 부르면 구독자가 적용된 레이아웃을 측정하려 할 때
  // 한 프레임 전 값을 읽는다.
  for (const listener of widthListeners) {
    try {
      listener(winner);
    } catch {
      // 구독자 예외가 폭 적용을 막으면 안 된다 (NFR-05).
    }
  }
}

/**
 * 리렌더 감시를 시작한다. 여러 기능이 각자 불러도 옵저버는 하나만 붙는다(참조 카운트).
 * 돌려주는 Disposer 를 모두 호출하면 옵저버가 끊기고 주입 스타일도 사라진다.
 */
export function ensureLayoutArbiter({ relaxed = false } = {}): Disposer {
  refCount += 1;

  if (!stopObserve) {
    const target = qs(ID.layoutBody) ?? document.body;
    if (target) {
      stopObserve = observe(target, () => reapply(), {
        debounceMs: relaxed ? RESIZE.debounceMsRelaxed : RESIZE.debounceMs,
      });
    }
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    refCount = Math.max(0, refCount - 1);
    if (refCount > 0) return;
    stopObserve?.();
    stopObserve = undefined;
    claims.clear();
    lastAppliedCss = null;
    removeStyle(OURS.layoutStyleId);
  };
}

/**
 * 페이지 리렌더로 `<style>` 이 제거·변형된 경우를 복구한다.
 *
 * 🔴 **주입된 스타일이 그대로 살아 있으면 아무것도 하지 않는다** (실측 결함 2026-08-17,
 * `chzzk-dom-35-widescreen-live.json`). 라이브 페이지의 감시 대상은 채팅 메시지 때문에 쉬지 않고
 * 변해서 이 콜백이 **디바운스 간격마다 영원히** 깨어난다. 예전 구현은 매번 `lastAppliedCss` 를
 * 지워 같은 CSS 를 다시 주입하고 `onActiveWidthChange` 구독자까지 깨웠다 —
 * 21.6초 동안 **같은 내용으로 101회 재적용**(중간 간격 201ms)이 실측으로 잡혔다 (NFR-04 위반).
 * 복구가 필요한 경우(노드가 사라졌거나 내용이 바뀐 경우)에만 캐시를 지운다.
 */
function reapply(): void {
  const expected = lastAppliedCss;
  if (expected !== null) {
    const node = document.getElementById(OURS.layoutStyleId);
    // 적용할 CSS 가 없는 상태(빈 문자열)에서는 노드가 없는 것이 정상이다.
    if (expected.length === 0 ? node === null : node?.textContent === expected) return;
  }
  lastAppliedCss = null;
  applyClaims();
}

/** 테스트 전용 초기화. 프로덕션 경로에서는 쓰지 않는다. */
export function resetLayoutArbiterForTest(): void {
  widthListeners.clear();
  claims.clear();
  refCount = 0;
  stopObserve?.();
  stopObserve = undefined;
  lastAppliedCss = null;
  removeStyle(OURS.layoutStyleId);
}
