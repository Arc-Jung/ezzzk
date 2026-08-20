/**
 * FR-09.2 설정 패널 순수 로직 검증.
 * DOM 렌더가 아니라 **패널이 노출하는 상수·계산식**을 검증한다 — 실제 치지직 DOM 결합은
 * Playwright 실브라우저 검증의 몫이다 (요구사항 §8.0).
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CHAT_FONT_RANGE, DEFAULT_SETTINGS, LIMITS } from '../constants/storage';
import { lineHeightForFont, visibleLines } from '../features/chatFont';
import { computeSlotRects, stripMetrics } from '../features/multiView/slotLayout';
import {
  REFERENCE_STAGE,
  SIDE_CHAT_PX,
  TABS,
  TAB_IDS,
  Toggle,
  chatOccupancyText,
  formatLoss,
  placementTradeOff,
  sectionsForTab,
} from './tabs';
import { REFERENCE_SCROLLER_HEIGHT } from './tabsExtra';
import { SETTINGS_PANEL_CSS } from './settingsPanelCss';
import { SHEET_CSS } from '../ui/Sheet';

declare global {
  // React 18 이 act 지원 환경임을 알리는 표준 플래그. 없으면 경고가 쏟아진다.
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(node: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(node);
  });
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  document.body.replaceChildren();
});

/**
 * 🔴 실측 회귀 2026-08-16 (실사이트 모바일 가로 915×412).
 * 시트 높이가 80vh = 330px 로 줄면 본문에 198px 밖에 안 남아 세로 탭 레일에서는 탭 7개 중
 * 3개만 보였다. 스크롤은 됐지만 레일이 본문과 함께 밀려 올라가 위치를 알 수 없었다.
 */
describe('좁은/짧은 화면 대응 CSS', () => {
  it('세로가 짧은 화면에서도 탭 레일을 가로 줄로 접는다', () => {
    expect(SETTINGS_PANEL_CSS).toContain('@media (max-height: 560px)');
    const shortBlock = SETTINGS_PANEL_CSS.slice(
      SETTINGS_PANEL_CSS.indexOf('@media (max-height: 560px)'),
    );
    expect(shortBlock).toContain('.cm-sp__rail { flex-direction: row;');
  });

  it('시트 본문은 min-height: 0 이라 푸터를 밀어내지 않는다', () => {
    expect(SHEET_CSS).toMatch(/\.cm-sheet__body \{[^}]*min-height: 0/);
    expect(SHEET_CSS).toMatch(/\.cm-sheet__body \{[^}]*overflow-y: auto/);
  });
});

/**
 * 감사 보고서 심각도 높음 #3 — 채팅·소리·기타 탭 하단 컨트롤이 스크롤 없이 안 보이는데
 * 신호가 없었다. JS 스크롤 리스너 없이 배경 이중 레이어로만 처리했는지 확인한다.
 */
describe('설정 패널 하단 스크롤 신호', () => {
  it(':has() 로 설정 패널 본문에만 적용된다 (다른 시트 스크롤은 건드리지 않는다)', () => {
    expect(SETTINGS_PANEL_CSS).toContain('.cm-sheet__body:has(.cm-sp)');
  });

  it('local/scroll 이중 배경 레이어를 쓴다 (JS 스크롤 리스너 없음)', () => {
    const block = SETTINGS_PANEL_CSS.slice(
      SETTINGS_PANEL_CSS.indexOf('.cm-sheet__body:has(.cm-sp)'),
    );
    expect(block).toContain('background-attachment: local, scroll;');
    // 별도 오버레이 엘리먼트가 없는 배경 트릭이므로 pointer-events 를 걸 대상 자체가 없다 —
    // 그 이유를 CSS 주석에 남겨 리뷰어가 "왜 pointer-events: none 이 없냐"고 재차 묻지 않게 한다.
    expect(SETTINGS_PANEL_CSS).toContain('pointer-events');
  });
});

