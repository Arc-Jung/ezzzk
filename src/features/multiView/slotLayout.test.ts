import { describe, expect, it } from 'vitest';
import {
  clampSplit,
  computeSlotRects,
  fitListScrollHeight,
  isSplitAvailable,
  maxSlotChatLines,
  maxSplitFor,
  recommendedPlacement,
  resolveSlotChatLines,
  slotLineHeight,
  stripHeight,
  stripMetrics,
  SLOT_GAP,
} from './slotLayout';

describe('computeSlotRects — 실측 기준값 재현 (1920×1080)', () => {
  it('4분할 슬롯은 959×539 다 (gap 2px)', () => {
    const rects = computeSlotRects(4, 1920, 1080);
    expect(rects).toHaveLength(4);
    for (const rect of rects) {
      expect(rect.width).toBe(959);
      expect(rect.height).toBe(539);
    }
    // 2×2 배치 좌표
    expect(rects[0]).toMatchObject({ index: 1, x: 0, y: 0 });
    expect(rects[1]).toMatchObject({ index: 2, x: 961, y: 0 });
    expect(rects[2]).toMatchObject({ index: 3, x: 0, y: 541 });
    expect(rects[3]).toMatchObject({ index: 4, x: 961, y: 541 });
  });

  it('4분할 슬롯 959×539 는 이미 16:9 라 여백이 1px 이하다', () => {
    const m = stripMetrics(959, 539, 0, 'overlay');
    expect(m.pillarbox).toBeLessThanOrEqual(1);
    expect(959 - m.pictureW).toBeLessThanOrEqual(1);
    expect(539 - m.pictureH).toBeLessThanOrEqual(1);
  });

  it('2분할 가로는 좌우 959×1080 이다', () => {
    const rects = computeSlotRects(2, 1920, 1080, 'landscape');
    expect(rects).toHaveLength(2);
    expect(rects[0]).toMatchObject({ index: 1, x: 0, y: 0, width: 959, height: 1080 });
    expect(rects[1]).toMatchObject({ index: 2, x: 961, y: 0, width: 959, height: 1080 });
  });

  it('2분할 세로는 상하로 나눈다 (모바일·7인치급 세로 자세)', () => {
    const rects = computeSlotRects(2, 412, 915, 'portrait');
    // y 는 0 이 아니다 — 16:9 높이만 쓰고 가운데로 모으기 때문이다 (2026-08-22, 아래 describe 참조).
    expect(rects[0]).toMatchObject({ index: 1, x: 0, width: 412 });
    expect(rects[1]?.index).toBe(2);
    expect(rects[1]?.x).toBe(0);
    expect(rects[1]?.width).toBe(412);
    // 상하 합 + gap 이 무대 높이를 넘지 않는다
    const total = (rects[0]?.height ?? 0) + (rects[1]?.height ?? 0) + SLOT_GAP;
    expect(total).toBeLessThanOrEqual(915 + SLOT_GAP);
  });

  /**
   * 🔴 회귀 고정 (실측 2026-08-22, mobile-portrait 412×915) — 세로 2분할에서 슬롯이 412×421
   * 이었는데 16:9 영상은 412×232 밖에 안 돼 **슬롯마다 189px(약 45%)가 검은 띠**로 남았다.
   * 세로 자세에서는 폭이 제약이므로 필요한 높이는 `width × 9/16` 뿐이다 — 그만큼만 준다.
   */
  describe('2분할 세로는 16:9 높이만 쓰고 가운데로 모은다 (2026-08-22)', () => {
    it('412×915 에서 슬롯이 412×232 (16:9) 다', () => {
      const rects = computeSlotRects(2, 412, 915, 'portrait');
      expect(rects[0]).toMatchObject({ index: 1, x: 0, width: 412, height: 232 });
      expect(rects[1]).toMatchObject({ index: 2, x: 0, width: 412, height: 232 });
    });

    it('슬롯 안에 검은 띠(레터박스)가 남지 않는다', () => {
      const rect = computeSlotRects(2, 412, 915, 'portrait')[0]!;
      const m = stripMetrics(rect.width, rect.height, 0, 'overlay');
      expect(rect.height - m.pictureH).toBeLessThanOrEqual(1);
      expect(m.pillarbox).toBeLessThanOrEqual(1);
    });

    it('남는 높이는 위아래로 균등 분배해 두 슬롯을 가운데에 둔다', () => {
      const rects = computeSlotRects(2, 412, 915, 'portrait');
      const top = rects[0]!.y;
      const bottom = 915 - (rects[1]!.y + rects[1]!.height);
      expect(rects[1]!.y).toBe(rects[0]!.y + rects[0]!.height + SLOT_GAP);
      expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1);
    });

    it('조작 바 띠가 있어도 그 아래 남는 높이 안에서 같은 계약을 지킨다', () => {
      const rects = computeSlotRects(2, 412, 915, 'portrait', SLOT_GAP, 70);
      expect(rects[0]).toMatchObject({ index: 1, x: 0, width: 412, height: 232 });
      expect(rects[1]).toMatchObject({ index: 2, x: 0, width: 412, height: 232 });
      expect(rects[0]!.y).toBeGreaterThanOrEqual(70);
      expect(rects[1]!.y + rects[1]!.height).toBeLessThanOrEqual(915);
    });

    it('16:9 두 장이 안 들어가는 좁은 높이에서는 예전처럼 균등 분할한다', () => {
      // 412 폭이면 16:9 두 장에 466px 이 필요하다 — 400px 밖에 없으면 균등 분할이 최선이다.
      const rects = computeSlotRects(2, 412, 400, 'portrait');
      expect(rects[0]?.height).toBe(199);
      expect(rects[1]?.y).toBe(201);
      expect(rects[1]!.y + rects[1]!.height).toBe(400);
    });

    it('가로 2분할은 바뀌지 않는다 (좌우 배치는 폭이 제약이 아니다)', () => {
      const rects = computeSlotRects(2, 1920, 1080, 'landscape');
      expect(rects[0]).toMatchObject({ index: 1, x: 0, y: 0, width: 959, height: 1080 });
    });
  });

  it('3분할은 좌측 1개가 두 행을 차지하고 우측 2개가 정확히 16:9 다', () => {
    const rects = computeSlotRects(3, 1920, 1080);
    expect(rects).toHaveLength(3);
    expect(rects[0]).toMatchObject({ index: 1, x: 0, y: 0, width: 959, height: 1080 });
    expect(rects[1]).toMatchObject({ index: 2, x: 961, y: 0, width: 959, height: 539 });
    expect(rects[2]).toMatchObject({ index: 3, x: 961, y: 541, width: 959, height: 539 });
    // 우측 슬롯은 959×539 → 여백 0
    const m = stripMetrics(959, 539, 0, 'overlay');
    expect(m.pillarbox).toBeLessThanOrEqual(1);
  });

  it('슬롯이 무대를 넘어가지 않는다', () => {
    for (const split of [2, 3, 4] as const) {
      for (const rect of computeSlotRects(split, 1600, 900)) {
        expect(rect.x + rect.width).toBeLessThanOrEqual(1600);
        expect(rect.y + rect.height).toBeLessThanOrEqual(900);
      }
    }
  });

  it('사이드 채팅(353px)을 켜면 슬롯이 783×440 이 되고 비율은 유지된다', () => {
    // 목업 화면 ③ 주석: 멀티뷰 영역이 1567px 로 줄어도 슬롯 비율 1.779 는 유지된다.
    const rects = computeSlotRects(4, 1567, 882);
    const first = rects[0];
    expect(first?.width).toBe(782);
    const ratio = (first?.width ?? 0) / (first?.height ?? 1);
    expect(ratio).toBeCloseTo(16 / 9, 1);
  });

  it('무대 크기가 0 이면 빈 배열이다', () => {
    expect(computeSlotRects(4, 0, 1080)).toEqual([]);
    expect(computeSlotRects(4, 1920, 0)).toEqual([]);
  });
});

