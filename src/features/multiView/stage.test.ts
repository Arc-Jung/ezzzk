/**
 * FR-14 스테이지 순수 로직 테스트.
 *
 * `stripBottomOffset` 은 2026-08-12 실측 버그에서 나왔다: 하단 컨트롤 바가 아래쪽 슬롯의
 * 채팅 스트립을 덮어 채팅 줄이 가려졌다 (3·4분할에서 겹침 면적 10,980px²).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../constants/storage';
import { decideDevice } from '../../device';
import { BETA_BADGE_TEXT, OURS } from '../../constants/class';
import { MV_CHANNEL } from './messages';
import { INACTIVE_SLOT_QUALITY } from './slotLayout';
import {
  FS_CHAT_STEP_PX,
  STRIP_BAR_GAP_PX,
  buildStageCss,
  sideChatWidthPx,
  stageTopInset,
  stripBottomOffset,
  MultiViewStage,
} from './stage';

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

describe('stageTopInset — 조작 바 전용 상단 띠 (2026-08-16 회귀)', () => {
  it('바가 없으면 띠도 없다', () => {
    expect(stageTopInset(null)).toBe(0);
  });

  it('바 높이가 0 이면(아직 렌더 전) 띠를 만들지 않는다', () => {
    expect(stageTopInset({ top: 6, height: 0 })).toBe(0);
  });

  it('바 아래 끝 + 간격까지가 띠다 (터치 프로필 실측: top 6 · 높이 58 → 70)', () => {
    expect(stageTopInset({ top: 6, height: 58 })).toBe(6 + 58 + STRIP_BAR_GAP_PX);
  });

  it('비터치 프로필은 버튼이 작아 띠도 얇다 (top 6 · 높이 46 → 58)', () => {
    expect(stageTopInset({ top: 6, height: 46 })).toBe(58);
  });

  it('소수 좌표는 올림한다 — 1px 라도 모자라면 바가 헤더를 덮는다', () => {
    expect(stageTopInset({ top: 6, height: 57.5 })).toBe(70);
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

/**
 * 🔴 사용자 보고 (2026-08-15) 회귀 고정 — 사용자가 비활성 슬롯의 음소거를 직접 풀면
 * 슬롯이 `requestAudio` 를 올리고, 스테이지가 **기존 활성 슬롯 전환 경로를 그대로 재사용해**
 * 그 슬롯을 활성으로 올린다. 이전 활성 슬롯은 음소거되므로 FR-14("오디오는 한 슬롯만")는 유지된다.
 */
