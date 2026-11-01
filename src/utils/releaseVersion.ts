export const RELEASES_URL = 'https://github.com/Arc-Jung/ezzzk/releases';
export const RELEASE_API_URL = 'https://api.github.com/repos/Arc-Jung/ezzzk/releases/latest';
export type ReleaseInfo = { tag: string; version: string; url: string };

function versionParts(value: unknown): number[] | null {
  if (typeof value !== 'string' || value.length > 40 || !/^v?\d+(?:\.\d+){0,3}$/i.test(value))
    return null;
  const parts = value.replace(/^v/i, '').split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

export function isNewerVersion(latest: string, installed: string): boolean {
  const next = versionParts(latest),
    current = versionParts(installed);
  if (!next || !current) return false;
  for (let i = 0; i < 4; i++) {
    const difference = (next[i] ?? 0) - (current[i] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

/** 외부 응답의 URL은 사용하지 않고 이지직 릴리스 링크만 만든다. */
export function releaseFromTag(tag: unknown): ReleaseInfo | null {
  if (!versionParts(tag) || typeof tag !== 'string') return null;
  return {
    tag,
    version: tag.replace(/^v/i, ''),
    url: `${RELEASES_URL}/tag/${encodeURIComponent(tag)}`,
  };
}
