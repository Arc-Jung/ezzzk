/** Exercises the extension with a desktop document fitted to a narrow mobile viewport. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { openLiveContext, PROFILES, ROOT, seedSettings, warmUp } from './demo-context.mjs';

const baseline = process.argv.includes('--baseline');
const overscaleBaseline = process.argv.includes('--overscale-baseline');
const sheetsBaseline = process.argv.includes('--sheets-baseline');
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
  const cors = {
    'access-control-allow-origin': 'https://chzzk.naver.com',
    'access-control-allow-credentials': 'true',
  };
  const followings = Array.from({ length: 10 }, (_, i) => ({
    channelId: (i + 1).toString(16).repeat(32),
    channelName: `테스트 채널 ${i + 1}`,
    liveTitle: '커버 화면 재현용 라이브',
    concurrentUserCount: 1000 - i * 50,
    openLive: true,
  }));
  await context.route('https://comm-api.game.naver.com/**', (route) =>
    route.fulfill({ headers: cors, json: { content: { loggedIn: true } } }),
  );
  await context.route('https://api.chzzk.naver.com/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const content = path.endsWith('/followings') ? { data: followings } : { data: [] };
    return route.fulfill({ headers: cors, json: { code: 200, content } });
  });
  await warmUp(context, channelIds[0]);
  await seedSettings(context, {
    wideScreen: { enabled: false, mode: 'default' },
    chatSubtitle: { enabled: true },
    multiView: {
      enabled: true,
      restoreLastLayout: true,
      defaultSplit: 4,
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
  const setPageScale = async (scale) => {
    const session = await context.newCDPSession(page);
    await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: scale });
    await page.waitForFunction((expected) => visualViewport.scale === expected, scale);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await session.detach();
    return measure();
  };

  const verifySheets = async () => {
    for (const { title, trigger, mode, shot } of [
      { title: '멀티뷰 구성', trigger: '멀티뷰 구성 열기', mode: 'config', shot: 'cover-config' },
      {
        title: '이지직 설정',
        trigger: '이지직 설정 열기',
        mode: 'settings',
        shot: 'cover-settings',
      },
    ]) {
      const triggerSelector = `${toolbar} button[aria-label="${trigger}"]`;
      await tap(triggerSelector);
      const dialog = page.getByRole('dialog', { name: title, exact: true });
      await dialog.waitFor();
      const search = dialog.getByRole('textbox', { name: '채널 검색' });
      if (mode === 'config') await search.waitFor();
      const panelState = () =>
        dialog.evaluate((panel) => {
          const rect = panel.getBoundingClientRect();
          const close = panel.querySelector('.cm-sheet__close').getBoundingClientRect();
          const { width, height, scale, offsetLeft, offsetTop } = visualViewport;
          const columns = panel.querySelector('.cm-mv-columns');
          const rail = panel.querySelector('.cm-sp__rail');
          const backdrop = getComputedStyle(panel.closest('.cm-sheet-backdrop'));
          const heading = getComputedStyle(panel.querySelector('h2'));
          const body = panel.querySelector('.cm-sheet__body');
          return {
            width: Math.round(rect.width * scale),
            available: Math.round(width * scale),
            fits:
              rect.left >= offsetLeft - 1 &&
              rect.top >= offsetTop - 1 &&
              rect.right <= offsetLeft + width + 1 &&
              rect.bottom <= offsetTop + height + 1,
            target: Math.min(close.width, close.height) * scale,
            textSize: parseFloat(heading.fontSize) * (Number(backdrop.zoom) || 1) * scale,
            compact: columns
              ? getComputedStyle(columns).gridTemplateColumns.split(' ').length === 1
              : getComputedStyle(rail).flexDirection === 'row',
            noHorizontalScroll: body.scrollWidth <= body.clientWidth + 1,
          };
        });
      const current = await panelState();
      console.log(mode, current);
      if (sheetsBaseline) {
        assert.ok(!current.compact && current.target < 30, `${mode}: original issue reproduced`);
        await page.screenshot({ path: resolve(out, shot + '-before.png') });
      } else {
        assert.ok(current.compact && current.fits && current.width >= current.available - 20);
        assert.ok(current.target >= 43.5 && current.textSize >= 13.5 && current.noHorizontalScroll);
        await page.screenshot({ path: resolve(out, shot + '.png') });
        if (mode === 'config') {
          await search.fill('테스트 채널 3');
          const assign = dialog.getByRole('button', { name: '테스트 채널 3 을 슬롯 3 에 배치' });
          await assign.click();
          await dialog.getByText('3/4개 방송 선택').waitFor();
        } else {
          await dialog.getByRole('tab', { name: '채팅 탭', exact: true }).click();
        }

        await page.setViewportSize({ width: 859, height: 954 });
        await page.waitForFunction(() => {
          const backdrop = document.querySelector('.cm-sheet-backdrop');
          return parseFloat(backdrop.style.width) > 720;
        });
        const expanded = await panelState();
        assert.ok(!expanded.compact && expanded.fits, `${mode}: unfolded layout`);
        const resizeCover = async (width, height) => {
          await page.setViewportSize({ width, height });
          await page.waitForFunction(
            ({ width, height }) => {
              const sheet = document.querySelector('.cm-sheet-backdrop');
              return (
                Math.abs(parseFloat(sheet.style.width) - width) < 1 &&
                Math.abs(parseFloat(sheet.style.height) - height) < 1
              );
            },
            { width, height },
          );
        };
        if (mode === 'config') await search.focus();
        await resizeCover(360, 510);
        const narrow = await panelState();
        assert.ok(
          narrow.compact && narrow.fits && narrow.noHorizontalScroll,
          `${mode}: narrow sheet`,
        );
        if (mode === 'config')
          assert.ok(await search.evaluate((input) => input === document.activeElement));
        await resizeCover(cover.viewport.width, cover.viewport.height);
        const refoldedSheet = await panelState();
        assert.ok(refoldedSheet.compact && refoldedSheet.fits && refoldedSheet.target >= 43.5);
        if (mode === 'config') {
          assert.equal(await search.inputValue(), '테스트 채널 3');
          await dialog.getByText('3/4개 방송 선택').waitFor();
        } else {
          assert.equal(
            await dialog
              .getByRole('tab', { name: '채팅 탭', exact: true })
              .getAttribute('aria-selected'),
            'true',
          );
        }
      }
      await tap('.cm-sheet__close');
      await dialog.waitFor({ state: 'hidden' });
      assert.ok(frames.every((frame) => !frame.isDetached()));
    }
  };

  if (sheetsBaseline) {
    await verifySheets();
  } else if (baseline) {
    assert.ok(state.barTarget < 30, 'Original undersized buttons should reproduce');
    await page.screenshot({ path: resolve(out, 'before.png') });
  } else if (overscaleBaseline) {
    const overlaid = await setPageScale(0.75);
    console.log('partially zoomed desktop, before:', overlaid);
    assert.ok(overlaid.layoutWidth >= 960 && overlaid.barTarget > 70 && overlaid.barRows >= 3);
    await page.screenshot({ path: resolve(out, 'overscale-before.png') });
  } else {
    assert.ok(state.barTarget >= 43.5, 'Toolbar target should be 44 visible CSS pixels');
    assert.ok(state.playerTarget >= 43.5, 'Slot player target should be 44 visible CSS pixels');
    assert.ok(state.barFits && state.barRows === 1 && !state.barLabels);
    assert.ok(state.stacked && state.firstWidth >= state.width - 1);
    await verifySheets();

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

    for (const scale of [0.75, 1]) {
      const actual = await setPageScale(scale);
      console.log('desktop at scale', scale, actual);
      assert.ok(actual.layoutWidth >= 960 && actual.barRows === 1 && actual.barFits);
      assert.ok(actual.barTarget >= 43.5 && actual.barTarget <= 45);
      assert.ok(actual.playerTarget >= 43.5 && actual.playerTarget <= 45);
      assert.ok(actual.stacked && actual.firstWidth >= actual.width - 1);
      if (scale === 0.75) {
        await Promise.all(
          frames.map((frame) =>
            frame.evaluate(() => {
              const ad = document.createElement('div');
              ad.className = 'ad_info_area';
              ad.style.cssText =
                'position:absolute;right:12px;bottom:12px;padding:6px 10px;background:#111c;border-radius:4px;font:14px sans-serif';
              ad.textContent = '14초 후 SKIP';
              document.querySelector('.pzp-pc').append(ad);
            }),
          ),
        );
        await page.waitForFunction(
          () => document.querySelectorAll('.cm-slot__ad-notice').length === 2,
        );
        assert.ok(
          await page.evaluate(() => {
            const bottom = document.querySelector('.cm-stage-bar').getBoundingClientRect().bottom;
            return [...document.querySelectorAll('.cm-slot__ad-notice')].every(
              (notice) => notice.getBoundingClientRect().top > bottom,
            );
          }),
          'Toolbar must leave both ad notices visible',
        );
        await page.screenshot({ path: resolve(out, 'cover.png') });
        await Promise.all(
          frames.map((frame) => frame.locator('.ad_info_area').evaluate((ad) => ad.remove())),
        );
      }
    }

    await page.setViewportSize({ width: 360, height: cover.viewport.height });
    await page.waitForFunction(() => {
      const stage = document.getElementById('cm-multiview-stage');
      return Math.abs(parseFloat(stage.style.width) - 360) < 1;
    });
    const narrow = await measure();
    console.log('narrow cover:', narrow);
    assert.ok(narrow.barRows === 1 && narrow.barFits && narrow.barTarget >= 43.5);
    await page.setViewportSize(cover.viewport);

    await page.goto(url + '?responsive');
    await page.locator(frameSelector).nth(1).waitFor();
    await page.frameLocator(frameSelector).first().locator('.pzp-pc__playback-switch').waitFor();
    const responsive = await measure();
    console.log('responsive:', responsive);
    assert.equal(responsive.scale, 1);
    assert.ok(
      responsive.barTarget >= 44 &&
        responsive.playerTarget >= 44 &&
        responsive.barFits &&
        responsive.stacked,
    );
  }
} finally {
  await context.close();
}
