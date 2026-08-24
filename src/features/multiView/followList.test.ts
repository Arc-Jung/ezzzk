import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildFollowingsUrl,
  buildLivesUrl,
  buildThumbnailUrl,
  parseLivePage,
  fetchFollowings,
  parseChannelInput,
  parseFollowings,
  parseFollowingsPage,
  parseLoggedIn,
  FOLLOWINGS_PAGE_SIZE,
  sortForSheet,
  type FollowChannel,
} from './followList';

const USER_STATUS_URL = 'https://comm-api.game.naver.com/nng_main/v1/user/getUserStatus';
/** 페이징이 붙은 실제 요청 URL (2026-08-24) — 테스트도 같은 빌더를 쓴다. */
const followingsUrl = (page: number) => buildFollowingsUrl(page);

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * 🔴 사용자 요청 (2026-08-23): 멀티뷰 선택 화면에 방송 썸네일·제목도 보여 달라는 요청.
 * 실측(curl, 2026-08-23): 치지직 CDN 은 `image_{type}.jpg` 템플릿을 주고, `{type}` 을
 * 90·270·360·480 어느 것으로 치환해도 200 OK — 목록이 수십 개로 늘어도 트래픽이 커지지
 * 않게 가장 작은 90 을 쓴다.
 */
describe('buildThumbnailUrl', () => {
  it('{type} 템플릿을 90 으로 치환한다', () => {
    expect(
      buildThumbnailUrl(
        'https://livecloud-thumb.akamaized.net/chzzk/.../thumbnail/image_{type}.jpg',
      ),
    ).toBe('https://livecloud-thumb.akamaized.net/chzzk/.../thumbnail/image_90.jpg');
  });

  it('템플릿이 없는 URL 은 그대로 돌려준다', () => {
    expect(buildThumbnailUrl('https://example.com/a.jpg')).toBe('https://example.com/a.jpg');
  });

  it('null·undefined 는 null 이다', () => {
    expect(buildThumbnailUrl(null)).toBeNull();
    expect(buildThumbnailUrl(undefined)).toBeNull();
  });
});

describe('parseChannelInput — 화면 ⑤ 직접 입력', () => {
  it('채널 주소에서 channelId 를 뽑는다', () => {
    expect(parseChannelInput('https://chzzk.naver.com/live/0dad8baf12a436f722faa8e5001c5011')).toBe(
      '0dad8baf12a436f722faa8e5001c5011',
    );
  });

  it('m.chzzk 주소도 받는다', () => {
    expect(
      parseChannelInput('https://m.chzzk.naver.com/live/0dad8baf12a436f722faa8e5001c5011'),
    ).toBe('0dad8baf12a436f722faa8e5001c5011');
  });

  it('순수 채널 ID 도 받고 소문자로 정규화한다', () => {
    expect(parseChannelInput('0DAD8BAF12A436F722FAA8E5001C5011')).toBe(
      '0dad8baf12a436f722faa8e5001c5011',
    );
  });

  it('앞뒤 공백을 무시한다', () => {
    expect(parseChannelInput('  0dad8baf12a436f722faa8e5001c5011  ')).toBe(
      '0dad8baf12a436f722faa8e5001c5011',
    );
  });

  it('다른 도메인·형식은 거부한다', () => {
    expect(parseChannelInput('')).toBeNull();
    expect(parseChannelInput('   ')).toBeNull();
    expect(
      parseChannelInput('https://evil.example/live/0dad8baf12a436f722faa8e5001c5011'),
    ).toBeNull();
    expect(parseChannelInput('https://chzzk.naver.com/video/14636773')).toBeNull();
    expect(parseChannelInput('짧은ID')).toBeNull();
    expect(parseChannelInput('not a url')).toBeNull();
  });
});