describe('computeSlotRects — 조작 바 전용 상단 띠 (2026-08-16 회귀)', () => {
  /*
   * 가운데 상단 조작 바가 슬롯 헤더 버튼을 덮어 눌리지 않던 결함. 배치에서 띠를 떼어 낸다.
   * 터치 프로필의 바 높이 실측: 버튼 44 + 패딩 12 + 테두리 2 = 58, top 6, 간격 6 → 띠 70px.
   */
  const INSET = 70;

  it('모든 슬롯이 띠 아래에서 시작한다 (분할·자세 무관)', () => {
    const cases = [
      [4, 1920, 1080, 'landscape'],
      [3, 1920, 1080, 'landscape'],
      [2, 915, 412, 'landscape'],
      [2, 412, 915, 'portrait'],
      [2, 1180, 820, 'landscape'],
      [4, 1440, 900, 'landscape'],
    ] as const;
    for (const [split, w, h, orientation] of cases) {
      const rects = computeSlotRects(split, w, h, orientation, SLOT_GAP, INSET);
      expect(rects.length).toBeGreaterThan(0);
      for (const rect of rects) {
        expect(rect.y).toBeGreaterThanOrEqual(INSET);
        expect(rect.y + rect.height).toBeLessThanOrEqual(h);
      }
    }
  });

  it('띠만큼 줄어든 높이로 다시 나눈다 (4분할 1920×1080, 띠 70 → 슬롯 959×504)', () => {
    const rects = computeSlotRects(4, 1920, 1080, 'landscape', SLOT_GAP, INSET);
    expect(rects[0]).toMatchObject({ index: 1, x: 0, y: 70, width: 959, height: 504 });
    expect(rects[1]).toMatchObject({ index: 2, x: 961, y: 70, width: 959, height: 504 });
    expect(rects[2]).toMatchObject({ index: 3, x: 0, y: 576, width: 959, height: 504 });
    expect(rects[3]).toMatchObject({ index: 4, x: 961, y: 576, width: 959, height: 504 });
    // 아래쪽 죽은 공간이 생기면 안 된다 — 남는 높이를 전부 쓴다.
    expect(rects[3]!.y + rects[3]!.height).toBe(1080);
  });

  it('2분할 세로도 띠 아래에서 상하로 나눈다', () => {
    // 2026-08-22: 세로 2분할은 16:9 높이(232)만 쓰고 띠 아래 남는 높이 안에서 가운데로 모인다.
    const rects = computeSlotRects(2, 412, 915, 'portrait', SLOT_GAP, INSET);
    expect(rects[0]).toMatchObject({ index: 1, x: 0, y: 259, width: 412, height: 232 });
    expect(rects[1]).toMatchObject({ index: 2, x: 0, y: 493, width: 412, height: 232 });
  });

  it('띠는 슬롯 높이만 줄인다 — 폭·x 는 띠가 없을 때와 같다', () => {
    const without = computeSlotRects(4, 1920, 1080);
    const with70 = computeSlotRects(4, 1920, 1080, 'landscape', SLOT_GAP, INSET);
    for (let i = 0; i < without.length; i += 1) {
      expect(with70[i]?.x).toBe(without[i]?.x);
      expect(with70[i]?.width).toBe(without[i]?.width);
      expect(with70[i]?.height).toBeLessThan(without[i]?.height ?? 0);
    }
  });

  it('줄어든 높이 안에서도 16:9 여백 최소 계약은 유지된다 (필러박스만 생긴다)', () => {
    const rect = computeSlotRects(4, 1920, 1080, 'landscape', SLOT_GAP, INSET)[0]!;
    const m = stripMetrics(rect.width, rect.height, 0, 'overlay');
    // 높이가 제약이 되므로 그림 높이는 슬롯 높이를 꽉 채운다.
    expect(Math.round(m.pictureH)).toBe(rect.height);
    expect(m.pictureW).toBeLessThanOrEqual(rect.width);
  });

  it('띠가 0 이면 기존 배치와 완전히 같다 (기본값 호환)', () => {
    expect(computeSlotRects(4, 1920, 1080, 'landscape', SLOT_GAP, 0)).toEqual(
      computeSlotRects(4, 1920, 1080),
    );
  });

  it('띠가 무대보다 크면 무대 안으로 클램프한다 (슬롯이 사라지지 않는다)', () => {
    const rects = computeSlotRects(2, 412, 200, 'portrait', SLOT_GAP, 999);
    expect(rects).toHaveLength(2);
    for (const rect of rects) {
      expect(rect.y + rect.height).toBeLessThanOrEqual(200);
      expect(rect.height).toBeGreaterThanOrEqual(0);
    }
  });

  it('무대 크기가 0 이면 띠가 있어도 빈 배열이다', () => {
    expect(computeSlotRects(4, 0, 1080, 'landscape', SLOT_GAP, INSET)).toEqual([]);
    expect(computeSlotRects(4, 1920, 0, 'landscape', SLOT_GAP, INSET)).toEqual([]);
  });
});

