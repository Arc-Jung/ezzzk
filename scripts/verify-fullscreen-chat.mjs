/** 실제 방송 전체화면에서 채팅 팝업 배치·초안·재생 연속성을 확인한다. 채팅을 보내지 않는다. */
import { openLiveContext, PROFILES, ROOT, seedSettings, warmUp } from './demo-context.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const output = resolve(ROOT, 'etc/tmp/fullscreen-chat');
mkdirSync(output, { recursive: true });
const context = await openLiveContext(
  PROFILES.find((p) => p.key === 'laptop13'),
  {
    profileDir: resolve(ROOT, 'etc/tmp/playwright/fullscreen-chat'),
    browserArgs: ['--disable-audio-output'],
  },
);
const report = { states: [] };
try {
  await warmUp(context, 'a67b328bcc8eea4451ccfa754bc19ae1');
  await seedSettings(context, {
    multiView: { enabled: false },
    wideScreen: { enabled: false, mode: 'default' },
  });
  const page = await context.newPage();
  await page.goto('https://chzzk.naver.com/', { waitUntil: 'domcontentloaded' });
  const channels = await page.evaluate(async () => {
    const response = await fetch('https://api.chzzk.naver.com/service/v1/lives?size=20', {
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json();
    return data.content.data
      .filter((row) => !row.adult)
      .slice(0, 4)
      .map((row) => row.channel.channelId);
  });
  let ready = false;
  for (const channel of channels) {
    await page.goto(`https://chzzk.naver.com/live/${channel}`, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(
        () =>
          document.querySelector('.pzp-pc--onlive video')?.readyState >= 3 &&
          document.querySelector('#cm-fullscreen-chat-button'),
        null,
        { timeout: 150000 },
      );
      ready = true;
      report.channelId = channel;
      break;
    } catch {
      /* 광고·종료된 채널은 다음 공개 방송을 확인한다. */
    }
  }
  if (!ready) throw new Error('실제 본방송 재생을 확인하지 못했습니다');
  const video = await page.locator('#live_player_layout .pzp-pc--onlive video').elementHandle();
  const before = await video.evaluate((v) => ({ time: v.currentTime, paused: v.paused }));
  await page.mouse.move(300, 300);
  await page.mouse.move(310, 310);
  await page.locator('#live_player_layout button.pzp-pc__fullscreen-button').click();
  await page.waitForFunction(
    () =>
      !!document.fullscreenElement && !document.querySelector('#cm-fullscreen-chat-button')?.hidden,
  );
  const order = await page.locator('#cm-fullscreen-chat-button').evaluate((button) => ({
    nextLabel: button.nextElementSibling?.getAttribute('aria-label'),
    nextClass: button.nextElementSibling?.className,
    nextText: button.nextElementSibling?.textContent,
  }));
  report.order = order;
  if (!/clip|클립/i.test(`${order.nextLabel} ${order.nextClass} ${order.nextText}`))
    throw new Error(`클립 바로 앞이 아닙니다: ${JSON.stringify(order)}`);
  await page.mouse.move(500, 400);
  await page.mouse.move(510, 410);
  await page.locator('#cm-fullscreen-chat-button').click();
  for (const [name, width, height] of [
    ['laptop', 1440, 900],
    ['fold', 859, 798],
    ['mobile-landscape', 915, 412],
    ['compact-height', 915, 220],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(500);
    const state = await page.locator('#cm-fullscreen-chat-popup').evaluate((e) => {
      const rect = e.getBoundingClientRect();
      const editor = e.querySelector('textarea');
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        insideFullscreen: document.fullscreenElement.contains(e),
        inputDisabled: editor.disabled,
        sendDisabled: e.querySelector('.cm-fullscreen-chat-send').disabled,
        note: e.querySelector('.cm-fullscreen-chat-note').textContent,
      };
    });
    if (
      !state.insideFullscreen ||
      state.x < -1 ||
      state.y < -1 ||
      state.x + state.width > width + 1 ||
      state.y + state.height > height + 1 ||
      state.width > 341
    )
      throw new Error(`팝업 배치 오류: ${JSON.stringify(state)}`);
    report.states.push({ name, ...state });
    await page.mouse.move(20, height - 25);
    await page.mouse.move(24, height - 25);
    await page.waitForTimeout(300);
    await page.screenshot({
      path:
        name === 'compact-height'
          ? resolve(output, 'compact-height.png')
          : resolve(ROOT, `screenshots/demo-${name}-fullscreen-chat.png`),
    });
  }
  const source = page.locator('#aside-chatting textarea[class*="_input_"]');
  await page.setViewportSize({ width: 915, height: 412 });
  report.nativeInputPresent = (await source.count()) > 0;
  if (!report.nativeInputPresent) throw new Error('원본 채팅 입력창 없음');
  const original = await source.inputValue();
  if (!(await page.locator('#cm-fullscreen-chat-popup textarea').isDisabled())) {
    await page.locator('#cm-fullscreen-chat-popup textarea').fill('초안 확인 — 전송하지 않음');
    await page.locator('#cm-fullscreen-chat-popup textarea').press('Space');
    await page.locator('#cm-fullscreen-chat-popup textarea').press('j');
    await page.waitForTimeout(300);
    if ((await source.inputValue()) !== '초안 확인 — 전송하지 않음 j')
      throw new Error('원본 입력 동기화 실패');
    await page.getByRole('button', { name: '채팅 입력 닫기', exact: true }).click();
    await page.mouse.move(520, 400);
    await page.locator('#cm-fullscreen-chat-button').click();
    if (
      (await page.locator('#cm-fullscreen-chat-popup textarea').inputValue()) !==
      '초안 확인 — 전송하지 않음 j'
    )
      throw new Error('다시 열기 후 초안 손실');
    await page.locator('#cm-fullscreen-chat-popup textarea').fill(original);
    report.draftPreserved = true;
  } else report.draftPreserved = '실제 비로그인 입력 제한. React 제어 입력 회귀 테스트로 별도 검증';
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(
    () => !document.fullscreenElement && !document.querySelector('#cm-fullscreen-chat-popup'),
    null,
    { timeout: 5000 },
  );
  if (await page.locator('#cm-fullscreen-chat-popup').count())
    throw new Error('전체화면 종료 후 팝업 잔류');
  if (!(await page.locator('#cm-fullscreen-chat-button').evaluate((e) => e.hidden)))
    throw new Error('일반 화면에서 버튼 노출');
  report.video = await video.evaluate((v) => ({
    sameVideo:
      v.isConnected && v === document.querySelector('#live_player_layout .pzp-pc--onlive video'),
    paused: v.paused,
    time: v.currentTime,
  }));
  if (!report.video.sameVideo || report.video.paused || report.video.time <= before.time)
    throw new Error('전체화면 채팅 조작 중 재생 연속성 손실');
  report.sentMessages = 0;
  report.success = true;
  console.log(JSON.stringify(report, null, 2));
} finally {
  writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  await context.close();
}