describe('parseFollowings — 스키마 미확인이라 관용적으로 읽는다', () => {
  it('content.followingList 형태', () => {
    const body = {
      content: {
        followingList: [
          {
            channel: { channelId: 'a'.repeat(32), channelName: '침착맨' },
            streamer: { openLive: true },
            liveInfo: { concurrentUserCount: 12000 },
          },
        ],
      },
    };
    const parsed = parseFollowings(body);
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0]).toEqual({
      channelId: 'a'.repeat(32),
      channelName: '침착맨',
      live: true,
      concurrentUserCount: 12000,
      liveTitle: null,
      thumbnailUrl: null,
    });
  });

  it('content.data 형태', () => {
    const body = {
      content: {
        data: [{ channel: { channelId: 'b'.repeat(32), channelName: '한동숙', openLive: false } }],
      },
    };
    const parsed = parseFollowings(body);
    expect(parsed?.[0]?.channelName).toBe('한동숙');
    expect(parsed?.[0]?.live).toBe(false);
  });

  it('평평한 형태 (channel 중첩 없음)', () => {
    const body = { content: [{ channelId: 'c'.repeat(32), channelName: '아이네' }] };
    const parsed = parseFollowings(body);
    expect(parsed?.[0]?.channelId).toBe('c'.repeat(32));
  });

  it('liveInfo 에 방송 제목·썸네일이 있으면 읽는다', () => {
    const body = {
      content: {
        followingList: [
          {
            channel: { channelId: 'f'.repeat(32), channelName: '테스트' },
            streamer: { openLive: true },
            liveInfo: {
              concurrentUserCount: 1,
              liveTitle: '오늘의 방송',
              liveImageUrl: 'https://img.example.com/thumb_{type}.jpg',
            },
          },
        ],
      },
    };
    const parsed = parseFollowings(body);
    expect(parsed?.[0]?.liveTitle).toBe('오늘의 방송');
    expect(parsed?.[0]?.thumbnailUrl).toBe('https://img.example.com/thumb_90.jpg');
  });

  it('방송 제목·썸네일이 없으면 null 이다 — 레이아웃이 깨지지 않아야 한다', () => {
    const body = {
      content: {
        followingList: [{ channel: { channelId: 'g'.repeat(32), channelName: '테스트2' } }],
      },
    };
    const parsed = parseFollowings(body);
    expect(parsed?.[0]?.liveTitle).toBeNull();
    expect(parsed?.[0]?.thumbnailUrl).toBeNull();
  });

  it('channelName 이 없으면 channelId 로 대체한다', () => {
    const body = { content: [{ channelId: 'd'.repeat(32) }] };
    expect(parseFollowings(body)?.[0]?.channelName).toBe('d'.repeat(32));
  });

  it('channelId 없는 항목은 버린다', () => {
    const body = { content: [{ channelName: '이름만' }, { channelId: 'e'.repeat(32) }] };
    expect(parseFollowings(body)).toHaveLength(1);
  });

  it('읽을 수 없는 형태는 null 이다 (폴백 전이 신호)', () => {
    expect(parseFollowings(null)).toBeNull();
    expect(parseFollowings(undefined)).toBeNull();
    expect(parseFollowings({ code: 401, message: '권한이 없습니다.' })).toBeNull();
    expect(parseFollowings({ content: {} })).toBeNull();
    expect(parseFollowings({ content: [] })).toBeNull();
    expect(parseFollowings('nonsense')).toBeNull();
  });
});

describe('sortForSheet — 라이브 상단, 오프라인 하단', () => {
  const make = (name: string, live: boolean, count: number | null): FollowChannel => ({
    channelId: name.padEnd(32, '0'),
    channelName: name,
    live,
    concurrentUserCount: count,
    liveTitle: null,
    thumbnailUrl: null,
  });

  it('라이브가 오프라인보다 먼저 온다', () => {
    const sorted = sortForSheet([make('풍월량', false, null), make('침착맨', true, 100)]);
    expect(sorted[0]?.channelName).toBe('침착맨');
    expect(sorted[1]?.channelName).toBe('풍월량');
  });

  it('라이브끼리는 시청자 수 내림차순이다', () => {
    const sorted = sortForSheet([
      make('릴카', true, 900),
      make('침착맨', true, 12000),
      make('한동숙', true, 8400),
    ]);
    expect(sorted.map((c) => c.channelName)).toEqual(['침착맨', '한동숙', '릴카']);
  });

  it('원본 배열을 변형하지 않는다', () => {
    const input = [make('b', true, 1), make('a', true, 2)];
    const copy = [...input];
    sortForSheet(input);
    expect(input).toEqual(copy);
  });
});