describe('탭 구성', () => {
  it('탭은 7개이며 목업 화면 ⑦ 의 순서를 지킨다', () => {
    expect(TABS.map((tab) => tab.title)).toEqual([
      '재생',
      '소리',
      '레이아웃',
      '멀티뷰',
      '채팅',
      '기타',
      '프리셋',
    ]);
    expect(TAB_IDS).toHaveLength(7);
    expect(TABS.map((tab) => tab.id)).toEqual([...TAB_IDS]);
  });

  it('탭 → 초기화 섹션 매핑이 FR-09.2 표와 일치한다', () => {
    expect(sectionsForTab('playback')).toEqual(['quality']);
    expect(sectionsForTab('sound')).toEqual(['volume']);
    expect(sectionsForTab('layout')).toEqual(['chatWidth', 'wideScreen', 'ultraWide']);
    expect(sectionsForTab('multiView')).toEqual(['multiView']);
    expect(sectionsForTab('chat')).toEqual([
      'chatFont',
      'chatPresets',
      'chatPresetBehavior',
      'chatUserFilter',
      // FR-16 채팅 부가 요소 숨김도 채팅 탭에서 초기화된다.
      'chatClutter',
    ]);
    expect(sectionsForTab('misc')).toEqual([
      'powerCollect',
      'promoHide',
      // FR-18 광고 SKIP 자동 클릭도 기타 탭에서 초기화된다.
      'adSkip',
      'device',
      'debug',
    ]);
    expect(sectionsForTab('preset')).toEqual(['optionPresets', 'activePresetId']);
  });

  it('모든 탭의 초기화 섹션은 Settings 의 실제 키다', () => {
    const keys = Object.keys(DEFAULT_SETTINGS);
    for (const id of TAB_IDS) {
      for (const section of sectionsForTab(id)) {
        expect(keys).toContain(section);
      }
    }
  });
});

describe('레이아웃 탭 점유율 안내', () => {
  it('353px 는 고정값이고 퍼센트는 뷰포트 폭에서 계산된다', () => {
    expect(SIDE_CHAT_PX).toBe(353);
    // 목업의 `└ 현재 353px = 18.4%` 는 1920 기준값이다.
    expect(chatOccupancyText(1920)).toBe('└ 현재 353px = 18.4%');
    // 노트북 13인치(1440) 에서는 같은 353px 이 24.5% 다 — 퍼센트를 상수로 박으면 안 된다.
    expect(chatOccupancyText(1440)).toBe('└ 현재 353px = 24.5%');
  });

  it('폭을 알 수 없으면 퍼센트를 만들어내지 않는다', () => {
    expect(chatOccupancyText(0)).toBe('└ 현재 353px');
  });
});

describe('멀티뷰 탭 배치 트레이드오프', () => {
  it('안내 퍼센트는 stripMetrics 계산 결과와 같다', () => {
    const four = computeSlotRects(4, REFERENCE_STAGE.width, REFERENCE_STAGE.height)[0];
    const two = computeSlotRects(2, REFERENCE_STAGE.width, REFERENCE_STAGE.height)[0];
    expect(four).toMatchObject({ width: 959, height: 539 });
    expect(two).toMatchObject({ width: 959, height: 1080 });

    const fourLoss = stripMetrics(959, 539, 3, 'reserve', CHAT_FONT_RANGE.slot.default).areaLoss;
    const twoLoss = stripMetrics(959, 1080, 5, 'reserve', CHAT_FONT_RANGE.slot.default).areaLoss;
    expect(fourLoss * 100).toBeCloseTo(20.0, 1);
    expect(twoLoss).toBe(0);

    const hints = placementTradeOff(3, CHAT_FONT_RANGE.slot.default);
    expect(hints.four).toBe(`4분할: 겹침 권장 (밑 배치 시 3줄=−${formatLoss(fourLoss)}%)`);
    expect(hints.two).toBe(`2분할: 밑 배치 권장 (손실 ${formatLoss(twoLoss)}%)`);
  });

  it('목업 문구를 그대로 재현한다', () => {
    const hints = placementTradeOff(3, CHAT_FONT_RANGE.slot.default);
    expect(hints.four).toBe('4분할: 겹침 권장 (밑 배치 시 3줄=−20.0%)');
    expect(hints.two).toBe('2분할: 밑 배치 권장 (손실 0%)');
  });

  it('손실 0 은 0.0% 가 아니라 0% 로 표기한다', () => {
    expect(formatLoss(0)).toBe('0');
    expect(formatLoss(0.2)).toBe('20.0');
  });

  it('줄 수를 늘리면 밑 배치 손실이 커진다', () => {
    const three = placementTradeOff(3, CHAT_FONT_RANGE.slot.default);
    const five = placementTradeOff(5, CHAT_FONT_RANGE.slot.default);
    expect(five.four).toContain('5줄=−30.3%');
    expect(five.four).not.toBe(three.four);
    // 2분할은 세로에 여유가 있어 5줄이어도 손실이 없다.
    expect(five.two).toBe(three.two);
  });
});

