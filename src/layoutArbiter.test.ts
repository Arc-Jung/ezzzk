import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  WIDTH_PRIORITY,
  activeClaim,
  buildLayoutCss,
  claimWidth,
  currentClaims,
  ensureLayoutArbiter,
  isCollapsedWidth,
  onActiveWidthChange,
  releaseWidth,
  resetLayoutArbiterForTest,
  resolveWidth,
  type WidthClaim,
  type WidthSource,
} from './layoutArbiter';
import { OURS } from './constants/class';
import { setDebug } from './utils/log';

function claim(source: WidthSource, widthPx: number): WidthClaim {
  return { source, widthPx, reason: `${source} test` };
}

describe('resolveWidth — 순수 우선순위 판정', () => {
  it('주장이 없으면 null', () => {
    expect(resolveWidth([])).toBeNull();
  });

  it('우선순위는 멀티뷰 > 초광폭 > 수동 폭', () => {
    expect(WIDTH_PRIORITY).toEqual(['multiView', 'ultraWide', 'chatWidth']);
  });

  // 3개 소스의 모든 부분집합(2^3 = 8가지)을 전수 확인한다.
  const cases: { present: WidthSource[]; winner: WidthSource | null }[] = [
    { present: [], winner: null },
    { present: ['chatWidth'], winner: 'chatWidth' },
    { present: ['ultraWide'], winner: 'ultraWide' },
    { present: ['multiView'], winner: 'multiView' },
    { present: ['chatWidth', 'ultraWide'], winner: 'ultraWide' },
    { present: ['chatWidth', 'multiView'], winner: 'multiView' },
    { present: ['ultraWide', 'multiView'], winner: 'multiView' },
    { present: ['chatWidth', 'ultraWide', 'multiView'], winner: 'multiView' },
  ];

  for (const { present, winner } of cases) {
    it(`{${present.join(', ') || '없음'}} → ${winner ?? 'null'}`, () => {
      const claims = present.map((source, i) => claim(source, 100 + i));
      expect(resolveWidth(claims)?.source ?? null).toBe(winner);
    });
  }

  it('등록 순서를 뒤집어도 결과가 같다', () => {
    const claims = [claim('multiView', 500), claim('chatWidth', 200)];
    expect(resolveWidth(claims)?.source).toBe('multiView');
    expect(resolveWidth([...claims].reverse())?.source).toBe('multiView');
  });

  it('같은 source 가 중복되면 마지막 주장이 이긴다', () => {
    const claims = [claim('chatWidth', 200), claim('chatWidth', 320)];
    expect(resolveWidth(claims)?.widthPx).toBe(320);
  });

  /**
   * 회귀 방지 — 실측 2026-08-15 (`chat-width-shots/report.json`).
   * 노트북 1920×950(비율 2.021)·모바일 가로 915×412 에서 `+` 를 눌러도 aside 가 231px·183px 로
   * 고정됐다. 로그가 매번 `applied … from ultraWide` 였다: FR-10 이 사용자 조작을 덮은 것이다.
   */
  it('사용자가 조작한 주장은 초광폭 계산값을 이긴다', () => {
    const claims: WidthClaim[] = [
      { source: 'ultraWide', widthPx: 231, reason: 'ratio 2.021' },
      { source: 'chatWidth', widthPx: 634, reason: 'ratio 33%', userOverride: true },
    ];
    expect(resolveWidth(claims)).toMatchObject({ source: 'chatWidth', widthPx: 634 });
    expect(resolveWidth([...claims].reverse())).toMatchObject({ source: 'chatWidth' });
  });

  it('사용자 조작이라도 멀티뷰는 이기지 못한다', () => {
    const claims: WidthClaim[] = [
      { source: 'multiView', widthPx: 0, reason: 'slots' },
      { source: 'chatWidth', widthPx: 634, reason: 'ratio 33%', userOverride: true },
    ];
    expect(resolveWidth(claims)?.source).toBe('multiView');
  });

  it('userOverride 가 없으면 기존 우선순위 그대로다', () => {
    const claims: WidthClaim[] = [
      { source: 'ultraWide', widthPx: 183, reason: 'ratio 2.2' },
      { source: 'chatWidth', widthPx: 400, reason: 'ratio 45%', userOverride: false },
    ];
    expect(resolveWidth(claims)?.source).toBe('ultraWide');
  });

  /**
   * 회귀 방지 (m1) — override 가 여럿일 때 **우선순위가 높은 쪽**이 이겨야 한다.
   * `currentClaims()` 는 우선순위 순 배열을 준다. 배열 순서로 고르면 가장 낮은 override 를
   * 뽑아 우선순위가 조용히 뒤집힌다.
   */
  it('override 가 여럿이면 우선순위가 높은 쪽이 이긴다', () => {
    const claims: WidthClaim[] = [
      { source: 'ultraWide', widthPx: 231, reason: 'computed', userOverride: true },
      { source: 'chatWidth', widthPx: 634, reason: 'ratio 33%', userOverride: true },
    ];
    // 우선순위 순(ultraWide → chatWidth) 배열에서도, 뒤집어도 ultraWide 가 이긴다.
    expect(resolveWidth(claims)).toMatchObject({ source: 'ultraWide', widthPx: 231 });
    expect(resolveWidth([...claims].reverse())).toMatchObject({ source: 'ultraWide' });
  });

  it('override 끼리도 같은 source 중복이면 마지막 것이 이긴다', () => {
    const claims: WidthClaim[] = [
      { source: 'chatWidth', widthPx: 300, reason: 'first', userOverride: true },
      { source: 'chatWidth', widthPx: 420, reason: 'second', userOverride: true },
    ];
    expect(resolveWidth(claims)?.widthPx).toBe(420);
  });

  it('그 source 의 최신 주장이 override 가 아니면 override 로 치지 않는다', () => {
    const claims: WidthClaim[] = [
      { source: 'ultraWide', widthPx: 183, reason: 'computed' },
      { source: 'chatWidth', widthPx: 300, reason: 'old override', userOverride: true },
      { source: 'chatWidth', widthPx: 420, reason: 'auto again', userOverride: false },
    ];
    expect(resolveWidth(claims)?.source).toBe('ultraWide');
  });

  it('중복이 섞여도 우선순위가 먼저다', () => {
    const claims = [
      claim('chatWidth', 200),
      claim('ultraWide', 183),
      claim('chatWidth', 400),
      claim('ultraWide', 420),
    ];
    expect(resolveWidth(claims)).toMatchObject({ source: 'ultraWide', widthPx: 420 });
  });
});

