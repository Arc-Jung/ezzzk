/** 자동 PiP 옵션 저장·등록과 실제 영상 PiP API를 검증한다.
 * 브라우저 자동 액션 전달은 확장 실행 문맥의 콜백 호출로 재현한다.
 * userGesture를 주므로 Android HOME의 권한·브라우저 지원 검증으로 해석하지 않는다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openLiveContext, PROFILES, ROOT, seedSettings, warmUp } from './demo-context.mjs';
const output = resolve(ROOT, 'etc/tmp/auto-pip');
mkdirSync(output, { recursive: true });
const context = await openLiveContext(
  PROFILES.find((p) => p.key === 'laptop13'),
  { profileDir: resolve(ROOT, 'etc/tmp/playwright/auto-pip') },
);
const report = {
  node: process.version,
  browser: context.browser().version(),
  action: 'extension callback invoked via CDP with userGesture=true',
  androidHomeVerified: false,
  checks: [],
};
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#101518;color:white;font:16px sans-serif}.pzp-pc{margin:55px auto;width:90vw;height:72vh;position:relative;background:#173541}.pzp-pc:fullscreen{width:100%;height:100%;margin:0}video{width:100%;height:100%;object-fit:contain}.pzp-pc__bottom{position:absolute;bottom:12px;left:12px;right:12px}.pzp-pc__bottom-buttons{display:flex;justify-content:space-between}.pzp-pc__bottom-buttons-right{display:flex;gap:10px}button{padding:12px;color:white;background:#183140;border:1px solid #6b8290}#fixture-header{position:absolute;top:18px;left:5vw}</style><header id="fixture-header">자동 PiP 옵션 · 재현용 영상</header><div id="root"><div id="live_player_layout"><div class="pzp-pc"><video playsinline muted autoplay></video><div class="pzp-pc__bottom"><div class="pzp-pc__bottom-buttons"><div class="pzp-pc__bottom-buttons-left"></div><div class="pzp-pc__bottom-buttons-right"><button id="manual-pip" onclick="document.querySelector('video').requestPictureInPicture()">PiP</button><button class="pzp-pc__fullscreen-button" onclick="document.fullscreenElement?document.exitFullscreen():document.querySelector('.pzp-pc').requestFullscreen()">전체화면</button></div></div></div></div></div><aside id="aside-chatting"></aside></div><script>const c=document.createElement('canvas');c.width=1280;c.height=720;const x=c.getContext('2d');let n=0;function draw(){x.fillStyle='#173541';x.fillRect(0,0,1280,720);x.fillStyle='#00ffa3';x.fillRect(n++%1000,540,180,10);x.fillStyle='white';x.font='44px sans-serif';x.fillText('자동 PiP 테스트 영상',80,200);x.font='28px sans-serif';x.fillText('재생 프레임 '+n,80,280);requestAnimationFrame(draw)}draw();const v=document.querySelector('video');v.srcObject=c.captureStream(20);v.play();window.originalVideo=v;</script>`;
await context.route('https://chzzk.naver.com/live/**', (r) =>
  r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }),
);
const verify = (condition, name) => {
  if (!condition) throw Error(name);
  report.checks.push(name);
};
try {
  await warmUp(context, 'a'.repeat(32));
  await seedSettings(context, {
    autoPip: { enabled: false },
    wideScreen: { enabled: false, mode: 'default' },
    multiView: { enabled: false, restoreLastLayout: false },
  });
  const page = await context.newPage();
  await page.goto('https://chzzk.naver.com/live/' + 'a'.repeat(32));
  await page.waitForSelector('#cm-settings-button');
  await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
  const session = await context.newCDPSession(page);
  const worlds = [];
  session.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context));
  await session.send('Runtime.enable');
  let world;
  for (const candidate of worlds.filter(
    (w) => w.auxData?.isDefault === false && w.origin.startsWith('chrome-extension://'),
  )) {
    const r = await session.send('Runtime.evaluate', {
      contextId: candidate.id,
      expression:
        'typeof chrome.runtime?.id === "string" && !!document.querySelector("#cm-settings-button")',
      returnByValue: true,
    });
    if (r.result.value) {
      world = candidate;
      break;
    }
  }
  if (!world) throw Error('확장 실행 문맥 없음');
  const evaluate = (expression, userGesture = false) =>
    session.send('Runtime.evaluate', {
      contextId: world.id,
      expression,
      returnByValue: true,
      userGesture,
      awaitPromise: true,
    });
  await evaluate(
    `(()=>{const s=navigator.mediaSession;const original=s.setActionHandler.bind(s);globalThis.__autoPipHandler=null;globalThis.__autoPipActions=[];globalThis.__autoPipFullscreenRequests=0;const full=HTMLElement.prototype.requestFullscreen;HTMLElement.prototype.requestFullscreen=function(options){globalThis.__autoPipFullscreenRequests++;return full.call(this,options)};s.setActionHandler=(action,handler)=>{if(action==='enterpictureinpicture'){globalThis.__autoPipHandler=handler;globalThis.__autoPipActions.push(!!handler)}return original(action,handler)}})()`,
  );
  await page.keyboard.press('Alt+,');
  const toggle = page.getByRole('switch', { name: '자동 PiP 꺼짐' });
  verify((await toggle.getAttribute('aria-checked')) === 'false', '기본 꺼짐');
  await toggle.click();
  await page.waitForTimeout(200);
  verify(
    (await evaluate('typeof globalThis.__autoPipHandler')).result.value === 'function',
    '켜기에서 자동 액션 등록',
  );
  const worker = context.serviceWorkers()[0];
  const stored = () =>
    worker.evaluate(
      async () =>
        (await chrome.storage.local.get('ezzzk.settings'))['ezzzk.settings'].autoPip.enabled,
    );
  verify(await stored(), '설정 켜기 저장');
  for (const key of ['laptop13', 'tablet10-landscape', 'mobile-portrait']) {
    const profile = PROFILES.find((p) => p.key === key);
    await page.setViewportSize(profile.viewport);
    await page.waitForTimeout(350);
    await page.screenshot({ path: resolve(output, `settings-${key}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${new URL(worker.url()).host}/index.html`);
  const quick = popup.getByRole('checkbox', { name: '자동 PiP', exact: true });
  verify(await quick.isChecked(), '팝업과 설정 값 동기화');
  await popup.setViewportSize({ width: 360, height: 690 });
  await popup.locator('.cm-popup').screenshot({ path: resolve(output, 'popup.png') });
  await popup.close();
  // 설정 시트를 닫고 네이티브 전체화면에서 PiP로 옮겨 복원 경합을 확인한다.
  await page.keyboard.press('Escape');
  await page.locator('.pzp-pc__fullscreen-button').click({ force: true });
  await page.waitForFunction(() => !!document.fullscreenElement);
  const fullscreenRequestsBefore = (await evaluate('globalThis.__autoPipFullscreenRequests')).result
    .value;
  await evaluate('globalThis.__autoPipHandler(); "requested"', true);
  await page.waitForFunction(() => !!document.pictureInPictureElement, undefined, {
    timeout: 5000,
  });
  verify(
    await page.evaluate(() => document.pictureInPictureElement === window.originalVideo),
    '실제 영상 PiP API 진입',
  );
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.querySelector('video').dispatchEvent(new Event('playing'));
  });
  verify(
    (await page.evaluate(() => !!document.pictureInPictureElement)) &&
      (await evaluate('globalThis.__autoPipFullscreenRequests')).result.value ===
        fullscreenRequestsBefore,
    'PiP 중 전체화면 추가 요청 없음',
  );
  // 열린 PiP는 유지하면서 팝업 OFF를 즉시 반영한다.
  const popupOff = await context.newPage();
  await popupOff.goto(`chrome-extension://${new URL(worker.url()).host}/index.html`);
  await popupOff.getByRole('checkbox', { name: '자동 PiP', exact: true }).uncheck();
  await page.waitForTimeout(200);
  verify(!(await stored()), '팝업 끄기 저장');
  verify(
    (await evaluate('globalThis.__autoPipHandler === null')).result.value,
    '끄기에서 자동 액션 해제',
  );
  verify(await page.evaluate(() => !!document.pictureInPictureElement), '이미 열린 PiP 유지');
  await popupOff.close();
  await page.evaluate(() => document.exitPictureInPicture());
  await page.waitForTimeout(400);
  if (await page.evaluate(() => !!document.fullscreenElement))
    await page.evaluate(() => document.exitFullscreen());
  await page.waitForTimeout(350);
  await page.locator('#manual-pip').click({ force: true });
  await page.waitForFunction(() => !!document.pictureInPictureElement);
  verify(
    await page.evaluate(() => !document.querySelector('video').disablePictureInPicture),
    '끄기에서도 수동 PiP 허용',
  );
  await page.evaluate(() => document.exitPictureInPicture());
  report.success = true;
} finally {
  writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  await context.close();
}
console.log(JSON.stringify(report, null, 2));