describe('stripHeight — 실측식 16×줄수 + 9 (12px 폰트)', () => {
  it('목업 표의 줄별 스트립 높이를 재현한다', () => {
    expect(stripHeight(0)).toBe(0);
    expect(stripHeight(1)).toBe(25);
    expect(stripHeight(2)).toBe(41);
    expect(stripHeight(3)).toBe(57);
    expect(stripHeight(4)).toBe(73);
    expect(stripHeight(5)).toBe(89);
  });

  it('폰트별 줄 높이 실측값', () => {
    expect(slotLineHeight(11)).toBe(15);
    expect(slotLineHeight(12)).toBe(16);
    expect(slotLineHeight(13)).toBe(18);
  });

  it('폰트를 바꾸면 스트립 높이가 함께 재계산된다 (FR-15 연동)', () => {
    expect(stripHeight(3, 11)).toBe(15 * 3 + 9);
    expect(stripHeight(3, 13)).toBe(18 * 3 + 9);
    expect(stripHeight(3, 11)).not.toBe(stripHeight(3, 13));
  });

  it('음수 줄 수는 0 이다', () => {
    expect(stripHeight(-1)).toBe(0);
  });
});

describe('stripMetrics — 오버레이 vs 예약 배치 (목업 화면 ③′·③″)', () => {
  it('오버레이는 영상 크기를 바꾸지 않는다 (손실 0%)', () => {
    for (const lines of [0, 1, 2, 3, 4, 5]) {
      const m = stripMetrics(959, 539, lines, 'overlay');
      expect(m.areaLoss).toBe(0);
      // 목업 실측: 슬롯 959×539 → 그림 958×539 (여백 0). 슬롯 폭과 1px 차이는 16:9 반올림이다.
      expect(Math.round(m.pictureW)).toBe(958);
      expect(Math.round(m.pictureH)).toBe(539);
    }
  });

  it('예약 배치 4분할 3줄 → 그림 857×482, 손실 20.0% ± 0.5%p', () => {
    const m = stripMetrics(959, 539, 3, 'reserve');
    expect(m.stripHeightPx).toBe(57);
    expect(Math.round(m.pictureW)).toBe(857);
    expect(Math.round(m.pictureH)).toBe(482);
    expect(m.areaLoss * 100).toBeCloseTo(20.0, 0);
  });

  it('예약 배치 4분할 5줄 → 그림 800×450, 손실 30.3% ± 0.5%p', () => {
    const m = stripMetrics(959, 539, 5, 'reserve');
    expect(m.stripHeightPx).toBe(89);
    expect(Math.round(m.pictureW)).toBe(800);
    expect(Math.round(m.pictureH)).toBe(450);
    expect(m.areaLoss * 100).toBeCloseTo(30.3, 0);
  });

  it('예약 배치 4분할 1줄만 켜도 9.0% 줄어든다 (좌우 필러박스 구조)', () => {
    const m = stripMetrics(959, 539, 1, 'reserve');
    expect(m.areaLoss * 100).toBeCloseTo(9.0, 0);
    // 레터박스가 아니라 필러박스가 생기는 것이 핵심이다.
    expect(m.pillarbox).toBeGreaterThan(0);
  });

  it('🔴 2분할 슬롯 959×1080 은 5줄 예약 배치에도 손실 0% 다', () => {
    const m = stripMetrics(959, 1080, 5, 'reserve');
    expect(m.stripHeightPx).toBe(89);
    expect(Math.round(m.pictureW)).toBe(959);
    expect(Math.round(m.pictureH)).toBe(539);
    expect(m.areaLoss).toBe(0);
  });

  it('2분할은 예약, 4분할은 오버레이를 권장한다', () => {
    expect(recommendedPlacement(2)).toBe('reserve');
    expect(recommendedPlacement(3)).toBe('overlay');
    expect(recommendedPlacement(4)).toBe('overlay');
  });
});