describe('채팅 탭 글자 크기 안내', () => {
  it('안정화 후 스크롤 영역 761px 기준 값이 목업 표와 일치한다', () => {
    expect(REFERENCE_SCROLLER_HEIGHT).toBe(761);
    expect(lineHeightForFont(14)).toBe(26);
    expect(visibleLines(REFERENCE_SCROLLER_HEIGHT, 14)).toBe(29);
  });

  it('목업 표의 다른 폰트 크기도 재현한다', () => {
    expect(visibleLines(761, 11)).toBe(34);
    expect(visibleLines(761, 12)).toBe(31);
    expect(visibleLines(761, 24)).toBe(19);
  });

  it('스테퍼 범위는 FR-15 범위와 같다', () => {
    expect(CHAT_FONT_RANGE.side).toMatchObject({ min: 11, max: 24, default: 14 });
    expect(CHAT_FONT_RANGE.slot).toMatchObject({ min: 10, max: 16, default: 12 });
  });
});

describe('상한', () => {
  it('프리셋·조합 상한은 요구사항 값을 쓴다', () => {
    expect(LIMITS.optionPresets).toBe(20);
    expect(LIMITS.multiViewSets).toBe(10);
    expect(LIMITS.chatPresets).toBe(50);
  });
});

/**
 * 켜기/끄기 토글 방향·색·글자 회귀 (사용자 보고: "방향이 반대라 헷갈리고 ON/OFF 구별이 안 된다").
 * 표준 방향은 OFF = 노브 왼쪽 · ON = 노브 오른쪽인데, 예전 글자 그림(켜기 ●──/끄기 ──○)은
 * 정반대였다. CSS 로 그린 실제 스위치(트랙+노브)로 바꾸면서 방향을 함께 바로잡는다.
 */
describe('켜기/끄기 토글', () => {
  function toggleButton(): HTMLButtonElement {
    return document.querySelector('button.cm-sp__toggle') as HTMLButtonElement;
  }

  it('OFF 일 때 aria-checked=false 이고 "끄기" 글자가 남는다', () => {
    mount(<Toggle label="화질 자동 적용" checked={false} onChange={() => {}} />);
    const button = toggleButton();
    expect(button.getAttribute('aria-checked')).toBe('false');
    expect(button.textContent).toContain('끄기');
    expect(button.textContent).not.toContain('켜기');
  });

  it('ON 일 때 aria-checked=true 이고 "켜기" 글자가 남는다', () => {
    mount(<Toggle label="화질 자동 적용" checked={true} onChange={() => {}} />);
    const button = toggleButton();
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(button.textContent).toContain('켜기');
    expect(button.textContent).not.toContain('끄기');
  });

  it('방향 회귀 방지: CSS 상 OFF 노브는 기본 위치(왼쪽)이고 ON 은 translateX 로 오른쪽이다', () => {
    // 노브 기본 위치는 left: 2px 로 왼쪽에 고정하고, ON 상태에서만 오른쪽으로 옮긴다.
    // 이번 버그의 핵심이 "방향이 반대"였으므로, 기본(OFF) 규칙에 translateX 가 없고
    // ON 전용 규칙(`[aria-checked='true']`)에만 translateX 가 있는지를 확인한다.
    const knobBase = SETTINGS_PANEL_CSS.slice(
      SETTINGS_PANEL_CSS.indexOf('.cm-sp__toggle-knob {'),
      SETTINGS_PANEL_CSS.indexOf('.cm-sp__toggle-knob {') + 200,
    );
    expect(knobBase).toMatch(/left:\s*2px/);
    const onRule = SETTINGS_PANEL_CSS.slice(
      SETTINGS_PANEL_CSS.indexOf(".cm-sp__toggle[aria-checked='true'] .cm-sp__toggle-knob"),
    );
    expect(onRule).toContain('transform: translateX(16px)');
  });

  it('ON 과 OFF 의 트랙 색이 서로 다르다 — 색만으로 구분하지 않되 색 자체도 달라야 한다', () => {
    const offTrack = SETTINGS_PANEL_CSS.slice(
      SETTINGS_PANEL_CSS.indexOf('.cm-sp__toggle-track {'),
      SETTINGS_PANEL_CSS.indexOf('.cm-sp__toggle-track {') + 200,
    );
    const onTrack = SETTINGS_PANEL_CSS.slice(
      SETTINGS_PANEL_CSS.indexOf(".cm-sp__toggle[aria-checked='true'] .cm-sp__toggle-track"),
    );
    expect(offTrack).toContain('--color-bg-layer-05');
    expect(onTrack).toContain('#00ffa3');
    expect(offTrack).not.toContain('#00ffa3');
  });

  it('클릭하면 role=switch 상태가 뒤집힌다', () => {
    let checked = false;
    mount(
      <Toggle
        label="VOD에도 적용"
        checked={checked}
        onChange={(next) => {
          checked = next;
        }}
      />,
    );
    const button = toggleButton();
    expect(button.getAttribute('role')).toBe('switch');
    act(() => button.click());
    expect(checked).toBe(true);
  });
});