describe('isCollapsedWidth', () => {
  it('0 이하와 비정상 값은 접힌 상태', () => {
    expect(isCollapsedWidth(0)).toBe(true);
    expect(isCollapsedWidth(-10)).toBe(true);
    expect(isCollapsedWidth(Number.NaN)).toBe(true);
  });

  it('양수는 접힌 상태가 아니다', () => {
    expect(isCollapsedWidth(1)).toBe(false);
    expect(isCollapsedWidth(353)).toBe(false);
  });
});

describe('buildLayoutCss — 실험으로 검증된 CSS 를 그대로 만든다', () => {
  it('주장이 없으면 빈 문자열', () => {
    expect(buildLayoutCss(null)).toBe('');
  });

  it('width 와 flex 를 !important 로 함께 쓴다', () => {
    const css = buildLayoutCss(claim('chatWidth', 420));
    expect(css).toContain('#aside-chatting {');
    expect(css).toContain('width: 420px !important');
    expect(css).toContain('flex: 0 0 420px !important');
    expect(css).toContain('min-width: 0 !important');
  });

  it('main 컨테이너에 min-width:0 / flex: 1 1 auto 를 준다', () => {
    const css = buildLayoutCss(claim('chatWidth', 420));
    expect(css).toContain('main[class*="_container_1tswz"] {');
    expect(css).toMatch(/main\[class\*="_container_1tswz"\] \{[^}]*flex: 1 1 auto !important/);
  });

  it('초광폭에서만 wrapper 에 width: 100% 를 넣는다', () => {
    expect(buildLayoutCss(claim('ultraWide', 183))).toContain(
      'div[class*="_wrapper_wj4te"] { width: 100% !important; }',
    );
    expect(buildLayoutCss(claim('chatWidth', 420))).not.toContain('width: 100%');
    expect(buildLayoutCss(claim('multiView', 300))).not.toContain('width: 100%');
    // 🔴 `100vw` 는 세로 스크롤바 폭을 포함해 상시 가로 스크롤을 만든다 (모바일 가로 915 vs 900).
    const sources: WidthSource[] = ['ultraWide', 'chatWidth', 'multiView'];
    for (const source of sources) {
      expect(buildLayoutCss(claim(source, 420))).not.toContain('100vw');
    }
  });

  it('접힌 상태는 폭 0 + overflow hidden', () => {
    const css = buildLayoutCss(claim('chatWidth', 0));
    expect(css).toContain('width: 0 !important');
    expect(css).toContain('flex: 0 0 0 !important');
    expect(css).toContain('overflow: hidden !important');
  });

  it('오버레이 모드는 fixed 배치 + safe-area 패딩', () => {
    const css = buildLayoutCss({
      source: 'ultraWide',
      widthPx: 140,
      reason: 'narrow',
      mode: 'overlay',
    });
    expect(css).toContain('position: fixed !important');
    expect(css).toContain('width: 140px !important');
    expect(css).toContain('env(safe-area-inset-right, 0px)');
  });

  /**
   * 🔴 회귀 방지 (실측 2026-08-16, 실사이트 412×915).
   * 치지직 자체 래퍼가 좁은 폭에서 `flex-direction: column` 이 되면 우리 `flex-basis` 가
   * 폭이 아니라 높이로 먹어 aside 가 정사각 상자로 찌그러진다 (채팅 목록 높이 0).
   */
  it('옆에 세우는 모드는 래퍼 방향을 가로로 못 박는다', () => {
    expect(buildLayoutCss(claim('chatWidth', 420))).toContain(
      'div[class*="_wrapper_wj4te"] { flex-direction: row !important; }',
    );
  });

  it('하단·접힘·오버레이에는 가로 못 박기를 넣지 않는다', () => {
    const bottom = buildLayoutCss({
      source: 'chatWidth',
      widthPx: 366,
      reason: 'portrait',
      mode: 'bottom',
    });
    expect(bottom).toContain('flex-direction: column !important');
    expect(bottom).not.toContain('flex-direction: row !important');
    expect(buildLayoutCss(claim('chatWidth', 0))).not.toContain('flex-direction: row');
    expect(
      buildLayoutCss({ source: 'ultraWide', widthPx: 140, reason: 'narrow', mode: 'overlay' }),
    ).not.toContain('flex-direction: row');
  });

  it('픽셀은 반올림해 정수로 쓴다', () => {
    expect(buildLayoutCss(claim('ultraWide', 182.56))).toContain('width: 183px !important');
  });

  it('같은 주장이면 같은 문자열이다 (멱등)', () => {
    expect(buildLayoutCss(claim('ultraWide', 183))).toBe(buildLayoutCss(claim('ultraWide', 183)));
  });
});

