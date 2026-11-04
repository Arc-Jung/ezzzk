/** 실제 Fullscreen API와 이벤트 전파 차단 상태에서 멀티뷰 버튼을 검사한다. 방송은 모의 DOM이다. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openLiveContext, PROFILES, ROOT, seedSettings, warmUp } from './demo-context.mjs';
const baseline = process.argv.includes('--baseline');
const out = resolve(ROOT, 'etc/tmp/multiview-fullscreen-button');
mkdirSync(out, { recursive: true });
const context = await openLiveContext(
  PROFILES.find((p) => p.key === 'fold8-mobile-browser'),
  { profileDir: resolve(ROOT, 'etc/tmp/playwright/multiview-fullscreen-button') },
);
const report = { baseline, states: [] };
try {
  await context.route('https://chzzk.naver.com/live/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"><div id="live_player_layout"><div class="pzp-pc"><video></video></div></div><aside id="aside-chatting"></aside></div></body></html>',
    }),
  );
  await warmUp(context, '11111111111111111111111111111111');
  await seedSettings(context, {
    wideScreen: { enabled: false, mode: 'default' },
    multiView: {
      enabled: true,
      restoreLastLayout: true,
      autoFullscreen: false,
      defaultSplit: 2,
      slots: [
        { index: 1, channelId: '11111111111111111111111111111111', channelName: '테스트1' },
        { index: 2, channelId: '22222222222222222222222222222222', channelName: '테스트2' },
      ],
    },
  });
  const page = await context.newPage();
  await page.goto('https://chzzk.naver.com/live/11111111111111111111111111111111');
  const button = page.locator('.cm-stage-bar button[aria-label^="전체 화면"]');
  await button.waitFor();
  const read = () =>
    button.evaluate((b) => ({
      fullscreen: !!document.fullscreenElement,
      text: b.textContent,
      title: b.title,
      label: b.getAttribute('aria-label'),
      pressed: b.getAttribute('aria-pressed'),
      path: b.querySelector('path').getAttribute('d'),
    }));
  report.states.push(await read());
  await page.evaluate(() =>
    document.documentElement.addEventListener('fullscreenchange', (event) =>
      event.stopPropagation(),
    ),
  );
  await button.click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  const maximized = await read();
  report.states.push(maximized);
  if (baseline) {
    if (maximized.text !== '최대화') throw new Error('수정 전 상태 불일치가 재현되지 않았습니다');
  } else {
    if (
      maximized.text !== '최소화' ||
      !maximized.title.includes('최소화') ||
      !maximized.label.includes('최소화') ||
      maximized.pressed !== 'true' ||
      maximized.path === report.states[0].path
    )
      throw new Error('최대화 상태의 최소화 표시가 일치하지 않습니다');
    await page.screenshot({ path: resolve(out, 'maximized.png') });
    await button.click();
    await page.waitForFunction(() => !document.fullscreenElement);
    const restored = await read();
    report.states.push(restored);
    if (
      restored.text !== '최대화' ||
      restored.pressed !== 'false' ||
      restored.path !== report.states[0].path
    )
      throw new Error('최소화 후 최대화 버튼 복구 실패');
    await button.click();
    await page.waitForFunction(() => !!document.fullscreenElement);
    await page.evaluate(() => document.exitFullscreen());
    // 외부 종료는 우리 클릭 핸들러를 거치지 않는다. 브라우저가 보내는 변경 이벤트까지 기다린다.
    await page.waitForFunction(
      () =>
        document.querySelector('.cm-stage-bar button[aria-label^="전체 화면"]')?.textContent ===
        '최대화',
    );
    if ((await read()).text !== '최대화') throw new Error('외부 전체화면 종료 후 버튼 복구 실패');
  }
  report.success = true;
  console.log(
    baseline
      ? 'BASELINE: 전체화면인데 최대화 아이콘·설명이 남는 현상 재현'
      : 'PASS: 실제 전체화면 진입·종료 시 최소화/최대화 아이콘·문구·설명 동기화',
  );
} finally {
  writeFileSync(
    resolve(out, baseline ? 'before.json' : 'after.json'),
    JSON.stringify(report, null, 2),
  );
  await context.close();
}
