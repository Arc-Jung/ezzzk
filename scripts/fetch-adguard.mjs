/**
 * 애드가드(AdGuard) 브라우저 확장을 내려받아 `.vendor/adguard-mv3/` 에 푼다.
 *
 * 왜 필요한가: 치지직의 `광고 차단 프로그램을 사용 중이신가요?` 모달은 **치지직이 광고 차단을
 * 감지했을 때만** 뜬다. 우리 확장은 네트워크를 차단하지 않으므로(권한이 `storage` 하나뿐)
 * 이 모달을 스스로 재현할 수 없다 — `adBlockNotice.ts` 헤더 주석이 "셀렉터 근거가 실측 덤프가
 * 아니라 스크린샷"이라고 적어 둔 이유가 이것이다.
 * 실제 광고 차단기를 함께 로드하면 **진짜 모달**로 검증할 수 있다 (2026-08-15 사용자 요청).
 *
 * ⚠️ 30MB 가 넘어 저장소에 커밋하지 않는다(`.gitignore`). 필요할 때 이 스크립트로 다시 받는다.
 */
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ADGUARD_DIR = resolve(ROOT, '.vendor/adguard-mv3');

const RELEASE_API =
  'https://api.github.com/repos/AdguardTeam/AdguardBrowserExtension/releases/latest';
/** MV3 빌드를 쓴다 — 우리 확장도 MV3 라 같은 크롬에서 함께 로드된다. */
const ASSET_NAME = 'chrome-mv3.zip';

export async function ensureAdguard({ force = false } = {}) {
  if (!force && existsSync(resolve(ADGUARD_DIR, 'manifest.json'))) return ADGUARD_DIR;

  const release = await fetch(RELEASE_API, {
    headers: { accept: 'application/vnd.github+json' },
  }).then((r) => r.json());
  const asset = (release.assets ?? []).find((a) => a.name === ASSET_NAME);
  if (!asset) throw new Error(`AdGuard release asset "${ASSET_NAME}" not found`);

  const vendor = dirname(ADGUARD_DIR);
  mkdirSync(vendor, { recursive: true });
  const zipPath = resolve(vendor, ASSET_NAME);

  const response = await fetch(asset.browser_download_url);
  if (!response.ok) throw new Error(`AdGuard download failed: ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(zipPath));

  rmSync(ADGUARD_DIR, { recursive: true, force: true });
  mkdirSync(ADGUARD_DIR, { recursive: true });
  execFileSync('unzip', ['-q', '-o', zipPath, '-d', ADGUARD_DIR]);
  rmSync(zipPath, { force: true });

  console.info(`[adguard] ${release.tag_name} → ${ADGUARD_DIR}`);
  return ADGUARD_DIR;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensureAdguard({ force: process.argv.includes('--force') }).catch((e) => {
    console.error('[adguard] 준비 실패:', e);
    process.exit(1);
  });
}
