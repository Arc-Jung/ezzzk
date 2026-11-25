/** Exercises the extension with a desktop document fitted to a narrow mobile viewport. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { openLiveContext, PROFILES, ROOT, seedSettings, warmUp } from './demo-context.mjs';

const baseline = process.argv.includes('--baseline');
const out = resolve(ROOT, 'etc/tmp/fold-cover-controls');
mkdirSync(out, { recursive: true });

const cover = PROFILES.find((profile) => profile.key === 'fold8-ultra-cover');
const context = await openLiveContext(
  { ...cover, isMobile: true },
  { profileDir: resolve(ROOT, 'etc/tmp/playwright/fold-cover-controls') },
);
const channelIds = ['a'.repeat(32), 'b'.repeat(32)];
const url = 'https://chzzk.naver.com/live/' + channelIds[0];
const toolbar = '.cm-stage-bar';
const slot = '.cm-slot';
const frameSelector = slot + ' iframe';

function fixture(slotNumber, responsive) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
${responsive ? '<meta name="viewport" content="width=device-width, initial-scale=1">' : ''}
<style>
html, body, #root, #live_player_layout, .pzp-pc { margin:0; width:100%; height:100%; background:#000; color:white }
.pzp-pc {position:relative}
video {width:100%;height:100%;object-fit:contain}
.pzp-pc__bottom {position:absolute;bottom:3px;left:5px;right:5px}
.pzp-pc__bottom-buttons-left button {width:44px;height:44px;border:0;border-radius:8px;background:#101821c9;color:white;font-size:18px}
</style></head><body><div id="root"><div id="live_player_layout"><div class="pzp-pc pzp-pc--controls pzp-pc--onlive">
<video autoplay muted playsinline></video>
<div class="pzp-pc__bottom"><div class="pzp-pc__bottom-buttons"><div class="pzp-pc__bottom-buttons-left">
<button class="pzp-pc__playback-switch" aria-label="일시정지">Ⅱ</button>
</div><div class="pzp-pc__bottom-buttons-right"></div></div></div>
</div></div><aside id="aside-chatting"></aside></div>
<script>
const video = document.querySelector('video');
const playback = document.querySelector('button');
playback.onclick = () => { if (video.paused) video.play(); else video.pause(); };
const canvas = document.createElement('canvas');
canvas.width = 960;
canvas.height = 540;
const drawing = canvas.getContext('2d');
const warm = ${slotNumber === '2'};
const sky = drawing.createLinearGradient(0, 0, 0, 540);
sky.addColorStop(0, warm ? '#392444' : '#0d3044');
sky.addColorStop(1, warm ? '#d3816d' : '#4a958f');
function draw(now) {
  drawing.fillStyle = sky;
  drawing.fillRect(0, 0, 960, 540);
  for (let layer = 0; layer < 4; layer++) {
    drawing.fillStyle = (warm ? ['#85536a', '#5c3854', '#362839', '#221c30'] : ['#438487', '#2b6570', '#204a5f', '#162e40'])[layer];
    drawing.beginPath();
    drawing.moveTo(0, 540);
    for (let x = 0; x <= 960; x += 12) {
      const y = 295 + layer * 43 + 25 * Math.sin(x / (105 - layer * 12) + layer + now / 14000);
      drawing.lineTo(x, y);
    }
    drawing.lineTo(960, 540);
    drawing.fill();
  }
  drawing.fillStyle = warm ? '#f5c891' : '#d8f3df';
  drawing.beginPath();
  drawing.arc(warm ? 705 : 254, 158, 38, 0, Math.PI * 2);
  drawing.fill();
  requestAnimationFrame(draw);
}
draw(0);
video.srcObject = canvas.captureStream(20);
</script></body></html>`;
}

try {
  await context.route('https://chzzk.naver.com/live/**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    return route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: fixture(params.get('cmSlot'), params.has('responsive')),
    });
  });
  await warmUp(context, channelIds[0]);
  await seedSettings(context, {
    wideScreen: { enabled: false, mode: 'default' },
    chatSubtitle: { enabled: true },
    multiView: {
      enabled: true,
      restoreLastLayout: true,
      autoFullscreen: false,
      defaultSplit: 2,
      layout: 'grid',
      slots: channelIds.map((channelId, index) => ({
        index: index + 1,
        channelId,
        channelName: `재현용 영상 ${index + 1}`,
      })),
    },
  });

  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  await page.goto(url);
  await page.locator(frameSelector).nth(1).waitFor();
  await page.locator('#cm-chat-subtitle-stage-button').waitFor();
  const frames = [];
  for (const frame of await page.locator(frameSelector).elementHandles()) {
    const child = await frame.contentFrame();
    await child.waitForFunction(() => document.querySelector('video')?.currentTime > 0);
    frames.push(child);
  }
  const measure = () =>
    page.evaluate(
      ({ toolbar, slot }) => {
        const { width, scale } = visualViewport;
        const buttons = [...document.querySelectorAll(toolbar + ' button')].filter(
          (button) => button.getClientRects().length,
        );
        const boxes = buttons.map((button) => button.getBoundingClientRect());
        const cells = [...document.querySelectorAll(slot)].map((cell) =>
          cell.getBoundingClientRect(),
        );
        const iframe = document.querySelector(slot + ' iframe');
        const playerButton = iframe.contentDocument.querySelector('.pzp-pc__playback-switch');
        const frameScale = iframe.getBoundingClientRect().width / iframe.contentWindow.innerWidth;
        return {
          layoutWidth: document.documentElement.clientWidth,
          width: Math.round(width * scale),
          scale,
          barTarget: Math.min(...boxes.map((box) => Math.min(box.width, box.height))) * scale,
          barRows: new Set(boxes.map((box) => box.top)).size,
          barFits: boxes.every((box) => box.left >= 0 && box.right <= width + 1),
          barLabels: getComputedStyle(buttons[0].querySelector('span')).display !== 'none',
          playerTarget: playerButton?.getBoundingClientRect().height * scale * frameScale,
          stacked: Math.abs(cells[0].left - cells[1].left) < 1 && cells[1].top > cells[0].top,
          firstWidth: Math.round(cells[0].width * scale),
        };
      },
      { toolbar, slot },
    );

  // Map a child frame's local CSS coordinates to the main frame for touch input.
  const tap = async (selector, inSlot = false) => {
    const { x, y } = await page.evaluate(
      ({ selector, inSlot, frameSelector }) => {
        const iframe = inSlot ? document.querySelector(frameSelector) : null;
        const host = iframe?.getBoundingClientRect();
        const local = (iframe?.contentDocument ?? document)
          .querySelector(selector)
          .getBoundingClientRect();
        const factor = iframe ? host.width / iframe.contentWindow.innerWidth : 1;
        return {
          x: (host?.left ?? 0) + (local.left + local.width / 2) * factor,
          y: (host?.top ?? 0) + (local.top + local.height / 2) * factor,
        };
      },
      { selector, inSlot, frameSelector },
    );
    await page.touchscreen.tap(x, y);
  };

  const state = await measure();
  console.log('cover:', state);
  assert.equal(state.width, cover.viewport.width);
  assert.ok(state.layoutWidth >= 960 && state.scale < 0.6, 'Missing desktop fit');
  await page.screenshot({ path: resolve(out, baseline ? 'before.png' : 'cover.png') });
  if (baseline) {
    assert.ok(state.barTarget < 30, 'Original undersized buttons should reproduce');
  } else {
    assert.ok(state.barTarget >= 43.5, 'Toolbar target should be 44 visible CSS pixels');
    assert.ok(state.playerTarget >= 43.5, 'Slot player target should be 44 visible CSS pixels');
    assert.ok(state.barFits && state.barRows === 1 && !state.barLabels);
    assert.ok(state.stacked && state.firstWidth >= state.width - 1);

    await tap('.pzp-pc__playback-switch', true);
    await frames[0].waitForFunction(() => document.querySelector('video').paused);
    await tap('.pzp-pc__playback-switch', true);
    await frames[0].waitForFunction(() => !document.querySelector('video').paused);

    const fullscreen = toolbar + ' [data-cm-fullscreen-toggle]';
    await tap(fullscreen);
    await page.waitForFunction(() => Boolean(document.fullscreenElement));
    await page.waitForTimeout(350); // Allow the browser's fullscreen transition to settle.
    await tap(fullscreen);
    await page.waitForFunction(() => !document.fullscreenElement);

    await page.setViewportSize({ width: 859, height: 954 });
    await page.waitForFunction(() =>
      document.querySelector('.cm-stage-bar button span')?.checkVisibility(),
    );
    const opened = await measure();
    console.log('opened:', opened);
    assert.ok(opened.barFits && opened.barLabels);
    for (const frame of frames) {
      assert.ok(!frame.isDetached(), 'Resizing must retain the original slot iframe');
      assert.ok(await frame.locator('video').evaluate((video) => !video.paused));
    }
    await page.screenshot({ path: resolve(out, 'opened.png') });

    await page.setViewportSize(cover.viewport);
    await page.waitForFunction(
      () => !document.querySelector('.cm-stage-bar button span')?.checkVisibility(),
    );
    const refolded = await measure();
    assert.ok(refolded.barTarget >= 43.5 && refolded.barFits && refolded.stacked);
    assert.ok(frames.every((frame) => !frame.isDetached()));

    await page.goto(url + '?responsive');
    await page.locator(frameSelector).nth(1).waitFor();
    const responsive = await measure();
    console.log('responsive:', responsive);
    assert.equal(responsive.scale, 1);
    assert.ok(responsive.barTarget >= 44 && responsive.barFits && responsive.stacked);
  }
} finally {
  await context.close();
}
