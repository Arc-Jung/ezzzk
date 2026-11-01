/** 실제 GitHub 조회와 설정창 버전 표시 검증. 새 버전 UI 검사는 테스트 캐시를 사용한다. */
import { openLiveContext, PROFILES, warmUp, ROOT } from './demo-context.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const context = await openLiveContext(
  PROFILES.find((p) => p.key === 'fold8-mobile-browser'),
  { profileDir: resolve(ROOT, 'etc/tmp/playwright/update-ui') },
);
const report = {};
mkdirSync('etc/tmp/update-ui', { recursive: true });
try {
  await warmUp(context, '4de764d9dad3b25602284be6db3ac647');
  const worker = context.serviceWorkers()[0];
  const extensionId = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/index.html`);
  report.actual = await popup.evaluate(() =>
    chrome.runtime.sendMessage({ kind: 'checkForUpdate' }),
  );
  console.log('ACTUAL RELEASE', JSON.stringify(report.actual));
  if (!report.actual?.release) {
    console.log(
      'FETCH DIAGNOSTIC',
      await worker.evaluate(async () => {
        try {
          const r = await fetch('https://api.github.com/repos/Arc-Jung/ezzzk/releases/latest', {
            credentials: 'omit',
            signal: AbortSignal.timeout(8000),
          });
          return { status: r.status, cors: r.headers.get('access-control-allow-origin') };
        } catch (e) {
          return { error: String(e) };
        }
      }),
    );
    throw new Error('실제 GitHub 릴리스 조회를 확인하지 못했습니다');
  }
  await popup.close();
  const page = await context.newPage();
  await page.goto('https://chzzk.naver.com/live/4de764d9dad3b25602284be6db3ac647', {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  await page.waitForSelector('#cm-settings-panel', { state: 'attached' });
  const open = async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('cm-open-settings')));
    await page.waitForSelector('#cm-settings-panel .cm-sp__footer-note');
  };
  await open();
  await page.waitForTimeout(1000);
  report.installed = await page.locator('.cm-sp__footer-note').innerText();
  await page.screenshot({ path: 'screenshots/demo-settings-version.png' });
  await page.locator('#cm-settings-panel button[aria-label="닫기"]').click();
  await page.waitForSelector('#cm-settings-panel .cm-sp__footer-note', { state: 'detached' });
  // 새 릴리스가 있는 경우의 UI만 제어한다. 실제 릴리스가 아니므로 공개 데모로 저장하지 않는다.
  await worker.evaluate(() =>
    chrome.storage.local.set({
      'ezzzk.releaseCheck': { tag: 'v99.0.0', expiresAt: Date.now() + 3600000 },
    }),
  );
  await open();
  await page.waitForSelector('.cm-sp__update-link');
  report.sizes = [];
  for (const [width, height] of [
    [859, 798],
    [411, 812],
    [915, 412],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(500);
    const metrics = await page.locator('#cm-settings-panel').evaluate((host) => {
      const link = host.querySelector('.cm-sp__update-link'),
        footer = host.querySelector('.cm-sheet__foot');
      const r = link.getBoundingClientRect(),
        f = footer.getBoundingClientRect(),
        n = host.querySelector('.cm-sp__footer-note').getBoundingClientRect();
      const buttons = [...footer.querySelectorAll('button,a')].map((e) => {
        const b = e.getBoundingClientRect();
        return {
          label: e.textContent.trim(),
          left: b.left,
          right: b.right,
          top: b.top,
          bottom: b.bottom,
          height: b.height,
        };
      });
      return {
        noteLeft: n.left,
        href: link.href,
        version: host.querySelector('.cm-sp__footer-note').textContent,
        link: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height },
        footer: { left: f.left, right: f.right, top: f.top, bottom: f.bottom },
        buttons,
        viewport: { w: innerWidth, h: innerHeight },
      };
    });
    if (metrics.noteLeft - metrics.footer.left > 20)
      throw new Error('버전 안내가 푸터 왼쪽에 정렬되지 않았습니다');
    if (
      metrics.link.height < 44 ||
      metrics.buttons.some(
        (b) => b.left < 0 || b.right > width + 1 || b.top < 0 || b.bottom > height + 1,
      )
    )
      throw new Error(`Footer outside viewport: ${JSON.stringify(metrics)}`);
    report.sizes.push(metrics);
    await page.screenshot({ path: `etc/tmp/update-ui/link-${width}x${height}.png` });
  }
  await page.locator('#cm-settings-panel .cm-sp__update-link').focus();
  if (
    (await page.locator('.cm-sp__update-link').getAttribute('href')) !==
    'https://github.com/Arc-Jung/ezzzk/releases/tag/v99.0.0'
  )
    throw new Error('잘못된 업데이트 링크');
  console.log('PASS version, update link, 3 responsive viewports');
} finally {
  writeFileSync('etc/tmp/update-ui/report.json', JSON.stringify(report, null, 2));
  await context.close();
}
