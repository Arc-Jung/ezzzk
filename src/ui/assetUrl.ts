/**
 * 확장 자산(아이콘 등)의 절대 URL.
 *
 * 콘텐츠 스크립트는 **치지직 페이지 안**에서 돌기 때문에 `icons/logo.svg` 같은 상대 경로는
 * 치지직 서버를 가리켜 404 가 된다. 반드시 `chrome.runtime.getURL` 로 확장 오리진을 붙여야 하고,
 * 그 경로가 `manifest.json` 의 `web_accessible_resources` 에 선언돼 있어야 페이지가 읽을 수 있다.
 *
 * 확장 밖(테스트·픽스처)에서는 `chrome` 이 없을 수 있으므로 null 을 돌려주고,
 * 쓰는 쪽에서 로고 없이 그린다 — 아이콘 하나 때문에 시트가 안 뜨면 안 된다.
 */
export function extensionAssetUrl(path: string): string | undefined {
  try {
    return chrome?.runtime?.getURL?.(path) || undefined;
  } catch {
    return undefined;
  }
}

/** 설정·라이선스 시트 헤더에 쓰는 로고. `manifest.json` 의 web_accessible_resources 에 선언돼 있다. */
export const SHEET_LOGO_PATH = 'icons/logo.svg';