describe('기기별 분할 상한 (FR-14 표)', () => {
  it('desktop / laptop / tablet-13 은 4분할까지', () => {
    for (const cls of ['desktop', 'laptop', 'tablet-13'] as const) {
      expect(maxSplitFor(cls)).toBe(4);
      expect(isSplitAvailable(4, cls)).toBe(true);
      expect(clampSplit(4, cls)).toBe(4);
    }
  });

  it('tablet-10 이하는 2분할까지이고 3·4분할 선택이 비활성이다', () => {
    for (const cls of ['tablet-10', 'tablet-7', 'mobile'] as const) {
      expect(maxSplitFor(cls)).toBe(2);
      expect(isSplitAvailable(2, cls)).toBe(true);
      expect(isSplitAvailable(3, cls)).toBe(false);
      expect(isSplitAvailable(4, cls)).toBe(false);
      expect(clampSplit(4, cls)).toBe(2);
      expect(clampSplit(3, cls)).toBe(2);
    }
  });
});

describe('슬롯 채팅 줄 상한', () => {
  it('슬롯 폭 < 400px 이면 최대 3줄로 자동 제한한다', () => {
    expect(maxSlotChatLines(399, 'desktop')).toBe(3);
    expect(maxSlotChatLines(400, 'desktop')).toBe(5);
    expect(resolveSlotChatLines(5, 380, 'desktop')).toBe(3);
  });

  it('모바일·7인치급은 기기 상한 2줄이 우선이다', () => {
    expect(maxSlotChatLines(959, 'mobile')).toBe(2);
    expect(maxSlotChatLines(959, 'tablet-7')).toBe(2);
    expect(resolveSlotChatLines(5, 959, 'mobile')).toBe(2);
  });

  it('tablet-10 은 3줄까지', () => {
    expect(maxSlotChatLines(959, 'tablet-10')).toBe(3);
    expect(resolveSlotChatLines(5, 959, 'tablet-10')).toBe(3);
  });

  it('0 줄(표시 안 함)은 그대로 유지된다', () => {
    expect(resolveSlotChatLines(0, 959, 'desktop')).toBe(0);
    expect(resolveSlotChatLines(0, 300, 'mobile')).toBe(0);
  });

  it('설정값이 상한보다 작으면 그대로 쓴다', () => {
    expect(resolveSlotChatLines(2, 959, 'desktop')).toBe(2);
  });
});

