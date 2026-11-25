import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { openLiveContext, PROFILES, ROOT, seedSettings, warmUp } from './demo-context.mjs';

const context = await openLiveContext(
  PROFILES.find((profile) => profile.key === 'fold8-mobile-browser'),
  { profileDir: resolve(ROOT, 'etc/tmp/playwright/manual-fullscreen') },
);
const channels = ['a'.repeat(32), 'b'.repeat(32)];
const url = 'https://chzzk.naver.com/live/' + channels[0];

const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:0;background:#111;color:white;font-family:Arial}.pzp-pc{position:relative;width:80vw;height:65vh;background:#153241;margin:70px auto}.pzp-pc:fullscreen{width:100%;height:100%;margin:0}.pzp-pc video{width:100%;height:100%;object-fit:contain}.pzp-pc__bottom{position:absolute;bottom:10px;left:12px;right:12px}.pzp-pc__bottom-buttons{display:flex;justify-content:space-between}button{padding:12px;color:white;background:#203948;border:1px solid #678}header{text-align:center}
</style></head><body><header>전체화면 전환 · 재현용 영상</header><div id="root"><div id="live_player_layout"><div class="pzp-pc pzp-pc--controls"><video muted autoplay playsinline></video><div class="pzp-pc__bottom"><div class="pzp-pc__bottom-buttons"><div class="pzp-pc__bottom-buttons-left"></div><div class="pzp-pc__bottom-buttons-right"><button class="pzp-pc__fullscreen-button" onclick="document.fullscreenElement?document.exitFullscreen():document.querySelector('.pzp-pc').requestFullscreen()">전체화면 / 최소화</button></div></div></div></div></div><aside id="aside-chatting"></aside></div><script>
const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const c=canvas.getContext('2d');let n=0;function draw(){c.fillStyle='#153241';c.fillRect(0,0,1280,720);c.fillStyle='#00ffa3';c.fillRect(n++%1100,550,180,12);c.fillStyle='#fff';c.font='42px sans-serif';c.fillText('전체화면 전환 테스트',80,180);c.font='26px sans-serif';c.fillText('같은 영상 · 같은 멀티뷰 프레임 유지',80,250);c.fillText('재생 프레임: '+n,80,330);requestAnimationFrame(draw)}draw();const v=document.querySelector('video');v.srcObject=canvas.captureStream(20);v.play();window.__originalVideo=v;
</script></body></html>`;
await context.route('https://chzzk.naver.com/live/**', (r) =>
  r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }),
);

async function verifyManualFullscreen(view) {
  const multiview = view !== 'single';
  // Feed the legacy fields directly to storage, as on an upgrade.
  await seedSettings(context, {
    wideScreen: { enabled: false, mode: 'fullscreen' },
    multiView: {
      enabled: multiview,
      restoreLastLayout: multiview,
      autoFullscreen: true,
      defaultSplit: 2,
      chatMode: 'none',
      slots: multiview
        ? channels.map((channelId, index) => ({
            index: index + 1,
            channelId,
            channelName: `재현 영상 ${index + 1}`,
          }))
        : [],
    },
  });

  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  try {
    await page.addInitScript(() => {
      window.fullscreenChanges = 0;
      window.fullscreenErrors = 0;
      document.addEventListener('fullscreenchange', () => window.fullscreenChanges++, true);
      document.addEventListener('fullscreenerror', () => window.fullscreenErrors++, true);
    });
    await page.goto(url);
    await page.waitForSelector('#cm-settings-button', { state: 'attached' });
    const playing = multiview
      ? await (await page.locator('.cm-slot iframe').first().elementHandle()).contentFrame()
      : page;
    const owner = view === 'slot' ? playing : page;
    const enter =
      view === 'multiview'
        ? page.locator('#cm-multiview-stage [data-cm-fullscreen-toggle]')
        : owner.locator('.pzp-pc__fullscreen-button');
    const state = () =>
      owner.evaluate(() => ({
        fullscreen: Boolean(document.fullscreenElement),
        changes: window.fullscreenChanges,
        errors: window.fullscreenErrors,
      }));

    await enter.waitFor();
    await playing.waitForFunction(() => document.querySelector('video')?.currentTime > 0);
    await playing.locator('video').click({ position: { x: 100, y: 100 } });
    // Touch click synthesis and rejected fullscreen requests may arrive on the next frame.
    await page.waitForTimeout(400);
    assert.deepEqual(
      await state(),
      { fullscreen: false, changes: 0, errors: 0 },
      view + ' playback',
    );

    await enter.click();
    await owner.waitForFunction(() => Boolean(document.fullscreenElement));
    // Model OS exit and foreground return with native fullscreen and page lifecycle events.
    await owner.evaluate(async () => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      await document.exitFullscreen();
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await page.waitForTimeout(400);
    await playing.locator('video').click({ position: { x: 100, y: 100 } });
    await page.waitForTimeout(400);
    assert.deepEqual(await state(), { fullscreen: false, changes: 2, errors: 0 }, view + ' return');

    await enter.click();
    await owner.waitForFunction(() => Boolean(document.fullscreenElement));
    await enter.click();
    await owner.waitForFunction(() => !document.fullscreenElement && window.fullscreenChanges >= 4);
    assert.deepEqual(
      await state(),
      { fullscreen: false, changes: 4, errors: 0 },
      view + ' manual toggle',
    );
    assert.ok(
      await playing.evaluate(() => {
        const video = document.querySelector('video');
        return video === window.__originalVideo && !video.paused && video.currentTime > 0;
      }),
      view + ' playback continuity',
    );
    console.log(`PASS ${view}: manual fullscreen works without automatic entry or restoration`);
  } finally {
    await page.close();
  }
}

try {
  await warmUp(context, channels[0]);
  for (const view of ['single', 'multiview', 'slot']) {
    await verifyManualFullscreen(view);
  }
} finally {
  await context.close();
}
