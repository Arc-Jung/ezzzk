import { afterEach, describe, expect, it, vi } from 'vitest';
const audio = vi.hoisted(() => ({
  ensureGraph: vi.fn(),
  ensureNormalization: vi.fn(),
  resumeGraph: vi.fn(),
}));
vi.mock('../audioPipeline', () => audio);
import { createAutoVolume, normalizationGain } from './autoVolume';

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});
function setup(level: number) {
  vi.useFakeTimers();
  const video = document.createElement('video');
  Object.defineProperty(video, 'paused', { configurable: true, value: false });
  video.volume = 0.7;
  const parameter = { value: 1, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() };
  const analyser = {
    fftSize: 16,
    getFloatTimeDomainData: (samples: Float32Array) => samples.fill(level),
  };
  const graph = {
    context: { state: 'running', currentTime: 0 },
    gain: { gain: { value: 1 } },
    normalization: { gain: { gain: parameter }, analyser },
  };
  audio.ensureGraph.mockReturnValue(graph);
  audio.ensureNormalization.mockReturnValue(graph.normalization);
  const controller = createAutoVolume(() => [video]);
  return { video, graph, parameter, controller };
}

describe('자동 음량', () => {
  it('큰 소리와 작은 소리를 같은 RMS 목표로 보정하며 무음·비정상 입력은 올리지 않는다', () => {
    expect(normalizationGain(0.4, 0.5)! * 0.4).toBeCloseTo(0.08);
    expect(normalizationGain(0.04, 0.05)! * 0.04).toBeCloseTo(0.08);
    expect(normalizationGain(0, 0)).toBeNull();
    expect(normalizationGain(0.001, 0.002)).toBeNull();
    expect(normalizationGain(NaN, 1)).toBeNull();
    expect(normalizationGain(0.004, 0.01)).toBe(8);
    expect(normalizationGain(0.1, 2)).toBe(0.4);
  });
  it('기본 꺼짐이며 켜야 측정하고, 끄면 보정 게인을 1로 되돌리고 타이머를 해제한다', () => {
    const { controller, parameter, video } = setup(0.4);
    expect(controller.state()).toBe('off');
    expect(audio.ensureGraph).not.toHaveBeenCalled();
    controller.setEnabled(true);
    expect(controller.state()).toBe('active');
    expect(parameter.setTargetAtTime).toHaveBeenLastCalledWith(expect.closeTo(0.14), 0, 0.15);
    expect(video.volume).toBe(0.7);
    expect(video.muted).toBe(false);
    controller.setEnabled(false);
    expect(parameter.setTargetAtTime).toHaveBeenLastCalledWith(1, 0, 0.1);
    expect(controller.state()).toBe('off');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('무음·음소거·일시정지를 증폭하거나 해제하지 않는다', () => {
    const { controller, parameter, video } = setup(0);
    controller.setEnabled(true);
    expect(parameter.setTargetAtTime).not.toHaveBeenCalled();
    expect(controller.state()).toBe('waiting');
    parameter.value = 3;
    video.muted = true;
    vi.advanceTimersByTime(1000);
    expect(video.muted).toBe(true);
    expect(parameter.setTargetAtTime).toHaveBeenLastCalledWith(1, 0, 0.1);
    controller.dispose();
  });
  it('수동 음량을 낮추면 자동 보정이 그 선택을 다시 키워서 상쇄하지 않는다', () => {
    const { controller, video, graph, parameter } = setup(0.4);
    controller.setEnabled(true);
    expect(parameter.setTargetAtTime).toHaveBeenLastCalledWith(expect.closeTo(0.14), 0, 0.15);
    video.volume = 0.35;
    graph.normalization.analyser.getFloatTimeDomainData = (samples) => samples.fill(0.2);
    vi.advanceTimersByTime(250);
    expect(parameter.setTargetAtTime).toHaveBeenLastCalledWith(expect.closeTo(0.14), 0, 0.15);
    expect(video.volume).toBe(0.35);
    controller.dispose();
  });
  it('오디오 처리 불가를 보고하고 매 틱마다 실패한 그래프를 다시 만들지 않는다', () => {
    const { controller } = setup(0.4);
    audio.ensureGraph.mockReturnValue(null);
    controller.setEnabled(true);
    vi.advanceTimersByTime(1000);
    expect(controller.state()).toBe('unavailable');
    expect(audio.ensureGraph).toHaveBeenCalledTimes(1);
    controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('재생 정책으로 컨텍스트가 정지돼 있으면 대기하며 재개를 시도한다', () => {
    const { controller, graph, parameter } = setup(0.4);
    graph.context.state = 'suspended';
    controller.setEnabled(true);
    expect(controller.state()).toBe('waiting');
    expect(audio.resumeGraph).toHaveBeenCalled();
    expect(parameter.setTargetAtTime).not.toHaveBeenCalled();
    controller.dispose();
  });
});
