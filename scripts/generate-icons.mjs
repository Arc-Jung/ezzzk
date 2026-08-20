/**
 * `public/icons/logo.svg` 를 확장 아이콘 PNG 4종으로 렌더한다.
 *
 * 왜 스크립트인가: 로고를 고칠 때마다 손으로 4개를 다시 만들면 어긋난다.
 * `yarn icons` 한 번으로 항상 SVG 와 일치시킨다.
 *
 * ⚠️ **큰 이미지를 만들어 축소하지 않는다.** 각 크기의 뷰포트에서 벡터를 그대로 래스터화한다 —
 * 축소하면 16px 에서 획이 뭉개진다. 브라우저가 그 크기에 맞춰 그리게 두는 것이 선명하다.
 *
 * ⚠️ 배경은 투명하게 남긴다(`omitBackground`). 로고의 라운드 코너 밖이 흰색으로 채워지면
 * 다크 테마 툴바에서 흰 사각형이 보인다.
 */
import { chromium } from 'playwright';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SVG_PATH = resolve(ROOT, 'public/icons/logo.svg');
const OUT_DIR = resolve(ROOT, 'public/icons');

/** manifest.json 의 `icons` 키와 같아야 한다. */
const SIZES = [16, 32, 64, 128];

async function main() {
  const svg = readFileSync(SVG_PATH, 'utf8');
  const browser = await chromium.launch();
  const results = [];

  for (const size of SIZES) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      // 1 로 둔다 — 논리 픽셀과 출력 픽셀을 일치시켜 정확히 size×size 를 얻는다.
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<!doctype html><meta charset="utf-8">
       <style>
         html, body { margin: 0; padding: 0; background: transparent; }
         svg { display: block; width: ${size}px; height: ${size}px; }
       </style>
       ${svg}`,
    );
    // 폰트가 없는 순수 도형이라 대기는 짧게 둔다 (그라데이션 적용만 기다린다).
    await page.waitForTimeout(120);

    const file = resolve(OUT_DIR, `icon${size}.png`);
    await page.screenshot({ path: file, omitBackground: true });
    await page.close();
    results.push({ size, file, bytes: statSync(file).size });
    console.info(`  ✓ icon${size}.png (${statSync(file).size} B)`);
  }

  await browser.close();

  // 검증 — PNG 헤더에서 실제 픽셀 크기를 읽어 요청한 크기와 맞는지 본다.
  console.info('\n[icons] 크기 검증 (PNG IHDR)');
  let ok = true;
  for (const { size, file } of results) {
    const buf = readFileSync(file);
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    const match = width === size && height === size;
    ok = ok && match;
    console.info(`  ${match ? '✓' : '✗'} icon${size}.png → ${width}×${height}`);
  }
  if (!ok) {
    console.error('[icons] 🔴 크기가 어긋났다');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('[icons] 실행 실패:', e);
  process.exit(1);
});
