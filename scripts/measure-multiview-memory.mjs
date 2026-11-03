/** 실제 공개 방송 4개 재생과 전용 Chromium 프로세스 트리 RSS를 함께 기록한다. */
import { openLiveContext, PROFILES, seedSettings, warmUp, ROOT } from './demo-context.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import os from 'node:os';

const option = (name) =>
  process.argv
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');
const duration = Number(option('seconds') ?? process.env.EZZZK_MEMORY_SECONDS ?? 300);
if (!Number.isInteger(duration) || duration < 10 || duration > 86400 || duration % 10 !== 0)
  throw new Error('측정 시간은 10~86400초 범위의 10초 배수여야 합니다');
const runId = option('run-id') ?? '';
if (runId && !/^[a-z0-9-]+$/.test(runId))
  throw new Error('run-id는 영문 소문자·숫자·하이픈만 허용합니다');
const output = resolve(ROOT, `etc/tmp/multiview-memory${runId ? `-${runId}` : ''}`);
mkdirSync(output, { recursive: true });
const context = await openLiveContext(
  PROFILES.find((p) => p.key === 'laptop13'),
  {
    profileDir: resolve(ROOT, `etc/tmp/playwright/multiview-memory${runId ? `-${runId}` : ''}`),
    browserArgs: ['--disable-audio-output'],
  },
);
const report = {
  startedAt: new Date().toISOString(),
  requestedDurationSeconds: duration,
  sampleIntervalSeconds: 10,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  extensionVersion: JSON.parse(readFileSync(resolve(ROOT, 'dist/manifest.json'))).version,
  environment: {
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0].model,
    cpuCount: os.cpus().length,
    ramBytes: os.totalmem(),
    viewport: { width: 1440, height: 900 },
    dpr: 2,
    headless: true,
    profile: 'fresh / signed out / extension only',
    audio: 'muted; --disable-audio-output',
  },
  settings: {
    qualityTarget: '1080p',
    lowerInactiveQuality: false,
    chatSubtitle: false,
    layout: 'grid',
    chatMode: 'none',
  },
  samples: [],
  events: [],
};
let page;
const persist = () =>
  writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
