/**
 * 멀티뷰 구성 시트 채널 목록 — 중복 렌더링 회귀 (UI 감사 #1, 사용자 보고 2026-08-20).
 *
 * 🔴 예전에는 인기 방송 블록이 `<section className="cm-mv-list">` 안에 두 벌 있었다.
 * 같은 `ref={scrollRef}`·`ref={sentinelRef}` 를 두 요소에 붙이면 React 는 나중에 마운트된
 * 쪽만 살려 두므로, `ConfigSheet.tsx` 의 `fitListScrollHeight` 높이 계산이 엉뚱한 박스에
 * 붙거나 아예 실패해 `.cm-mv-scroll` 의 `min-height: 72px`(행 하나 높이)만 남았다.
 * 사용자가 "채널이 한 개밖에 안 보인다"고 보고한 증상과 일치한다.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MULTIVIEW_CHAT_ENABLED } from './chatFeature';
import { ConfigSheet, SLOT_STATUS_REFRESH_MS } from './ConfigSheet';
import { decideDevice } from '../../device';
import { DEFAULT_SETTINGS } from '../../constants/storage';
import type { FollowChannel } from './followList';
import { auditIconButtons } from '../../ui/iconButtonAudit.test-utils';

vi.mock('../liveResume', async () => {
  const actual = await vi.importActual<typeof import('../liveResume')>('../liveResume');
  return { ...actual, fetchLiveStatus: vi.fn(async () => 'UNKNOWN') };
});
import { fetchLiveStatus } from '../liveResume';

beforeEach(() => {
  vi.mocked(fetchLiveStatus).mockReset().mockResolvedValue('UNKNOWN');
});

vi.mock('./followList', async () => {
  const actual = await vi.importActual<typeof import('./followList')>('./followList');
  return {
    ...actual,
    fetchFollowings: vi.fn(),
    fetchCurrentLives: vi.fn(async () => []),
    fetchLivePage: vi.fn(),
  };
});

import { fetchFollowings, fetchLivePage } from './followList';

class MockObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// jsdom 에는 IntersectionObserver/ResizeObserver 가 없다 — 센티널·높이 계산 훅이 쓰므로 최소 스텁을 준다.
(globalThis as any).IntersectionObserver = MockObserver;
(globalThis as any).ResizeObserver = MockObserver;

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount(node: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(node);
  });
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  document.body.replaceChildren();
  vi.clearAllMocks();
  vi.useRealTimers();
});

function followChannel(
  n: number,
  {
    live = true,
    liveTitle = null,
    thumbnailUrl = null,
  }: { live?: boolean; liveTitle?: string | null; thumbnailUrl?: string | null } = {},
): FollowChannel {
  return {
    channelId: `follow-${n}`,
    channelName: `팔로우채널${n}`,
    live,
    concurrentUserCount: n,
    liveTitle,
    thumbnailUrl,
  };
}

function popularChannel(
  n: number,
  {
    liveTitle = null,
    thumbnailUrl = null,
  }: { liveTitle?: string | null; thumbnailUrl?: string | null } = {},
): FollowChannel {
  return {
    channelId: `popular-${n}`,
    channelName: `인기채널${n}`,
    live: true,
    concurrentUserCount: 100 - n,
    liveTitle,
    thumbnailUrl,
  };
}

function baseProps() {
  return {
    settings: DEFAULT_SETTINGS,
    device: decideDevice('desktop'),
    currentChannel: null,
    stageSize: { width: 1200, height: 700 },
    onClose: vi.fn(),
    onStart: vi.fn(),
  };
}

describe('ConfigSheet — 채널 목록 섹션은 하나만 렌더된다', () => {
  it('.cm-mv-list · ref 대상(scroll·sentinel)이 각각 정확히 1개다', async () => {
    vi.mocked(fetchFollowings).mockResolvedValue({ ok: true, channels: [followChannel(1)] });
    vi.mocked(fetchLivePage).mockResolvedValue({ channels: [popularChannel(1)], next: null });

    await mount(<ConfigSheet {...baseProps()} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.querySelectorAll('.cm-mv-list').length).toBe(1);
    expect(document.querySelectorAll('.cm-mv-scroll').length).toBe(1);
  });

  it('팔로우한 채널이 인기 방송보다 먼저 나온다', async () => {
    vi.mocked(fetchFollowings).mockResolvedValue({
      ok: true,
      channels: [followChannel(1), followChannel(2)],
    });
    vi.mocked(fetchLivePage).mockResolvedValue({
      channels: [popularChannel(1), popularChannel(2)],
      next: null,
    });

    await mount(<ConfigSheet {...baseProps()} />);
    await act(async () => {
      await Promise.resolve();
    });

    const headings = Array.from(document.querySelectorAll('.cm-mv-list h3')).map(
      (el) => el.textContent,
    );
    const followIndex = headings.findIndex((t) => t?.includes('팔로우한 채널'));
    const popularIndex = headings.findIndex((t) => t?.includes('시청자 수 많은 방송'));
    expect(followIndex).toBeGreaterThanOrEqual(0);
    expect(popularIndex).toBeGreaterThan(followIndex);
  });

  it('비로그인(팔로우 0개)이면 인기 방송이 바로 나온다 — 목록이 통째로 비지 않는다', async () => {
    vi.mocked(fetchFollowings).mockResolvedValue({ ok: true, channels: [] });
    vi.mocked(fetchLivePage).mockResolvedValue({
      channels: [popularChannel(1), popularChannel(2), popularChannel(3)],
      next: null,
    });

    await mount(<ConfigSheet {...baseProps()} />);
    await act(async () => {
      await Promise.resolve();
    });

    const headings = Array.from(document.querySelectorAll('.cm-mv-list h3')).map(
      (el) => el.textContent,
    );
    expect(headings.some((t) => t?.includes('시청자 수 많은 방송'))).toBe(true);
    // 팔로우가 0개라도 목록 전체가 비지 않는다 — 인기 방송 행이 곧바로 채워진다.
    const rows = document.querySelectorAll('.cm-mv-channels > li');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('로그인 조회 실패(fallback)에서도 인기 방송이 바로 나온다', async () => {
    vi.mocked(fetchFollowings).mockResolvedValue({
      ok: false,
      reason: 'unauthorized',
      message: '로그인이 필요합니다.',
    });
    vi.mocked(fetchLivePage).mockResolvedValue({
      channels: [popularChannel(1)],
      next: null,
    });

    await mount(<ConfigSheet {...baseProps()} />);
    await act(async () => {
      await Promise.resolve();
    });

    const headings = Array.from(document.querySelectorAll('.cm-mv-list h3')).map(
      (el) => el.textContent,
    );
    expect(headings.some((t) => t?.includes('시청자 수 많은 방송'))).toBe(true);
    expect(document.querySelectorAll('.cm-mv-channels > li').length).toBeGreaterThan(0);
  });
});

/**
 * 🔴 사용자 요청 (2026-08-23): 멀티뷰는 지금 방송 중인 채널을 고르는 화면이라, 팔로우한
 * 채널이라도 지금 오프라인이면 골라도 빈 슬롯만 남는다 — 목록에서 아예 뺀다.
 */
