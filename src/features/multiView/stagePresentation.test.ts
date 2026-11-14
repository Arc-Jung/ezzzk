/** 멀티뷰 스타일과 채팅 영역의 순수 계산 회귀 테스트. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../constants/storage';
import { INACTIVE_SLOT_QUALITY } from './slotLayout';
import { buildStageCss } from './stageCss';
import {
  FS_CHAT_STEP_PX,
  STRIP_BAR_GAP_PX,
  sideChatWidthPx,
  stripBottomOffset,
} from './stageLayout';

/** 1920×1080 4분할 기준 실측값. 슬롯 959×539, gap 2. */
const TOP_LEFT = { x: 0, y: 0, width: 959, height: 539 };
const BOTTOM_LEFT = { x: 0, y: 541, width: 959, height: 539 };
const BOTTOM_RIGHT = { x: 961, y: 541, width: 959, height: 539 };

/** 실측된 바 좌표 (x 830~1074, y 1022~1068). */
const BAR = { left: 830, right: 1074, top: 1022, bottom: 1068, height: 46 };

describe('stripBottomOffset', () => {
  it('바가 없으면 하단에 밀착한다', () => {
    expect(stripBottomOffset(BOTTOM_RIGHT, 89, 3, null)).toBe(0);
  });

  it('바 높이가 0 이면(아직 렌더 전) 올리지 않는다', () => {
    expect(stripBottomOffset(BOTTOM_RIGHT, 89, 3, { ...BAR, height: 0 })).toBe(0);
  });

  it('채팅 줄이 0 이면 올릴 스트립이 없다', () => {
    expect(stripBottomOffset(BOTTOM_RIGHT, 0, 0, BAR)).toBe(0);
  });

  it('위쪽 행 슬롯은 바와 세로로 겹치지 않아 그대로 둔다', () => {
    expect(stripBottomOffset(TOP_LEFT, 89, 3, BAR)).toBe(0);
  });

  it('바와 겹치는 아래쪽 슬롯의 스트립을 바 위로 올린다', () => {
    // 슬롯 하단 1080, 바 상단 1022 → 58 + 간격
    const offset = stripBottomOffset(BOTTOM_RIGHT, 89, 3, BAR);
    expect(offset).toBe(1080 - 1022 + STRIP_BAR_GAP_PX);
    // 올린 뒤 스트립 하단이 바 상단보다 위에 있어야 한다 = 겹치지 않는다
    const stripBottomY = BOTTOM_RIGHT.y + BOTTOM_RIGHT.height - offset;
    expect(stripBottomY).toBeLessThanOrEqual(BAR.top);
  });

  it('바가 슬롯의 가로 범위를 벗어나면 올리지 않는다', () => {
    // 바(830~1074)는 x 0~959 슬롯과 겹치므로, 겹치지 않는 슬롯을 따로 만든다.
    const farLeft = { x: 0, y: 541, width: 400, height: 539 };
    expect(stripBottomOffset(farLeft, 89, 3, BAR)).toBe(0);
  });

  it('바가 왼쪽 슬롯에 걸치면 그 슬롯도 올린다', () => {
    // 830 < 959 이므로 좌하단 슬롯도 바와 겹친다 — 한쪽만 올리면 다른 쪽이 가려진다.
    expect(stripBottomOffset(BOTTOM_LEFT, 89, 3, BAR)).toBeGreaterThan(0);
  });

  it('스트립이 슬롯을 벗어날 만큼은 올리지 않는다', () => {
    const shallow = { x: 0, y: 1000, width: 959, height: 80 };
    const offset = stripBottomOffset(shallow, 60, 3, BAR);
    expect(offset).toBeLessThanOrEqual(shallow.height - 60);
  });
});