try {
  await warmUp(context, '4de764d9dad3b25602284be6db3ac647');
  page = await context.newPage();
  await page.goto('https://chzzk.naver.com/', { waitUntil: 'domcontentloaded' });
  const channels = await page.evaluate(async () => {
    const response = await fetch('https://api.chzzk.naver.com/service/v1/lives?size=30', {
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`lives HTTP ${response.status}`);
    const data = await response.json();
    return data.content.data
      .filter((row) => !row.adult)
      .map((row) => ({
        channelId: row.channel.channelId,
        channelName: row.channel.channelName,
      }))
      .slice(0, 8);
  });
  if (channels.length < 4) throw new Error('공개 비성인 방송 4개가 필요합니다');
  report.channels = channels.slice(0, 4);
  console.log('CHANNELS', JSON.stringify(report.channels));
  await seedSettings(context, {
    quality: { enabled: true, target: '1080p' },
    chatSubtitle: { enabled: false },
    multiView: { enabled: false, slots: [], lowerInactiveQuality: false, chatMode: 'none' },
  });
  const browserCdp = await context.browser().newBrowserCDPSession();
  report.environment.browser = (await browserCdp.send('Browser.getVersion')).product;
  async function rss() {
    const { processInfo } = await browserCdp.send('SystemInfo.getProcessInfo');
    const browserPid = processInfo.find((p) => p.type === 'browser')?.id;
    if (!browserPid) throw new Error('측정 브라우저 PID 없음');
    const table = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,comm='], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((line) => {
        const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line);
        return match && { pid: +match[1], ppid: +match[2], rssKiB: +match[3], command: match[4] };
      })
      .filter(Boolean);
    const pids = new Set([browserPid, ...processInfo.map((p) => p.id)]);
    let size;
    do {
      size = pids.size;
      for (const process of table) if (pids.has(process.ppid)) pids.add(process.pid);
    } while (size !== pids.size);
    const processes = table
      .filter((p) => pids.has(p.pid))
      .map((p) => ({
        pid: p.pid,
        ppid: p.ppid,
        rssKiB: p.rssKiB,
        type: processInfo.find((info) => info.id === p.pid)?.type ?? 'descendant',
      }));
    return {
      browserPid,
      rssMiB: processes.reduce((sum, p) => sum + p.rssKiB, 0) / 1024,
      processes,
    };
  }
  async function videos() {
    const result = [];
    for (const frame of page.frames()) {
      if (!frame.url().includes('/live/')) continue;
      try {
        result.push(
          await frame.evaluate(() => ({
            slot: new URL(location.href).searchParams.get('cmSlot'),
            channelId: location.pathname.split('/').at(-1),
            isMain: window === window.top,
            title: document.title,
            adActive: [
              ...document.querySelectorAll(
                '.vod_player_wrap .ad_info_area, .vod_player_wrap .btn_skip',
              ),
            ].some(
              (e) =>
                e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden',
            ),
            videos: [...document.querySelectorAll('video')].map((v) => ({
              onLive: !!v.closest('.pzp-pc--onlive'),
              paused: v.paused,
              ended: v.ended,
              readyState: v.readyState,
              currentTime: v.currentTime,
              width: v.videoWidth,
              height: v.videoHeight,
              muted: v.muted,
              totalVideoFrames: v.getVideoPlaybackQuality().totalVideoFrames,
              droppedFrames: v.getVideoPlaybackQuality().droppedVideoFrames,
              bufferedSeconds: v.buffered.length
                ? v.buffered.end(v.buffered.length - 1) - v.currentTime
                : 0,
            })),
          })),
        );
      } catch (error) {
        result.push({ error: error.message });
      }
    }
    return result;
  }
  async function sample(phase, elapsedSeconds, actualElapsedSeconds = elapsedSeconds) {
    const memory = await rss();
    const sample = {
      phase,
      elapsedSeconds,
      actualElapsedSeconds,
      timestamp: new Date().toISOString(),
      ...memory,
      frames: await videos(),
    };
    report.samples.push(sample);
    persist();
    console.log(
      JSON.stringify({
        phase,
        elapsedSeconds,
        rssMiB: +memory.rssMiB.toFixed(1),
        frames: sample.frames.map((f) => ({
          channel: f.channelId,
          main: f.isMain,
          ad: f.adActive,
          videos: f.videos?.map((v) => ({
            playing: !v.paused,
            live: v.onLive,
            t: +v.currentTime.toFixed(1),
            size: `${v.width}x${v.height}`,
          })),
        })),
      }),
    );
    return sample;
  }
  async function record(phase, seconds) {
    const started = performance.now();
    await sample(phase, 0);
    for (let elapsed = 10; elapsed <= seconds; elapsed += 10) {
      await page.waitForTimeout(Math.max(0, started + elapsed * 1000 - performance.now()));
      await sample(phase, elapsed, (performance.now() - started) / 1000);
    }
  }
  await page.goto('about:blank');
  await page.waitForTimeout(10000);
  await record('blank', 30);
  await page.goto(`https://chzzk.naver.com/live/${report.channels[0].channelId}`, {
    waitUntil: 'domcontentloaded',
  });
  async function waitPlaying(expected) {
    let previous = new Map();
    for (let attempt = 0; attempt < 120; attempt++) {
      const frames = await videos();
      const relevant = frames.filter((f) => (expected === 1 ? f.isMain : f.isMain === false));
      let advancing = 0;
      for (const f of relevant) {
        const v = f.videos?.find((v) => v.onLive && !v.paused && v.readyState >= 3 && v.width > 0);
        if (
          v &&
          !f.adActive &&
          previous.has(f.channelId) &&
          v.currentTime > previous.get(f.channelId) + 0.5
        )
          advancing++;
        if (v) previous.set(f.channelId, v.currentTime);
      }
      if (advancing === expected && relevant.length === expected) return;
      if (attempt % 10 === 0) console.log('WAIT_PLAYING', expected, JSON.stringify(frames));
      await page.waitForTimeout(2000);
    }
    throw new Error(`${expected}개 본방송 동시 재생을 확인하지 못했습니다`);
  }
  await waitPlaying(1);
  await page.waitForTimeout(20000);
  await record('single', 30);
  await seedSettings(context, {
    multiView: {
      enabled: true,
      restoreLastLayout: true,
      defaultSplit: 4,
      layout: 'grid',
      activeSlot: 1,
      slots: report.channels.map((channel, index) => ({ ...channel, index: index + 1 })),
      lowerInactiveQuality: false,
      chatMode: 'none',
    },
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page
    .locator('#cm-multiview-stage .cm-slot iframe')
    .nth(3)
    .waitFor({ state: 'attached', timeout: 60000 });
  await waitPlaying(4);
  report.events.push({ type: 'four-live-streams-advancing', timestamp: new Date().toISOString() });
  await page.waitForTimeout(20000);
  await page.screenshot({ path: resolve(output, 'four-streams-start.png') });
  await record('multiview4', duration);
  await page.screenshot({ path: resolve(output, 'four-streams-end.png') });
  const samples = report.samples.filter((sample) => sample.phase === 'multiview4');
  const live = (sample) =>
    sample.frames
      .filter((frame) => frame.isMain === false)
      .map((frame) => ({
        channelId: frame.channelId,
        video:
          !frame.adActive &&
          frame.videos?.find((v) => v.onLive && !v.paused && v.readyState >= 3 && v.width > 0),
      }));
  report.validation = {
    samplesWithFourLive: samples.filter(
      (sample) => live(sample).length === 4 && live(sample).every((frame) => frame.video),
    ).length,
    progressingIntervals: samples.slice(1).filter((sample, index) => {
      const previous = new Map(
        live(samples[index]).map((frame) => [frame.channelId, frame.video?.currentTime]),
      );
      return (
        live(sample).length === 4 &&
        live(sample).every(
          (frame) => frame.video && frame.video.currentTime > previous.get(frame.channelId) + 0.5,
        )
      );
    }).length,
    totalSamples: samples.length,
    totalIntervals: samples.length - 1,
  };
  if (
    report.validation.samplesWithFourLive !== samples.length ||
    report.validation.progressingIntervals !== samples.length - 1
  )
    throw new Error(
      '기록 중 네 방송의 연속 재생 조건을 만족하지 못했습니다. 원시 데이터를 확인하세요',
    );
  report.completedAt = new Date().toISOString();
  report.success = true;
} catch (error) {
  report.error = error.stack;
  console.error(error);
  if (page) await page.screenshot({ path: resolve(output, 'error.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  persist();
  await context.close();
}