describe('ConfigSheet — 팔로우 채널 목록에서 오프라인은 뺀다 (2026-08-23)', () => {
  it('오프라인 팔로우 채널은 목록에 나타나지 않는다', async () => {
    vi.mocked(fetchFollowings).mockResolvedValue({
      ok: true,
      channels: [followChannel(1, { live: true }), followChannel(2, { live: false })],
    });
    vi.mocked(fetchLivePage).mockResolvedValue({ channels: [popularChannel(1)], next: null });

    await mount(<ConfigSheet {...baseProps()} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('팔로우채널1');
    expect(document.body.textContent).not.toContain('팔로우채널2');
  });

  it('팔로우한 채널이 전부 오프라인이면 안내 문구를 보여주고 인기 방송으로 넘어간다', async () => {
    vi.mocked(fetchFollowings).mockResolvedValue({
      ok: true,
      channels: [followChannel(1, { live: false })],
    });
    vi.mocked(fetchLivePage).mockResolvedValue({ channels: [popularChannel(1)], next: null });

    await mount(<ConfigSheet {...baseProps()} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('지금 방송 중인 팔로우 채널이 없습니다.');
    expect(document.body.textContent).toContain('시청자 수 많은 방송');
    expect(document.body.textContent).not.toContain('팔로우채널1');
  });
});

/**
 * P3 아이콘 치환 회귀 — 시트 닫기(`✕`)와 슬롯 채팅 줄 스테퍼(`−`/`+`)가 전부 아이콘 전용
 * 버튼이 됐다. 보이는 텍스트가 없으므로 `aria-label` 이 사라지면 이름 없는 버튼이 된다.
 */
describe('ConfigSheet — 아이콘 버튼 접근성', () => {
  it('시트 안의 모든 아이콘 버튼에 접근성 이름이 있다', async () => {
    vi.mocked(fetchFollowings).mockResolvedValue({ ok: true, channels: [followChannel(1)] });
    vi.mocked(fetchLivePage).mockResolvedValue({ channels: [popularChannel(1)], next: null });

    await mount(<ConfigSheet {...baseProps()} />);
    await act(async () => {
      await Promise.resolve();
    });

    // 시트는 `document.body` 직계로 렌더된다 — host 가 아니라 document 를 훑는다.
    // 닫기 + 슬롯 채팅 스테퍼 `−`/`+` 셋이 최소선이다. 멀티뷰 채팅을 임시로 끈 동안
    // (`chatFeature.ts`, 2026-08-22) 스테퍼가 없으므로 `닫기` 하나만 남는다.
    auditIconButtons(document, {
      expectAtLeast: MULTIVIEW_CHAT_ENABLED ? 3 : 1,
      context: 'multiview config sheet',
    });

    const close = document.querySelector<HTMLButtonElement>('.cm-sheet__close');
    expect(close?.textContent?.trim()).toBe('');
    expect(close?.getAttribute('aria-label')).toBe('닫기');
  });
});

describe('ConfigSheet — 메인 70% 레이아웃', () => {
  it('선택한 배치와 4개 슬롯을 시작 설정으로 넘기고 기존 4분할로 돌아갈 수 있다', async () => {
    vi.mocked(fetchFollowings).mockResolvedValue({ ok: true, channels: [] });
    vi.mocked(fetchLivePage).mockResolvedValue({ channels: [], next: null });
    const props = baseProps();
    props.settings = {
      ...DEFAULT_SETTINGS,
      multiView: {
        ...DEFAULT_SETTINGS.multiView,
        slots: [1, 2, 3, 4].map((n) => ({
          index: n as 1 | 2 | 3 | 4,
          channelId: `channel-${n}`,
          channelName: `방송 ${n}`,
        })),
      },
    };
    await mount(<ConfigSheet {...props} />);
    const input = document.querySelector<HTMLInputElement>('input[value="main-sidebar"]')!;
    await act(async () => input.click());
    expect(input.checked).toBe(true);
    expect(document.querySelector('.cm-mv-grid')?.getAttribute('data-layout')).toBe('main-sidebar');
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="멀티뷰 시작"]')!.click(),
    );
    expect(props.onStart).toHaveBeenLastCalledWith(
      expect.objectContaining({
        defaultSplit: 4,
        layout: 'main-sidebar',
        slots: props.settings.multiView.slots,
      }),
    );
    await act(async () =>
      document.querySelector<HTMLInputElement>('input[name="cm-split"][value="4"]')!.click(),
    );
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="멀티뷰 시작"]')!.click(),
    );
    expect(props.onStart).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultSplit: 4, layout: 'grid' }),
    );
  });

  it('저장한 배치를 다시 선택하고 4분할을 지원하지 않는 기기에서는 선택을 막는다', async () => {
    vi.mocked(fetchFollowings).mockResolvedValue({ ok: true, channels: [] });
    vi.mocked(fetchLivePage).mockResolvedValue({ channels: [], next: null });
    const props = baseProps();
    await mount(
      <ConfigSheet
        {...props}
        settings={{
          ...DEFAULT_SETTINGS,
          multiView: {
            ...DEFAULT_SETTINGS.multiView,
            layout: 'main-sidebar',
          },
        }}
      />,
    );
    expect(document.querySelector<HTMLInputElement>('input[value="main-sidebar"]')?.checked).toBe(
      true,
    );
    await act(async () =>
      root!.render(<ConfigSheet {...props} device={decideDevice('tablet-10')} />),
    );
    expect(document.querySelector<HTMLInputElement>('input[value="main-sidebar"]')?.disabled).toBe(
      true,
    );
  });
});

