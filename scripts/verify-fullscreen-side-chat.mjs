/** Reproduces CHZZK's folded chat in a native fullscreen wrapper with a real fullscreen API. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openLiveContext, PROFILES, ROOT, seedSettings, warmUp } from './demo-context.mjs';

const baseline = process.argv.includes('--baseline');
const out = resolve(ROOT, 'etc/tmp/fullscreen-side-chat');
mkdirSync(out, { recursive: true });
const profile = PROFILES.find(({ key }) => key === 'fold8-mobile-browser');
const screen = { width: 1266, height: 549 };
const context = await openLiveContext(
  { ...profile, viewport: screen },
  { profileDir: resolve(ROOT, 'etc/tmp/playwright/fullscreen-side-chat') },
);
const channelId = '1'.repeat(32);
const url = 'https://chzzk.naver.com/live/' + channelId;
const report = {};
const html = `<!doctype html><html lang="ko"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><style>
html, body, #root, #layout-body { margin:0; width:100%; height:100%; background:#000; color:#fff; font:15px sans-serif }
._wrapper_wj4te_test { display:flex; width:100%; height:100% }
main { min-width:0; flex:1; height:100% }
#live_player_layout, .pzp-pc { position:relative; width:100%; height:100% }
video { position:absolute; inset:0; width:100%; height:100%; object-fit:contain }
.pzp-pc__bottom { position:absolute; bottom:10px; right:14px; left:14px }
.pzp-pc__bottom-buttons { display:flex; justify-content:flex-end }
.pzp-pc__bottom-buttons-right { display:flex; gap:8px }
button { color:#fff; background:#161e25; border:1px solid #627482; padding:8px; min-height:36px }
._container_nu1j9_2 { box-sizing:border-box; background:#1d2025; display:flex; flex-direction:column; width:353px; position:relative }
._container_nu1j9_2._is_folded_nu1j9_10 { display:none }
aside header { padding:12px; border-bottom:1px solid #404650 }
aside ._wrapper_8lqsk_test { flex:1; min-height:0; overflow:auto; padding:12px }
aside ._chatting_message_test { padding:5px 0 }
aside footer { display:flex; gap:6px; padding:8px; border-top:1px solid #404650 }
aside textarea { flex:1; min-width:0 }
</style><div id="root"><div id="layout-body"><div class="_wrapper_wj4te_test"><main>
<div id="live_player_layout"><div class="pzp-pc pzp-pc--controls pzp-pc--onlive"><video autoplay muted playsinline></video>
<div class="pzp-pc__bottom"><div class="pzp-pc__bottom-buttons"><div class="pzp-pc__bottom-buttons-left"></div>
<div class="pzp-pc__bottom-buttons-right"><button class="custom__clip-button">클립</button><button class="pzp-pc__fullscreen-button">전체화면</button></div>
</div></div></div></div></main>
<aside id="aside-chatting" class="_container_nu1j9_2"><header>실시간 채팅</header>
<div class="_wrapper_8lqsk_test"></div><footer><textarea class="_input_test" aria-label="방송 채팅 입력"></textarea>
<button class="_send_button_test">채팅</button></footer></aside></div></div></div>
<script>
const aside = document.querySelector('aside');
const wrapper = document.querySelector('._wrapper_wj4te_test');
const video = document.querySelector('video');
const toggle = document.querySelector('.pzp-pc__fullscreen-button');
const editor = document.querySelector('textarea');
const scroller = aside.querySelector('._wrapper_8lqsk_test');
window.original = { aside, video };
window.receive = (text) => {
  const row = document.createElement('div');
  row.className = '_chatting_message_test';
  row.textContent = text;
  scroller.append(row);
  scroller.scrollTop = scroller.scrollHeight;
};
window.receive('시청자 · 방송 채팅 테스트');
window.receive('시청자 · 새 채팅이 여기에 표시됩니다');
aside.querySelector('button').onclick = () => {
  window.receive(editor.value);
  editor.value = '';
};
toggle.onclick = () => document.fullscreenElement ? document.exitFullscreen() : wrapper.requestFullscreen();
document.addEventListener('fullscreenchange', () => {
  aside.classList.toggle('_is_folded_nu1j9_10', Boolean(document.fullscreenElement));
});
const canvas = document.createElement('canvas');
canvas.width = 640;
canvas.height = 360;
const draw = canvas.getContext('2d');
let frame = 0;
setInterval(() => {
  draw.fillStyle = '#214759'; draw.fillRect(0,0,640,360);
  draw.fillStyle = '#e8f1fc'; draw.font = '28px sans-serif'; draw.fillText('전체화면 채팅 재현 영상',30,56);
  draw.fillStyle = '#6ab6b1'; draw.fillRect(frame++ % 480,230,150,12);
}, 100);
video.srcObject = canvas.captureStream(10);
</script></html>`;

try {
  await context.route('https://chzzk.naver.com/live/**', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }),
  );
  await warmUp(context, channelId);
  await seedSettings(context, {
    wideScreen: { enabled: false, mode: 'default' },
    chatSubtitle: { enabled: false },
    multiView: { enabled: false, restoreLastLayout: false },
    chatWidth: { enabled: true, collapsed: false, placement: 'right', placementSource: 'auto' },
    ultraWide: { enabled: true, minChatPx: 150, overlayFallback: true, videoAlign: 'left' },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  await page.goto(url);
  await page.waitForFunction(() => window.original.video.currentTime > 0.1);
  const fullscreen = page.locator('.pzp-pc__fullscreen-button');
  const measure = () =>
    page.evaluate(() => {
      const video = document.querySelector('video');
      const chat = document.querySelector('#aside-chatting');
      const pane = chat.getBoundingClientRect();
      const videoRect = video.getBoundingClientRect();
      const stage = document.fullscreenElement;
      return {
        fullscreen: Boolean(stage),
        hasNativeAside: stage?.contains(chat) ?? false,
        nativeFolded: chat.classList.contains('_is_folded_nu1j9_10'),
        display: getComputedStyle(chat).display,
        chatWidth: Math.round(pane.width),
        chatLeft: Math.round(pane.left),
        videoWidth: Math.round(videoRect.width),
        videoRight: Math.round(videoRect.right),
        sameVideo: video === window.original.video,
        sameAside: chat === window.original.aside,
        paused: video.paused,
      };
    });
  report.normal = await measure();
  await fullscreen.click();
  await page.waitForFunction(() => document.querySelector('aside').matches('._is_folded_nu1j9_10'));
  report.entered = await measure();
  assert.ok(report.entered.hasNativeAside && report.entered.nativeFolded);
  if (baseline) {
    assert.equal(report.entered.display, 'none');
    assert.equal(report.entered.chatWidth, 0);
    assert.equal(report.entered.videoWidth, screen.width);
    await page.screenshot({ path: resolve(out, 'before.png'), scale: 'css' });
  } else {
    assert.ok(report.entered.chatWidth >= 289 && report.entered.chatWidth <= 291);
    assert.ok(report.entered.sameVideo && report.entered.sameAside && !report.entered.paused);
    assert.equal(report.entered.videoRight, report.entered.chatLeft);
    const chat = page.locator('#aside-chatting');
    await page.evaluate(() => window.receive('전체화면에서도 새 메시지 수신'));
    await chat.getByText('전체화면에서도 새 메시지 수신').waitFor();
    await chat.getByRole('button', { name: '채팅 입력창 펼치기' }).click();
    await chat.getByRole('textbox', { name: '방송 채팅 입력' }).fill('로컬 채팅 전송 검증');
    await chat.getByRole('button', { name: '채팅', exact: true }).click();
    await chat.getByText('로컬 채팅 전송 검증').waitFor();
    await page.screenshot({ path: resolve(out, 'after.png'), scale: 'css' });
    await page.getByRole('button', { name: '채팅 접기' }).click();
    await chat.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '채팅 펼치기' }).click();
    assert.ok((await measure()).chatWidth >= 289);

    await page.getByRole('button', { name: '채팅 위치를 아래로 옮기기' }).click();
    await chat.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '채팅 위치를 오른쪽으로 옮기기' }).click();
    await chat.waitFor();
    await fullscreen.click();
    await page.waitForFunction(
      () =>
        !document.fullscreenElement &&
        !document.querySelector('aside').matches('._is_folded_nu1j9_10'),
    );
    report.exited = await measure();
    assert.ok(report.exited.sameAside && report.exited.chatWidth > 0 && !report.exited.paused);
    const video = page.locator('video');
    await video.tap({ position: { x: 180, y: 180 } });
    await video.tap({ position: { x: 180, y: 180 } });
    await page.waitForFunction(
      () =>
        Boolean(document.fullscreenElement) &&
        document.querySelector('aside').matches('._is_folded_nu1j9_10'),
    );
    report.doubleTap = await measure();
    assert.ok(report.doubleTap.hasNativeAside && report.doubleTap.chatWidth >= 289);
    await page.setViewportSize({ width: 859, height: 450 });
    await page.waitForFunction(() => {
      const chat = document.querySelector('#aside-chatting').getBoundingClientRect();
      const video = document.querySelector('video').getBoundingClientRect();
      return chat.width <= 60 && video.width >= 800;
    });
    report.split = await measure();
    await page.setViewportSize({ width: 859, height: 540 });
    await chat.waitFor({ state: 'hidden' });
    report.nearSquare = await measure();
    await page.setViewportSize(screen);
    await page.waitForFunction(
      () =>
        document.fullscreenElement?.contains(document.querySelector('#aside-chatting')) &&
        document.querySelector('#aside-chatting').getBoundingClientRect().width >= 289,
    );
    await page.evaluate(() => document.exitFullscreen());
    await seedSettings(context, {
      multiView: {
        enabled: true,
        restoreLastLayout: true,
        slots: [
          { index: 1, channelId, channelName: '메인 방송' },
          { index: 2, channelId: '2'.repeat(32), channelName: '보조 방송' },
        ],
      },
    });
    await page.reload();
    await page.getByRole('button', { name: '멀티뷰 해제' }).waitFor();
    assert.equal((await measure()).chatWidth, 0);
    await page.getByRole('button', { name: '멀티뷰 해제' }).click();
    await fullscreen.click();
    await page.waitForFunction(() => {
      const chat = document.querySelector('#aside-chatting');
      return (
        document.fullscreenElement?.contains(chat) &&
        chat.matches('._is_folded_nu1j9_10') &&
        chat.getBoundingClientRect().width >= 289
      );
    });
    report.afterMultiview = await measure();
  }
  report.success = true;
  console.log(JSON.stringify(report, null, 2));
} finally {
  writeFileSync(
    resolve(out, baseline ? 'before.json' : 'after.json'),
    JSON.stringify(report, null, 2),
  );
  await context.close();
}
