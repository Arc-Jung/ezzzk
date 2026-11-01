import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { isNewerVersion, releaseFromTag, RELEASE_API_URL } from './utils/releaseVersion';

let cache: Record<string, unknown>;
beforeEach(() => {
  vi.resetModules();
  cache = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async () => cache),
        set: vi.fn(async (value) => {
          Object.assign(cache, value);
        }),
      },
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('공개 릴리스 버전 비교', () => {
  it.each([
    ['v0.1.75', '0.1.74', true],
    ['v0.10.0', '0.9.99', true],
    ['v1.0.0', '0.99.99', true],
    ['v0.1.74', '0.1.74.0', false],
    ['0.1.74.1', '0.1.74', true],
    ['v0.1.73', '0.1.74', false],
    ['v0.1.75-beta', '0.1.74', false],
    ['oops', '0.1.74', false],
    ['v0.1.75', 'invalid', false],
  ])('%s와 %s를 숫자 단위로 비교한다', (latest, current, newer) => {
    expect(isNewerVersion(latest, current)).toBe(newer);
  });
  it('업데이트 주소는 버전 태그로 이지직 저장소에만 만든다', () => {
    expect(releaseFromTag('v0.1.75')?.url).toBe(
      'https://github.com/Arc-Jung/ezzzk/releases/tag/v0.1.75',
    );
    expect(releaseFromTag('https://example.com')).toBeNull();
    expect(releaseFromTag('v0.1.75/../../evil')).toBeNull();
  });
});

describe('릴리스 확인 캐시', () => {
  it('동시 요청을 합치고 서비스 워커가 재시작해도 캐시를 재사용한다', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v0.1.75',
        draft: false,
        prerelease: false,
        html_url: 'https://example.com',
      }),
    }));
    vi.stubGlobal('fetch', fetcher);
    const { checkLatestRelease } = await import('./updateCheck');
    const first = checkLatestRelease();
    expect(checkLatestRelease()).toBe(first);
    expect((await first)?.version).toBe('0.1.75');
    vi.resetModules();
    const restarted = await import('./updateCheck');
    expect((await restarted.checkLatestRelease())?.url).toBe(
      'https://github.com/Arc-Jung/ezzzk/releases/tag/v0.1.75',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      RELEASE_API_URL,
      expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }),
    );
  });
  it('6시간 후에는 최신 릴리스를 다시 확인한다', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100000);
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ tag_name: 'v0.1.75', draft: false, prerelease: false }),
    }));
    vi.stubGlobal('fetch', fetcher);
    const { checkLatestRelease } = await import('./updateCheck');
    await checkLatestRelease();
    now.mockReturnValue(100000 + 6 * 3600000 + 1);
    await checkLatestRelease();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    { ok: false, status: 403, json: async () => ({}) },
    {
      ok: true,
      status: 200,
      json: async () => ({ tag_name: 'v0.1.75-beta', draft: false, prerelease: true }),
    },
    {
      ok: true,
      status: 200,
      json: async () => ({ tag_name: 'v0.1.75', draft: true, prerelease: false }),
    },
  ])('오류·시험판·초안은 업데이트로 표시하지 않는다', async (response) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    );
    const { checkLatestRelease } = await import('./updateCheck');
    expect(await checkLatestRelease()).toBeNull();
  });
  it('네트워크 실패는 잠시 캐시하고 1분 후 재시도한다', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100000);
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetcher);
    const { checkLatestRelease } = await import('./updateCheck');
    expect(await checkLatestRelease()).toBeNull();
    expect(await checkLatestRelease()).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    now.mockReturnValue(160001);
    await checkLatestRelease();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
