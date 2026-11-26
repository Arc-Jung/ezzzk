/** Starts five routed live fixtures through the actual configuration sheet. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { openLiveContext, PROFILES, ROOT, seedSettings, warmUp } from './demo-context.mjs';

const profileKey =
  process.argv.find((arg) => arg.startsWith('--profile='))?.split('=')[1] ??
  (process.argv.includes('--touch') ? 'fold8-ultra-open-landscape' : 'laptop13');
const profile = PROFILES.find(({ key }) => key === profileKey);
assert.ok(profile, `Unknown profile: ${profileKey}`);
const out = resolve(ROOT, 'etc/tmp/multiview-five-streams', profileKey);
mkdirSync(out, { recursive: true });
const context = await openLiveContext(profile, {
  profileDir: resolve(ROOT, 'etc/tmp/playwright', 'multiview-five-streams-' + profile.key),
});
const channels = Array.from({ length: 6 }, (_, i) => ({
  channelId: String(i + 1).repeat(32),
  channelName: i === 0 ? '메인 방송' : `보조 방송 ${i}`,
  openLive: true,
  liveTitle: '길이가 긴 테스트 방송 제목',
  concurrentUserCount: 21000 - i,
  liveImageUrl: 'https://chzzk.naver.com/test-thumbnail.png',
}));
const stage = '#cm-multiview-stage';
const cells = `${stage} .cm-slot`;
const cors = {
  'access-control-allow-origin': 'https://chzzk.naver.com',
  'access-control-allow-credentials': 'true',
};

function fixture(slot) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
html,body,#root,#live_player_layout,.pzp-pc {width:100%;height:100%;margin:0;background:#000;color:white}
video {display:block;width:100%;height:100%;object-fit:contain}
</style>
<div id="root"><div id="live_player_layout"><div class="pzp-pc pzp-pc--onlive">
<video autoplay muted playsinline></video>
<div class="pzp-pc__bottom-buttons"><div class="pzp-pc__bottom-buttons-left"></div><div class="pzp-pc__bottom-buttons-right"></div></div>
</div></div><aside id="aside-chatting"></aside></div>
<script>
const video = document.querySelector('video');
const canvas = document.createElement('canvas');
canvas.width = 640;
canvas.height = 360;
const ctx = canvas.getContext('2d');
const slot = ${JSON.stringify(slot)};
const colors = [
  ['#16304b','#287e7b','#d0f4ce'], ['#462747','#996373','#fed9a8'], ['#193d52','#236d82','#a1ddec'],
  ['#263b35','#3f7563','#dbecb0'], ['#453448','#a36e54','#ffd9a5'],
];
const [deep, light, accent] = colors[slot - 1] ?? colors[0];
const sky = ctx.createLinearGradient(0, 0, 0, 360);
sky.addColorStop(0, deep);
sky.addColorStop(1, light);
function draw(time) {
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 640, 360);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(462, 115, 34, 0, 2 * Math.PI);
  ctx.fill();
  for (let layer = 0; layer < 3; layer++) {
    ctx.fillStyle = layer === 0 ? light : deep;
    ctx.globalAlpha = 0.82;
    ctx.beginPath();
    ctx.moveTo(0, 360);
    for (let x = 0; x <= 640; x += 8)
      ctx.lineTo(x, 220 + layer * 35 + 28 * Math.sin(x / 105 + slot + layer + time / 9000));
    ctx.lineTo(640, 360);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = accent;
  ctx.font = '30px sans-serif';
  ctx.fillText(slot === 1 ? '메인 방송' : '보조 방송 ' + (slot - 1), 28, 54);
  requestAnimationFrame(draw);
}
draw(0);
video.srcObject = canvas.captureStream(15);
</script>`;
}

async function playingFrames(page) {
  await page.waitForFunction((selector) => document.querySelectorAll(selector).length === 5, cells);
  const frames = await Promise.all(
    (await page.locator(`${cells} iframe`).elementHandles()).map((handle) => handle.contentFrame()),
  );
  await Promise.all(
    frames.map((frame) =>
      frame.waitForFunction(() => {
        const video = document.querySelector('video');
        return video && !video.paused && video.currentTime > 0.1;
      }),
    ),
  );
  await page.waitForFunction(() => window.readySlots.size === 5);
  return frames;
}

function assertLayout(rects, orientation) {
  assert.deepEqual(
    rects.map(({ index }) => index),
    [1, 2, 3, 4, 5],
  );
  assert.ok(rects.every(({ width, height }) => width > 0 && height > 0));
  const [main, ...side] = rects;
  if (orientation === 'landscape') {
    assert.ok(Math.abs(main.width - 0.7 * (main.width + side[0].width)) < 1);
    assert.ok(
      side.every(
        (rect, i) =>
          rect.left === main.width + 2 &&
          rect.top === (i ? side[i - 1].top + side[i - 1].height + 2 : main.top),
      ),
    );
    assert.equal(side.at(-1).top + side.at(-1).height, main.top + main.height);
    return;
  }
  const [upperLeft, upperRight, lowerLeft, lowerRight] = side;
  assert.equal(upperLeft.top, main.top + main.height + 2);
  assert.equal(upperRight.top, upperLeft.top);
  assert.equal(lowerLeft.top, upperLeft.top + upperLeft.height + 2);
  assert.equal(lowerRight.top, lowerLeft.top);
  assert.equal(lowerRight.left, upperRight.left);
  assert.equal(upperRight.left + upperRight.width, main.left + main.width);
}

try {
  await context.route('https://chzzk.naver.com/test-thumbnail.png', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 27"><rect width="48" height="27" fill="#285369"/><path d="M0 27 24 8l11 11 6-5 7 8v5z" fill="#70a797"/></svg>',
    }),
  );
  await context.route('https://chzzk.naver.com/live/**', (route) => {
    const slot = Number(new URL(route.request().url()).searchParams.get('cmSlot'));
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture(slot) });
  });
  await context.route('https://comm-api.game.naver.com/**', (route) =>
    route.fulfill({ headers: cors, json: { content: { loggedIn: true } } }),
  );
  await context.route('https://api.chzzk.naver.com/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const content = path.endsWith('/followings')
      ? { data: channels }
      : { data: [], status: 'OPEN' };
    return route.fulfill({ headers: cors, json: { code: 200, content } });
  });

  const [first] = channels;
  await warmUp(context, first.channelId);
  await seedSettings(context, {
    wideScreen: { enabled: false, mode: 'default' },
    multiView: {
      enabled: true,
      defaultSplit: 4,
      restoreLastLayout: true,
      chatMode: 'none',
      slots: channels.slice(0, 2).map(({ channelId, channelName }, i) => ({
        index: i + 1,
        channelId,
        channelName,
      })),
    },
  });

  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.addInitScript(() => {
    window.readySlots = new Set();
    addEventListener('message', (event) => {
      if (event.data?.channel === 'ezzzk/multiview' && event.data.kind === 'ready')
        window.readySlots.add(event.data.slot);
    });
  });
  await page.goto('https://chzzk.naver.com/live/' + first.channelId);

  const press = (locator) => (profile.hasTouch ? locator.tap() : locator.click());
  const openSheet = () => press(page.getByRole('button', { name: '멀티뷰 구성 열기' }));
  await openSheet();
  const sheet = page.getByRole('dialog', { name: '멀티뷰 구성', exact: true });
  await press(sheet.locator('label').filter({ hasText: '5분할 · 메인 70% + 오른쪽 4개' }));
  await sheet.locator('.cm-mv-grid[data-split="5"]').waitFor();
  const fifthTarget = sheet.getByRole('button', { name: '보조 방송 5 을 슬롯 5 에 배치' });
  await fifthTarget.waitFor();
  const dimensions = await fifthTarget.boundingBox();
  assert.ok(dimensions.width >= profile.minTargetPx && dimensions.height >= profile.minTargetPx);
  await page.screenshot({ path: resolve(out, 'configuration.png'), scale: 'css' });
  const infoWidth = await fifthTarget
    .locator('xpath=ancestor::li')
    .locator('.cm-mv-info__text')
    .evaluate((text) => text.getBoundingClientRect().width);
  const listWidth = await sheet.locator('.cm-mv-scroll').evaluate((list) => ({
    scroll: list.scrollWidth,
    client: list.clientWidth,
  }));
  const dialogWidth = await sheet.locator('.cm-sheet__body').evaluate((body) => ({
    scroll: body.scrollWidth,
    client: body.clientWidth,
  }));
  console.log(
    `${profileKey}: channel text is ${infoWidth}px, list ${listWidth.scroll}/${listWidth.client}px, dialog ${dialogWidth.scroll}/${dialogWidth.client}px`,
  );
  assert.ok(infoWidth >= 95, `Channel name is squeezed to ${infoWidth}px`);
  assert.ok(listWidth.scroll <= listWidth.client + 1, 'Channel list scrolls horizontally');
  assert.ok(dialogWidth.scroll <= dialogWidth.client + 1, 'Dialog body scrolls horizontally');
  assert.ok(
    await sheet
      .locator('.cm-mv-cell:nth-child(2) .cm-mv-cell__head > span')
      .evaluate((name) => name.scrollWidth <= name.clientWidth + 1),
    'A short channel name in the slot preview is clipped',
  );
  for (const index of [5, 4, 3]) {
    const { channelName } = channels[index - 1];
    await press(sheet.getByRole('button', { name: `${channelName} 을 슬롯 ${index} 에 배치` }));
  }
  await sheet.getByText('5/5개 방송 선택').waitFor();
  await page.evaluate(() => window.readySlots.clear());
  await press(sheet.getByRole('button', { name: '멀티뷰 시작' }));
  const frames = await playingFrames(page);
  const streamIds = () =>
    Promise.all(
      frames.map((frame) => frame.locator('video').evaluate((video) => video.srcObject.id)),
    );
  const originalStreams = await streamIds();

  const rects = () =>
    page.locator(cells).evaluateAll((slots) =>
      slots.map((slot) => ({
        index: Number(slot.dataset.slot),
        left: slot.offsetLeft,
        top: slot.offsetTop,
        width: slot.offsetWidth,
        height: slot.offsetHeight,
      })),
    );
  async function checkLayout({ width, height }) {
    const orientation = width >= height ? 'landscape' : 'portrait';
    const mainWidth = orientation === 'landscape' ? Math.floor((width - 2) * 0.7) : width;
    await page.waitForFunction(
      ({ stage, selector, width, height, mainWidth }) => {
        const el = document.querySelector(stage);
        return (
          el?.clientWidth === width &&
          el.clientHeight === height &&
          document.querySelector(selector)?.offsetWidth === mainWidth
        );
      },
      { stage, selector: cells, width, height, mainWidth },
    );
    assertLayout(await rects(), orientation);
  }
  await checkLayout(profile.viewport);
  if (!profile.hasTouch) {
    await page.mouse.move(profile.viewport.width / 2, 10);
    await page.keyboard.press('Alt+Shift+5');
    await page.locator(`${cells}[data-slot="5"].cm-slot--focused`).waitFor();
  }
  await page.screenshot({ path: resolve(out, 'playing.png'), scale: 'css' });

  const { width, height } = profile.viewport;
  const next = {
    'fold8-ultra-cover': { width: 859, height: 954 },
    'fold8-ultra-open': { width: 411, height: 960 },
    'fold8-cover': { width: 704, height: 933 },
    'fold8-open': { width: 475, height: 751 },
  }[profileKey] ?? { width: height, height: width };
  await page.setViewportSize(next);
  await checkLayout(next);
  assert.ok(frames.every((frame) => !frame.isDetached()));
  await Promise.all(
    frames.map((frame) => frame.waitForFunction(() => !document.querySelector('video').paused)),
  );
  assert.deepEqual(await streamIds(), originalStreams);
  await page.screenshot({ path: resolve(out, 'resized.png'), scale: 'css' });
  await openSheet();
  await fifthTarget.waitFor();
  await press(sheet.getByRole('button', { name: '닫기', exact: true }));

  await page.setViewportSize(profile.viewport);
  await page.reload();
  await playingFrames(page);
  await checkLayout(profile.viewport);
  await openSheet();
  assert.ok(await sheet.getByRole('radio', { name: '5분할 · 메인 70% + 오른쪽 4개' }).isChecked());
  await sheet.getByText('5/5개 방송 선택').waitFor();
  console.log(
    `PASS ${profileKey}: five streams play, resize without replacing frames, and restore after reload`,
  );
} finally {
  await context.close();
}
