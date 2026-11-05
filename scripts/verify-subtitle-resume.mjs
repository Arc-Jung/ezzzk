/** 모의 영상·채팅으로 일시정지/중단 → 재생 재개 시 오버레이 복구를 검증한다. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openLiveContext, PROFILES, ROOT, seedSettings, warmUp } from './demo-context.mjs';
const baseline = process.argv.includes('--baseline');
const out = resolve(ROOT, 'etc/tmp/subtitle-resume');
mkdirSync(out, { recursive: true });
const context = await openLiveContext(
  PROFILES.find((p) => p.key === 'fold8-mobile-browser'),
  {
    profileDir: resolve(ROOT, 'etc/tmp/playwright/subtitle-resume'),
  },
);
const report = { baseline, states: [] };
try {
  await context.route('https://chzzk.naver.com/live/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      body{margin:0;background:#151515;color:white}#live_player_layout,.pzp-pc{width:100%;height:70vh;position:relative;background:#213642}video{width:100%;height:100%}
      </style></head><body><div id="root"><div id="live_player_layout"><div class="pzp-pc"><video muted playsinline></video></div></div>
      <aside id="aside-chatting"><div class="_wrapper_8lqsk_test"></div></aside></div>
      <script>
      window.setChat=text=>{window.testClient={messageLimitCount:200,messageList:[{content:text,profile:{nickname:'viewer'}}]};
        document.querySelector('#aside-chatting>div').__reactFiber$test={memoizedProps:{client:window.testClient}}};
      window.setChat('재생 전 채팅');
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#213642';ctx.fillRect(0,0,640,360);
      window.stream=canvas.captureStream(5);setInterval(()=>ctx.fillRect(0,0,1,1),200);
      window.startVideo=async()=>{const v=document.querySelector('video');v.muted=true;v.srcObject=window.stream;await v.play()};
      </script></body></html>`,
    }),
  );
  await warmUp(context, '11111111111111111111111111111111');
  await seedSettings(context, {
    multiView: { enabled: false },
    wideScreen: { enabled: false, mode: 'default' },
    chatSubtitle: { enabled: true },
  });
  for (const mode of baseline ? ['single'] : ['single', 'slot']) {
    const page = await context.newPage();
    await page.goto(
      'https://chzzk.naver.com/live/11111111111111111111111111111111' +
        (mode === 'slot' ? '?cmSlot=1' : ''),
    );
    await page.evaluate(() => window.startVideo());
    await page.waitForFunction(() =>
      document.querySelector('.cm-subtitle-message')?.textContent.includes('재생 전 채팅'),
    );
    await page.evaluate(() => {
      window.originalVideo = document.querySelector('video');
      window.originalOverlay = document.querySelector('#cm-chat-subtitle');
      window.originalVideo.pause();
      document.querySelector('.cm-subtitle-lines').replaceChildren();
      window.originalOverlay.replaceChildren();
    });
    await page.evaluate(() => window.originalVideo.play());
    if (baseline) {
      await page.waitForTimeout(1500);
      const stuck = await page.locator('#cm-chat-subtitle').textContent();
      if (stuck) throw new Error('수정 전 빈 오버레이 잔류가 재현되지 않았습니다');
      report.states.push({ mode, phase: 'pause-resume', empty: true });
    } else {
      await page.waitForFunction(() =>
        document.querySelector('.cm-subtitle-message')?.textContent.includes('재생 전 채팅'),
      );
      if (
        !(await page.evaluate(
          () =>
            window.originalVideo === document.querySelector('video') &&
            !window.originalVideo.paused,
        ))
      )
        throw new Error('동일 영상 재생이 유지되지 않았습니다');
      report.states.push({ mode, phase: 'pause-resume', restored: true });
      await page.evaluate(() => window.setChat('일시정지 복구 후 새 채팅'));
      await page.waitForFunction(() =>
        document
          .querySelector('.cm-subtitle-message')
          ?.textContent.includes('일시정지 복구 후 새 채팅'),
      );
      await page.evaluate(() => document.querySelector('.pzp-pc').remove());
      await page.waitForFunction(() => !document.querySelector('#cm-chat-subtitle'));
      await page.evaluate(() => {
        document.querySelector('#live_player_layout').innerHTML =
          '<div class="pzp-pc"><video muted playsinline></video></div>';
        document.querySelector('#aside-chatting').innerHTML =
          '<div class="_wrapper_8lqsk_test"></div>';
        window.setChat('중단 복구 후 새 채팅');
        return window.startVideo();
      });
      await page.waitForFunction(() =>
        document
          .querySelector('.cm-subtitle-message')
          ?.textContent.includes('중단 복구 후 새 채팅'),
      );
      const state = await page.evaluate(() => ({
        sameOverlay: window.originalOverlay === document.querySelector('#cm-chat-subtitle'),
        visible: !document.querySelector('#cm-chat-subtitle').hidden,
        playing: !document.querySelector('video').paused,
        count: document.querySelectorAll('#cm-chat-subtitle').length,
      }));
      if (!state.sameOverlay || !state.visible || !state.playing || state.count !== 1)
        throw new Error('플레이어 교체 복구 실패: ' + JSON.stringify(state));
      report.states.push({ mode, phase: 'player-replaced', ...state });
    }
    await page.screenshot({ path: resolve(out, baseline ? 'before.png' : `after-${mode}.png`) });
    await page.close();
  }
  report.success = true;
  console.log(
    baseline
      ? 'BASELINE: 일시정지 중 제거된 채팅 DOM이 재생 후 빈 상태로 남음'
      : 'PASS: 일반·슬롯 일시정지/중단 후 채팅 복구 및 갱신',
  );
} finally {
  writeFileSync(
    resolve(out, baseline ? 'before.json' : 'after.json'),
    JSON.stringify(report, null, 2),
  );
  await context.close();
}