describe('fetchFollowings — 실패는 폴백 이유로 분류된다', () => {
  it('HTTP 401 은 unauthorized 다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );
    const result = await fetchFollowings();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unauthorized');
  });

  it('200 이지만 본문 code 가 401 인 실측 응답도 unauthorized 다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 401, message: '권한이 없습니다.' }), { status: 200 }),
      ),
    );
    const result = await fetchFollowings();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unauthorized');
  });

  it('알 수 없는 스키마는 schema 다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ content: { surprise: true } }), { status: 200 }),
      ),
    );
    const result = await fetchFollowings();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('schema');
  });

  it('네트워크 실패는 network 다 (예외를 밖으로 던지지 않는다)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const result = await fetchFollowings();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('network');
  });

  it('성공 시 정렬된 목록을 준다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              content: {
                followingList: [
                  { channel: { channelId: 'a'.repeat(32), channelName: '오프', openLive: false } },
                  { channel: { channelId: 'b'.repeat(32), channelName: '온', openLive: true } },
                ],
              },
            }),
            { status: 200 },
          ),
      ),
    );
    const result = await fetchFollowings();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.channels[0]?.channelName).toBe('온');
  });

  it('credentials: include 로 호출한다 (로그인 쿠키 필요)', async () => {
    const spy = vi.fn(async () => new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', spy);
    await fetchFollowings();
    expect(spy).toHaveBeenCalledWith(followingsUrl(0), { credentials: 'include' });
  });
});

describe('parseLoggedIn — 로그인 상태 응답 (실측 2026-08-15)', () => {
  it('비로그인 실측 응답은 false 다', () => {
    expect(
      parseLoggedIn({
        code: 200,
        message: null,
        content: { hasProfile: false, userIdHash: null, nickname: null, loggedIn: false },
      }),
    ).toBe(false);
  });

  it('로그인 상태는 true 다', () => {
    expect(parseLoggedIn({ content: { loggedIn: true } })).toBe(true);
  });

  it('읽을 수 없는 형태는 null(판단 불가) 이다', () => {
    expect(parseLoggedIn({})).toBeNull();
    expect(parseLoggedIn({ content: {} })).toBeNull();
    expect(parseLoggedIn({ content: { loggedIn: 'yes' } })).toBeNull();
    expect(parseLoggedIn(null)).toBeNull();
  });
});

