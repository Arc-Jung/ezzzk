/** 4개 WAV 신호를 실제 슬롯·Web Audio로 처리해 출력 RMS와 끄기 복원을 검증한다. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openLiveContext, PROFILES, ROOT, seedSettings, warmUp } from './demo-context.mjs';
const out = resolve(ROOT, 'etc/tmp/multiview-auto-volume');
mkdirSync(out, { recursive: true });
const context = await openLiveContext(
  PROFILES.find((p) => p.key === 'fold8-mobile-browser'),
  {
    profileDir: resolve(ROOT, 'etc/tmp/playwright/multiview-auto-volume'),
    browserArgs: ['--autoplay-policy=document-user-activation-required'],
  },
);
const report = { states: [] };
function wav(amplitude, frequency, transient = false) {
  const count = 48000 * (transient ? 6 : 3);
  const data = Buffer.alloc(44 + count * 2);
  data.write('RIFF');
  data.writeUInt32LE(data.length - 8, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(48000, 24);
  data.writeUInt32LE(96000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(count * 2, 40);
  for (let n = 0; n < count; n++)
    data.writeInt16LE(
      Math.round(
        Math.sin((n * 2 * Math.PI * frequency) / 48000) *
          (transient && n >= 48000 * 4 && n < 48000 * 4.3 ? 0.8 : amplitude) *
          32767,
      ),
      44 + n * 2,
    );
  return data;
}
try {
  await context.route('https://chzzk.naver.com/audio-*.wav', (route) => {
    const slot = Number(/audio-(\d)/.exec(route.request().url())[1]);
    return route.fulfill({
      contentType: 'audio/wav',
      body: wav(
        slot === 0 ? 0 : slot === 5 ? 0.005 : 0.08 * 2 ** (slot - 1),
        400 + slot * 50,
        slot === 5,
      ),
    });
  });
  await context.route('https://chzzk.naver.com/live/**', (route) => {
    const slot = Number(new URL(route.request().url()).searchParams.get('cmSlot') ?? 1);
    return route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#13212b;color:white}.pzp-pc,#live_player_layout{position:relative;width:100%;height:100vh}video{width:100%;height:100%;background:#13212b}#play{position:absolute;top:45%;left:40%;font-size:18px}p{position:absolute;top:30%;left:20%}</style></head><body><div id="root"><div id="live_player_layout"><div class="pzp-pc pzp-pc--onlive pzp-pc--controls"><video playsinline loop src="/audio-${slot}.wav"></video><div class="pzp-pc__bottom"><div class="pzp-pc__bottom-buttons"><div class="pzp-pc__bottom-buttons-left"></div><div class="pzp-pc__bottom-buttons-right"></div></div></div><p>자동 음량 검증 신호 ${slot}</p><button id="play" onclick="document.querySelector('video').play()">재생</button></div></div><aside id="aside-chatting"></aside></div></body></html>`,
    });
  });
  await warmUp(context, '11111111111111111111111111111111');
  await seedSettings(context, {
    audio: { compressor: { enabled: false } },
    volume: { defaultLevel: 100, restoreLast: false },
    wideScreen: { enabled: false, mode: 'default' },
    multiView: {
      enabled: true,
      restoreLastLayout: true,
      autoFullscreen: false,
      autoVolume: false,
      defaultSplit: 4,
      slots: [1, 2, 3, 4].map((index) => ({
        index,
        channelId: String(index).repeat(32),
        channelName: '검증 신호 ' + index,
      })),
    },
  });
  const page = await context.newPage();
  await page.goto('https://chzzk.naver.com/live/11111111111111111111111111111111');
  await page.waitForFunction(() => document.querySelectorAll('.cm-slot iframe').length === 4);
  const frames = [];
  for (let slot = 1; slot <= 4; slot++) {
    const handle = await page.locator(`.cm-slot[data-slot="${slot}"] iframe`).elementHandle();
    const frame = await handle.contentFrame();
    await frame.waitForSelector('#play');
    await frame.click('#play');
    await frame.waitForFunction(() => !document.querySelector('video').paused);
    frames.push(frame);
  }
  const session = await context.newCDPSession(page);
  const executionContexts = [];
  session.on('Runtime.executionContextCreated', ({ context }) => executionContexts.push(context));
  await session.send('Runtime.enable');
  const { frameTree } = await session.send('Page.getFrameTree');
  const slots = new Map(
    frameTree.childFrames.map(({ frame }) => [
      frame.id,
      Number(new URL(frame.url).searchParams.get('cmSlot')),
    ]),
  );
  const worlds = executionContexts.filter(
    (c) =>
      slots.has(c.auxData?.frameId) &&
      c.auxData?.isDefault === false &&
      c.origin.startsWith('chrome-extension://'),
  );
  if (worlds.length !== 4)
    throw new Error(
      '확장 슬롯 실행 환경 4개를 찾지 못했습니다: ' +
        JSON.stringify(
          executionContexts.map((c) => ({ name: c.name, origin: c.origin, aux: c.auxData })),
        ),
    );
  for (const world of worlds)
    await session.send('Runtime.evaluate', {
      contextId: world.id,
      expression: `(()=>{
  const Native=AudioContext;globalThis.__levelProbe={contexts:[],sources:0};
  globalThis.AudioContext=class extends Native{constructor(...args){super(...args);const record={context:this,outputs:[],lastOutput:null};__levelProbe.contexts.push(record);
    const source=this.createMediaElementSource.bind(this);this.createMediaElementSource=(...a)=>{__levelProbe.sources++;return source(...a)};
    const instrument=node=>{const connect=node.connect.bind(node);node.connect=(target,...a)=>{const result=connect(target,...a);if(target===this.destination){const analyser=this.createAnalyser();analyser.fftSize=4096;connect(analyser);record.lastOutput=analyser;record.outputs.push(analyser)}return result};return node};
    const gain=this.createGain.bind(this);this.createGain=()=>instrument(gain());
    const compressor=this.createDynamicsCompressor.bind(this);this.createDynamicsCompressor=()=>instrument(compressor());
  }};
 })()`,
    });
  const read = async () =>
    Promise.all(
      worlds.map(async (world) => {
        const { result, exceptionDetails } = await session.send('Runtime.evaluate', {
          contextId: world.id,
          returnByValue: true,
          expression: `(()=>{const probe=globalThis.__levelProbe;const r=probe.contexts.at(-1);const a=r?.lastOutput;const samples=new Float32Array(4096);a?.getFloatTimeDomainData(samples);return {rms:Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/samples.length),contextState:r?.context.state,sources:probe.sources,volume:document.querySelector('video').volume,muted:document.querySelector('video').muted}})()`,
        });
        if (exceptionDetails) throw new Error(JSON.stringify(exceptionDetails));
        return { slot: slots.get(world.auxData.frameId), ...result.value };
      }),
    );
  const button = page.locator('#cm-multiview-auto-volume');
  await button.click();
  await page.waitForTimeout(8000);
  const enabled = await read();
  report.states.push({ phase: 'enabled', slots: enabled });
  const spread = (values) =>
    20 * Math.log10(Math.max(...values.map((s) => s.rms)) / Math.min(...values.map((s) => s.rms)));
  report.enabledSpreadDb = spread(enabled);
  if (
    enabled.some((s) => s.rms < 0.06 || s.rms > 0.1 || s.contextState !== 'running') ||
    report.enabledSpreadDb > 2
  )
    throw new Error('자동 보정 출력이 수렴하지 않았습니다: ' + JSON.stringify(enabled));
  // 작은 소리 직후 큰 소리가 나올 때의 피크. 일정 진폭 검사에서 놓치는 클리핑을 측정한다.
  const stressWorld = worlds.find((w) => slots.get(w.auxData.frameId) === 1);
  const transient = async () => {
    await frames[0].evaluate(async () => {
      const video = document.querySelector('video');
      video.src = '/audio-5.wav';
      await video.play();
    });
    const { result, exceptionDetails } = await session.send('Runtime.evaluate', {
      contextId: stressWorld.id,
      awaitPromise: true,
      returnByValue: true,
      expression: `new Promise(resolve => {let peak=0,count=0;const values=new Float32Array(4096);const timer=setInterval(()=>{const a=__levelProbe.contexts.at(-1)?.lastOutput;a?.getFloatTimeDomainData(values);for(const v of values)peak=Math.max(peak,Math.abs(v));count++;},10);setTimeout(()=>{clearInterval(timer);resolve({peak,count});},6000);})`,
    });
    if (exceptionDetails) throw new Error(JSON.stringify(exceptionDetails));
    if (result.value.peak <= 0.05 || result.value.peak > 0.95 || result.value.count < 100)
      throw new Error('급격한 음량 변화의 출력 제한 실패: ' + JSON.stringify(result.value));
    return result.value;
  };
  report.transient = await transient();
  await frames[0].evaluate(() => {
    for (let n = 0; n < 10; n++) document.querySelector('[aria-label="볼륨 높이기"]').click();
  });
  report.transientBoosted = await transient();
  await frames[0].evaluate(() => {
    for (let n = 0; n < 10; n++) document.querySelector('[aria-label="볼륨 낮추기"]').click();
  });
  await frames[0].evaluate(async () => {
    const video = document.querySelector('video');
    video.src = '/audio-1.wav';
    await video.play();
  });
  await page.waitForTimeout(8000);
  const restored = await read();
  if (restored.some((s) => s.volume !== 1) || spread(restored) > 2)
    throw new Error('200% 증폭에서 100% 복귀 실패');
  report.states.push({ phase: 'after-boost', slots: restored });
  await frames[2].evaluate(() => document.querySelector('video').pause());
  await page.waitForTimeout(800);
  const paused = await read();
  if (paused.find((s) => s.slot === 3).rms > 0.0001)
    throw new Error('일시정지 중 출력이 남아 있습니다');
  await frames[2].click('#play');
  await page.waitForTimeout(8000);
  const resumedPlayback = await read();
  if (spread(resumedPlayback) > 2 || resumedPlayback.some((s) => s.sources !== 1))
    throw new Error('일시정지 후 보정 재개 실패');
  report.states.push({ phase: 'pause-resume', slots: resumedPlayback });
  console.log(
    'transient',
    JSON.stringify({ normal: report.transient, boosted: report.transientBoosted }),
  );
  await page.screenshot({ path: resolve(out, 'enabled.png') });
  await page.setViewportSize({ width: 411, height: 900 });
  await page.waitForFunction(
    () => {
      const rect = document.querySelector('.cm-stage-bar').getBoundingClientRect();
      return rect.left >= -1 && rect.right <= innerWidth + 1;
    },
    null,
    { timeout: 3000 },
  );
  const bar = await page.locator('.cm-stage-bar').evaluate((e) => ({
    left: e.getBoundingClientRect().left,
    right: e.getBoundingClientRect().right,
    width: innerWidth,
  }));
  if (bar.left < -1 || bar.right > bar.width + 1)
    throw new Error('모바일 조작 바가 화면 밖으로 나갑니다: ' + JSON.stringify(bar));
  report.mobileBar = bar;
  await page.setViewportSize({ width: 859, height: 798 });
  await button.click();
  await page.waitForTimeout(800);
  const disabled = await read();
  report.states.push({ phase: 'disabled', slots: disabled });
  report.disabledSpreadDb = spread(disabled);
  if (
    report.disabledSpreadDb < 16 ||
    disabled.some((s) => s.sources !== 1 || s.volume !== 1 || s.muted)
  )
    throw new Error('끄기 후 원본 음량 복원 실패: ' + JSON.stringify(disabled));
  await button.click();
  await page.waitForTimeout(1000);
  const repeated = await read();
  if (repeated.some((s) => s.sources !== 1)) throw new Error('반복 토글 중 소스 중복 생성');
  await frames[0].evaluate(() => {
    const old = document.querySelector('video');
    old.pause();
    const next = old.cloneNode(true);
    old.replaceWith(next);
  });
  await frames[0].click('#play');
  await page.waitForTimeout(1500);
  const replaced = await read();
  report.states.push({ phase: 'video-replaced', slots: replaced });
  if (replaced.find((s) => s.slot === 1).sources !== 2)
    throw new Error('교체된 video에 오디오 처리가 붙지 않았습니다');
  for (const frame of frames)
    await frame.evaluate(() => {
      const control = document.querySelector('[aria-label="음량 평탄화 켜기"]');
      if (!control) throw new Error('기존 컴프레서 버튼이 없습니다');
      control.click();
      const minus = document.querySelector('[aria-label="볼륨 낮추기"]');
      for (let n = 0; n < 5; n++) minus.click();
    });
  await page.waitForTimeout(10000);
  const compressed = await read();
  report.states.push({ phase: 'compressor-and-manual-volume', slots: compressed });
  report.compressedSpreadDb = spread(compressed);
  if (
    compressed.some((s) => s.rms < 0.035 || s.rms > 0.045 || s.volume !== 0.5) ||
    report.compressedSpreadDb > 3
  )
    throw new Error('컴프레서·수동 음량과 함께 보정되지 않습니다: ' + JSON.stringify(compressed));
  await frames[1].evaluate(async () => {
    const video = document.querySelector('video');
    video.src = '/audio-0.wav';
    await video.play();
  });
  await page.waitForTimeout(1000);
  const silence = await read();
  report.states.push({ phase: 'silence', slots: silence });
  if (silence.find((s) => s.slot === 2).rms > 0.0001) throw new Error('무음 구간이 증폭됐습니다');
  await frames[1].evaluate(async () => {
    const video = document.querySelector('video');
    video.src = '/audio-2.wav';
    await video.play();
  });
  await page.waitForTimeout(6000);
  const resumed = await read();
  report.states.push({ phase: 'after-silence', slots: resumed });
  if (spread(resumed) > 3) throw new Error('무음 후 보정이 복구되지 않았습니다');
  await button.click();
  for (const frame of frames)
    if ((await frame.locator('[aria-label="음량 평탄화 끄기"]').count()) !== 1)
      throw new Error('자동 보정 해제가 기존 컴프레서 상태를 바꿨습니다');
  report.success = true;
  console.log(
    JSON.stringify({
      success: true,
      enabledSpreadDb: report.enabledSpreadDb,
      disabledSpreadDb: report.disabledSpreadDb,
    }),
  );
} finally {
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  await context.close();
}
