/** 분할 창 크기의 실제 Fullscreen API에서 하단 채팅 예약이 남지 않는지 검사한다. 영상은 모의 스트림이다. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openLiveContext, PROFILES, ROOT, seedSettings, warmUp } from './demo-context.mjs';
const out = resolve(ROOT, 'etc/tmp/fold-split-fullscreen');
mkdirSync(out, { recursive: true });
const context = await openLiveContext(
  {
    ...PROFILES.find((p) => p.key === 'fold8-mobile-browser'),
    viewport: { width: 859, height: 450 },
  },
  { profileDir: resolve(ROOT, 'etc/tmp/playwright/fold-split-fullscreen') },
);
const report = { states: [] };
try {
  await context.route('https://chzzk.naver.com/live/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
 html,body,#root{margin:0;height:100%;background:#10151b;color:white}.wrapper_wj4te_test{display:flex;width:100%;height:100%}main{height:100%;flex:1;min-width:0}#live_player_layout,.pzp-pc{position:relative;width:100%;height:100%}video{width:100%;height:100%;object-fit:contain}aside{width:200px;background:#222}
 .wrapper_wj4te_test:fullscreen{width:100%;height:100%}.wrapper_wj4te_test:fullscreen aside{display:none}.pzp-pc__bottom{position:absolute;bottom:12px;right:12px}button{font-size:16px;padding:10px}
 </style></head><body><div id="root"><div class="wrapper_wj4te_test"><main><div id="live_player_layout"><div class="pzp-pc pzp-pc--controls"><video playsinline muted></video><div class="pzp-pc__bottom"><button class="pzp-pc__fullscreen-button">전체화면</button></div></div></div></main><aside id="aside-chatting"><div class="_chatting_message_test">최신 채팅</div></aside></div></div><script>
 const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const paint=canvas.getContext('2d');paint.fillStyle='#244a5b';paint.fillRect(0,0,640,360);paint.fillStyle='white';paint.font='24px sans-serif';paint.fillText('분할 창 전체화면 검증',150,180);
 const stream=canvas.captureStream(5);setInterval(()=>{paint.fillRect(0,0,1,1)},200);const video=document.querySelector('video');video.srcObject=stream;video.muted=true;video.play();window.originalVideo=video;
 document.querySelector('button').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.querySelector('.wrapper_wj4te_test').requestFullscreen();
 document.addEventListener('fullscreenchange',()=>document.querySelector('.pzp-pc').classList.toggle('pzp-pc--fullscreen',!!document.fullscreenElement));
 </script></body></html>`,
    }),
  );
  await warmUp(context, '11111111111111111111111111111111');
  await seedSettings(context, {
    multiView: { enabled: false },
    ultraWide: { enabled: false },
    wideScreen: { enabled: false, mode: 'default' },
    chatWidth: { placement: 'bottom', ratioSource: 'manual', ratio: 35, bottomRatio: 35 },
    chatSubtitle: { enabled: true },
  });
  const page = await context.newPage();
  await page.goto('https://chzzk.naver.com/live/11111111111111111111111111111111');
  await page.waitForSelector('#cm-chat-subtitle');
  await page.locator('.pzp-pc__fullscreen-button').click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  const session = await context.newCDPSession(page);
  const start = await page.evaluate(() => window.originalVideo.currentTime);
  for (const [width, height] of [
    [859, 450],
    [859, 320],
    [411, 440],
    [859, 798],
    [859, 450],
  ]) {
    await page.setViewportSize({ width, height });
    // OS 분할 모드처럼 기기 크기와 앱 viewport 크기를 다르게 둔다.
    await session.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2.625,
      mobile: true,
      screenWidth: 859,
      screenHeight: 915,
    });
    await page.waitForFunction(
      ({ width, height }) => {
        const r = document.querySelector('.pzp-pc').getBoundingClientRect();
        return Math.abs(r.width - width) < 2 && Math.abs(r.height - height) < 2;
      },
      { width, height },
      { timeout: 5000 },
    );
    const state = await page.evaluate(() => {
      const rect = (e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      const video = document.querySelector('video');
      return {
        viewport: { width: innerWidth, height: innerHeight },
        screen: { width: screen.width, height: screen.height },
        player: rect(document.querySelector('.pzp-pc')),
        video: rect(video),
        button: rect(document.querySelector('.pzp-pc__fullscreen-button')),
        sameVideo: video === window.originalVideo,
        paused: video.paused,
        currentTime: video.currentTime,
        overlayConnected: document.querySelector('#cm-chat-subtitle')?.isConnected,
      };
    });
    if (!state.sameVideo || state.paused || !state.overlayConnected)
      throw new Error('전환 중 영상·오버레이 연속성 실패');
    if (state.button.y + state.button.height > height + 1)
      throw new Error('컨트롤이 앱 창 밖으로 나갑니다');
    report.states.push(state);
    await page.screenshot({ path: resolve(out, `fullscreen-${width}-${height}.png`) });
  }
  await page.locator('.pzp-pc__fullscreen-button').click();
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.waitForFunction(
    () => document.querySelector('main').getBoundingClientRect().height < innerHeight - 20,
  );
  report.normalLayoutRestored = true;
  if ((await page.evaluate(() => window.originalVideo.currentTime)) <= start)
    throw new Error('크기 변경 중 재생 시간이 진행하지 않았습니다');
  report.success = true;
  console.log(
    'PASS: 분할·커버·펼침 5개 상태에서 앱 영역 전체화면 및 재생·자막·종료 후 하단 배치 복원',
  );
} finally {
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  await context.close();
}
