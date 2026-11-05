/** 슬롯별 RMS 자동 게인. 원본 음량·음소거·컴프레서 설정은 변경하지 않는다. */
import {
  ensureGraph,
  ensureNormalization,
  resumeGraph,
  setNormalizationEnabled,
  type AudioGraph,
} from '../audioPipeline';
export type AutoVolumeState = 'off' | 'waiting' | 'active' | 'unavailable';
export const AUTO_VOLUME_TARGET = 0.08;
export const AUTO_VOLUME_INTERVAL_MS = 250;

/** 무음/잡음 바닥은 올리지 않고, 작은 소리는 최대 8배·측정 피크 0.8 이내로 제한한다. */
export function normalizationGain(rms: number, peak: number): number | null {
  if (!Number.isFinite(rms) || !Number.isFinite(peak) || rms < 0.003 || peak <= 0) return null;
  return Math.max(0.05, Math.min(8, AUTO_VOLUME_TARGET / rms, 0.8 / peak));
}

function smoothGain(graph: AudioGraph, value: number, seconds: number) {
  const gain = graph.normalization?.gain.gain;
  if (!gain) return;
  const now = graph.context.currentTime;
  gain.cancelScheduledValues(now);
  gain.setTargetAtTime(value, now, seconds);
}

type Meter = { graph: AudioGraph; samples: Float32Array<ArrayBuffer>; power: number | null };
export function createAutoVolume(getVideos: () => HTMLVideoElement[]) {
  let enabled = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let state: AutoVolumeState = 'off';
  const meters = new Map<HTMLVideoElement, Meter>();
  let failedVideos = new WeakSet<HTMLVideoElement>();
  const reset = (meter: Meter) => smoothGain(meter.graph, 1, 0.1);
  const tick = () => {
    if (!enabled) return;
    const videos = getVideos();
    for (const [video, meter] of meters) {
      if (!videos.includes(video)) {
        reset(meter);
        setNormalizationEnabled(meter.graph, false);
        meters.delete(video);
      }
    }
    state = 'waiting';
    let active = false;
    let failed = false;
    for (const video of videos) {
      if (video.paused || video.ended || video.muted || video.volume === 0) {
        const pausedMeter = meters.get(video);
        if (pausedMeter) {
          reset(pausedMeter);
          pausedMeter.power = null;
        }
        continue;
      }
      if (failedVideos.has(video)) {
        failed = true;
        continue;
      }
      let meter = meters.get(video);
      if (!meter) {
        const graph = ensureGraph(video);
        const normalization = graph && ensureNormalization(graph);
        if (!graph || !normalization) {
          failedVideos.add(video);
          failed = true;
          continue;
        }
        setNormalizationEnabled(graph, true);
        meter = { graph, samples: new Float32Array(normalization.analyser.fftSize), power: null };
        meters.set(video, meter);
      }
      resumeGraph(meter.graph);
      if (meter.graph.context.state !== 'running') continue;
      const analyser = meter.graph.normalization!.analyser;
      analyser.getFloatTimeDomainData(meter.samples);
      let power = 0;
      let peak = 0;
      for (const sample of meter.samples) {
        power += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
      power /= meter.samples.length;
      // 수동 음량을 낮췄다고 AGC가 다시 키우지 않도록 수동 배율을 제거한 기준으로 비교한다.
      const manualScale = video.volume * meter.graph.gain.gain.value;
      if (!Number.isFinite(manualScale) || manualScale <= 0) continue;
      power /= manualScale * manualScale;
      const rms = Math.sqrt(power);
      if (normalizationGain(rms, peak / manualScale) === null) {
        // 긴 무음 뒤 큰 소리가 나올 때 이전의 증폭값이 남아 있지 않게 한다.
        meter.power = null;
        if (meter.graph.normalization!.gain.gain.value !== 1) reset(meter);
        continue;
      }
      // 약 1초 평균. 갑자기 커진 피크는 평균을 기다리지 않고 먼저 낮춘다.
      meter.power = meter.power === null ? power : meter.power * 0.75 + power * 0.25;
      const target = Math.min(
        normalizationGain(Math.sqrt(meter.power), peak / manualScale)!,
        0.8 / peak,
      );
      const current = meter.graph.normalization!.gain.gain.value;
      smoothGain(meter.graph, target, target < current ? 0.15 : 1.5);
      active = true;
    }
    state = failed ? 'unavailable' : active ? 'active' : 'waiting';
  };
  const setEnabled = (next: boolean) => {
    if (enabled === next) return;
    enabled = next;
    failedVideos = new WeakSet();
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    if (enabled) {
      tick();
      timer = setInterval(tick, AUTO_VOLUME_INTERVAL_MS);
    } else {
      for (const meter of meters.values()) {
        reset(meter);
        setNormalizationEnabled(meter.graph, false);
      }
      meters.clear();
      state = 'off';
    }
  };
  return { setEnabled, state: () => state, dispose: () => setEnabled(false) };
}
