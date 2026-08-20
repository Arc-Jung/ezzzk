/**
 * 오디오 파이프라인 — **볼륨 100% 초과 증폭(FR-03.2)과 컴프레서(FR-19)**.
 *
 * 왜 Web Audio 인가 (실측 2026-08-20, `scripts/probe-volume-boost.mjs`)
 * - `video.volume = 2` 는 **`IndexSizeError`** 다. HTMLMediaElement 볼륨은 스펙상 0~1 이라
 *   이 경로로는 100% 를 넘길 수 없다.
 * - `createMediaElementSource` → `GainNode` 경로는 치지직에서 **무음이 되지 않았다**(크로스 오리진
 *   태인트 없음). 게인 전/후 RMS 비율이 gain 1 에서 1.000, gain 2 에서 **2.000** 으로 정확히 곱해졌다.
 *
 * 구현 참조: **chzzk-plus (kyechan99/chzzk-plus, MIT)** 의 `AudioCompressorButton`.
 * 그래프 구성(단일 컨텍스트·소스 재사용, source → compressor → gain → destination)과 컴프레서
 * 기본값(threshold -50, knee 40, ratio 12, attack 0, release 0.25)을 참고했다.
 *
 * 🔴 지켜야 하는 제약
 * - `createMediaElementSource` 는 **요소당 한 번만** 부를 수 있다(두 번째는 InvalidStateError).
 *   그래서 요소별로 그래프를 기억하고 재사용한다. 요소가 교체되면(전체화면 전환) 새로 만든다.
 * - 그래프에 한 번 연결하면 요소의 소리는 **그래프를 통해서만** 나온다. 그래서 증폭·컴프레서를
 *   모두 끈 상태에서도 `source → destination` 연결은 유지해야 소리가 사라지지 않는다.
 * - `AudioContext` 는 사용자 제스처 전에는 `suspended` 일 수 있다 — 매번 `resume()` 을 시도하고
 *   실패는 조용히 넘긴다(정책상 정상이다).
 */

import { warning } from '../utils/log';

/** 증폭 상한. 200% 까지는 실측으로 확인했고, 그 이상은 찢어짐(클리핑) 위험이 커진다. */
export const MAX_BOOST_PERCENT = 200;

export type CompressorParams = {
  /** dB, -100~0 — 이 세기를 넘는 소리부터 누른다. */
  threshold: number;
  /** dB, 0~40 — 문턱 부근을 부드럽게 만드는 폭. */
  knee: number;
  /** 1~20 — 누르는 비율. */
  ratio: number;
  /** 초, 0~1 — 누르기 시작하는 속도. */
  attack: number;
  /** 초, 0~1 — 풀리는 속도. */
  release: number;
};

/** chzzk-plus 와 같은 기본값. 방송 간 음량 차이를 줄이는 데 무난하다. */
export const DEFAULT_COMPRESSOR: CompressorParams = {
  threshold: -50,
  knee: 40,
  ratio: 12,
  attack: 0,
  release: 0.25,
};

export type AudioGraph = {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  compressor: DynamicsCompressorNode;
  /** 지금 컴프레서를 거치고 있는가. 연결 변경을 멱등하게 하려고 들고 있는다. */
  compressorEnabled: boolean;
};

/**
 * 요소별 그래프. **WeakMap 이라 요소가 사라지면 함께 정리된다.**
 * 요소당 소스는 하나뿐이라는 제약 때문에 전역 캐시가 필요하다.
 */
const graphs = new WeakMap<HTMLMediaElement, AudioGraph>();

/** 게인 배율을 계산한다. **순수 함수** — 100% = 1배, 200% = 2배, 범위 밖은 클램프한다. */
export function boostToGain(percent: number): number {
  if (!Number.isFinite(percent)) return 1;
  const clamped = Math.min(MAX_BOOST_PERCENT, Math.max(0, percent));
  return clamped / 100;
}

/** 100% 를 넘겼는가 — 게이지 색(주황) 판정에 쓴다. **순수 함수.** */
export function isBoosted(percent: number): boolean {
  return Number.isFinite(percent) && percent > 100;
}

/**
 * 이 요소의 그래프를 만들거나 가져온다. 실패하면 null — 소리는 원래대로 나온다.
 * (Web Audio 가 막힌 환경에서도 확장이 소리를 없애면 안 된다.)
 */
export function ensureGraph(video: HTMLMediaElement): AudioGraph | null {
  const existing = graphs.get(video);
  if (existing) return existing;

  try {
    const context = new AudioContext();
    const source = context.createMediaElementSource(video);
    const gain = context.createGain();
    const compressor = context.createDynamicsCompressor();
    // 기본 경로: 증폭만 거친다. 컴프레서는 켤 때 사이에 끼운다.
    source.connect(gain);
    gain.connect(context.destination);
    const graph: AudioGraph = { context, source, gain, compressor, compressorEnabled: false };
    graphs.set(video, graph);
    return graph;
  } catch (e) {
    warning('failed to build the audio graph; keeping the default audio path', e);
    return null;
  }
}

/** 컨텍스트를 깨운다. 사용자 제스처 전에는 실패하는 것이 정상이라 조용히 넘긴다. */
export function resumeGraph(graph: AudioGraph): void {
  void graph.context.resume?.()?.catch?.(() => undefined);
}

/**
 * 증폭을 적용한다. 100% 이하도 그대로 반영한다 — 그래프에 연결된 뒤에는 여기가 유일한 음량 경로다.
 * `setValueAtTime` 을 쓰면 값이 튀지 않는다.
 */
export function applyBoost(graph: AudioGraph, percent: number): void {
  const value = boostToGain(percent);
  try {
    graph.gain.gain.setValueAtTime(value, graph.context.currentTime);
  } catch {
    graph.gain.gain.value = value;
  }
}

export function applyCompressorParams(graph: AudioGraph, params: CompressorParams): void {
  const now = graph.context.currentTime;
  const set = (param: AudioParam, value: number) => {
    try {
      param.setValueAtTime(value, now);
    } catch {
      param.value = value;
    }
  };
  set(graph.compressor.threshold, params.threshold);
  set(graph.compressor.knee, params.knee);
  set(graph.compressor.ratio, params.ratio);
  set(graph.compressor.attack, params.attack);
  set(graph.compressor.release, params.release);
}

/**
 * 컴프레서를 그래프에 끼우거나 뺀다. **멱등**하다.
 * 켜짐: source → compressor → gain → destination / 꺼짐: source → gain → destination
 */
export function setCompressorEnabled(graph: AudioGraph, enabled: boolean): void {
  if (graph.compressorEnabled === enabled) return;

  const reconnect = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      warning('failed to rewire the compressor node', e);
    }
  };

  if (enabled) {
    reconnect(() => graph.source.disconnect());
    reconnect(() => graph.source.connect(graph.compressor));
    reconnect(() => graph.compressor.connect(graph.gain));
  } else {
    reconnect(() => graph.source.disconnect());
    reconnect(() => graph.compressor.disconnect());
    reconnect(() => graph.source.connect(graph.gain));
  }
  graph.compressorEnabled = enabled;
}
