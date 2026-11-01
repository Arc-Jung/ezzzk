export type SubtitlePart =
  { type: 'text'; text: string } | { type: 'emoticon'; src: string; alt: string };

/** 원본 채팅에서 확인한 이모티콘 CDN 경로만 허용한다. 배지·프로필·외부 URL은 제외한다. */
export function emoticonUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const allowed =
      (url.hostname === 'nng-phinf.pstatic.net' &&
        url.pathname.startsWith('/glive/subscription/emoji/')) ||
      (url.hostname === 'ssl.pstatic.net' && url.pathname.startsWith('/static/nng/glive/icon/'));
    return allowed ? url.href : null;
  } catch {
    return null;
  }
}

export function nicknameColor(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 50) return undefined;
  if (/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)) return value;
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(value);
  if (!rgb) return undefined;
  const parts = rgb.slice(1).map(Number);
  return parts.every((part) => part <= 255) ? `rgb(${parts.join(', ')})` : undefined;
}

/** 본문 길이·조각 수·이미지 수를 제한하고 표시에 필요한 필드만 전달한다. */
export function subtitleParts(value: unknown): SubtitlePart[] | undefined {
  if (!Array.isArray(value) || value.length > 64) return undefined;
  const parts: SubtitlePart[] = [];
  let remaining = 1000,
    images = 0;
  const text = (value: string) => {
    const next = value.slice(0, remaining);
    remaining -= next.length;
    if (!next) return;
    const previous = parts.at(-1);
    if (previous?.type === 'text') previous.text += next;
    else parts.push({ type: 'text', text: next });
  };
  for (const item of value) {
    if (!item || typeof item !== 'object') return undefined;
    if (item.type === 'text' && typeof item.text === 'string') text(item.text);
    else if (item.type === 'emoticon' && typeof item.alt === 'string') {
      const alt = (item.alt || '[이모티콘]').slice(0, Math.min(100, remaining));
      if (!alt) continue;
      const src = emoticonUrl(item.src);
      if (src && images < 20) {
        parts.push({ type: 'emoticon', src, alt });
        images++;
        remaining -= alt.length;
      } else text(alt);
    } else return undefined;
  }
  return images > 0 ? parts : undefined;
}
