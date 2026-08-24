/**
 * FR-14 팔로우 채널 목록 조회 + 폴백.
 *
 * 실측 (2026-08-11)
 * - `GET https://api.chzzk.naver.com/service/v1/channels/followings` → 비로그인 시
 *   `{"code":401,"message":"권한이 없습니다."}`. **경로는 실재하며 로그인만 필요하다.**
 * - ⚪ 응답 스키마는 아직 미확인(비로그인 조사)이다. 그래서 파서를 **여러 후보 형태에 관용적으로**
 *   만들고, 어떤 형태도 못 읽으면 화면 ⑤ 폴백으로 전이한다.
 * - 401·스키마 변경 시 → 화면 ⑤(채널 주소 직접 입력 + 최근 목록).
 */

import { info, warning } from '../../utils/log';

const FOLLOWINGS_URL = 'https://api.chzzk.naver.com/service/v1/channels/followings';
/** 홈 라이브 목록 — 비로그인·무인증으로 응답한다(실측). 폴백 후보 목록에 쓴다. */
const LIVES_URL = 'https://api.chzzk.naver.com/service/v1/lives';
/**
 * 로그인 상태 조회.
 *
 * 실측 2026-08-15 (curl, 비로그인)
 * - `GET https://comm-api.game.naver.com/nng_main/v1/user/getUserStatus` → **200**
 *   `{"code":200,...,"content":{...,"loggedIn":false}}` — 비로그인에서도 200 이다.
 * - `Origin: https://chzzk.naver.com` 에 대해
 *   `access-control-allow-origin: https://chzzk.naver.com` + `allow-credentials: true` 를 준다.
 *   → host_permissions 없이 콘텐츠 스크립트에서 그대로 호출할 수 있다.
 */
const USER_STATUS_URL = 'https://comm-api.game.naver.com/nng_main/v1/user/getUserStatus';

export type FollowChannel = {
  channelId: string;
  channelName: string;
  live: boolean;
  concurrentUserCount: number | null;
  /** 방송 제목. 팔로우 목록은 스키마가 미확인이라 없을 수 있다(그때는 채널명만 보여 준다). */
  liveTitle: string | null;
  /** 방송 썸네일. `{type}` 템플릿을 이미 해상도 값으로 치환한 완성 URL이다. */
  thumbnailUrl: string | null;
};

export type FollowListResult =
  | { ok: true; channels: FollowChannel[] }
  /** 화면 ⑤ 폴백으로 전이해야 하는 상태 */
  | { ok: false; reason: 'unauthorized' | 'schema' | 'network'; message: string };

/** 채널 주소 또는 채널 ID 문자열에서 channelId 를 뽑는다 (화면 ⑤ 직접 입력). */
export function parseChannelInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // 순수 채널 ID (실측 형태: 32자 16진수)
  if (/^[0-9a-f]{16,}$/i.test(trimmed)) return trimmed.toLowerCase();

  try {
    const url = new URL(trimmed);
    if (url.hostname !== 'chzzk.naver.com' && url.hostname !== 'm.chzzk.naver.com') return null;
    const match = /^\/live\/([0-9a-f]{16,})/i.exec(url.pathname);
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/**
 * 목록 썸네일 크기. 치지직 CDN URL 은 `image_{type}.jpg` 템플릿을 준다 — `{type}` 을
 * 실측으로 확인된 폭값(90·270·360·480 모두 200 OK, 2026-08-23)중 가장 작은 것으로 치환해
 * 목록이 수십 개로 늘어나도 트래픽이 커지지 않게 한다.
 */
const THUMBNAIL_WIDTH = '90';

/** `image_{type}.jpg` 템플릿을 실제 URL로 치환한다. **순수 함수 — 테스트 대상.** */
export function buildThumbnailUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.includes('{type}')) return raw;
  return raw.replace('{type}', THUMBNAIL_WIDTH);
}