describe('fitListScrollHeight — 마지막 행이 푸터에 잘리지 않는다 (2026-08-15 회귀)', () => {
  /*
   * 실측 배경 (laptop13 1440×900, 수정 전)
   * - .cm-sheet__body 가시 영역 204~696px, footer.cm-sheet__foot 상단 696px
   * - .cm-mv-scroll 은 max-height: min(48vh, 420px) 로 414~834px → 바닥 138px 가 푸터 뒤
   * - 게다가 스크롤 상자 안에서 마지막 행이 반쯤 잘려 배치 버튼 중심점이 푸터로 갔다
   */
  it('남은 높이를 행 간격의 배수로 내림한다', () => {
    // 제목 20px + 행 간격 40px. 남은 높이 268px → 6행(240) + 20 = 260
    expect(fitListScrollHeight(268, 20, 40)).toBe(260);
  });

  it('딱 떨어지면 그대로 쓴다', () => {
    expect(fitListScrollHeight(260, 20, 40)).toBe(260);
  });

  it('결과는 절대 남은 높이를 넘지 않는다 (넘으면 푸터 뒤로 들어간다)', () => {
    for (let available = 20; available <= 600; available += 1) {
      expect(fitListScrollHeight(available, 20, 40)).toBeLessThanOrEqual(available);
    }
  });

  it('한 행도 못 넣을 만큼 좁으면 남은 높이를 그대로 준다 (목록을 감추지 않는다)', () => {
    expect(fitListScrollHeight(50, 20, 40)).toBe(50);
    expect(fitListScrollHeight(0, 20, 40)).toBe(0);
    expect(fitListScrollHeight(-30, 20, 40)).toBe(0);
  });

  it('측정이 실패해도(0·NaN) 예외 없이 남은 높이를 준다', () => {
    expect(fitListScrollHeight(268, 20, 0)).toBe(268);
    expect(fitListScrollHeight(268, 20, Number.NaN)).toBe(268);
    expect(fitListScrollHeight(Number.NaN, 20, 40)).toBe(0);
  });

  it('터치 기기의 큰 행(44+8=52px)에서도 배수로 맞춘다', () => {
    expect(fitListScrollHeight(200, 20, 52)).toBe(20 + 3 * 52);
  });
});
