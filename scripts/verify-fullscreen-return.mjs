/** 재현용 영상과 실제 Fullscreen API로 복귀·입력 제한·직접 종료를 검증한다.
 * OS 앱 전환은 자동화 환경에서 관측되지 않아 pagehide/pageshow를 재생한다.
 * 사용자 입력이 필요한 브라우저는 확장 실행 문맥의 요청에 제한을 주입해 확인한다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openLiveContext, PROFILES, ROOT, seedSettings, warmUp } from './demo-context.mjs';

const out = resolve(ROOT, 'etc/tmp/fullscreen-return');
mkdirSync(out, { recursive: true });
const context = await openLiveContext(
  PROFILES.find((p) => p.key === 'fold8-mobile-browser'),
  {
    profileDir: resolve(ROOT, 'etc/tmp/playwright/fullscreen-return'),
  },
);
const channels = ['a', 'b', 'c', 'd'].map((c) => c.repeat(32));
const report = {
  node: process.version,
  browser: context.browser().version(),
  viewport: { width: 859, height: 798 },
  fixture: 'canvas captureStream video on routed Chzzk URLs',
  lifecycle: 'pagehide/pageshow replay',
  permissionCase: 'first automatic restore request rejection (fault injection)',
  cases: [],
};
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:0;background:#111;color:white;font-family:Arial}.pzp-pc{position:relative;width:80vw;height:65vh;background:#153241;margin:70px auto}.pzp-pc:fullscreen{width:100%;height:100%;margin:0}.pzp-pc video{width:100%;height:100%;object-fit:contain}.pzp-pc__bottom{position:absolute;bottom:10px;left:12px;right:12px}.pzp-pc__bottom-buttons{display:flex;justify-content:space-between}button{padding:12px;color:white;background:#203948;border:1px solid #678}header{text-align:center}
</style></head><body><header>전체화면 복귀 · 재현용 영상</header><div id="root"><div id="live_player_layout"><div class="pzp-pc pzp-pc--controls"><video muted autoplay playsinline></video><div class="pzp-pc__bottom"><div class="pzp-pc__bottom-buttons"><div class="pzp-pc__bottom-buttons-left"></div><div class="pzp-pc__bottom-buttons-right"><button class="pzp-pc__fullscreen-button" onclick="document.fullscreenElement?document.exitFullscreen():document.querySelector('.pzp-pc').requestFullscreen()">전체화면 / 최소화</button></div></div></div></div></div><aside id="aside-chatting"></aside></div><script>
const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const c=canvas.getContext('2d');let n=0;function draw(){c.fillStyle='#153241';c.fillRect(0,0,1280,720);c.fillStyle='#00ffa3';c.fillRect(n++%1100,550,180,12);c.fillStyle='#fff';c.font='42px sans-serif';c.fillText('전체화면 복귀 테스트',80,180);c.font='26px sans-serif';c.fillText('같은 영상 · 같은 멀티뷰 프레임 유지',80,250);c.fillText('재생 프레임: '+n,80,330);requestAnimationFrame(draw)}draw();const v=document.querySelector('video');v.srcObject=canvas.captureStream(20);v.play();window.__originalVideo=v;
</script></body></html>`;
await context.route('https://chzzk.naver.com/live/**', (r) =>
  r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }),
);

async function requireGesture(page) {
  const session = await context.newCDPSession(page);
  const worlds = [];
  session.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context));
  await session.send('Runtime.enable');
  const contexts = worlds.filter(
    (c) => c.auxData?.isDefault === false && c.origin.startsWith('chrome-extension://'),
  );
  if (!contexts.length) throw Error('확장 실행 문맥을 찾지 못했습니다');
  for (const world of contexts)
    await session.send('Runtime.evaluate', {
      contextId: world.id,
      expression: `(()=>{let blocked=true;const original=HTMLElement.prototype.requestFullscreen;HTMLElement.prototype.requestFullscreen=function(options){if(blocked){blocked=false;return Promise.reject(new TypeError('Injected: user gesture required'))};return original.call(this,options)}})()`,
    });
  return session;
}
async function runCase(name, multiView, leaf, blocked) {
  await seedSettings(context, {
    wideScreen: { enabled: false, mode: 'default' },
    multiView: {
      enabled: multiView,
      restoreLastLayout: multiView,
      autoFullscreen: false,
      autoVolume: false,
      defaultSplit: 4,
      chatMode: 'none',
      slots: multiView
        ? channels.map((channelId, i) => ({
            index: i + 1,
            channelId,
            channelName: '재현 영상 ' + (i + 1),
          }))
        : [],
    },
  });
  const page = await context.newPage();
  let probe;
  let videoOwner = page;
  const result = { name, multiView, leaf, blocked, states: [] };
  const sample = async (owner, phase) => {
    const value = await videoOwner.evaluate(() => ({
      sameVideo: document.querySelector('video') === window.__originalVideo,
      paused: document.querySelector('video').paused,
      time: document.querySelector('video').currentTime,
    }));
    value.fullscreen = await owner.evaluate(() => !!document.fullscreenElement);
    result.states.push({ phase, ...value });
    return value;
  };
  try {
    await page.goto('https://chzzk.naver.com/live/' + channels[0]);
    await page.waitForSelector('#cm-settings-button');
    let owner = page;
    if (multiView) {
      await page.waitForFunction(() => document.querySelectorAll('.cm-slot iframe').length === 4);
      const frames = await page.locator('.cm-slot iframe').elementHandles();
      for (const handle of frames)
        await (
          await handle.contentFrame()
        ).waitForSelector('#cm-volume-control', { state: 'attached' });
      await page.evaluate(() => {
        window.__originalFrames = [...document.querySelectorAll('.cm-slot iframe')];
      });
      videoOwner = await frames[0].contentFrame();
      if (leaf) owner = videoOwner;
    }
    const enter =
      multiView && !leaf
        ? page.locator('[data-cm-fullscreen-toggle]')
        : owner.locator('.pzp-pc__fullscreen-button');
    await enter.click();
    await owner.waitForFunction(() => !!document.fullscreenElement);
    await sample(owner, 'entered');
    if (blocked) probe = await requireGesture(page);
    // 요청에 쓰인 기존 입력 활성화가 만료될 때까지 기다린다.
    await page.waitForTimeout(6000);
    await owner.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })),
    );
    await owner.evaluate(() => document.exitFullscreen());
    await owner.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
    );
    await page.waitForTimeout(300);
    const returned = await sample(owner, 'returned');
    if (blocked && returned.fullscreen) throw Error(name + ': 입력 없이 제한을 우회했습니다');
    if (!returned.fullscreen) {
      const inputOwner =
        multiView && !leaf
          ? await (await page.locator('.cm-slot iframe').first().elementHandle()).contentFrame()
          : owner;
      await inputOwner.locator('video').click({ position: { x: 100, y: 100 }, force: true });
      await owner.waitForFunction(() => !!document.fullscreenElement);
    }
    const restored = await sample(owner, 'restored');
    if (!restored.sameVideo || restored.paused || restored.time <= result.states[0].time)
      throw Error(name + ': 재생이 유지되지 않았습니다');
    if (
      multiView &&
      !(await page.evaluate(() =>
        window.__originalFrames.every(
          (f, i) => f === document.querySelectorAll('.cm-slot iframe')[i],
        ),
      ))
    )
      throw Error(name + ': 슬롯이 재생성됐습니다');
    if (!leaf) await page.screenshot({ path: resolve(out, name + '.png') });
    await enter.click();
    await owner.waitForFunction(() => !document.fullscreenElement);
    await owner.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await page.waitForTimeout(350);
    if ((await sample(owner, 'minimized')).fullscreen)
      throw Error(name + ': 최소화 후 다시 진입했습니다');
    await enter.click();
    await owner.waitForFunction(() => !!document.fullscreenElement);
    await page.keyboard.press('Escape');
    // CDP 키 입력은 브라우저 UI의 Esc 기본 동작을 실행하지 않을 수 있다.
    if (await owner.evaluate(() => !!document.fullscreenElement))
      await owner.evaluate(() => document.exitFullscreen());
    // 브라우저가 Esc를 소비한 경우 전면 종료 판정(250ms)이 끝난 뒤 앱을 전환한다.
    await page.waitForTimeout(350);
    await owner.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await page.waitForTimeout(350);
    if ((await sample(owner, 'escape')).fullscreen)
      throw Error(name + ': Esc 종료 후 다시 진입했습니다');
    result.success = true;
    console.log('PASS', name, JSON.stringify(result.states));
  } finally {
    report.cases.push(result);
    await probe?.detach();
    await page.close();
  }
}
try {
  await warmUp(context, channels[0]);
  await runCase('single-auto-return', false, false, false);
  await runCase('single-gesture-return', false, false, true);
  await runCase('multiview-gesture-return', true, false, true);
  await runCase('slot-gesture-return', true, true, true);
  report.success = true;
} finally {
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  await context.close();
}