describe('레지스트리 — 스타일 노드는 하나만 유지된다', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    resetLayoutArbiterForTest();
  });

  afterEach(() => {
    resetLayoutArbiterForTest();
  });

  it('claim 하면 style 태그 하나가 생긴다', () => {
    claimWidth('chatWidth', 420, 'ratio 30%');
    const styles = document.querySelectorAll(`#${OURS.layoutStyleId}`);
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toContain('width: 420px !important');
  });

  it('여러 번 claim 해도 노드가 누적되지 않는다', () => {
    claimWidth('chatWidth', 420, 'a');
    claimWidth('chatWidth', 300, 'b');
    claimWidth('ultraWide', 183, 'c');
    expect(document.querySelectorAll('style').length).toBe(1);
    expect(document.getElementById(OURS.layoutStyleId)?.textContent).toContain(
      'width: 183px !important',
    );
  });

  it('우선순위가 높은 주장이 낮은 주장을 덮는다', () => {
    claimWidth('chatWidth', 420, 'manual');
    claimWidth('multiView', 260, 'multi view active');
    expect(activeClaim()?.source).toBe('multiView');
    expect(document.getElementById(OURS.layoutStyleId)?.textContent).toContain(
      'width: 260px !important',
    );
  });

  it('철회하면 다음 우선순위가 다시 적용된다', () => {
    claimWidth('chatWidth', 420, 'manual');
    claimWidth('ultraWide', 183, 'ultra');
    releaseWidth('ultraWide');
    expect(activeClaim()?.source).toBe('chatWidth');
    expect(document.getElementById(OURS.layoutStyleId)?.textContent).toContain(
      'width: 420px !important',
    );
  });

  it('모두 철회하면 style 태그가 사라진다', () => {
    claimWidth('chatWidth', 420, 'manual');
    releaseWidth('chatWidth');
    expect(document.getElementById(OURS.layoutStyleId)).toBeNull();
  });

  it('없는 주장을 철회해도 안전하다', () => {
    expect(() => releaseWidth('multiView')).not.toThrow();
    expect(document.getElementById(OURS.layoutStyleId)).toBeNull();
  });

  it('currentClaims 는 우선순위 순으로 돌려준다', () => {
    claimWidth('chatWidth', 420, 'manual');
    claimWidth('multiView', 260, 'multi');
    claimWidth('ultraWide', 183, 'ultra');
    expect(currentClaims().map((c) => c.source)).toEqual(['multiView', 'ultraWide', 'chatWidth']);
  });

  it('ensureLayoutArbiter 는 참조 카운트로 동작한다 — 하나 해제해도 유지된다', () => {
    const stopA = ensureLayoutArbiter();
    const stopB = ensureLayoutArbiter();
    claimWidth('chatWidth', 420, 'manual');

    stopA();
    expect(document.getElementById(OURS.layoutStyleId)).not.toBeNull();

    stopB();
    expect(document.getElementById(OURS.layoutStyleId)).toBeNull();
    expect(currentClaims()).toHaveLength(0);
  });

  it('같은 Disposer 를 두 번 호출해도 카운트가 깨지지 않는다', () => {
    const stopA = ensureLayoutArbiter();
    const stopB = ensureLayoutArbiter();
    stopA();
    stopA();
    claimWidth('chatWidth', 420, 'manual');
    expect(document.getElementById(OURS.layoutStyleId)).not.toBeNull();
    stopB();
    expect(document.getElementById(OURS.layoutStyleId)).toBeNull();
  });

  /**
   * `content.tsx` 는 라우팅·설정 변경마다 **모든 기능을 해제한 뒤 다시 시작**한다.
   * 그 주기를 반복해도 style 노드가 누적되지 않고 폭이 정확해야 한다 (FR-12.1 멱등성).
   */
  it('해제 → 재시작 주기를 반복해도 style 노드가 하나이고 폭이 정확하다', () => {
    for (let cycle = 0; cycle < 5; cycle += 1) {
      // 여러 기능이 각각 arbiter 를 잡고 폭을 주장하는 상황을 재현한다.
      const stopChatWidth = ensureLayoutArbiter();
      const stopUltraWide = ensureLayoutArbiter();
      claimWidth('chatWidth', 420, 'ratio 30%');
      claimWidth('ultraWide', 183, 'computed');

      const styles = document.querySelectorAll(`#${OURS.layoutStyleId}`);
      expect(styles, `cycle ${cycle}`).toHaveLength(1);
      // 초광폭이 수동 폭을 이긴다.
      expect(styles[0]?.textContent).toContain('width: 183px !important');

      // teardown 은 모든 disposer 를 돌린다 (release → stop 순).
      releaseWidth('ultraWide');
      releaseWidth('chatWidth');
      stopUltraWide();
      stopChatWidth();

      expect(document.getElementById(OURS.layoutStyleId), `cycle ${cycle}`).toBeNull();
      expect(currentClaims(), `cycle ${cycle}`).toHaveLength(0);
    }
  });

  it('release 를 빼먹고 arbiter 만 해제해도 주장이 남지 않는다 (누수 방지)', () => {
    const stop = ensureLayoutArbiter();
    claimWidth('multiView', 353, 'multiview active');
    // 기능이 releaseWidth 를 잊고 disposer 만 돌린 경우.
    stop();
    expect(currentClaims()).toHaveLength(0);
    expect(document.getElementById(OURS.layoutStyleId)).toBeNull();

    // 다음 초기화가 깨끗한 상태에서 시작된다.
    const stop2 = ensureLayoutArbiter();
    claimWidth('chatWidth', 420, 'ratio 30%');
    expect(document.getElementById(OURS.layoutStyleId)?.textContent).toContain(
      'width: 420px !important',
    );
    stop2();
  });
});