/**
 * 팔로우 목록 한 페이지.
 *
 * 🔴 사용자 보고 (2026-08-24): "팔로잉 목록이 전부 표시되지 않고 누락된다."
 * 예전에는 `/channels/followings` 를 **파라미터 없이 한 번만** 불러 서버 기본 페이지 크기까지만
 * 받았다 — 그보다 많이 팔로우한 사용자는 나머지가 통째로 없는 것과 같았다(미검증: 서버 기본
 * 크기 값을 실측하지 못했다. 다만 파라미터도 페이징도 없었다는 것은 코드로 확정된 사실이다).
 */
export type FollowingsPage = {
  channels: FollowChannel[];
  /** 응답에 들어 있던 행 수. 요청한 `size` 보다 적으면 마지막 페이지다. */
  rowCount: number;
  /** 서버가 알려 준 전체 팔로우 수. 스키마가 미확인이라 없을 수 있다. */
  totalCount: number | null;
};

/** 한 번에 요청할 팔로우 수. 서버가 더 작은 값으로 깎아도 페이징 루프가 이어 받는다. */
export const FOLLOWINGS_PAGE_SIZE = 50;
/**
 * 페이지 루프 상한. 서버가 `page` 파라미터를 무시해 같은 페이지만 돌려주는 경우를 대비한
 * 안전장치다 — 새로 얻은 채널이 0개면 그 전에 멈추므로 실제로는 거의 닿지 않는다.
 */
const MAX_FOLLOWINGS_PAGES = 20;

/** 팔로우 목록 요청 URL. **순수 함수 — 테스트 대상.** */
export function buildFollowingsUrl(page: number, size: number = FOLLOWINGS_PAGE_SIZE): string {
  const url = new URL(FOLLOWINGS_URL);
  url.searchParams.set('page', String(Math.max(0, Math.floor(page))));
  url.searchParams.set('size', String(Math.max(1, Math.floor(size))));
  return url.toString();
}

/**
 * 관용적 파서. 스키마가 미확인이므로 흔한 형태를 모두 시도한다.
 * 하나도 못 읽으면 null 을 돌려주고 호출부가 폴백으로 전이한다.
 */
export function parseFollowingsPage(body: unknown): FollowingsPage | null {
  const content = pick(body, ['content']);
  const rows =
    firstArray(pick(content, ['followingList'])) ??
    firstArray(pick(content, ['data'])) ??
    firstArray(pick(content, ['channels'])) ??
    firstArray(content) ??
    firstArray(body);

  if (!rows) return null;

  /*
   * 🔴 임시 디버그 로그 (2026-08-23): 사용자 보고 — 팔로우 목록은 썸네일·방송 제목이 안 나오는데
   * 인기 방송(`parseLivePage`, 스키마 확정)은 잘 나온다. 팔로우 응답 스키마가 미확인이라 후보
   * 경로(`liveInfo.liveImageUrl` 등)로 추측해 짰는데 실제 필드명이 다를 가능성이 높다.
   * 설정 → 기타 → 디버그 로그를 켠 뒤 재현하면 첫 행의 실제 구조가 콘솔에 남는다 — 그 값을
   * 보고 후보 경로를 실측값으로 교체한 뒤 이 로그는 지운다.
   */
  info('followings raw row sample (first item)', JSON.stringify(rows[0], null, 2));

  const channels: FollowChannel[] = [];
  for (const row of rows) {
    // 채널 정보가 한 단계 안에 들어 있는 형태와 평평한 형태를 모두 받는다.
    const channel = (pick(row, ['channel']) ?? row) as Record<string, unknown> | undefined;
    const channelId = asString(channel?.channelId);
    if (!channelId) continue;

    const streamStatus = pick(row, ['streamer', 'openLive']) ?? channel?.openLive;
    const liveInfo = pick(row, ['liveInfo']) as Record<string, unknown> | undefined;
    const flatRow = row as Record<string, unknown>;

    channels.push({
      channelId,
      channelName: asString(channel?.channelName) ?? channelId,
      live: asBoolean(streamStatus) ?? asBoolean(liveInfo?.openLive) ?? false,
      concurrentUserCount:
        asNumber(liveInfo?.concurrentUserCount) ?? asNumber(flatRow.concurrentUserCount),
      // 팔로우 응답 스키마가 미확인이라 흔한 후보 경로를 순서대로 시도한다 — 못 찾으면 null.
      liveTitle: asString(liveInfo?.liveTitle) ?? asString(flatRow.liveTitle),
      thumbnailUrl: buildThumbnailUrl(
        asString(liveInfo?.liveImageUrl) ?? asString(flatRow.liveImageUrl),
      ),
    });
  }

  /*
   * 🔴 행을 통째로 버리는 경로가 조용하면 "왜 몇 개가 안 보이는지"를 영영 알 수 없다
   * (2026-08-24 사용자 보고의 다른 후보 원인). 몇 개를 왜 버렸는지 남긴다.
   */
  if (channels.length < rows.length) {
    warning(
      `followings: ${rows.length - channels.length} of ${rows.length} row(s) had no channelId and were dropped`,
    );
  }

  return {
    channels,
    rowCount: rows.length,
    totalCount: asNumber(pick(content, ['totalCount'])) ?? asNumber(pick(content, ['page', 'total'])),
  };
}

