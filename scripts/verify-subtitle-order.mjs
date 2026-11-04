/** 채팅 시각 역전 → MAIN 소스 → 격리 브리지 → 오버레이의 실제 Chromium 회귀 검사. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openLiveContext, PROFILES, ROOT, seedSettings, warmUp } from './demo-context.mjs';
const baseline = process.argv.includes('--baseline');
const out = resolve(ROOT, 'etc/tmp/subtitle-order');
mkdirSync(out, { recursive: true });
const context = await openLiveContext(
  PROFILES.find((p) => p.key === 'fold8-mobile-browser'),
  {
    profileDir: resolve(ROOT, 'etc/tmp/playwright/subtitle-order'),
  },
);
const report = { baseline, states: [] };
try {
  await context.route('https://chzzk.naver.com/live/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    body{margin:0;background:#151515;color:white}#live_player_layout,.pzp-pc{width:100%;height:70vh;position:relative;background:#213642}
    #aside-chatting{position:absolute;top:72vh}video{width:100%;height:100%}
    </style></head><body><div id="root"><div id="live_player_layout"><div class="pzp-pc"><video></video></div></div>
    <aside id="aside-chatting"><div class="_wrapper_8lqsk_test"></div></aside></div>
    <script>
    window.testClient={messageLimitCount:200,messageList:[]};
    document.querySelector('#aside-chatting>div').__reactFiber$test={memoizedProps:{client:window.testClient}};
    window.feed=(n)=>{const time=1000+n;window.testClient.messageList.push({key:String(n),time:n===0?999999: n===9?undefined:time,content:n===0?'STUCK_MARKER':'message-'+n,profile:{nickname:'viewer'}})};
    window.feed(0);
    </script></body></html>`,
    }),
  );
  await warmUp(context, '11111111111111111111111111111111');
  await seedSettings(context, {
    multiView: { enabled: false },
    wideScreen: { enabled: false, mode: 'default' },
    chatSubtitle: { enabled: true, lines: 3 },
  });
  for (const mode of baseline ? ['single'] : ['single', 'slot']) {
    const page = await context.newPage();
    await page.goto(
      'https://chzzk.naver.com/live/11111111111111111111111111111111' +
        (mode === 'slot' ? '?cmSlot=1' : ''),
    );
    await page.waitForFunction(
      () => window.__ezzzkChatSourceInstalled && document.querySelector('.cm-subtitle-message'),
    );
    for (let n = 1; n <= (baseline ? 8 : 12); n++) {
      await page.evaluate((n) => window.feed(n), n);
      await page.waitForFunction(
        (n) =>
          [...document.querySelectorAll('.cm-subtitle-message')].some(
            (row) => row.textContent === 'viewer: message-' + n,
          ),
        n,
      );
      const state = await page.evaluate(() => {
        const box = document.querySelector('.cm-subtitle-lines');
        const rows = [...box.children];
        return {
          rows: rows.map((row) => row.textContent),
          bottomGap: box.scrollHeight - box.clientHeight - box.scrollTop,
          latestBottom: rows.at(-1).getBoundingClientRect().bottom,
          boxBottom: box.getBoundingClientRect().bottom,
        };
      });
      report.states.push({ mode, n, ...state });
      if (!baseline && state.rows.at(-1) !== 'viewer: message-' + n)
        throw new Error('시각 역전 메시지가 최신 메시지 뒤에 고정됐습니다');
      if (!baseline && n >= 6 && state.rows.some((text) => text.includes('STUCK_MARKER')))
        throw new Error('오래된 메시지가 표시 범위를 벗어나지 않았습니다');
      if (!baseline && (Math.abs(state.bottomGap) > 1 || state.latestBottom > state.boxBottom + 1))
        throw new Error('최신 채팅이 표시 영역 밖에 있습니다');
    }
    const stuck = report.states.at(-1).rows.some((text) => text.includes('STUCK_MARKER'));
    if (baseline && !stuck) throw new Error('수정 전 잔류 현상이 재현되지 않았습니다');
    await page.screenshot({ path: resolve(out, baseline ? 'before.png' : `after-${mode}.png`) });
    await page.close();
  }
  report.success = true;
  console.log(
    baseline
      ? 'BASELINE: 8개 새 메시지 뒤에도 시각 역전 메시지 잔류 재현'
      : 'PASS: 역전·누락 시각에 관계없이 새 메시지 하단 갱신 및 오래된 메시지 제거',
  );
} finally {
  writeFileSync(
    resolve(out, baseline ? 'before.json' : 'after.json'),
    JSON.stringify(report, null, 2),
  );
  await context.close();
}