describe('onActiveWidthChange — 이긴 주장 구독', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    resetLayoutArbiterForTest();
  });

  afterEach(() => {
    resetLayoutArbiterForTest();
  });

  const styleText = (): string | null =>
    document.getElementById(OURS.layoutStyleId)?.textContent ?? null;

  it('이긴 주장이 바뀌면 알린다', () => {
    const seen: (WidthClaim | null)[] = [];
    onActiveWidthChange((claim) => seen.push(claim));

    claimWidth('chatWidth', 420, 'ratio 30%');
    claimWidth('ultraWide', 183, 'computed');

    expect(seen.map((c) => c?.source ?? null)).toEqual(['chatWidth', 'ultraWide']);
  });

  it('결과 CSS 가 같으면 알리지 않는다 (멱등)', () => {
    const seen: (WidthClaim | null)[] = [];
    onActiveWidthChange((claim) => seen.push(claim));

    claimWidth('chatWidth', 420, 'ratio 30%');
    claimWidth('chatWidth', 420, 'ratio 30%');
    expect(seen).toHaveLength(1);
  });

  it('모든 주장이 철회되면 null 을 알린다', () => {
    const seen: (WidthClaim | null)[] = [];
    claimWidth('chatWidth', 420, 'ratio 30%');
    onActiveWidthChange((claim) => seen.push(claim));
    releaseWidth('chatWidth');
    expect(seen).toEqual([null]);
  });

  it('해제하면 더 이상 알림을 받지 않는다', () => {
    let calls = 0;
    const stop = onActiveWidthChange(() => {
      calls += 1;
    });
    claimWidth('chatWidth', 420, 'a');
    expect(calls).toBe(1);

    stop();
    claimWidth('chatWidth', 300, 'b');
    expect(calls).toBe(1);
  });

  it('같은 Disposer 를 두 번 호출해도 안전하다', () => {
    const stop = onActiveWidthChange(() => {});
    stop();
    expect(() => stop()).not.toThrow();
  });

  it('구독자가 던져도 폭 적용과 다른 구독자를 막지 않는다 (NFR-05)', () => {
    const seen: number[] = [];
    onActiveWidthChange(() => {
      throw new Error('구독자 폭발');
    });
    onActiveWidthChange((claim) => seen.push(claim?.widthPx ?? -1));

    expect(() => claimWidth('chatWidth', 420, 'ratio 30%')).not.toThrow();
    expect(seen).toEqual([420]);
    expect(styleText()).toContain('width: 420px !important');
  });

  /**
   * 회귀 방지 (n1) — 알림이 스타일 적용 **뒤**에 와야 한다.
   * 앞에 오면 적용된 레이아웃을 측정하려는 구독자가 한 프레임 전 값을 읽는다.
   */
  it('구독자는 스타일이 이미 적용된 뒤에 호출된다', () => {
    const cssAtNotify: (string | null)[] = [];
    onActiveWidthChange(() => cssAtNotify.push(styleText()));

    claimWidth('chatWidth', 420, 'ratio 30%');
    expect(cssAtNotify[0]).toContain('width: 420px !important');

    // 철회 알림 시점에는 이미 style 노드가 사라져 있어야 한다.
    releaseWidth('chatWidth');
    expect(cssAtNotify[1]).toBeNull();
  });
});

