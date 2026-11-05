/** 실제 방송의 싱글뷰·멀티뷰 설정 아이콘과 패널 열기를 확인한다. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openLiveContext, PROFILES, ROOT, seedSettings, warmUp } from './demo-context.mjs';
const out = resolve(ROOT, 'etc/tmp/settings-icon');
mkdirSync(out, { recursive: true });
const context = await openLiveContext(
  PROFILES.find((p) => p.key === 'fold8-mobile-browser'),
  { profileDir: resolve(ROOT, 'etc/tmp/playwright/settings-icon') },
);
const report = { states: [] };
try {
  await warmUp(context, 'a67b328bcc8eea4451ccfa754bc19ae1');
  await seedSettings(context, {
    multiView: { enabled: false },
    wideScreen: { enabled: true, mode: 'wide' },
  });
  const page = await context.newPage();
  await page.goto('https://chzzk.naver.com/');
  const ids = await page.evaluate(async () => {
    const response = await fetch('https://api.chzzk.naver.com/service/v1/lives?size=15');
    const data = await response.json();
    return data.content.data
      .filter((r) => !r.adult)
      .slice(0, 4)
      .map((r) => r.channel.channelId);
  });
  let ready = false;
  for (const id of ids) {
    await page.goto('https://chzzk.naver.com/live/' + id, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(
        () =>
          document.querySelector('.pzp-pc--onlive video')?.readyState >= 3 &&
          document.querySelector('#cm-settings-button'),
        null,
        { timeout: 100000 },
      );
      report.channel = id;
      ready = true;
      break;
    } catch {}
  }
  if (!ready) throw new Error('본방송·설정 버튼을 확인하지 못했습니다');
  const read = (button) =>
    button.evaluate((button) => {
      const svg = button.querySelector('svg');
      const r = button.getBoundingClientRect();
      return {
        label: button.getAttribute('aria-label'),
        title: button.title,
        shapes: [...svg.children].map((e) => e.outerHTML),
        width: r.width,
        height: r.height,
        svgWidth: svg.getBoundingClientRect().width,
        ariaHidden: svg.getAttribute('aria-hidden'),
      };
    });
  await page.mouse.move(400, 350);
  await page.mouse.move(410, 355);
  const single = page.locator('#cm-settings-button');
  const singleState = await read(single);
  if (singleState.svgWidth < 20 || singleState.width < 36 || singleState.ariaHidden !== 'true')
    throw new Error('싱글뷰 아이콘 크기·접근성 오류');
  await page.locator('.pzp-pc__bottom').screenshot({ path: resolve(out, 'single.png') });
  await single.click();
  await page.locator('#cm-settings-panel [role="dialog"]').waitFor();
  await page.locator('#cm-settings-panel [aria-label="닫기"]').click();
  report.states.push({ view: 'single', ...singleState, panelOpened: true });
  await seedSettings(context, {
    multiView: {
      enabled: true,
      restoreLastLayout: true,
      defaultSplit: 2,
      slots: ids.slice(0, 2).map((channelId, index) => ({
        index: index + 1,
        channelId,
        channelName: '방송 ' + (index + 1),
      })),
    },
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const multi = page.locator('.cm-stage-bar [aria-label="이지직 설정 열기"]');
  await multi.waitFor();
  const multiState = await read(multi);
  if (JSON.stringify(singleState.shapes) !== JSON.stringify(multiState.shapes))
    throw new Error('싱글뷰·멀티뷰 아이콘 형상이 다릅니다');
  if (multiState.svgWidth < 20 || !multiState.title.includes('이지직'))
    throw new Error('멀티뷰 아이콘 크기·설명 오류');
  await page.locator('.cm-stage-bar').screenshot({ path: resolve(out, 'multi.png') });
  await multi.click();
  await page.locator('#cm-settings-panel [role="dialog"]').waitFor();
  await page.locator('#cm-settings-panel [aria-label="닫기"]').click();
  report.states.push({ view: 'multi', ...multiState, panelOpened: true });
  await page.setViewportSize({ width: 411, height: 915 });
  await page.waitForTimeout(500);
  const bounds = await multi.boundingBox();
  if (bounds.x < 0 || bounds.x + bounds.width > 411 || bounds.width < 44)
    throw new Error('모바일 설정 버튼 배치·터치 영역 오류: ' + JSON.stringify(bounds));
  report.mobile = { viewportWidth: 411, ...bounds };
  report.success = true;
  console.log('PASS: 싱글뷰·멀티뷰 동일 EZ SVG, 설정 열기, 411px 터치 영역 확인');
} finally {
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  await context.close();
}