describe('MultiViewStage — 슬롯 → 부모 메시지 배선', () => {
  const SLOTS = [
    { index: 1 as const, channelId: '17a4bfff01d96ffad065f641ce90bdde', channelName: '로마러' },
    { index: 2 as const, channelId: '0dad8baf12a436f722faa8e5001c5011', channelName: '따효니' },
  ];

  function openStage({
    deviceClass,
    chatMode,
  }: { deviceClass?: 'mobile'; chatMode?: 'active' | 'none' } = {}) {
    const onActiveSlotChange = vi.fn();
    const settings = chatMode
      ? {
          ...DEFAULT_SETTINGS,
          multiView: { ...DEFAULT_SETTINGS.multiView, chatMode },
        }
      : DEFAULT_SETTINGS;
    const stage = new MultiViewStage(settings, decideDevice(deviceClass ?? 'auto'), {
      onRequestConfig: vi.fn(),
      onExit: vi.fn(),
      onActiveSlotChange,
      onVolumeChange: vi.fn(),
      onChatLinesChange: vi.fn(),
      onChatWidthChange: vi.fn(),
    });
    stage.open(SLOTS);
    return { stage, onActiveSlotChange };
  }

  function sendFromSlot(data: unknown, origin = 'https://chzzk.naver.com') {
    window.dispatchEvent(new MessageEvent('message', { data, origin }));
  }

  const audioShortcut = (slot: number) => ({
    channel: MV_CHANNEL,
    dir: 's2p' as const,
    kind: 'audioShortcut' as const,
    slot,
  });

  /** 지금 활성 표시가 붙은 슬롯 번호. 없으면 null. */
  const activeSlotFromDom = (): number | null => {
    const cells = [...document.querySelectorAll('.cm-slot')];
    const index = cells.findIndex((cell) => cell.classList.contains('cm-slot--active'));
    return index < 0 ? null : index + 1;
  };

  const requestAudio = (slot: number) => ({
    channel: MV_CHANNEL,
    dir: 's2p' as const,
    kind: 'requestAudio' as const,
    slot,
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  /**
   * 🔴 2026-08-16 실측 결함 (`probe-multiview-beta` 03-stage): 스테이지를 열자마자는
   * **어느 슬롯에도 `cm-slot--active` 가 없어** 지금 어느 방송의 소리가 나는지 화면에서
   * 알 수 없었다 — 클래스 토글이 `setActiveSlot()` 안에만 있었기 때문이다.
   */
  it('열자마자 저장된 활성 슬롯에 활성 표시가 붙는다', () => {
    const { stage } = openStage();

    const active = document.querySelector(
      `#cm-multiview-stage .cm-slot[data-slot="${DEFAULT_SETTINGS.multiView.activeSlot}"]`,
    );
    expect(active?.classList.contains('cm-slot--active')).toBe(true);
    // 활성 표시는 정확히 하나다 (소리가 나는 슬롯도 하나다).
    expect(document.querySelectorAll('#cm-multiview-stage .cm-slot--active').length).toBe(1);
    stage.close();
  });

  /**
   * 🔴 2026-08-16 실측 결함 (`probe-multiview-slot-failure`): 슬롯 문서가 네트워크 오류로
   * 뜨지 않아도 크롬은 오류 페이지를 커밋하며 iframe 에 `load` 를 발화시킨다.
   * 그때 `loaded` 로 성공을 판정하면 **22초가 지나도 안내가 뜨지 않고 검은 칸만 남았다.**
   * 살아 있음의 신호는 슬롯 컨트롤러의 `ready` 하나뿐이다.
   */
  describe('슬롯 로드 실패 표시', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('load 만 발화하고 ready 가 오지 않으면 실패로 표시한다 (오류 페이지)', () => {
      vi.useFakeTimers();
      const { stage } = openStage();
      const frames = document.querySelectorAll('#cm-multiview-stage .cm-slot iframe');
      // 오류 페이지도 load 를 발화시킨다 — 이것만으로 성공이라고 보면 안 된다.
      frames.forEach((frame) => frame.dispatchEvent(new Event('load')));

      vi.advanceTimersByTime(20_000);

      const errors = document.querySelectorAll('#cm-multiview-stage .cm-slot__error');
      expect(errors.length).toBe(2);
      expect(errors[0]?.textContent).toContain('불러올 수 없습니다');
      stage.close();
    });

    it('ready 를 보낸 슬롯은 실패로 표시하지 않는다', () => {
      vi.useFakeTimers();
      const { stage } = openStage();
      document
        .querySelectorAll('#cm-multiview-stage .cm-slot iframe')
        .forEach((frame) => frame.dispatchEvent(new Event('load')));
      sendFromSlot({ channel: MV_CHANNEL, dir: 's2p', kind: 'ready', slot: 1 });

      vi.advanceTimersByTime(20_000);

      const cell1 = document.querySelector('#cm-multiview-stage .cm-slot[data-slot="1"]');
      const cell2 = document.querySelector('#cm-multiview-stage .cm-slot[data-slot="2"]');
      expect(cell1?.querySelector('.cm-slot__error')).toBeNull();
      // ready 를 안 보낸 슬롯만 실패다.
      expect(cell2?.querySelector('.cm-slot__error')).not.toBeNull();
      stage.close();
    });
  });

  it('requestAudio 를 받으면 그 슬롯을 활성 오디오 슬롯으로 승격한다', () => {
    const { stage, onActiveSlotChange } = openStage();

    sendFromSlot(requestAudio(2));

    expect(onActiveSlotChange).toHaveBeenCalledWith(2);
    const cell = document.querySelector('#cm-multiview-stage .cm-slot[data-slot="2"]');
    expect(cell?.classList.contains('cm-slot--active')).toBe(true);
    // 이전 활성 슬롯은 활성 표시를 잃는다 (= 음소거 지시를 받는다).
    const previous = document.querySelector('#cm-multiview-stage .cm-slot[data-slot="1"]');
    expect(previous?.classList.contains('cm-slot--active')).toBe(false);
    stage.close();
  });

  it('이미 활성인 슬롯의 요청은 무시한다 (불필요한 재배치·핑퐁 방지)', () => {
    const { stage, onActiveSlotChange } = openStage();

    sendFromSlot(requestAudio(1));

    expect(onActiveSlotChange).not.toHaveBeenCalled();
    stage.close();
  });

  it('허용되지 않은 origin 의 승격 요청은 무시한다', () => {
    const { stage, onActiveSlotChange } = openStage();

    sendFromSlot(requestAudio(2), 'https://evil.example');

    expect(onActiveSlotChange).not.toHaveBeenCalled();
    stage.close();
  });
  /**
   * 🔴 실측 2026-08-18 (`multiview-scenario-shots/report.json` M-03): 슬롯을 한 번 누르면
   * `document.activeElement` 가 **iframe** 이 되어 부모 `window` keydown 이 죽는다. 그 뒤로
   * `Alt+Shift+N` 이 3개 프로필 전부에서 먹지 않았다 → 프레임이 넘겨 준 단축키를 부모가 받는다.
   */
  it('프레임이 넘긴 오디오 단축키로 활성 슬롯을 옮긴다', () => {
    const { stage, onActiveSlotChange } = openStage();
    expect(activeSlotFromDom()).toBe(1);

    sendFromSlot(audioShortcut(2));

    expect(activeSlotFromDom()).toBe(2);
    expect(onActiveSlotChange).toHaveBeenCalledWith(2);
    stage.close();
  });

  it('단축키가 꺼진 기기(모바일)에서는 넘겨받아도 무시한다 (설계)', () => {
    const { stage } = openStage({ deviceClass: 'mobile' });

    sendFromSlot(audioShortcut(2));

    expect(activeSlotFromDom()).toBe(1);
    stage.close();
  });

  it('이번 구성에 없는 슬롯 번호는 무시한다', () => {
    const { stage } = openStage();

    sendFromSlot(audioShortcut(4));

    expect(activeSlotFromDom()).toBe(1);
    stage.close();
  });
  /**
   * 사이드 채팅(BETA) — 요청 2026-08-18 "멀티뷰일 때 채팅은 비효율적일 수 있는데 일단 구현하고
   * BETA 뱃지를 붙이자". 원본 aside(호스트 채널 채팅) 대신 **활성 슬롯 채팅**을 흘린다.
   */
  const chat = (slot: number, nickname: string) => ({
    channel: MV_CHANNEL,
    dir: 's2p' as const,
    kind: 'chat' as const,
    slot,
    messages: [{ nickname, text: '안녕', color: null }],
  });

  const panel = () => document.querySelector('.cm-stage-chat');
  const panelLines = () =>
    [...document.querySelectorAll('.cm-stage-chat__line')].map((n) => n.textContent);

  it('사이드 채팅 패널에 BETA 뱃지가 붙고 활성 슬롯 채널명이 보인다', () => {
    const { stage } = openStage();

    expect(panel()).not.toBeNull();
    expect(panel()?.querySelector(`.${OURS.betaBadgeClass}`)?.textContent).toBe(BETA_BADGE_TEXT);
    expect(panel()?.querySelector('.cm-stage-chat__title')?.textContent).toContain('로마러');

    stage.close();
  });

  it('활성 슬롯 채팅만 패널에 들어간다 (비활성 슬롯은 스트립 전용)', () => {
    const { stage } = openStage();

    sendFromSlot(chat(2, '비활성'));
    expect(panelLines()).toEqual([]);

    sendFromSlot(chat(1, '활성'));
    expect(panelLines().join()).toContain('활성');

    stage.close();
  });

  it('활성 슬롯을 바꾸면 제목이 따라가고 이전 채널 줄이 남지 않는다', () => {
    const { stage } = openStage();
    sendFromSlot(chat(1, '슬롯1사람'));
    expect(panelLines().join()).toContain('슬롯1사람');

    stage.setActiveSlot(2);

    expect(panel()?.querySelector('.cm-stage-chat__title')?.textContent).toContain('따효니');
    expect(panelLines()).toEqual([]);
    sendFromSlot(chat(2, '슬롯2사람'));
    expect(panelLines().join()).toContain('슬롯2사람');

    stage.close();
  });

  it('`채팅 끄기` 는 토글이다 — 끄면 패널이 사라지고 다시 켤 수 있다', () => {
    const { stage } = openStage();
    const toggle = () =>
      document.querySelector<HTMLButtonElement>(
        '.cm-stage-bar [aria-label="채팅 끄기"], .cm-stage-bar [aria-label="채팅 켜기"]',
      );

    expect(toggle()?.getAttribute('aria-label')).toBe('채팅 끄기');
    toggle()?.click();
    expect(panel()).toBeNull();
    expect(toggle()?.getAttribute('aria-label')).toBe('채팅 켜기');

    toggle()?.click();
    expect(panel()).not.toBeNull();
    expect(toggle()?.getAttribute('aria-label')).toBe('채팅 끄기');

    stage.close();
  });

  it("chatMode: 'none' 이면 패널도 컨트롤도 만들지 않는다", () => {
    const { stage } = openStage({ chatMode: 'none' });

    expect(panel()).toBeNull();
    expect(document.querySelector<HTMLElement>('.cm-stage-chat-controls')?.style.display).toBe(
      'none',
    );

    stage.close();
  });
  /**
   * 🔴 회귀 고정 — 실측 2026-08-19 (시나리오 M-10). 구성 시트에서 **가운데 슬롯을 빼면** 남는 번호가
   * 1·3 처럼 띄어진다. 예전 구현은 번호로 사각형을 찾아 빈 번호에서 `continue` 했고, 배치를 못 받은
   * 슬롯이 옛 좌표에 남아 겹쳤다(겹침 27,600px², 조작 바까지 덮여 버튼 8개가 안 눌렸다).
   */
  it('슬롯 번호가 비어 있어도(1·3) 모든 슬롯이 배치를 받는다', () => {
    const onActiveSlotChange = vi.fn();
    const stage = new MultiViewStage(DEFAULT_SETTINGS, decideDevice(), {
      onRequestConfig: vi.fn(),
      onExit: vi.fn(),
      onActiveSlotChange,
      onVolumeChange: vi.fn(),
      onChatLinesChange: vi.fn(),
      onChatWidthChange: vi.fn(),
    });
    stage.open([
      { index: 1 as const, channelId: 'a'.repeat(32), channelName: '첫번째' },
      { index: 3 as const, channelId: 'b'.repeat(32), channelName: '세번째' },
    ]);

    const cells = [...document.querySelectorAll<HTMLElement>('.cm-slot')];
    expect(cells).toHaveLength(2);
    // 두 슬롯 모두 좌표를 받았고 서로 다른 자리여야 한다 (하나가 옛 좌표에 남으면 겹친다).
    for (const cell of cells) {
      expect(cell.style.width).not.toBe('');
      expect(cell.style.height).not.toBe('');
    }
    expect(
      cells[0]?.style.left !== cells[1]?.style.left || cells[0]?.style.top !== cells[1]?.style.top,
    ).toBe(true);

    stage.close();
  });
});