describe('fetchFollowings — 비로그인이면 401 을 만들지 않는다 (콘솔 오류 회귀)', () => {
  it('loggedIn: false 면 팔로우 조회를 아예 호출하지 않는다', async () => {
    const spy = vi.fn(async (url: string) => {
      if (url === USER_STATUS_URL) {
        return new Response(JSON.stringify({ content: { loggedIn: false } }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: 401 }), { status: 401 });
    });
    vi.stubGlobal('fetch', spy);

    const result = await fetchFollowings();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unauthorized');
    // 401 을 부르는 요청이 한 번도 나가지 않아야 한다 — 이게 콘솔 오류의 직접 원인이었다.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalledWith(followingsUrl(0), expect.anything());
  });

  it('loggedIn: true 면 평소대로 팔로우 목록을 부른다', async () => {
    const spy = vi.fn(async (url: string) => {
      if (url === USER_STATUS_URL) {
        return new Response(JSON.stringify({ content: { loggedIn: true } }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          content: {
            followingList: [
              { channel: { channelId: 'b'.repeat(32), channelName: '온', openLive: true } },
            ],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', spy);

    const result = await fetchFollowings();

    expect(result.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(followingsUrl(0), { credentials: 'include' });
  });

  it('로그인 상태를 알 수 없으면(조회 실패) 기존 경로로 진행한다', async () => {
    const spy = vi.fn(async (url: string) => {
      if (url === USER_STATUS_URL) throw new Error('blocked');
      return new Response(JSON.stringify({ code: 401 }), { status: 401 });
    });
    vi.stubGlobal('fetch', spy);

    const result = await fetchFollowings();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unauthorized');
    expect(spy).toHaveBeenCalledWith(followingsUrl(0), { credentials: 'include' });
  });
});

describe('buildLivesUrl', () => {
  it('size 를 붙인다', () => {
    expect(buildLivesUrl(10, null)).toContain('size=10');
  });

  it('커서 파라미터를 그대로 실어 보낸다 — 이름을 우리가 정하지 않는다', () => {
    const url = buildLivesUrl(10, { concurrentUserCount: 1234, liveId: 'abc' });
    expect(url).toContain('concurrentUserCount=1234');
    expect(url).toContain('liveId=abc');
  });

  it('빈 값은 싣지 않는다', () => {
    expect(buildLivesUrl(10, { liveId: '' })).not.toContain('liveId=');
  });

  it('size 는 최소 1 이상으로 보정한다', () => {
    expect(buildLivesUrl(0, null)).toContain('size=1');
    expect(buildLivesUrl(-5, null)).toContain('size=1');
  });
});

describe('parseLivePage', () => {
  const body = (data: unknown[], next?: unknown) => ({
    content: { data, ...(next === undefined ? {} : { page: { next } }) },
  });
  const row = (channelId: string, name: string, viewers: number) => ({
    channel: { channelId, channelName: name },
    concurrentUserCount: viewers,
  });

  it('방송 제목·썸네일을 읽고 {type} 을 치환한다', () => {
    const page = parseLivePage(
      body([
        {
          ...row('a'.repeat(32), '로마러', 1),
          liveTitle: '오늘의 방송',
          liveImageUrl: 'https://img.example.com/thumb_{type}.jpg',
        },
      ]),
    );
    expect(page.channels[0]?.liveTitle).toBe('오늘의 방송');
    expect(page.channels[0]?.thumbnailUrl).toBe('https://img.example.com/thumb_90.jpg');
  });

  it('채널 목록을 읽는다', () => {
    const page = parseLivePage(body([row('a'.repeat(32), '로마러', 3631)]));
    expect(page.channels).toHaveLength(1);
    expect(page.channels[0]).toEqual({
      channelId: 'a'.repeat(32),
      channelName: '로마러',
      live: true,
      concurrentUserCount: 3631,
      liveTitle: null,
      thumbnailUrl: null,
    });
  });

  it('커서 객체를 읽는다', () => {
    const page = parseLivePage(
      body([row('b'.repeat(32), 'x', 1)], { concurrentUserCount: 900, liveId: 'z' }),
    );
    expect(page.next).toEqual({ concurrentUserCount: 900, liveId: 'z' });
  });

  it('커서가 없으면 null — 무한 스크롤이 첫 페이지에서 안전하게 멈춘다', () => {
    expect(parseLivePage(body([row('c'.repeat(32), 'x', 1)])).next).toBeNull();
    expect(parseLivePage(body([row('c'.repeat(32), 'x', 1)], null)).next).toBeNull();
    expect(parseLivePage(body([row('c'.repeat(32), 'x', 1)], 'nope')).next).toBeNull();
  });

  it('빈 페이지면 커서가 있어도 끝으로 본다', () => {
    expect(parseLivePage(body([], { liveId: 'z' })).next).toBeNull();
  });

  it('channelId 가 없는 행은 버린다', () => {
    const page = parseLivePage(body([{ channel: { channelName: '이름만' } }]));
    expect(page.channels).toHaveLength(0);
  });

  it('형태가 전혀 다르면 빈 목록을 돌려준다 (던지지 않는다)', () => {
    expect(parseLivePage(null).channels).toEqual([]);
    expect(parseLivePage({ nope: 1 }).channels).toEqual([]);
  });
});

/**
 * 🔴 사용자 보고 (2026-08-24): "팔로잉 목록이 전부 표시되지 않고 누락된다."
 * 예전에는 `/channels/followings` 를 파라미터 없이 **한 번만** 불러 서버 기본 페이지 크기까지만
 * 받았다. 끝까지 넘겨 받고, 서버가 페이징을 무시해도 무한 루프에 빠지지 않아야 한다.
 */
describe('fetchFollowings — 페이지를 끝까지 넘겨 받는다 (2026-08-24)', () => {
  const rows = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      channel: {
        channelId: String(from + i).padStart(32, '0'),
        channelName: `채널${from + i}`,
        openLive: true,
      },
    }));
  const page = (from: number, count: number, totalCount?: number) =>
    new Response(
      JSON.stringify({
        content: { followingList: rows(from, count), ...(totalCount ? { totalCount } : {}) },
      }),
      { status: 200 },
    );
  const loggedIn = () =>
    new Response(JSON.stringify({ content: { loggedIn: true } }), { status: 200 });

  it('가득 찬 페이지가 이어지면 다음 페이지를 계속 부른다', async () => {
    const spy = vi.fn(async (url: string) => {
      if (url === USER_STATUS_URL) return loggedIn();
      if (url === followingsUrl(0)) return page(0, FOLLOWINGS_PAGE_SIZE);
      if (url === followingsUrl(1)) return page(FOLLOWINGS_PAGE_SIZE, 7);
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', spy);

    const result = await fetchFollowings();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.channels).toHaveLength(FOLLOWINGS_PAGE_SIZE + 7);
    expect(spy).toHaveBeenCalledWith(followingsUrl(1), { credentials: 'include' });
  });

  it('totalCount 를 다 모으면 더 부르지 않는다', async () => {
    const spy = vi.fn(async (url: string) => {
      if (url === USER_STATUS_URL) return loggedIn();
      if (url === followingsUrl(0)) return page(0, FOLLOWINGS_PAGE_SIZE, FOLLOWINGS_PAGE_SIZE);
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', spy);

    const result = await fetchFollowings();

    expect(result.ok).toBe(true);
    expect(spy).not.toHaveBeenCalledWith(followingsUrl(1), expect.anything());
  });

  it('서버가 page 를 무시하고 같은 목록만 줘도 멈춘다 (무한 루프 방지)', async () => {
    const spy = vi.fn(async (url: string) => {
      if (url === USER_STATUS_URL) return loggedIn();
      return page(0, FOLLOWINGS_PAGE_SIZE);
    });
    vi.stubGlobal('fetch', spy);

    const result = await fetchFollowings();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.channels).toHaveLength(FOLLOWINGS_PAGE_SIZE);
    // 로그인 조회 1 + 첫 페이지 + 새 항목이 없다고 확인한 두 번째 페이지 = 3
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('두 번째 페이지가 실패해도 첫 페이지까지는 살린다', async () => {
    const spy = vi.fn(async (url: string) => {
      if (url === USER_STATUS_URL) return loggedIn();
      if (url === followingsUrl(0)) return page(0, FOLLOWINGS_PAGE_SIZE);
      throw new Error('offline');
    });
    vi.stubGlobal('fetch', spy);

    const result = await fetchFollowings();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.channels).toHaveLength(FOLLOWINGS_PAGE_SIZE);
  });
});

describe('parseFollowingsPage — 행 수·totalCount 를 함께 읽는다 (2026-08-24)', () => {
  it('행 수와 totalCount 를 돌려준다', () => {
    const parsed = parseFollowingsPage({
      content: {
        totalCount: 123,
        followingList: [{ channel: { channelId: 'a'.repeat(32), channelName: 'x' } }],
      },
    });
    expect(parsed?.rowCount).toBe(1);
    expect(parsed?.totalCount).toBe(123);
  });

  it('channelId 없는 행은 버리되 행 수에는 남는다 (누락을 조용히 만들지 않는다)', () => {
    const parsed = parseFollowingsPage({
      content: { followingList: [{ channel: { channelName: '이름만' } }] },
    });
    expect(parsed?.rowCount).toBe(1);
    expect(parsed?.channels).toHaveLength(0);
  });

  it('알 수 없는 형태는 null 이다', () => {
    expect(parseFollowingsPage({ content: { surprise: true } })).toBeNull();
  });
});
