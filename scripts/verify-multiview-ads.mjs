/** 광고 마크업 → 실제 슬롯 컨트롤러 → 부모 안내 UI 회귀 검사. 방송/광고 자체는 목업이다. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openLiveContext, PROFILES, ROOT, seedSettings, warmUp } from './demo-context.mjs';

const baseline = process.argv.includes('--baseline');
const out = resolve(ROOT, 'etc/tmp/multiview-ad-regression');
mkdirSync(out, { recursive: true });
const context = await openLiveContext(
  PROFILES.find((p) => p.key === 'fold8-mobile-browser'),
  {
    profileDir: resolve(ROOT, 'etc/tmp/playwright/ad-regression'),
  },
);
const reports = [];
let page;
try {
  await context.route('https://chzzk.naver.com/live/**', async (route) => {
    const slot = new URL(route.request().url()).searchParams.get('cmSlot');
    await route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>광고 상태 회귀 테스트</title><style>
      html,body,#root,section,main,#live_player_layout,.pzp-pc {margin:0;width:100%;height:100%;background:#151515;color:white}
      .vod_player_wrap {position:absolute;inset:0;background:#193a47;display:flex;align-items:center;justify-content:center}
      .ad_info_area {padding:30px} .vod_player_wrap[hidden] {display:none}
    </style></head><body><div id="root"><section><main><div id="${slot === '1' ? 'ad-stage' : 'live_player_layout'}"><div class="pzp-pc pzp-pc--live"><video></video>
      <div class="vod_player_wrap" ${slot === '1' ? '' : 'hidden'}><div class="ad_info_area">광고 마크업 테스트 — 실제 방송 화면이 아닙니다</div></div>
    </div></div></main></section><aside id="aside-chatting"></aside></div></body></html>`,
    });
  });
  await warmUp(context, '11111111111111111111111111111111');
  await seedSettings(context, {
    adSkip: { enabled: false },
    multiView: {
      enabled: true,
      restoreLastLayout: true,
      defaultSplit: 2,
      layout: 'grid',
      chatMode: 'none',
      slots: [
        {
          index: 1,
          channelId: '11111111111111111111111111111111',
          channelName: '광고 상태 테스트',
        },
        {
          index: 2,
          channelId: '22222222222222222222222222222222',
          channelName: '실제 실패 상태 테스트',
        },
      ],
    },
  });
  page = await context.newPage();
  page.on('pageerror', (error) => console.log('PAGE ERROR', String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') console.log('CONSOLE', message.text().slice(0, 300));
  });
  await page.addInitScript(() => {
    window.__adStates = {};
    addEventListener('message', (e) => {
      if (e.data?.channel === 'ezzzk/multiview' && e.data.kind === 'state')
        window.__adStates[e.data.slot] = e.data;
    });
  });
  await page.goto('https://chzzk.naver.com/live/11111111111111111111111111111111');
  const adNotice = page.locator('.cm-slot[data-slot="1"] .cm-slot__ad-notice');
  const notice = (slot) => page.locator(`.cm-slot[data-slot="${slot}"] .cm-slot__notice`);
  await notice(2).waitFor({ timeout: 25000 });
  await page.screenshot({ path: resolve(out, baseline ? 'before.png' : 'advertising.png') });
  reports.push({
    phase: 'advertising',
    states: await page.evaluate(() => window.__adStates),
    notice1: await notice(1).count(),
    notice2: await notice(2).count(),
  });
  if (baseline) {
    if (!(await notice(1).count())) throw new Error('수정 전 오판이 재현되지 않았습니다');
    console.log('BASELINE: 광고 마크업과 재생 실패 안내 동시 표시 재현');
  } else {
    if (await notice(1).count()) throw new Error('광고 중 실패 안내 노출');
    if ((await adNotice.textContent()) !== '광고 재생 중') throw new Error('광고 상태 안내 없음');
    const separated = await adNotice.evaluate(
      (e) =>
        e.getBoundingClientRect().top >=
        e.parentElement.querySelector('.cm-slot__head').getBoundingClientRect().bottom + 2,
    );
    if (!separated) throw new Error('광고 안내가 채널 헤더에 겹칩니다');
    const handle = await page.locator('.cm-slot[data-slot="1"] iframe').elementHandle();
    const frame = await handle.contentFrame();
    await frame.locator('.vod_player_wrap').evaluate((e) => (e.hidden = true));
    await page.waitForFunction(() => window.__adStates[1]?.advertising === false);
    if (await notice(1).count()) throw new Error('광고 종료 직후 대기 시간 없이 실패 표시');
    if (await adNotice.count()) throw new Error('광고 종료 후 광고 안내 잔류');
    await notice(1).waitFor({ timeout: 16000 });
    reports.push({ phase: 'ad-ended-without-playback', notice1: await notice(1).count() });
    await frame.locator('.vod_player_wrap').evaluate((e) => (e.hidden = false));
    await notice(1).waitFor({ state: 'detached', timeout: 5000 });
    if ((await adNotice.textContent()) !== '광고 재생 중') throw new Error('광고 재시작 안내 없음');
    reports.push({ phase: 'ad-resumed', notice1: await notice(1).count() });
    await frame.evaluate(() => {
      document.querySelector('.vod_player_wrap').hidden = true;
      document.querySelector('#ad-stage').id = 'live_player_layout';
      document.querySelector('.pzp-pc').classList.add('pzp-pc--onlive');
    });
    await page.waitForFunction(
      () => window.__adStates[1]?.online === true && window.__adStates[1]?.advertising === false,
    );
    await page.waitForTimeout(12000);
    if (await notice(1).count()) throw new Error('본방송 전환 후 실패 표시');
    if (await adNotice.count()) throw new Error('본방송 전환 후 광고 안내 잔류');
    reports.push({
      phase: 'live',
      states: await page.evaluate(() => window.__adStates),
      notice1: await notice(1).count(),
    });
    await page.screenshot({ path: resolve(out, 'live.png') });
    console.log('PASS: 광고 중 안내 억제·실제 실패 유지·광고 종료 후 대기·광고/본방송 전환 확인');
  }
} catch (error) {
  if (page) {
    await page.screenshot({ path: resolve(out, 'failure.png') });
    console.log(
      'DIAGNOSTIC',
      await page.evaluate(() => ({
        device: document.documentElement.dataset.cmDevice,
        ids: [...document.querySelectorAll('[id^="cm-"]')].map((e) => e.id),
        states: window.__adStates,
        frames: document.querySelectorAll('iframe').length,
      })),
    );
  }
  throw error;
} finally {
  writeFileSync(
    resolve(out, baseline ? 'before.json' : 'after.json'),
    JSON.stringify(reports, null, 2),
  );
  await context.close();
}
