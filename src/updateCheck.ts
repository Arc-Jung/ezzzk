/** 서비스 워커 전용. 공개 릴리스 메타데이터만 조회하고 설정·시청 정보는 보내지 않는다. */
import { RELEASE_API_URL, releaseFromTag, type ReleaseInfo } from './utils/releaseVersion';

export const UPDATE_CACHE_KEY = 'ezzzk.releaseCheck';
const SUCCESS_TTL = 6 * 60 * 60 * 1000;
const FAILURE_TTL = 60 * 1000;
let pending: Promise<ReleaseInfo | null> | undefined;

async function loadLatestRelease(): Promise<ReleaseInfo | null> {
  const now = Date.now();
  try {
    const stored = (await chrome.storage.local.get(UPDATE_CACHE_KEY))[UPDATE_CACHE_KEY];
    if (
      stored &&
      typeof stored.expiresAt === 'number' &&
      stored.expiresAt > now &&
      stored.expiresAt <= now + SUCCESS_TTL
    ) {
      if (stored.tag === null) return null;
      const release = releaseFromTag(stored.tag);
      if (release) return release;
    }
  } catch {
    /* 캐시가 없어도 공개 릴리스 확인은 계속한다. */
  }

  let release: ReleaseInfo | null = null;
  let ttl = FAILURE_TTL;
  try {
    const response = await fetch(RELEASE_API_URL, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 404) ttl = SUCCESS_TTL;
    else {
      if (!response.ok) throw new Error('Release check unavailable');
      const data: unknown = await response.json();
      if (
        !data ||
        typeof data !== 'object' ||
        !('draft' in data) ||
        !('prerelease' in data) ||
        data.draft !== false ||
        data.prerelease !== false ||
        !('tag_name' in data)
      )
        throw new Error('Invalid release');
      release = releaseFromTag(data.tag_name);
      if (!release) throw new Error('Unsupported release version');
      ttl = SUCCESS_TTL;
    }
  } catch {
    /* 네트워크 실패를 최신 버전이라는 의미로 표시하지 않는다. */
  }
  try {
    await chrome.storage.local.set({
      [UPDATE_CACHE_KEY]: { expiresAt: Date.now() + ttl, tag: release?.tag ?? null },
    });
  } catch {
    /* 저장 실패가 설정창을 막지 않게 한다. */
  }
  return release;
}

export function checkLatestRelease(): Promise<ReleaseInfo | null> {
  pending ??= loadLatestRelease().finally(() => {
    pending = undefined;
  });
  return pending;
}
