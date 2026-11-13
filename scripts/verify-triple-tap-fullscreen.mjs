/** 실제 터치 입력과 Fullscreen API를 사용한다. 영상은 canvas 재현용이며 실제 Android 기기 검증은 아니다. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openLiveContext, PROFILES, ROOT, seedSettings, warmUp } from './demo-context.mjs';

const out = resolve(ROOT, 'etc/tmp/triple-tap-fullscreen');
mkdirSync(out, { recursive: true });
const report = {
  node: process.version,
  fixture: 'canvas captureStream on routed Chzzk URLs',
  input: 'trusted Playwright touchscreen taps and mouse double-clicks',
  cases: [],
};
const channels = ['a', 'b', 'c', 'd'].map((c) => c.repeat(32));
const html = (
  mobile = false,
) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:0;background:#111820;color:white;font:16px Arial}.pzp-pc,.pzp-mobile{position:relative;width:90vw;height:65vh;margin:70px auto;background:#173541}.pzp-pc:fullscreen,.pzp-mobile:fullscreen{width:100%;height:100%;margin:0}video{width:100%;height:100%;object-fit:contain}.pzp-pc__bottom{position:absolute;bottom:12px;left:12px;right:12px}.pzp-pc__bottom-buttons{display:flex;justify-content:space-between}.pzp-pc__bottom-buttons-right{display:flex;gap:8px}button{padding:12px;color:white;background:#183140;border:1px solid #6b8290}#fixture-title{text-align:center;padding-top:12px}#outside{position:fixed;left:0;top:0}
</style><div id="fixture-title">세 번 터치 · 재현용 영상</div><div id="root"><div id="live_player_layout"><div class="${mobile ? 'pzp-mobile' : 'pzp-pc pzp-pc--controls'}"><video muted autoplay playsinline></video><div class="pzp-pc__bottom"><div class="pzp-pc__bottom-buttons"><div class="pzp-pc__bottom-buttons-left"></div><div class="pzp-pc__bottom-buttons-right"><button id="test-control">설정</button><button class="pzp-pc__fullscreen-button" onclick="document.fullscreenElement?document.exitFullscreen():document.querySelector('video').parentElement.requestFullscreen()">전체화면</button></div></div></div></div></div><aside id="aside-chatting"></aside></div><script>
const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const c=canvas.getContext('2d');let n=0;function draw(){c.fillStyle='#173541';c.fillRect(0,0,1280,720);c.fillStyle='#00ffa3';c.fillRect(n++%1000,550,180,10);c.fillStyle='white';c.font='44px sans-serif';c.fillText('세 번 터치로 전체화면',80,210);c.font='28px sans-serif';c.fillText('재현용 영상 · 프레임 '+n,80,290);requestAnimationFrame(draw)}draw();const v=document.querySelector('video');v.srcObject=canvas.captureStream(20);v.play();window.originalVideo=v;window.nativeDoubles=0;v.parentElement.addEventListener('dblclick',event=>{if(event.target.closest('button')||window.nativeDoubleEnabled===false)return;window.nativeDoubles++;document.fullscreenElement?document.exitFullscreen():v.parentElement.requestFullscreen()});window.touchInputs=0;document.addEventListener('pointerdown',e=>{if(e.isTrusted&&e.pointerType==='touch')window.touchInputs++},true);
</script>`;
const ensure = (ok, message) => {
  if (!ok) throw Error(message);
};
const profiles = [
  'mobile-portrait',
  'mobile-landscape',
  'tablet10-portrait',
  'tablet10-landscape',
  'laptop13',
  'fold8-mobile-browser',
];
for (const key of profiles.filter((key) => !process.argv[2] || key === process.argv[2])) {
  const context = await openLiveContext(
    PROFILES.find((p) => p.key === key),
    { profileDir: resolve(ROOT, 'etc/tmp/playwright/triple-tap-' + key) },
  );
  try {
    report.browser = context.browser().version();
    await context.route('https://chzzk.naver.com/live/**', (r) =>
      r.fulfill({ contentType: 'text/html; charset=utf-8', body: html() }),
    );
    await context.route('https://m.chzzk.naver.com/live/**', (r) =>
      r.fulfill({ contentType: 'text/html; charset=utf-8', body: html(true) }),
    );
    await warmUp(context, channels[0]);
    await seedSettings(context, {
      wideScreen: { enabled: false, mode: 'default' },
      multiView: { enabled: false, restoreLastLayout: false, autoFullscreen: false },
      autoPip: { enabled: false },
      tripleTapFullscreen: { enabled: true },
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('https://chzzk.naver.com/live/' + channels[0]);
    await page.waitForSelector('#cm-settings-button');
    await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
    async function touchVideo(owner = page, times = 1) {
      for (let i = 0; i < times; i++) {
        const box = await owner.locator('video').boundingBox();
        ensure(box, 'video box unavailable');
        await page.touchscreen.tap(box.x + box.width * 0.55, box.y + box.height * 0.4);
      }
    }
    const state = () =>
      page.evaluate(() => ({
        fullscreen: !!document.fullscreenElement,
        tag: document.fullscreenElement?.tagName,
        sameVideo: document.querySelector('video') === window.originalVideo,
        paused: document.querySelector('video').paused,
        scale: visualViewport.scale,
        doubles: window.nativeDoubles,
        touchInputs: window.touchInputs,
      }));
    if (key === 'laptop13') {
      await page.locator('video').dblclick({ position: { x: 200, y: 150 } });
      await page.waitForFunction(() => !!document.fullscreenElement);
      ensure((await state()).doubles === 1, 'mouse double-click was intercepted');
      await page.locator('.pzp-pc__fullscreen-button').click();
      report.cases.push({ name: key + ': native mouse double-click', ...(await state()) });
      console.log(key + ': mouse passed');
      continue;
    }
    await touchVideo(page, 2);
    ensure(!(await state()).fullscreen, key + ': entered before third tap');
    await touchVideo();
    await page.waitForFunction(() => !!document.fullscreenElement);
    const entered = await state();
    ensure(
      entered.doubles === 0 && entered.scale === 1 && entered.sameVideo && !entered.paused,
      key + ': tap entry changed playback or zoom',
    );
    await page.screenshot({ path: resolve(out, key + '-entered.png') });
    await touchVideo(page, 3);
    await page.waitForFunction(() => !document.fullscreenElement);
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await page.waitForTimeout(400);
    ensure(!(await state()).fullscreen, key + ': fullscreen restored after intentional exit');
    await touchVideo();
    await page.waitForTimeout(400);
    await touchVideo();
    await page.waitForTimeout(400);
    await touchVideo();
    ensure(!(await state()).fullscreen, key + ': slow taps toggled');
    await page.waitForTimeout(400);
    for (let i = 0; i < 3; i++) await page.locator('#test-control').tap();
    ensure(!(await state()).fullscreen, key + ': button taps toggled');
    report.cases.push({ name: key + ': single view', entered, exited: await state(), errors });
    console.log(key + ': touch passed');
    if (key !== 'fold8-mobile-browser') continue;

    // 설정 변경은 새로고침 없이 입력 리스너에 반영되어야 한다.
    await page.evaluate(() => {
      window.nativeDoubleEnabled = false;
    });
    await page.locator('#cm-settings-button').click();
    const option = page.getByRole('switch', { name: '세 번 터치로 전체화면 켜짐', exact: true });
    await option.click();
    await page.getByRole('switch', { name: '세 번 터치로 전체화면 꺼짐', exact: true }).waitFor();
    await page.screenshot({ path: resolve(out, 'option-off.png'), animations: 'disabled' });
    await page.locator('.cm-sheet__close').click();
    await page.waitForTimeout(150);
    await touchVideo(page, 3);
    ensure(!(await state()).fullscreen, 'OFF: triple tap still toggled fullscreen');
    await page.locator('#cm-settings-button').click();
    await page.getByRole('switch', { name: '세 번 터치로 전체화면 꺼짐', exact: true }).click();
    await page.locator('.cm-sheet__close').click();
    await page.waitForTimeout(150);
    await touchVideo(page, 3);
    await page.waitForFunction(() => !!document.fullscreenElement);
    await touchVideo(page, 3);
    await page.waitForFunction(() => !document.fullscreenElement);
    report.cases.push({ name: 'settings OFF / ON without reload', ...(await state()) });
    console.log('settings option: passed');

    // 실제 슬롯 iframe에서 입력하고 부모 문서의 전체화면 상태와 기존 프레임을 확인한다.
    await seedSettings(context, {
      multiView: {
        enabled: true,
        restoreLastLayout: true,
        autoFullscreen: false,
        autoVolume: false,
        defaultSplit: 4,
        chatMode: 'none',
        slots: channels.map((channelId, i) => ({
          index: i + 1,
          channelId,
          channelName: '재현 영상 ' + (i + 1),
        })),
      },
    });
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.cm-slot iframe').length === 4);
    const frames = await page.locator('.cm-slot iframe').elementHandles();
    const owners = await Promise.all(frames.map((f) => f.contentFrame()));
    for (const owner of owners)
      await owner.waitForSelector('#cm-volume-control', { state: 'attached' });
    await page.evaluate(
      () => (window.originalFrames = [...document.querySelectorAll('.cm-slot iframe')]),
    );
    await touchVideo(owners[0], 2);
    ensure(!(await state()).fullscreen, 'multiview: two taps toggled');
    await touchVideo(owners[0]);
    await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
    ensure(
      await owners[0].evaluate(() => !document.fullscreenElement),
      'only one slot was fullscreened',
    );
    ensure(
      (await page.locator('[data-cm-fullscreen-toggle]').getAttribute('aria-label')).includes(
        '최소화',
      ),
      'multiview button state stale',
    );
    await page.screenshot({ path: resolve(out, 'multiview-entered.png') });
    await touchVideo(owners[1], 3);
    await page.waitForFunction(() => !document.fullscreenElement);
    ensure(
      await page.evaluate(() =>
        window.originalFrames.every(
          (f, i) => f === document.querySelectorAll('.cm-slot iframe')[i],
        ),
      ),
      'frames replaced',
    );
    report.cases.push({
      name: 'multiview four slots: enter in first, exit in second',
      fullscreen: false,
      sameFrames: true,
    });
    console.log('multiview: touch passed');
    await seedSettings(context, { tripleTapFullscreen: { enabled: false } });
    for (const owner of owners)
      await owner.evaluate(() => {
        window.nativeDoubleEnabled = false;
      });
    await page.waitForTimeout(150);
    await touchVideo(owners[0], 3);
    ensure(!(await state()).fullscreen, 'multiview OFF: still toggled fullscreen');
    await seedSettings(context, { tripleTapFullscreen: { enabled: true } });
    await page.waitForTimeout(150);
    await touchVideo(owners[2], 3);
    await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
    await touchVideo(owners[0], 3);
    await page.waitForFunction(() => !document.fullscreenElement);
    report.cases.push({ name: 'multiview option OFF / ON propagates to slots', fullscreen: false });
    console.log('multiview option: passed');

    await seedSettings(context, { multiView: { enabled: false, restoreLastLayout: false } });
    await page.goto('https://m.chzzk.naver.com/live/' + channels[0]);
    await page.waitForSelector('.pzp-mobile');
    await page.waitForTimeout(400);
    await touchVideo(page, 3);
    await page.waitForFunction(() => !!document.fullscreenElement);
    await touchVideo(page, 3);
    await page.waitForFunction(() => !document.fullscreenElement);
    report.cases.push({ name: 'mobile web player', ...(await state()) });
    console.log('mobile web: passed');
  } finally {
    await context.close();
  }
}
writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ cases: report.cases.length, report: resolve(out, 'report.json') }));