describe('buildStageCss', () => {
  it('컨테이너를 화면 전체로 덮지 않는다 — 사이드 채팅 자리를 남겨야 한다', () => {
    const css = buildStageCss(44, false);
    // 컨테이너 규칙만 본다. `.cm-slot__error` 의 `inset: 0` 은 슬롯을 채우는 정당한 용도다.
    const containerRule = /#cm-multiview-stage\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(containerRule).not.toBe('');
    // `inset: 0` 이면 chatMode active 에서 채팅 aside 가 검은 띠에 가려진다 (실측 버그).
    expect(containerRule).not.toMatch(/inset\s*:/);
    // 폭은 layout() 이 무대 폭으로 인라인 지정한다 → CSS 에 width·right 를 박지 않는다.
    expect(containerRule).not.toMatch(/(^|[;\s])width\s*:/);
    expect(containerRule).not.toMatch(/(^|[;\s])right\s*:/);
    expect(containerRule).toMatch(/position:\s*fixed/);
    expect(containerRule).toMatch(/left:\s*0/);
  });

  it('터치 기기에서는 슬롯 헤더를 상시 노출한다 (호버 금지 — FR-12)', () => {
    expect(buildStageCss(44, true)).toMatch(/opacity:\s*1/);
    expect(buildStageCss(36, false)).toMatch(/opacity:\s*0/);
  });

  it('터치 타겟 크기를 프로필 값으로 넣는다', () => {
    expect(buildStageCss(48, true)).toContain('min-width: 48px');
  });

  /**
   * 🔴 사용자 보고 — 좁은 화면에서 조작 바가 라벨 때문에 3줄로 접혀 무대를 잡아먹었다
   * (`docs/ui-audit/multiview-stage-mobile-portrait.png`). 버튼 크기는 그대로 두고
   * 라벨만 숨겨 1줄로 압축한다. 데스크톱(이 미디어쿼리 밖)에서는 라벨이 그대로 남아야 한다.
   */
  it('좁은 화면에서만 조작 바 라벨을 숨긴다 — 터치 타겟은 그대로다', () => {
    const css = buildStageCss(44, true);
    const compactBlock = /@media \(max-width:\s*\d+px\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(compactBlock).not.toBe('');
    expect(compactBlock).toMatch(/\.cm-stage-bar__label\s*\{[^}]*display:\s*none/);
    // 압축 블록 안에서도 버튼 크기(터치 타겟)는 건드리지 않는다 — 라벨만 숨긴다.
    expect(compactBlock).not.toMatch(/min-width:\s*\d+px/);
    expect(compactBlock).not.toMatch(/min-height:\s*\d+px/);
    // 압축 블록 밖(기본 규칙)에는 버튼 터치 타겟이 그대로 있다 — 데스크톱도 같은 규칙을 쓴다.
    expect(css).toContain('min-width: 44px');
    expect(css).toContain('min-height: 44px');
  });

  it('좁은 화면 압축 시 버튼 사이 간격을 줄이지 않는다 — 오히려 넓힌다', () => {
    const css = buildStageCss(44, true);
    const baseGap = Number(/\.cm-stage-bar\s*\{[^}]*gap:\s*(\d+)px/.exec(css)?.[1] ?? '0');
    const compactBlock = /@media \(max-width:\s*\d+px\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    const compactGap = Number(
      /\.cm-stage-bar\s*\{[^}]*gap:\s*(\d+)px/.exec(compactBlock)?.[1] ?? '0',
    );
    expect(baseGap).toBeGreaterThan(0);
    expect(compactGap).toBeGreaterThanOrEqual(baseGap);
  });
});

describe('sideChatWidthPx — 사이드 채팅 폭', () => {
  it('기본값은 뷰포트 폭의 25% 다', () => {
    expect(sideChatWidthPx(1440, 900, 0)).toBe(360);
    expect(sideChatWidthPx(915, 412, 0)).toBe(229);
  });

  /**
   * 🔴 회귀 고정 — 예전 공식은 "영상 16:9 를 채우고 남는 폭"이라 **정확히 16:9 인 화면에서 0** 이었다.
   * 즉 1920×1080 모니터에서는 채팅이 열리지 않았다(컨트롤은 보이는데 폭이 0).
   */
  it('정확히 16:9 인 화면에서도 0 이 아니다', () => {
    expect(sideChatWidthPx(1920, 1080, 0)).toBe(480);
  });

  it('+ 는 한 칸씩 넓힌다', () => {
    const base = sideChatWidthPx(915, 412, 0);
    expect(sideChatWidthPx(915, 412, 1)).toBe(base + FS_CHAT_STEP_PX);
    expect(sideChatWidthPx(915, 412, 2)).toBe(base + 2 * FS_CHAT_STEP_PX);
  });

  it('− 로 계속 줄여도 읽을 수 있는 최소 폭 아래로는 안 내려간다', () => {
    const narrow = sideChatWidthPx(915, 412, -100);
    expect(narrow).toBeGreaterThan(0);
    expect(narrow).toBeLessThanOrEqual(sideChatWidthPx(915, 412, 0));
  });

  it('화면의 60% 를 넘게 넓히지 못한다', () => {
    expect(sideChatWidthPx(915, 412, 100)).toBeLessThanOrEqual(Math.floor(915 * 0.6));
  });

  it('세로 화면에서도 비율로 계산한다 (켜기 판정은 무대 최소 폭이 한다)', () => {
    expect(sideChatWidthPx(412, 915, 0)).toBeGreaterThan(0);
  });

  it('비정상 입력에는 0 을 돌려준다', () => {
    expect(sideChatWidthPx(0, 0, 0)).toBe(0);
    expect(sideChatWidthPx(-1, 100, 3)).toBe(0);
  });
});

describe('비활성 슬롯 화질 기본값 (2026-08-12 요청)', () => {
  it('기본값은 하향 끄기 — 비활성 슬롯도 목표 화질로 재생한다', () => {
    expect(DEFAULT_SETTINGS.multiView.lowerInactiveQuality).toBe(false);
    // 목표 화질 자체가 1080p 이므로 비활성 슬롯도 1080p 가 된다.
    expect(DEFAULT_SETTINGS.quality.target).toBe('1080p');
  });

  it('옵션을 켜면 내려갈 화질이 720p 다', () => {
    expect(INACTIVE_SLOT_QUALITY).toBe('720p');
  });
});