describe('하단 배치 모드 (2026-08-12 요청 — 채팅 위치 전환 버튼)', () => {
  const bottom = (px: number): WidthClaim => ({
    source: 'chatWidth',
    widthPx: px,
    reason: 'bottom test',
    mode: 'bottom',
  });

  it('래퍼를 세로 흐름으로 바꾼다', () => {
    expect(buildLayoutCss(bottom(300))).toContain('flex-direction: column !important');
  });

  it('aside 는 폭 100% · 높이는 claim 값을 쓴다 (쌓는 축이 세로다)', () => {
    const css = buildLayoutCss(bottom(300));
    expect(css).toContain('width: 100% !important');
    expect(css).toContain('height: 300px !important');
    expect(css).toContain('flex: 0 0 300px !important');
  });

  it('영상이 남는 높이를 먹는다', () => {
    const css = buildLayoutCss(bottom(300));
    expect(css).toContain('flex: 1 1 auto !important');
    expect(css).toContain('min-height: 0 !important');
  });

  it('오른쪽 배치(flex)에서는 세로 흐름으로 바꾸지 않는다', () => {
    const css = buildLayoutCss({ ...bottom(300), mode: 'flex' });
    expect(css).not.toContain('flex-direction: column');
    expect(css).toContain('width: 300px !important');
  });

  it('접힌 상태(0)면 배치와 무관하게 접는다 — 하단에 빈 띠를 남기지 않는다', () => {
    const css = buildLayoutCss(bottom(0));
    expect(css).not.toContain('flex-direction: column');
    expect(css).toContain('width: 0 !important');
  });

  it('min-width 해제는 하단 배치에서도 유지된다 (가로 스크롤 방지)', () => {
    expect(buildLayoutCss(bottom(300))).toContain('min-width: 0 !important');
  });
});