describe('ConfigSheet — 선택된 방송 상태', () => {
  const selectedProps = () => {
    vi.mocked(fetchFollowings).mockResolvedValue({ ok: true, channels: [] });
    vi.mocked(fetchLivePage).mockResolvedValue({ channels: [], next: null });
    return {
      ...baseProps(),
      settings: {
        ...DEFAULT_SETTINGS,
        multiView: {
          ...DEFAULT_SETTINGS.multiView,
          slots: [
            { index: 1 as const, channelId: 'a'.repeat(32), channelName: '현재 방송' },
            { index: 2 as const, channelId: 'b'.repeat(32), channelName: '저장된 종료 방송' },
          ],
        },
      },
    };
  };

  it('인기·팔로우 목록에 없는 저장된 방송도 조회해 방송 중은 초록색, 종료는 빨간색으로 구분한다', async () => {
    const props = selectedProps();
    vi.mocked(fetchLiveStatus).mockImplementation(async (id) =>
      id === 'a'.repeat(32) ? 'OPEN' : 'CLOSE',
    );
    await mount(<ConfigSheet {...props} />);
    const cells = document.querySelectorAll('.cm-mv-cell');
    expect(cells[0]?.querySelector('[aria-label="방송 중"] .cm-mv-live--on')).not.toBeNull();
    expect(cells[1]?.querySelector('[aria-label="방송 종료"] .cm-mv-live--off')).not.toBeNull();
    expect(fetchLiveStatus).toHaveBeenCalledTimes(2);
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="멀티뷰 시작"]')!.click(),
    );
    expect(props.onStart.mock.calls[0]?.[0].slots).toEqual(props.settings.multiView.slots);
  });

  it('창을 열어 둔 동안 종료·재개 상태를 갱신하고 닫으면 조회를 중단한다', async () => {
    vi.useFakeTimers();
    const props = selectedProps();
    vi.mocked(fetchLiveStatus).mockResolvedValue('OPEN');
    await mount(<ConfigSheet {...props} />);
    expect(document.querySelectorAll('.cm-mv-cell .cm-mv-live--on')).toHaveLength(2);
    vi.mocked(fetchLiveStatus).mockResolvedValue('CLOSE');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SLOT_STATUS_REFRESH_MS);
    });
    expect(document.querySelectorAll('.cm-mv-cell .cm-mv-live--off')).toHaveLength(2);
    vi.mocked(fetchLiveStatus).mockResolvedValue('OPEN');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SLOT_STATUS_REFRESH_MS);
    });
    expect(document.querySelectorAll('.cm-mv-cell .cm-mv-live--on')).toHaveLength(2);
    const signal = vi.mocked(fetchLiveStatus).mock.calls.at(-1)?.[1];
    await act(async () => root!.unmount());
    root = null;
    expect(signal?.aborted).toBe(true);
    const calls = vi.mocked(fetchLiveStatus).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SLOT_STATUS_REFRESH_MS * 2);
    });
    expect(fetchLiveStatus).toHaveBeenCalledTimes(calls);
  });

  it('상태 조회 실패는 방송 종료로 표시하지 않고 회색으로 구분한다', async () => {
    await mount(<ConfigSheet {...selectedProps()} />);
    expect(
      document.querySelectorAll('.cm-mv-cell [aria-label="방송 상태 미확인"] .cm-mv-live--unknown'),
    ).toHaveLength(2);
    expect(document.querySelector('.cm-mv-cell .cm-mv-live--off')).toBeNull();
  });

  it('방송을 슬롯에서 비우면 진행 중인 조회를 취소하고 늦게 온 응답은 무시한다', async () => {
    const props = selectedProps();
    const pending: Array<(value: 'CLOSE') => void> = [];
    vi.mocked(fetchLiveStatus).mockImplementation(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    await mount(<ConfigSheet {...props} />);
    const signal = vi.mocked(fetchLiveStatus).mock.calls[0]?.[1];
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="슬롯 2 비우기"]')!.click(),
    );
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      pending.forEach((resolve) => resolve('CLOSE'));
    });
    expect(document.querySelectorAll('.cm-mv-cell .cm-mv-live--off')).toHaveLength(1);
    expect(document.querySelectorAll('.cm-mv-cell')[1]?.textContent).toContain('비어 있음');
  });
});