/** 기존 호출부·테스트용 얇은 래퍼. 한 페이지의 채널만 돌려준다. */
export function parseFollowings(body: unknown): FollowChannel[] | null {
  const page = parseFollowingsPage(body);
  if (!page || page.channels.length === 0) return null;
  return page.channels;
}

/** 라이브 중을 위로, 오프라인을 아래로 정렬한다 (시트 UX 규칙). */
export function sortForSheet(channels: FollowChannel[]): FollowChannel[] {
  return [...channels].sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1;
    const av = a.concurrentUserCount ?? -1;
    const bv = b.concurrentUserCount ?? -1;
    if (av !== bv) return bv - av;
    return a.channelName.localeCompare(b.channelName, 'ko');
  });
}

/**
 * 로그인 여부. 판단할 수 없으면 `null` 을 돌려준다 (호출부가 기존 경로로 진행한다).
 * **순수하지 않지만 파싱부는 `parseLoggedIn` 으로 뽑아 테스트한다.**
 */
export async function fetchLoggedIn(): Promise<boolean | null> {
  try {
    const response = await fetch(USER_STATUS_URL, { credentials: 'include' });
    if (!response.ok) return null;
    return parseLoggedIn(await response.json());
  } catch {
    // 조회 자체가 실패하면 알 수 없음으로 둔다. 여기서 오류를 남기지 않는다 —
    // 로그인 여부는 부가 정보이고, 실패해도 아래 팔로우 조회가 스스로 판정한다.
    return null;
  }
}

/** 로그인 상태 응답 파서. **순수 함수 — 테스트 대상.** */
export function parseLoggedIn(body: unknown): boolean | null {
  const value = pick(body, ['content', 'loggedIn']);
  return typeof value === 'boolean' ? value : null;
}