describe('영상 그림 좌측 정렬 (2026-08-13 실측 원인 수정)', () => {
  /**
   * 오버레이 모드에서 aside 가 흐름에서 빠지면 main 이 뷰포트 전체로 늘어나고,
   * `object-fit: contain` + `object-position: 50% 50%` 이라 그림이 그 넓은 영역의 가운데 놓인다.
   * → 오른쪽 절반이 채팅 오버레이 밑에 가려지고 왼쪽 절반은 죽은 공간이 된다.
   * 실측: 915×480 에서 main 915 / video 914 / 그림 853 / aside 62 (chzzk-dom-36).
   */
  it('폭을 주장하는 동안 그림을 왼쪽으로 붙인다', () => {
    for (const mode of ['flex', 'overlay'] as const) {
      const css = buildLayoutCss({
        source: 'ultraWide',
        widthPx: 62,
        reason: 'test',
        mode,
      });
      expect(css, mode).toContain('object-position: 0% 50% !important');
    }
  });

  it('주장이 없으면 아무 규칙도 넣지 않는다 — 평소 시청은 건드리지 않는다', () => {
    expect(buildLayoutCss(null)).toBe('');
  });

  it('라이브·VOD 플레이어를 모두 포함한다', () => {
    const css = buildLayoutCss({
      source: 'ultraWide',
      widthPx: 62,
      reason: 'test',
      mode: 'overlay',
    });
    expect(css).toContain('#live_player_layout');
    expect(css).toContain('#player_layout');
    expect(css).toContain('.pzp-pc');
  });

  /**
   * 하단 배치에서는 남는 폭이 **세로**로 생긴다. 여기서 왼쪽으로 붙이면
   * 오른쪽에 빈 공간이 생겨 오히려 나빠진다 → 넣지 않는다.
   */
  it('하단 배치에서는 좌측 정렬을 넣지 않는다', () => {
    const css = buildLayoutCss({
      source: 'chatWidth',
      widthPx: 300,
      reason: 'test',
      mode: 'bottom',
    });
    expect(css).not.toContain('object-position');
  });

  it('접힌 상태에서도 정렬 규칙은 유지된다 (영상이 전체 폭을 쓰므로 무해하다)', () => {
    const css = buildLayoutCss({ source: 'chatWidth', widthPx: 0, reason: 'test', mode: 'flex' });
    expect(css).toContain('object-position: 0% 50% !important');
  });
});

