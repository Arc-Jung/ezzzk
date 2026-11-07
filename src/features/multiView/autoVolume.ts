/** 슬롯별 RMS 자동 게인. 수동 볼륨은 임시로 100%에 고정하고 공통 평균 목표로 보정한다. */
import { autoVolumeLock, enforceAutoVolume } from './volumeLock';
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
export function normalizationGain(
  rms: number,
  peak: number,
  target = AUTO_VOLUME_TARGET,
): number | null {
  if (!Number.isFinite(rms) || !Number.isFinite(peak) || rms < 0.003 || peak <= 0) return null;
  return Math.max(0.05, Math.min(8, target / rms, 0.8 / peak));
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
  let targetRms = AUTO_VOLUME_TARGET;
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
      enforceAutoVolume(video);
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
      // 분석기에 반영된 수동 배율을 제거해 방송 원본 레벨을 보고한다.
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
        normalizationGain(Math.sqrt(meter.power), peak / manualScale, targetRms)!,
        0.8 / peak,
      );
      const current = meter.graph.normalization!.gain.gain.value;
      smoothGain(meter.graph, target, target < current ? 0.15 : 1.5);
      active = true;
    }
    state = failed ? 'unavailable' : active ? 'active' : 'waiting';
  };
  const setEnabled = (next: boolean) => {
    if (enabled === next) {
      if (!next) autoVolumeLock.setEnabled(false);
      return;
    }
    enabled = next;
    failedVideos = new WeakSet();
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    if (enabled) {
      autoVolumeLock.setEnabled(true);
      tick();
      timer = setInterval(tick, AUTO_VOLUME_INTERVAL_MS);
    } else {
      for (const meter of meters.values()) {
        reset(meter);
        setNormalizationEnabled(meter.graph, false);
      }
      meters.clear();
      state = 'off';
      autoVolumeLock.setEnabled(false);
    }
  };
  return {
    setEnabled,
    setTarget: (value: number) => {
      if (Number.isFinite(value)) targetRms = Math.max(0.02, Math.min(AUTO_VOLUME_TARGET, value));
    },
    level: () =>
      state === 'active'
        ? Math.sqrt(Math.max(0, ...[...meters.values()].map((m) => m.power ?? 0)))
        : null,
    state: () => state,
    dispose: () => setEnabled(false),
  };
}

/** 재생 중인 방송의 평균 입력 음량을 공통 목표로 삼되, 혼합 출력의 과증폭을 제한한다. */
export function averageVolumeTarget(levels: (number | null | undefined)[]): number {
  const active = levels.filter(
    (level): level is number =>
      typeof level === 'number' && Number.isFinite(level) && level >= 0.003,
  );
  return active.length
    ? Math.max(
        0.02,
        Math.min(AUTO_VOLUME_TARGET, active.reduce((sum, level) => sum + level, 0) / active.length),
      )
    : AUTO_VOLUME_TARGET;
}
