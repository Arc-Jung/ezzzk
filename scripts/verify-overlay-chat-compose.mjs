/** 원본 입력/전송 버튼을 갖춘 로컬 픽스처에서 검증한다. 실제 방송에는 메시지를 보내지 않는다. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openLiveContext, PROFILES, ROOT, seedSettings, warmUp } from './demo-context.mjs';
const out = resolve(ROOT, 'etc/tmp/overlay-chat-compose');
mkdirSync(out, { recursive: true });
const channels = ['a', 'b', 'c', 'd'].map((c) => c.repeat(32));
const report = {
  input: 'trusted pointer/touch and keyboard input',
  fixture: 'canvas video and local native-chat stand-in; no broadcast messages sent',
  cases: [],
};
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:0;background:#101518;color:#fff;font:16px Arial}.pzp-pc{position:relative;width:90vw;height:65vh;margin:65px auto;background:#173541}.pzp-pc:fullscreen{width:100%;height:100%;margin:0}video{width:100%;height:100%;object-fit:contain}.pzp-pc__bottom{position:absolute;bottom:12px;left:12px;right:12px}.pzp-pc__bottom-buttons{display:flex;justify-content:space-between}.pzp-pc__bottom-buttons-right{display:flex;gap:8px}.pzp-pc:not(.pzp-pc--controls) .pzp-pc__bottom{visibility:hidden}button{padding:12px;color:#fff;background:#183140;border:1px solid #6b8290}#aside-chatting{padding:12px}#fixture-header{position:absolute;top:14px;left:5vw}
</style><div id="fixture-header">채팅 오버레이 입력 · 재현용 영상</div><div id="root"><div id="live_player_layout"><div class="pzp-pc pzp-pc--controls"><video autoplay playsinline muted></video><div class="pzp-pc__bottom"><div class="pzp-pc__bottom-buttons"><div class="pzp-pc__bottom-buttons-left"></div><div class="pzp-pc__bottom-buttons-right"><button class="custom__clip-button" aria-label="클립 만들기">클립</button><button class="pzp-pc__fullscreen-button" onclick="document.fullscreenElement?document.exitFullscreen():document.querySelector('.pzp-pc').requestFullscreen()">전체화면</button></div></div></div></div></div><aside id="aside-chatting"><div class="_chatting_message_test"><span class="_nickname_test">시청자1</span><span class="_text_test">오늘 방송도 잘 보고 있어요</span></div><div class="_chatting_message_test"><span class="_nickname_test">시청자2</span><span class="_text_test">말풍선을 눌러 채팅할 수 있어요</span></div><div class="_chatting_message_test"><span class="_nickname_test">시청자3</span><span class="_text_test">안녕하세요!</span></div><textarea class="_input_test" placeholder="채팅을 입력해주세요" maxlength="400"></textarea><button class="_send_button_test" disabled>채팅</button></aside></div><script>
window.sent=[];window.surfaceClicks=0;const source=document.querySelector('aside textarea');const send=document.querySelector('aside button');source.addEventListener('input',()=>send.disabled=!source.value.trim());send.addEventListener('click',()=>{window.sent.push({channel:location.pathname.split('/').pop(),text:source.value});source.value='';source.dispatchEvent(new Event('input',{bubbles:true}))});document.querySelector('.pzp-pc').addEventListener('click',e=>{if(!e.target.closest('button,[role=dialog]'))window.surfaceClicks++});
const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const c=canvas.getContext('2d');let n=0;function draw(){c.fillStyle='#173541';c.fillRect(0,0,1280,720);c.fillStyle='#00ffa3';c.fillRect(n++%1000,540,180,10);c.fillStyle='#fff';c.font='44px sans-serif';c.fillText('오버레이에서 채팅 보내기',80,70);c.font='26px sans-serif';c.fillText('재현용 영상 · 프레임 '+n,80,120);requestAnimationFrame(draw)}draw();const v=document.querySelector('video');v.srcObject=canvas.captureStream(20);v.play();window.originalVideo=v;
</script>`;
const ensure = (ok, message) => {
  if (!ok) throw Error(message);
};
for (const key of [
  'mobile-portrait',
  'mobile-landscape',
  'tablet10-portrait',
  'tablet10-landscape',
  'laptop13',
  'fold8-mobile-browser',
].filter((key) => !process.argv[2] || key === process.argv[2])) {
  const profile = PROFILES.find((p) => p.key === key);
  const context = await openLiveContext(profile, {
    profileDir: resolve(ROOT, 'etc/tmp/playwright/overlay-compose-' + key),
  });
  try {
    report.browser = context.browser().version();
    await context.route('https://chzzk.naver.com/live/**', (r) =>
      r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }),
    );
    await warmUp(context, channels[0]);
    await seedSettings(context, {
      wideScreen: { enabled: false, mode: 'default' },
      autoPip: { enabled: false },
      chatSubtitle: { enabled: true, lines: 3, position: 'left', fontPx: 16 },
      multiView: { enabled: false, restoreLastLayout: false, autoFullscreen: false },
    });
    const page = await context.newPage();
    await page.goto('https://chzzk.naver.com/live/' + channels[0]);
    await page.waitForSelector('#cm-chat-subtitle-compose');
    await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
    await page.locator('.pzp-pc__fullscreen-button').click();
    await page.waitForFunction(() => !!document.fullscreenElement);
    await page.evaluate(() =>
      document.querySelector('.pzp-pc').classList.remove('pzp-pc--controls'),
    );
    const compose = page.locator('#cm-chat-subtitle-compose');
    await page.waitForTimeout(120);
    const geometry = await compose.evaluate((e) => {
      const b = e.getBoundingClientRect(),
        o = e.closest('#cm-chat-subtitle').getBoundingClientRect(),
        l = e
          .closest('#cm-chat-subtitle')
          .querySelector('.cm-subtitle-lines')
          .getBoundingClientRect();
      return {
        width: b.width,
        height: b.height,
        right: o.right - b.right,
        bottom: o.bottom - b.bottom,
        textRight:
          l.right -
          parseFloat(
            getComputedStyle(e.closest('#cm-chat-subtitle').querySelector('.cm-subtitle-lines'))
              .paddingRight,
          ),
        buttonLeft: b.left,
      };
    });
    ensure(
      geometry.width >= 44 &&
        geometry.height >= 44 &&
        geometry.right <= 11 &&
        geometry.bottom <= 9 &&
        geometry.textRight <= geometry.buttonLeft + 1,
      key + ': overlay button layout',
    );
    await page.screenshot({ path: resolve(out, key + '-button.png') });
    if (profile.hasTouch) await compose.tap();
    else await compose.click();
    const popup = page.locator('#cm-fullscreen-chat-popup');
    await popup.waitFor();
    const box = await popup.boundingBox();
    ensure(
      box &&
        box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= profile.viewport.width + 1 &&
        box.y + box.height <= profile.viewport.height + 1,
      key + ': popup outside viewport',
    );
    const editor = popup.locator('textarea');
    const text = '오버레이 한글 전송 ' + key;
    await editor.fill(text);
    await page.screenshot({ path: resolve(out, key + '-popup.png') });
    await popup.locator('.cm-fullscreen-chat-send').click();
    const sent = await page.evaluate(() => window.sent);
    ensure(
      sent.length === 1 && sent[0].text === text && sent[0].channel === channels[0],
      key + ': wrong chat target or duplicate send',
    );
    ensure((await editor.inputValue()) === '', key + ': input not cleared');
    await popup.getByRole('button', { name: '채팅 입력 닫기' }).click();
    ensure(
      await compose.evaluate((e) => document.activeElement === e),
      key + ': focus not restored',
    );
    const state = await page.evaluate(() => ({
      fullscreen: !!document.fullscreenElement,
      sameVideo: window.originalVideo === document.querySelector('video'),
      paused: document.querySelector('video').paused,
      surfaceClicks: window.surfaceClicks,
    }));
    ensure(
      state.fullscreen && state.sameVideo && !state.paused && state.surfaceClicks === 0,
      key + ': playback changed',
    );
    report.cases.push({ name: key, geometry, popup: box, sent, ...state });
    console.log(key + ': passed');
    if (key !== 'fold8-mobile-browser') continue;
    await page.evaluate(() =>
      document.querySelectorAll('._chatting_message_test').forEach((e) => e.remove()),
    );
    await page.waitForTimeout(1100);
    await compose.tap();
    ensure(await popup.locator('textarea').isEnabled(), 'empty chat cannot be composed');
    await popup.getByRole('button', { name: '채팅 입력 닫기' }).click();
    report.cases.push({ name: 'empty chat can compose', passed: true });
    await page.evaluate(() => document.querySelector('.pzp-pc').classList.add('pzp-pc--controls'));
    await page.locator('.pzp-pc__fullscreen-button').click();
    await page.waitForFunction(() => !document.fullscreenElement);
    await seedSettings(context, {
      multiView: {
        enabled: true,
        restoreLastLayout: true,
        autoFullscreen: false,
        autoVolume: false,
        chatMode: 'none',
        defaultSplit: 4,
        slots: channels.map((channelId, i) => ({
          index: i + 1,
          channelId,
          channelName: '방송 ' + (i + 1),
        })),
      },
    });
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.cm-slot iframe').length === 4);
    const handles = await page.locator('.cm-slot iframe').elementHandles();
    const owners = await Promise.all(handles.map((h) => h.contentFrame()));
    for (const owner of owners) await owner.waitForSelector('#cm-chat-subtitle-compose');
    await page.locator('[data-cm-fullscreen-toggle]').click();
    await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
    await owners[1].locator('#cm-chat-subtitle-compose').tap();
    const slotPopup = owners[1].locator('#cm-fullscreen-chat-popup');
    await slotPopup.locator('textarea').fill('두 번째 방송으로 전송');
    await page.screenshot({ path: resolve(out, 'multiview-popup.png') });
    await slotPopup.locator('.cm-fullscreen-chat-send').click();
    const allSent = await Promise.all(owners.map((o) => o.evaluate(() => window.sent)));
    ensure(
      allSent[1].length === 1 &&
        allSent[1][0].channel === channels[1] &&
        allSent[1][0].text === '두 번째 방송으로 전송',
      'multiview: wrong channel',
    );
    ensure(
      allSent.every((sent, i) => i === 1 || sent.length === 0),
      'multiview: sent to another channel',
    );
    ensure(
      await page.evaluate(() => document.fullscreenElement === document.documentElement),
      'multiview: fullscreen exited',
    );
    report.cases.push({
      name: 'fullscreen multiview sends to clicked channel only',
      sent: allSent,
    });
    console.log('multiview: passed');
  } finally {
    await context.close();
  }
}
writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ cases: report.cases.length, report: resolve(out, 'report.json') }));