/**
 * 🔴 회귀 고정 — 실측 결함 2026-08-17 (`docs/frontend-dump/chzzk-dom-35-widescreen-live.json`).
 *
 * 라이브 페이지의 감시 대상(`#layout-body`)은 채팅 메시지 때문에 쉬지 않고 변한다. 그래서 리렌더
 * 복구 콜백이 **디바운스 간격마다 영원히** 깨어나는데, 예전 구현은 매번 캐시를 지워 같은 CSS 를
 * 다시 주입하고 폭 구독자까지 깨웠다 — 21.6초에 **동일 내용 101회 재적용**(간격 201ms)이 잡혔다.
 * 복구는 유지하고 헛일만 없앤다.
 */
describe('리렌더 복구 — 살아 있으면 다시 쓰지 않는다', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.head.innerHTML = '';
    document.body.innerHTML = '<div id="layout-body"></div>';
    resetLayoutArbiterForTest();
  });

  afterEach(() => {
    resetLayoutArbiterForTest();
    vi.useRealTimers();
  });

  /** 채팅 메시지가 도착한 것처럼 감시 대상 안을 바꾼다. */
  async function churnObservedSubtree(times: number): Promise<void> {
    const host = document.getElementById('layout-body');
    for (let i = 0; i < times; i += 1) {
      host?.appendChild(document.createElement('li'));
      await vi.advanceTimersByTimeAsync(300);
    }
  }

  it('감시 대상이 계속 변해도 적용 로그가 늘지 않는다 (실측 21.6초에 101줄)', async () => {
    setDebug(true);
    const logged = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const stop = ensureLayoutArbiter();
      claimWidth('chatWidth', 378, 'ratio 25% (right)');
      const applyLines = () =>
        logged.mock.calls.filter((args) => String(args[0]).includes('layout arbiter: applied'))
          .length;
      expect(applyLines()).toBe(1);

      await churnObservedSubtree(10);

      expect(applyLines()).toBe(1);
      expect(document.getElementById(OURS.layoutStyleId)?.textContent).toContain(
        'width: 378px !important',
      );
      stop();
    } finally {
      logged.mockRestore();
      setDebug(false);
    }
  });

  it('감시 대상이 계속 변해도 폭 구독자를 다시 깨우지 않는다', async () => {
    const stop = ensureLayoutArbiter();
    let notified = 0;
    const unsubscribe = onActiveWidthChange(() => {
      notified += 1;
    });
    claimWidth('chatWidth', 378, 'ratio 25% (right)');
    expect(notified).toBe(1);

    await churnObservedSubtree(10);

    expect(notified).toBe(1);
    unsubscribe();
    stop();
  });

  it('페이지가 style 노드를 지우면 다시 주입한다 (복구는 그대로)', async () => {
    const stop = ensureLayoutArbiter();
    claimWidth('chatWidth', 378, 'ratio 25% (right)');
    document.getElementById(OURS.layoutStyleId)?.remove();

    await churnObservedSubtree(1);

    expect(document.getElementById(OURS.layoutStyleId)?.textContent).toContain(
      'width: 378px !important',
    );
    stop();
  });

  it('style 내용이 바뀌어 있으면 우리 값으로 되돌린다', async () => {
    const stop = ensureLayoutArbiter();
    claimWidth('chatWidth', 378, 'ratio 25% (right)');
    const node = document.getElementById(OURS.layoutStyleId) as HTMLStyleElement;
    node.textContent = '/* 페이지가 덮어썼다 */';

    await churnObservedSubtree(1);

    expect(document.getElementById(OURS.layoutStyleId)?.textContent).toContain(
      'width: 378px !important',
    );
    stop();
  });
});
