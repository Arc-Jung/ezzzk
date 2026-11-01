/** 실제 공개 채팅에서 스트리머 이모티콘·닉네임 색상·설정 토글을 검증한다. 채팅은 보내지 않는다. */
import { openLiveContext, PROFILES, seedSettings, warmUp, ROOT } from './demo-context.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const context = await openLiveContext(
  PROFILES.find((p) => p.key === 'fold8-mobile-browser'),
  { profileDir: resolve(ROOT, 'etc/tmp/playwright/subtitle-emoticons') },
);
const reports = [];
mkdirSync(resolve(ROOT, 'etc/tmp/subtitle-emoticons'), { recursive: true });
try {
  await warmUp(context, '4de764d9dad3b25602284be6db3ac647');
  await seedSettings(context, {
    chatSubtitle: { enabled: true, useNicknameColor: true, backgroundOpacity: 10 },
    multiView: { enabled: false },
  });
  let captured = false;
  for (const channelId of [
    '4de764d9dad3b25602284be6db3ac647',
    '40adc722447978816ce04cf2f0a70590',
    'c0d9723cbb75dc223c6aa8a9d4f56002',
  ]) {
    const page = await context.newPage();
    try {
      await page.goto(`https://chzzk.naver.com/live/${channelId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      await page.waitForFunction(
        () =>
          document.querySelector('#cm-chat-subtitle .cm-subtitle-author') &&
          document.querySelector('.pzp-pc--onlive video')?.readyState >= 3,
        null,
        { timeout: 150000 },
      );
      const video = await page.locator('#live_player_layout video').first().elementHandle();
      let matched;
      for (let tick = 0; tick < 180; tick++) {
        await page.waitForTimeout(500);
        const state = await page.evaluate(() => {
          const scroller = document.querySelector('#aside-chatting [class*="_wrapper_8lqsk"]');
          let fiber =
              scroller?.[Object.keys(scroller ?? {}).find((k) => k.startsWith('__reactFiber$'))],
            client;
          for (let depth = 0; fiber && depth < 15; depth++, fiber = fiber.return)
            client ??= Object.values(fiber.memoizedProps ?? {}).find(
              (v) => v && Array.isArray(v.messageList) && typeof v.messageLimitCount === 'number',
            );
          const history = client?.messageList ?? [];
          const nativeImages = [];
          function images(value, depth = 0) {
            if (depth > 8) return;
            if (Array.isArray(value))
              return value.slice(0, 64).forEach((v) => images(v, depth + 1));
            if (!value || typeof value !== 'object') return;
            if (value.type === 'img' && typeof value.props?.src === 'string')
              nativeImages.push(value.props.src);
            else images(value.props?.children, depth + 1);
          }
          history.slice(-50).forEach((m) => images(m.content));
          const theme = document.documentElement.classList.contains('theme_dark')
            ? 'dark'
            : 'light';
          const colors = [...document.querySelectorAll('#cm-chat-subtitle .cm-subtitle-author')]
            .map((e) => {
              const name = e.textContent.replace(/: $/, '');
              const native = history.findLast((m) => m.profile?.nickname === name)
                ?.displayNicknameColor?.[theme];
              const span = document.createElement('span');
              if (native) span.style.color = native;
              return { name, actual: getComputedStyle(e).color, expected: span.style.color };
            })
            .filter((c) => c.actual && c.actual === c.expected);
          const emotes = [
            ...document.querySelectorAll('#cm-chat-subtitle img.cm-subtitle-emoticon'),
          ]
            .filter(
              (e) =>
                e.src.includes('/glive/subscription/emoji/') &&
                e.complete &&
                e.naturalWidth > 0 &&
                nativeImages.includes(e.src),
            )
            .map((e) => ({ src: e.src, alt: e.alt, width: e.width, height: e.height }));
          const v = document.querySelector('#live_player_layout video');
          return {
            colors,
            emotes,
            playing: !!v && !v.paused && !v.error && v.currentTime > 0,
            theme,
            scrollTop: scroller?.scrollTop,
          };
        });
        if (state.emotes.length && state.colors.length >= 2 && state.playing) {
          matched = state;
          break;
        }
      }
      if (!matched)
        throw new Error('관찰 시간 동안 최신 자막의 스트리머 이모티콘을 확인하지 못했습니다');
      await page.screenshot({
        path: resolve(ROOT, 'screenshots/demo-chat-subtitle-emoticons.png'),
      });
      reports.push({ channelId, ...matched });
      await page.evaluate(() => window.dispatchEvent(new Event('cm-open-settings')));
      await page.locator('#cm-sp-tab-chat').click();
      const toggle = page.getByRole('switch', {
        name: '치지직 원본 닉네임 색상 사용 켜짐',
        exact: true,
      });
      await toggle.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: resolve(ROOT, 'screenshots/demo-chat-subtitle-colors-settings.png'),
      });
      await toggle.click();
      await page.waitForFunction(() => {
        const authors = [...document.querySelectorAll('#cm-chat-subtitle .cm-subtitle-author')];
        return (
          authors.length > 0 &&
          authors.every(
            (e) =>
              !e.style.color &&
              getComputedStyle(e).color ===
                getComputedStyle(document.querySelector('#cm-chat-subtitle')).color,
          )
        );
      });
      await page
        .getByRole('switch', { name: '치지직 원본 닉네임 색상 사용 꺼짐', exact: true })
        .click();
      await page.waitForFunction(() =>
        [...document.querySelectorAll('#cm-chat-subtitle .cm-subtitle-author')].some(
          (e) => e.style.color,
        ),
      );
      const sameVideo = await video.evaluate(
        (v) =>
          v.isConnected && v === document.querySelector('#live_player_layout video') && !v.paused,
      );
      if (!sameVideo) throw new Error('색상 설정 중 재생이 끊겼습니다');
      reports.push({ toggleOff: true, toggleOn: true, sameVideo });
      console.log(
        'PASS native streamer emoticons, original nickname colors, toggle off/on, same video',
      );
      captured = true;
      break;
    } catch (e) {
      console.log('RETRY', channelId, String(e).split('\n')[0]);
    } finally {
      await page.close();
    }
  }
  if (!captured) throw new Error('실제 이모티콘 검증 실패');
} finally {
  writeFileSync(
    resolve(ROOT, 'etc/tmp/subtitle-emoticons/report.json'),
    JSON.stringify(reports, null, 2),
  );
  await context.close();
}
