/**
 * 멀티뷰 구성 시트 채널 목록 — 중복 렌더링 회귀 (UI 감사 #1, 사용자 보고 2026-08-20).
 *
 * 🔴 예전에는 인기 방송 블록이 `<section className="cm-mv-list">` 안에 두 벌 있었다.
 * 같은 `ref={scrollRef}`·`ref={sentinelRef}` 를 두 요소에 붙이면 React 는 나중에 마운트된
 * 쪽만 살려 두므로, `ConfigSheet.tsx` 의 `fitListScrollHeight` 높이 계산이 엉뚱한 박스에
 * 붙거나 아예 실패해 `.cm-mv-scroll` 의 `min-height: 72px`(행 하나 높이)만 남았다.
 * 사용자가 "채널이 한 개밖에 안 보인다"고 보고한 증상과 일치한다.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ConfigSheet } from './ConfigSheet';
import { decideDevice } from '../../device';
import { DEFAULT_SETTINGS } from '../../constants/storage';
import type { FollowChannel } from './followList';
import { auditIconButtons } from '../../ui/iconButtonAudit.test-utils';

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
});

function followChannel(n: number): FollowChannel {
  return {
    channelId: `follow-${n}`,
    channelName: `팔로우채널${n}`,
    live: true,
    concurrentUserCount: n,
  };
}

function popularChannel(n: number): FollowChannel {
  return {
    channelId: `popular-${n}`,
    channelName: `인기채널${n}`,
    live: true,
    concurrentUserCount: 100 - n,
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
    // 닫기 + 스테퍼 `−`/`+` 셋이 최소선이다.
    auditIconButtons(document, { expectAtLeast: 3, context: 'multiview config sheet' });

    const close = document.querySelector<HTMLButtonElement>('.cm-sheet__close');
    expect(close?.textContent?.trim()).toBe('');
    expect(close?.getAttribute('aria-label')).toBe('닫기');
  });
});
