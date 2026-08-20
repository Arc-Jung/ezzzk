/**
 * 오디오 파이프라인 — 볼륨 100% 초과 증폭(FR-03.2) · 컴프레서(FR-19).
 *
 * jsdom 에는 Web Audio 가 없다. 여기서는 **순수 계산과 배선 계약**을 고정하고, 실제 증폭이
 * 동작하는지는 실브라우저 프로브(`scripts/probe-volume-boost.mjs`)가 이미 증명했다
 * (게인 전/후 RMS 비율 gain 2 에서 정확히 2.000).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_COMPRESSOR,
  MAX_BOOST_PERCENT,
  applyBoost,
  boostToGain,
  ensureGraph,
  CLIPPING_RISK_PERCENT,
  isBoosted,
  isClippingRisk,
  setCompressorEnabled,
  volumeGaugeColor,
  type AudioGraph,
} from './audioPipeline';

describe('boostToGain — 퍼센트를 배율로', () => {
  it('100% 는 1배, 200% 는 2배다', () => {
    expect(boostToGain(100)).toBe(1);
    expect(boostToGain(200)).toBe(2);
  });

  it('50% 는 0.5배다 (증폭 전 구간도 이 경로를 쓴다)', () => {
    expect(boostToGain(50)).toBe(0.5);
  });

  it(`상한 ${MAX_BOOST_PERCENT}% 를 넘기지 않는다 — 그 이상은 찢어진다`, () => {
    expect(boostToGain(500)).toBe(MAX_BOOST_PERCENT / 100);
  });

  it('음수·NaN 은 안전한 값으로 떨어진다', () => {
    expect(boostToGain(-10)).toBe(0);
    expect(boostToGain(Number.NaN)).toBe(1);
  });
});

describe('isBoosted — 증폭 구간 판정', () => {
  it('100% 이하는 거짓, 100% 초과는 참이다', () => {
    expect(isBoosted(100)).toBe(false);
    expect(isBoosted(101)).toBe(true);
    expect(isBoosted(200)).toBe(true);
    expect(isBoosted(0)).toBe(false);
  });
});

describe('isClippingRisk — 과증폭(빨강) 구간 판정', () => {
  it(`${CLIPPING_RISK_PERCENT}% 는 거짓, 그 초과는 참이다 — 경계는 "넘을 때"다`, () => {
    expect(isClippingRisk(CLIPPING_RISK_PERCENT)).toBe(false);
    expect(isClippingRisk(CLIPPING_RISK_PERCENT + 1)).toBe(true);
  });

  it('증폭 구간이어도 경계 이하면 거짓이다', () => {
    expect(isBoosted(120)).toBe(true);
    expect(isClippingRisk(120)).toBe(false);
  });

  it('상한 200% 는 참이다', () => {
    expect(isClippingRisk(MAX_BOOST_PERCENT)).toBe(true);
  });

  it('NaN 은 거짓이다 — 알 수 없는 값을 경고로 칠하지 않는다', () => {
    expect(isClippingRisk(Number.NaN)).toBe(false);
  });
});

describe('volumeGaugeColor — 세 단계 색', () => {
  it('기본·증폭·과증폭이 서로 다른 색이다', () => {
    const base = volumeGaugeColor(100);
    const boosted = volumeGaugeColor(120);
    const clipping = volumeGaugeColor(180);
    expect(new Set([base, boosted, clipping]).size).toBe(3);
  });

  it('경계에서 색이 바뀐다', () => {
    expect(volumeGaugeColor(100)).toBe(volumeGaugeColor(50));
    expect(volumeGaugeColor(101)).not.toBe(volumeGaugeColor(100));
    expect(volumeGaugeColor(CLIPPING_RISK_PERCENT + 1)).not.toBe(
      volumeGaugeColor(CLIPPING_RISK_PERCENT),
    );
  });
});

describe('컴프레서 배선 — 멱등하고, 꺼도 소리 경로가 끊기지 않는다', () => {
  function fakeGraph(): { graph: AudioGraph; calls: string[] } {
    const calls: string[] = [];
    const node = (name: string) => ({
      connect: vi.fn((to: { __name?: string }) => calls.push(`${name}→${to.__name ?? '?'}`)),
      disconnect: vi.fn(() => calls.push(`${name}✕`)),
      __name: name,
    });
    const source = node('source');
    const gain = { ...node('gain'), gain: { value: 1, setValueAtTime: vi.fn() } };
    const compressor = {
      ...node('compressor'),
      threshold: { value: 0, setValueAtTime: vi.fn() },
      knee: { value: 0, setValueAtTime: vi.fn() },
      ratio: { value: 0, setValueAtTime: vi.fn() },
      attack: { value: 0, setValueAtTime: vi.fn() },
      release: { value: 0, setValueAtTime: vi.fn() },
    };
    const graph = {
      context: { currentTime: 0, destination: { __name: 'destination' }, resume: vi.fn() },
      source,
      gain,
      compressor,
      compressorEnabled: false,
    } as unknown as AudioGraph;
    return { graph, calls };
  }

  it('켜면 source → compressor → gain 으로 다시 잇는다', () => {
    const { graph, calls } = fakeGraph();
    setCompressorEnabled(graph, true);
    expect(calls).toEqual(['source✕', 'source→compressor', 'compressor→gain']);
    expect(graph.compressorEnabled).toBe(true);
  });

  it('끄면 source → gain 으로 되돌린다 (소리가 사라지면 안 된다)', () => {
    const { graph, calls } = fakeGraph();
    setCompressorEnabled(graph, true);
    calls.length = 0;
    setCompressorEnabled(graph, false);
    expect(calls).toEqual(['source✕', 'compressor✕', 'source→gain']);
    expect(graph.compressorEnabled).toBe(false);
  });

  it('같은 상태로 다시 불러도 배선을 건드리지 않는다 (멱등)', () => {
    const { graph, calls } = fakeGraph();
    setCompressorEnabled(graph, true);
    calls.length = 0;
    setCompressorEnabled(graph, true);
    expect(calls).toEqual([]);
  });

  it('증폭 값은 setValueAtTime 으로 적용한다 (값이 튀지 않게)', () => {
    const { graph } = fakeGraph();
    applyBoost(graph, 180);
    expect(graph.gain.gain.setValueAtTime).toHaveBeenCalledWith(1.8, 0);
  });
});

describe('ensureGraph — Web Audio 가 없는 환경', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** 🔴 확장이 소리를 없애면 안 된다 — 그래프를 못 만들면 원래 경로 그대로 둔다. */
  it('AudioContext 가 없으면 null 을 돌려주고 예외를 던지지 않는다', () => {
    vi.stubGlobal('AudioContext', undefined);
    const video = document.createElement('video');
    expect(() => ensureGraph(video)).not.toThrow();
    expect(ensureGraph(video)).toBeNull();
  });

  it('같은 요소에는 그래프를 한 번만 만든다 (createMediaElementSource 제약)', () => {
    const created: number[] = [];
    class FakeContext {
      currentTime = 0;
      destination = {};
      createMediaElementSource() {
        created.push(1);
        return { connect: vi.fn(), disconnect: vi.fn() };
      }
      createGain() {
        return { connect: vi.fn(), disconnect: vi.fn(), gain: { setValueAtTime: vi.fn() } };
      }
      createDynamicsCompressor() {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }
    }
    vi.stubGlobal('AudioContext', FakeContext);

    const video = document.createElement('video');
    const first = ensureGraph(video);
    const second = ensureGraph(video);

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(created).toHaveLength(1);
  });
});

describe('컴프레서 기본값 — chzzk-plus 와 같은 값', () => {
  it('threshold -50 · knee 40 · ratio 12 · attack 0 · release 0.25', () => {
    expect(DEFAULT_COMPRESSOR).toEqual({
      threshold: -50,
      knee: 40,
      ratio: 12,
      attack: 0,
      release: 0.25,
    });
  });
});