export async function fetchFollowings(): Promise<FollowListResult> {
  /*
   * 🔴 비로그인이면 팔로우 조회를 **아예 하지 않는다** (실측 2026-08-15).
   * 예전에는 무조건 호출해 401 을 받았고, 401 은 fetch 로 잡히지 않는 브라우저 네트워크 오류라
   * `Failed to load resource: ... 401` 이 콘솔에 그대로 남았다 (탐색 하네스가 6프로필 전부에서
   * console-error 로 잡았다). 401 은 "로그인 안 됨"이라는 정상 응답이므로 오류로 남길 일이 아니다.
   * 로그인 상태는 200 으로 답하는 getUserStatus 로 먼저 확인한다.
   */
  if ((await fetchLoggedIn()) === false) {
    info('not logged in; skipping followings request and using the fallback channel list');
    return {
      ok: false,
      reason: 'unauthorized',
      message: '치지직에 로그인되어 있는지 확인해 주세요.',
    };
  }

  /**
   * 🔴 **끝까지 페이지를 넘겨 받는다** (2026-08-24). 한 번만 부르면 서버 기본 페이지 크기까지만
   * 오고 나머지 팔로우 채널이 조용히 사라진다.
   *
   * 중단 조건은 셋이다 — 어느 하나만 믿지 않는다(스키마 미확인이라 서버가 `totalCount` 를
   * 안 줄 수도, `page` 파라미터를 무시할 수도 있다):
   * 1. 받은 행 수가 요청한 `size` 보다 적다 → 마지막 페이지.
   * 2. `totalCount` 만큼 다 모았다.
   * 3. 이번 페이지에서 **새로 얻은 채널이 0개** → 서버가 페이징을 무시하고 있다(무한 루프 방지).
   */
  const collected = new Map<string, FollowChannel>();
  let totalCount: number | null = null;
  let pagesFetched = 0;

  for (let page = 0; page < MAX_FOLLOWINGS_PAGES; page += 1) {
    let response: Response;
    try {
      response = await fetch(buildFollowingsUrl(page), { credentials: 'include' });
    } catch (e) {
      // 첫 페이지가 실패하면 폴백으로 넘어가고, 뒤쪽 페이지면 지금까지 모은 것으로 마친다.
      if (page === 0) return { ok: false, reason: 'network', message: String(e) };
      warning(`followings page ${page} failed; keeping ${collected.size} channel(s)`, e);
      break;
    }

    if (response.status === 401 || response.status === 403) {
      if (page > 0) break;
      return {
        ok: false,
        reason: 'unauthorized',
        message: '치지직에 로그인되어 있는지 확인해 주세요.',
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (e) {
      if (page > 0) break;
      return { ok: false, reason: 'schema', message: String(e) };
    }

    // 200 이면서 본문에 401 코드를 담아 주는 경우도 있다 (실측 응답 형태).
    const code = asNumber((body as Record<string, unknown> | undefined)?.code);
    if (code === 401 || code === 403) {
      if (page > 0) break;
      return {
        ok: false,
        reason: 'unauthorized',
        message: '치지직에 로그인되어 있는지 확인해 주세요.',
      };
    }

    const parsed = parseFollowingsPage(body);
    if (!parsed) {
      if (page > 0) break;
      warning('followings response schema not recognized, falling back to manual channel input');
      return { ok: false, reason: 'schema', message: '팔로우 목록 형식을 읽을 수 없습니다.' };
    }

    pagesFetched += 1;
    const before = collected.size;
    for (const channel of parsed.channels) {
      if (!collected.has(channel.channelId)) collected.set(channel.channelId, channel);
    }
    totalCount = parsed.totalCount ?? totalCount;

    if (collected.size === before) break;
    if (parsed.rowCount < FOLLOWINGS_PAGE_SIZE) break;
    if (totalCount !== null && collected.size >= totalCount) break;
  }

  if (collected.size === 0) {
    warning('followings response had no usable channel, falling back to manual channel input');
    return { ok: false, reason: 'schema', message: '팔로우 목록 형식을 읽을 수 없습니다.' };
  }

  info(
    `followings: collected ${collected.size} channel(s) over ${pagesFetched} page(s)` +
      (totalCount === null ? ' (server did not report totalCount)' : ` of ${totalCount}`),
  );
  return { ok: true, channels: sortForSheet([...collected.values()]) };
}

/** 라이브 목록 한 페이지. `next` 가 null 이면 더 불러올 것이 없다. */
export type LivePage = {
  channels: FollowChannel[];
  /** 다음 페이지 커서. 응답의 `content.page.next` 를 그대로 쿼리 파라미터로 쓴다. */
  next: LiveCursor | null;
};

export type LiveCursor = Record<string, string | number>;

/** 인기 방송 목록 한 번에 불러오는 개수 (사용자 요청 2026-08-23 — 10개는 너무 적었다). */
export const LIVES_PAGE_SIZE = 30;

/**
 * 목록 요청 URL 을 만든다. **순수 함수 — 테스트 대상.**
 * 커서는 응답이 준 값을 그대로 되돌려 준다 (파라미터 이름을 우리가 정하지 않는다).
 */
export function buildLivesUrl(size: number, cursor: LiveCursor | null): string {
  const url = new URL(LIVES_URL);
  url.searchParams.set('size', String(Math.max(1, Math.floor(size))));
  for (const [key, value] of Object.entries(cursor ?? {})) {
    if (value === null || value === undefined || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * 라이브 목록 응답을 파싱한다. **순수 함수 — 테스트 대상.**
 *
 * ⚪ `content.page.next` 의 정확한 형태는 미확인이다(비로그인 조사). 그래서 객체면 그대로 커서로
 * 쓰고, 아니면 커서 없음으로 본다 — 이 파일의 다른 파서와 같은 관용적 방침이다.
 * 커서를 못 읽으면 무한 스크롤이 첫 페이지에서 멈추며, 그것이 안전한 실패다.
 */
export function parseLivePage(body: unknown): LivePage {
  const content = pick(body, ['content']);
  const rows = firstArray(pick(content, ['data'])) ?? [];
  const channels: FollowChannel[] = [];
  for (const row of rows) {
    const record = row as Record<string, unknown>;
    const channel = record.channel as Record<string, unknown> | undefined;
    const channelId = asString(channel?.channelId);
    if (!channelId) continue;
    channels.push({
      channelId,
      channelName: asString(channel?.channelName) ?? channelId,
      live: true,
      concurrentUserCount: asNumber(record.concurrentUserCount),
      liveTitle: asString(record.liveTitle),
      thumbnailUrl: buildThumbnailUrl(asString(record.liveImageUrl)),
    });
  }

  const rawNext = pick(pick(content, ['page']), ['next']);
  let next: LiveCursor | null = null;
  if (typeof rawNext === 'object' && rawNext !== null && !Array.isArray(rawNext)) {
    const entries = Object.entries(rawNext as Record<string, unknown>).filter(
      (entry): entry is [string, string | number] =>
        typeof entry[1] === 'string' || typeof entry[1] === 'number',
    );
    if (entries.length > 0) next = Object.fromEntries(entries);
  }

  // 행이 요청 개수보다 적으면 마지막 페이지다 — 커서가 있어도 더 부를 필요가 없다.
  return { channels, next: channels.length === 0 ? null : next };
}

/**
 * 인기(시청자 수) 순 라이브 목록을 한 페이지 가져온다.
 * 비로그인에서도 응답한다(실측 2026-08-11).
 */
export async function fetchLivePage(
  size: number = LIVES_PAGE_SIZE,
  cursor: LiveCursor | null = null,
): Promise<LivePage> {
  try {
    const response = await fetch(buildLivesUrl(size, cursor), { credentials: 'include' });
    const body: unknown = await response.json();
    return parseLivePage(body);
  } catch (e) {
    warning('failed to fetch live list page', e);
    return { channels: [], next: null };
  }
}

/**
 * 화면 ⑤ 폴백 보조 — 현재 라이브 목록.
 * 비로그인에서도 응답하므로, 팔로우 목록을 못 읽을 때 "지금 방송 중" 후보를 보여줄 수 있다.
 */
export async function fetchCurrentLives(size = 8): Promise<FollowChannel[]> {
  return (await fetchLivePage(size)).channels;
}

function pick(value: unknown, keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function firstArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}
