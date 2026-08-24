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
import { auditIconButtons } from '../../ui/iconButtonAudit.test-utils';
import { MULTIVIEW_CHAT_ENABLED } from './chatFeature';
import { MV_CHANNEL } from './messages';
import { INACTIVE_SLOT_QUALITY } from './slotLayout';
import {
  FOCUSED_SLOT_CLASS,
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

/**
 * 🔴 사용자 보고 (2026-08-15) 회귀 고정 — 사용자가 비활성 슬롯의 음소거를 직접 풀면
 * 슬롯이 `requestAudio` 를 올리고, 스테이지가 **기존 초점 전환 경로를 그대로 재사용해**
 * 그 슬롯을 초점으로 올린다(사이드채팅 대상·화질 우선순위용).
 *
 * 🔴 정책 변경 (요청 2026-08-20) — **모든 슬롯이 항상 소리를 낸다.** 예전에는 활성 슬롯
 * 하나만 소리를 내고 나머지를 강제 음소거했다. 초록 아웃라인 표시도 그 흔적이라 함께
 * 제거했다 — 초점 개념 자체(사이드채팅·화질 우선순위·나가기 버튼)는 남아 있다.
 */
describe('MultiViewStage — 슬롯 → 부모 메시지 배선', () => {
  const SLOTS = [
    { index: 1 as const, channelId: '17a4bfff01d96ffad065f641ce90bdde', channelName: '로마러' },
    { index: 2 as const, channelId: '0dad8baf12a436f722faa8e5001c5011', channelName: '따효니' },
  ];

  function openStage({
    deviceClass,
    chatMode,
    lowerInactiveQuality,
  }: {
    deviceClass?: 'mobile';
    chatMode?: 'active' | 'none';
    lowerInactiveQuality?: boolean;
  } = {}) {
    const onActiveSlotChange = vi.fn();
    const settings =
      chatMode || lowerInactiveQuality
        ? {
            ...DEFAULT_SETTINGS,
            multiView: {
              ...DEFAULT_SETTINGS.multiView,
              ...(chatMode ? { chatMode } : {}),
              ...(lowerInactiveQuality ? { lowerInactiveQuality } : {}),
            },
          }
        : DEFAULT_SETTINGS;
    const stage = new MultiViewStage(settings, decideDevice(deviceClass ?? 'auto'), {
      onRequestConfig: vi.fn(),
      onExit: vi.fn(),
      onActiveSlotChange,
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

  /** 슬롯 iframe 에 실제로 나간 postMessage 를 가로챈다 (음소거 지시가 없는지 검증용). */
  const spyOnSlotPosts = () =>
    [...document.querySelectorAll('#cm-multiview-stage .cm-slot iframe')].map((frame) =>
      vi.spyOn((frame as HTMLIFrameElement).contentWindow!, 'postMessage'),
    );
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
   * 🔴 회귀 고정 (2026-08-20 정책 변경) — 강제 음소거 프로토콜 자체를 지웠다. 누가
   * 나중에 되살리더라도 슬롯에 실제로 나가는 메시지를 검사하면 잡힌다.
   */
  it('어느 슬롯에도 음소거 지시를 보내지 않는다 — 강제 음소거 프로토콜은 완전히 사라졌다', () => {
    const { stage } = openStage();
    const posts = spyOnSlotPosts();

    document
      .querySelectorAll('#cm-multiview-stage .cm-slot iframe')
      .forEach((frame) => frame.dispatchEvent(new Event('load')));
    sendFromSlot({ channel: MV_CHANNEL, dir: 's2p', kind: 'ready', slot: 1 });
    sendFromSlot({ channel: MV_CHANNEL, dir: 's2p', kind: 'ready', slot: 2 });
    sendFromSlot(requestAudio(2));
    sendFromSlot(audioShortcut(1));

    for (const post of posts) {
      // 강제 음소거 지시는 `active: boolean` 필드가 있는 메시지뿐이었다 — 이제 없다.
      for (const call of post.mock.calls) {
        expect(call[0]).not.toHaveProperty('active');
      }
    }
    stage.close();
  });

  /**
   * 초점(오디오 아님) 개념 자체는 남아 있다는 걸 확인한다 — 비활성 슬롯 화질 하향은
   * 초록 아웃라인이 없어져도 여전히 초점 슬롯 기준으로 동작해야 한다.
   */
  it('열자마자 저장된 초점 슬롯 기준으로 화질 우선순위가 적용된다 (초록 아웃라인은 제거됐다)', () => {
    const { stage } = openStage({ lowerInactiveQuality: true });
    const posts = spyOnSlotPosts();

    document
      .querySelectorAll('#cm-multiview-stage .cm-slot iframe')
      .forEach((frame) => frame.dispatchEvent(new Event('load')));
    sendFromSlot({ channel: MV_CHANNEL, dir: 's2p', kind: 'ready', slot: 1 });
    sendFromSlot({ channel: MV_CHANNEL, dir: 's2p', kind: 'ready', slot: 2 });

    const qualityOf = (post: ReturnType<typeof vi.spyOn>) =>
      post.mock.calls
        .map((call) => call[0] as { kind?: string; target?: string })
        .filter((m) => m.kind === 'setQuality')
        .at(-1)?.target;

    // 초점 슬롯(기본값 1) 은 목표 화질 그대로, 나머지는 하향된다.
    expect(qualityOf(posts[0]!)).toBe('1080p');
    expect(qualityOf(posts[1]!)).toBe('720p');
    // 초록 아웃라인 클래스는 더 이상 존재하지 않는다.
    expect(document.querySelectorAll('[class*="slot--active"]').length).toBe(0);
    stage.close();
  });

  /**
   * 🔴 헤더의 전용 `초점` 버튼은 채팅이 임시 비활성화된 뒤로 쓸모가 없어져 제거했다
   * (사용자 요청 2026-08-23) — 슬롯을 직접 클릭해도 같은 경로(`setActiveSlot`)로 초점이 옮겨간다.
   */
  describe('초점 슬롯 시각 표시', () => {
    const focusedCells = () =>
      [...document.querySelectorAll(`#cm-multiview-stage .${FOCUSED_SLOT_CLASS}`)].map(
        (cell) => (cell as HTMLElement).dataset.slot,
      );

    it('열자마자 초점 슬롯 하나에만 표시가 붙는다', () => {
      const { stage } = openStage();
      expect(focusedCells()).toEqual(['1']);
      stage.close();
    });

    it('초점을 옮기면 표시도 따라 옮겨진다 (동시에 둘이 켜지지 않는다)', () => {
      const { stage } = openStage();

      stage.setActiveSlot(2);

      expect(focusedCells()).toEqual(['2']);
      stage.close();
    });

    it('슬롯을 직접 클릭해도 표시가 바뀐다 (사용자 경로)', () => {
      const { stage } = openStage();

      document.querySelector<HTMLElement>('.cm-slot[data-slot="2"]')?.click();

      expect(focusedCells()).toEqual(['2']);
      stage.close();
    });
  });

  /**
   * 🔴 사용자 보고 (2026-08-23): "멀티뷰를 설정할 때 가끔 4개 중 1~2개 방송이 요청이 실패한다."
   * 타임아웃마다 곧장 실패로 확정하지 않고 `MAX_SLOT_LOAD_RETRIES`(2)회 프레임을 다시 로드한다 —
   * 총 대기 시간은 최초 15s + (2s 백오프 + 15s) + (4s 백오프 + 15s) = 51s.
   */
  describe('슬롯 로드 실패 표시 — 재시도 (2026-08-23)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('load 만 발화하고 ready 가 오지 않으면 재시도를 거쳐 결국 실패로 표시한다 (오류 페이지)', () => {
      vi.useFakeTimers();
      const { stage } = openStage();
      const frames = document.querySelectorAll('#cm-multiview-stage .cm-slot iframe');
      // 오류 페이지도 load 를 발화시킨다 — 이것만으로 성공이라고 보면 안 된다.
      frames.forEach((frame) => frame.dispatchEvent(new Event('load')));

      vi.advanceTimersByTime(52_000);

      const errors = document.querySelectorAll('#cm-multiview-stage .cm-slot__error');
      expect(errors.length).toBe(2);
      expect(errors[0]?.textContent).toContain('불러올 수 없습니다');
      stage.close();
    });

    it('첫 타임아웃에서는 아직 실패로 확정하지 않고 재시도 상태를 보여준다', () => {
      vi.useFakeTimers();
      const { stage } = openStage();
      const frames = document.querySelectorAll('#cm-multiview-stage .cm-slot iframe');
      frames.forEach((frame) => frame.dispatchEvent(new Event('load')));

      vi.advanceTimersByTime(15_000);

      const cell1 = document.querySelector('#cm-multiview-stage .cm-slot[data-slot="1"]');
      expect(cell1?.querySelector('.cm-slot__error')).toBeNull();
      expect(cell1?.querySelector('.cm-slot__retry')?.textContent).toContain('다시 시도');
      stage.close();
    });

    it('재시도 중 frame.src 를 다시 대입해 실제로 다시 불러온다', () => {
      vi.useFakeTimers();
      const { stage } = openStage();
      const frame = document.querySelector<HTMLIFrameElement>(
        '#cm-multiview-stage .cm-slot[data-slot="1"] iframe',
      );
      expect(frame).not.toBeNull();
      frame?.dispatchEvent(new Event('load'));
      const srcBefore = frame?.src;

      // 첫 타임아웃(15s) + 재시도 백오프(2s) 뒤 재로드가 일어난다.
      vi.advanceTimersByTime(17_000);

      expect(frame?.src).toBe(srcBefore); // 채널·슬롯이 같으니 URL 자체는 동일하다.
      stage.close();
    });

    it('ready 를 보낸 슬롯은 재시도 없이 실패로 표시하지 않는다', () => {
      vi.useFakeTimers();
      const { stage } = openStage();
      document
        .querySelectorAll('#cm-multiview-stage .cm-slot iframe')
        .forEach((frame) => frame.dispatchEvent(new Event('load')));
      sendFromSlot({ channel: MV_CHANNEL, dir: 's2p', kind: 'ready', slot: 1 });

      vi.advanceTimersByTime(52_000);

      const cell1 = document.querySelector('#cm-multiview-stage .cm-slot[data-slot="1"]');
      const cell2 = document.querySelector('#cm-multiview-stage .cm-slot[data-slot="2"]');
      expect(cell1?.querySelector('.cm-slot__error')).toBeNull();
      expect(cell1?.querySelector('.cm-slot__retry')).toBeNull();
      // ready 를 안 보낸 슬롯만 재시도 끝에 실패로 확정된다.
      expect(cell2?.querySelector('.cm-slot__error')).not.toBeNull();
      stage.close();
    });

    it('재시도 도중에 ready 가 오면 재시도 상태를 지우고 실패로 확정하지 않는다', () => {
      vi.useFakeTimers();
      const { stage } = openStage();
      document
        .querySelectorAll('#cm-multiview-stage .cm-slot iframe')
        .forEach((frame) => frame.dispatchEvent(new Event('load')));

      vi.advanceTimersByTime(15_000);
      const cell1 = document.querySelector('#cm-multiview-stage .cm-slot[data-slot="1"]');
      expect(cell1?.querySelector('.cm-slot__retry')).not.toBeNull();

      sendFromSlot({ channel: MV_CHANNEL, dir: 's2p', kind: 'ready', slot: 1 });
      vi.advanceTimersByTime(40_000);

      expect(cell1?.querySelector('.cm-slot__retry')).toBeNull();
      expect(cell1?.querySelector('.cm-slot__error')).toBeNull();
      stage.close();
    });
  });

  /**
   * 🔴 실측 확정 (2026-08-24, `etc/probe/multiview-report2.json`): 4슬롯 중 하나가 프레임은
   * 정상 로드돼 `ready` 까지 왔는데 플레이어를 만들지 않아 **검은 칸으로만 남았다.**
   * 로드 타임아웃 경로는 `ready` 때문에 영원히 발화하지 않고, 유일한 신호였던
   * `header.dataset.offline` 은 대응 CSS 가 없어 화면에 아무 변화도 주지 못했다.
   */
  describe('재생이 시작되지 않는 슬롯 안내 (2026-08-24)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    const state = (slot: number, online: boolean) => ({
      channel: MV_CHANNEL,
      dir: 's2p' as const,
      kind: 'state' as const,
      slot,
      muted: true,
      volumePercent: 0,
      quality: null,
      online,
      viewerCount: null,
    });
    const notice = (slot: number) =>
      document.querySelector(`#cm-multiview-stage .cm-slot[data-slot="${slot}"] .cm-slot__notice`);

    it('잠깐 꺼져 보이는 것만으로는 안내하지 않는다 (방송 시작 직후·광고 구간)', () => {
      vi.useFakeTimers();
      const { stage } = openStage();

      sendFromSlot(state(1, false));
      vi.advanceTimersByTime(4_000);
      sendFromSlot(state(1, false));

      expect(notice(1)).toBeNull();
      stage.close();
    });

    it('10초 넘게 재생이 시작되지 않으면 안내를 띄운다', () => {
      vi.useFakeTimers();
      const { stage } = openStage();

      sendFromSlot(state(1, false));
      vi.advanceTimersByTime(11_000);
      sendFromSlot(state(1, false));

      expect(notice(1)?.textContent).toContain('재생이 시작되지 않았습니다');
      // 다른 슬롯까지 덮어쓰지 않는다.
      expect(notice(2)).toBeNull();
      stage.close();
    });

    it('재생이 시작되면 안내를 지우고 타이머도 되돌린다', () => {
      vi.useFakeTimers();
      const { stage } = openStage();
      sendFromSlot(state(1, false));
      vi.advanceTimersByTime(11_000);
      sendFromSlot(state(1, false));
      expect(notice(1)).not.toBeNull();

      sendFromSlot(state(1, true));
      expect(notice(1)).toBeNull();

      // 다시 꺼져도 처음부터 다시 센다 — 이전 경과가 남아 즉시 뜨면 안 된다.
      sendFromSlot(state(1, false));
      expect(notice(1)).toBeNull();
      stage.close();
    });
  });

  /**
   * 🔴 사용자 보고 (2026-08-24): "멀티뷰에 들어갈 때 4개 요청을 한 번에 보내서 문제가 생기는 것 같다."
   * 슬롯 프레임 `src` 는 순서대로 100ms 씩 벌려 대입한다.
   */
  describe('슬롯 로드 분산 (2026-08-24)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    const srcOf = (slot: number) =>
      document
        .querySelector<HTMLIFrameElement>(
          `#cm-multiview-stage .cm-slot[data-slot="${slot}"] iframe`,
        )
        ?.getAttribute('src') ?? null;

    it('첫 슬롯만 즉시 출발하고 나머지는 100ms 씩 밀린다', () => {
      vi.useFakeTimers();
      const { stage } = openStage();

      expect(srcOf(1)).toContain('cmSlot=1');
      expect(srcOf(2)).toBeNull();

      vi.advanceTimersByTime(100);
      expect(srcOf(2)).toContain('cmSlot=2');
      stage.close();
    });

    it('출발 전에 닫으면 요청 자체를 내지 않는다', () => {
      vi.useFakeTimers();
      const { stage } = openStage();

      stage.close();
      vi.advanceTimersByTime(1_000);

      // 스테이지 컨테이너가 통째로 사라지므로 남은 타이머가 살아 있으면 안 된다.
      expect(document.getElementById('cm-multiview-stage')).toBeNull();
    });

    it('src 를 대입하기 전의 about:blank load 는 로드 성공으로 세지 않는다', () => {
      vi.useFakeTimers();
      const { stage } = openStage();
      const frame2 = document.querySelector<HTMLIFrameElement>(
        '#cm-multiview-stage .cm-slot[data-slot="2"] iframe',
      );

      // 아직 src 가 없는 상태에서 load 가 와도 로드 타임아웃 시계가 시작되면 안 된다.
      frame2?.dispatchEvent(new Event('load'));
      vi.advanceTimersByTime(15_000);

      const cell2 = document.querySelector('#cm-multiview-stage .cm-slot[data-slot="2"]');
      // 슬롯 2 의 타임아웃은 100ms 늦게 걸리므로 15_000ms 시점엔 아직 재시도가 뜨지 않는다.
      expect(cell2?.querySelector('.cm-slot__retry')).toBeNull();
      stage.close();
    });
  });

  it('requestAudio 를 받으면 그 슬롯을 초점으로 승격한다 (오디오는 건드리지 않는다)', () => {
    const { stage, onActiveSlotChange } = openStage();

    sendFromSlot(requestAudio(2));

    expect(onActiveSlotChange).toHaveBeenCalledWith(2);
    stage.close();
  });

  it('이미 초점인 슬롯의 요청은 무시한다 (불필요한 재배치·핑퐁 방지)', () => {
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
  it('프레임이 넘긴 오디오 단축키로 초점을 옮긴다', () => {
    const { stage, onActiveSlotChange } = openStage();

    sendFromSlot(audioShortcut(2));

    expect(onActiveSlotChange).toHaveBeenCalledWith(2);
    stage.close();
  });

  it('단축키가 꺼진 기기(모바일)에서는 넘겨받아도 무시한다 (설계)', () => {
    const { stage, onActiveSlotChange } = openStage({ deviceClass: 'mobile' });

    sendFromSlot(audioShortcut(2));

    expect(onActiveSlotChange).not.toHaveBeenCalled();
    stage.close();
  });

  it('이번 구성에 없는 슬롯 번호는 무시한다', () => {
    const { stage, onActiveSlotChange } = openStage();

    sendFromSlot(audioShortcut(4));

    expect(onActiveSlotChange).not.toHaveBeenCalled();
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

  it.skipIf(!MULTIVIEW_CHAT_ENABLED)(
    '사이드 채팅 패널에 BETA 뱃지가 붙고 활성 슬롯 채널명이 보인다',
    () => {
      // 기본값이 chatMode: 'none' 이라 패널 테스트는 명시적으로 켠다 (2026-08-20).
      const { stage } = openStage({ chatMode: 'active' });

      expect(panel()).not.toBeNull();
      expect(panel()?.querySelector(`.${OURS.betaBadgeClass}`)?.textContent).toBe(BETA_BADGE_TEXT);
      expect(panel()?.querySelector('.cm-stage-chat__title')?.textContent).toContain('로마러');

      stage.close();
    },
  );

  it.skipIf(!MULTIVIEW_CHAT_ENABLED)(
    '활성 슬롯 채팅만 패널에 들어간다 (비활성 슬롯은 스트립 전용)',
    () => {
      // 기본값이 chatMode: 'none' 이라 패널 테스트는 명시적으로 켠다 (2026-08-20).
      const { stage } = openStage({ chatMode: 'active' });

      sendFromSlot(chat(2, '비활성'));
      expect(panelLines()).toEqual([]);

      sendFromSlot(chat(1, '활성'));
      expect(panelLines().join()).toContain('활성');

      stage.close();
    },
  );

  it.skipIf(!MULTIVIEW_CHAT_ENABLED)(
    '활성 슬롯을 바꾸면 제목이 따라가고 이전 채널 줄이 남지 않는다',
    () => {
      // 기본값이 chatMode: 'none' 이라 패널 테스트는 명시적으로 켠다 (2026-08-20).
      const { stage } = openStage({ chatMode: 'active' });
      sendFromSlot(chat(1, '슬롯1사람'));
      expect(panelLines().join()).toContain('슬롯1사람');

      stage.setActiveSlot(2);

      expect(panel()?.querySelector('.cm-stage-chat__title')?.textContent).toContain('따효니');
      expect(panelLines()).toEqual([]);
      sendFromSlot(chat(2, '슬롯2사람'));
      expect(panelLines().join()).toContain('슬롯2사람');

      stage.close();
    },
  );

  it.skipIf(!MULTIVIEW_CHAT_ENABLED)(
    '`채팅 끄기` 는 토글이다 — 끄면 패널이 사라지고 다시 켤 수 있다',
    () => {
      // 기본값이 chatMode: 'none' 이라 패널 테스트는 명시적으로 켠다 (2026-08-20).
      const { stage } = openStage({ chatMode: 'active' });
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
      expect(toggle()?.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
      stage.close();
    },
  );

  /**
   * 멀티뷰 채팅 임시 비활성화 (2026-08-22, `chatFeature.ts`).
   * 저장값이 `chatMode: 'active'` 이고 슬롯 채팅 줄 수가 남아 있어도 **아무것도 보이지 않아야**
   * 한다 — 마이그레이션 없이 런타임에서만 막았기 때문에 이 경로가 회귀 감시 지점이다.
   */
  it.skipIf(MULTIVIEW_CHAT_ENABLED)(
    '채팅 비활성화 중에는 저장값이 active 여도 패널·컨트롤·스트립이 모두 꺼진다',
    () => {
      const { stage } = openStage({ chatMode: 'active' });

      expect(panel()).toBeNull();
      const controls = document.querySelector<HTMLElement>('.cm-stage-chat-controls');
      expect(controls?.style.display).toBe('none');
      const strips = [...document.querySelectorAll<HTMLElement>('.cm-slot-chat-strip')];
      expect(strips.length).toBeGreaterThan(0);
      for (const strip of strips) expect(strip.style.display).toBe('none');

      stage.close();
    },
  );

  it('조작 바·슬롯 헤더의 +/− 버튼은 문자가 아니라 aria-hidden svg 아이콘이다', () => {
    const { stage } = openStage({ chatMode: 'active' });
    const bar = document.querySelector('.cm-stage-bar');
    expect(bar?.textContent).not.toMatch(/[+−]/);
    for (const label of ['채팅 영역 좁히기', '채팅 영역 넓히기']) {
      const button = bar?.querySelector(`[aria-label="${label}"]`);
      const svg = button?.querySelector('svg');
      expect(svg).toBeTruthy();
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.getAttribute('viewBox')).toBe('0 0 16 16');
    }
    stage.close();
  });

  /**
   * 좁은 화면에서 라벨을 숨겨도(CSS) 스크린리더용 접근성 이름은 항상 있어야 한다 —
   * 전수 검사. 하나라도 빠지면 압축 시 빈 버튼이 남는다.
   *
   * 판정은 다른 UI 와 **같은 규칙**(`auditIconButtons`)으로 한다 — 접근성 이름뿐 아니라
   * 버튼 속 SVG 의 `aria-hidden`, `aria-pressed` 값 유효성까지 한 번에 본다.
   */
  it('조작 바·슬롯 헤더의 모든 버튼에 접근성 이름이 있다 (전수 검사)', () => {
    const { stage } = openStage({ chatMode: 'active' });
    const stageRoot = document.getElementById('cm-multiview-stage');
    expect(stageRoot).not.toBeNull();

    // 텍스트 라벨을 가진 버튼(`구성`·`해제`)이 섞여 있으므로 전체 수와 같지 않다.
    auditIconButtons(stageRoot as HTMLElement, { expectAtLeast: 1, context: 'multiview stage' });
    for (const button of stageRoot?.querySelectorAll('button') ?? []) {
      expect(button.getAttribute('aria-label')?.length ?? 0).toBeGreaterThan(0);
    }
    stage.close();
  });

  /**
   * 압축은 CSS 미디어쿼리(`buildStageCss`)가 하고, DOM 은 항상 라벨 `<span>` 을 그대로
   * 둔다 — 넓은 화면(데스크톱·`laptop13`)에서는 미디어쿼리가 적용되지 않아 라벨이 보인다.
   */
  it('데스크톱 폭에서는 라벨이 그대로 남는다 (라벨은 DOM에 항상 있고 좁을 때만 CSS로 숨긴다)', () => {
    const { stage } = openStage({ chatMode: 'active' });
    const bar = document.querySelector('.cm-stage-bar');
    const configLabel = bar
      ?.querySelector('[aria-label="멀티뷰 구성 열기"]')
      ?.querySelector('.cm-stage-bar__label');
    const exitLabel = bar
      ?.querySelector('[aria-label="멀티뷰 해제"]')
      ?.querySelector('.cm-stage-bar__label');
    expect(configLabel?.textContent).toBe('구성');
    expect(exitLabel?.textContent).toBe('해제');
    stage.close();
  });

  /**
   * `stage.ts` 는 문자·이모지 아이콘을 0개 써야 한다 (🎯·⛶·💬 전량 SVG 로 치환).
   */
  it('전체화면·채팅켜기 버튼은 이모지가 아니라 aria-hidden svg 다', () => {
    const { stage } = openStage({ chatMode: 'active' });
    const stageRoot = document.getElementById('cm-multiview-stage');
    expect(stageRoot?.textContent).not.toMatch(/[🎯⛶💬]/u);

    const fullscreenButton = document.querySelector('.cm-stage-bar [aria-label^="전체 화면"]');
    const svg = fullscreenButton?.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 16 16');
    stage.close();
  });

  /** 터치 타겟 하한(44px 모바일) — `ctx.device.profile.touchTargetPx` 를 그대로 CSS 에 넣는다. */
  it('모바일에서는 조작 바 버튼 터치 타겟이 44px 이상이다', () => {
    const { stage } = openStage({ deviceClass: 'mobile' });
    const button = document.querySelector<HTMLButtonElement>(
      '.cm-stage-bar [aria-label="멀티뷰 구성 열기"]',
    );
    expect(button).not.toBeNull();
    const style = getComputedStyle(button!);
    expect(Number.parseFloat(style.minWidth)).toBeGreaterThanOrEqual(44);
    expect(Number.parseFloat(style.minHeight)).toBeGreaterThanOrEqual(44);
    stage.close();
  });

  it("기본값이 chatMode: 'none' 이다 — 멀티뷰를 켜면 우측 채팅이 무대를 먹지 않는다", () => {
    expect(DEFAULT_SETTINGS.multiView.chatMode).toBe('none');

    // 기본 설정 그대로 열면 패널도 컨트롤도 없다.
    const { stage } = openStage();
    expect(panel()).toBeNull();
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
