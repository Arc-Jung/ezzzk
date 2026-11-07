import { afterEach, describe, expect, it, vi } from 'vitest';
const audio = vi.hoisted(() => ({
  ensureGraph: vi.fn(),
  existingGraph: vi.fn(),
  ensureNormalization: vi.fn(),
  resumeGraph: vi.fn(),
  setNormalizationEnabled: vi.fn(),
}));
vi.mock('../audioPipeline', () => audio);
import { createAutoVolume, normalizationGain, averageVolumeTarget } from './autoVolume';
import { autoVolumeLock } from './volumeLock';

afterEach(() => {
  autoVolumeLock.setEnabled(false);
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
  autoVolumeLock.register({
    read: () => ({ percent: video.volume * 100, muted: video.muted }),
    apply: (value) => {
      video.volume = value.percent / 100;
      video.muted = value.muted;
    },
  });
  const controller = createAutoVolume(() => [video]);
  return { video, graph, parameter, controller };
}

describe('자동 음량', () => {
  it('재생 중인 방송의 평균 RMS를 공통 목표로 제한한다', () => {
    expect(averageVolumeTarget([0.02, 0.04, null, 0])).toBeCloseTo(0.03);
    expect(averageVolumeTarget([0.4, 0.2, NaN])).toBe(0.08);
    expect(averageVolumeTarget([0.004])).toBe(0.02);
  });
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
    expect(audio.setNormalizationEnabled).toHaveBeenLastCalledWith(expect.anything(), true);
    expect(controller.state()).toBe('active');
    expect(parameter.setTargetAtTime).toHaveBeenLastCalledWith(expect.closeTo(0.2), 0, 0.15);
    expect(video.volume).toBe(1);
    expect(video.muted).toBe(false);
    controller.setEnabled(false);
    expect(audio.setNormalizationEnabled).toHaveBeenLastCalledWith(expect.anything(), false);
    expect(parameter.setTargetAtTime).toHaveBeenLastCalledWith(1, 0, 0.1);
    expect(controller.state()).toBe('off');
    // jsdom의 sessionStorage 변경은 0ms storage 이벤트를 예약한다.
    // 이벤트를 전달한 뒤에도 남는 반복 타이머가 없는지 확인한다.
    vi.runOnlyPendingTimers();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('무음을 증폭하지 않고 자동 음량 동안 음소거 변경을 되돌린다', () => {
    const { controller, parameter, video } = setup(0);
    controller.setEnabled(true);
    expect(parameter.setTargetAtTime).not.toHaveBeenCalled();
    expect(controller.state()).toBe('waiting');
    parameter.value = 3;
    video.muted = true;
    vi.advanceTimersByTime(1000);
    expect(video.muted).toBe(false);
    expect(parameter.setTargetAtTime).toHaveBeenLastCalledWith(1, 0, 0.1);
    controller.dispose();
  });
  it('자동 음량 중 수동 변경은 100%로 되돌리고 끄면 이전 값을 복원한다', () => {
    const { controller, video, parameter } = setup(0.4);
    controller.setEnabled(true);
    expect(parameter.setTargetAtTime).toHaveBeenLastCalledWith(expect.closeTo(0.2), 0, 0.15);
    video.volume = 0.35;
    vi.advanceTimersByTime(250);
    expect(parameter.setTargetAtTime).toHaveBeenLastCalledWith(expect.closeTo(0.2), 0, 0.15);
    expect(video.volume).toBe(1);
    controller.dispose();
    expect(video.volume).toBe(0.7);
  });
  it('오디오 처리 불가를 보고하고 매 틱마다 실패한 그래프를 다시 만들지 않는다', () => {
    const { controller } = setup(0.4);
    audio.ensureGraph.mockReturnValue(null);
    controller.setEnabled(true);
    vi.advanceTimersByTime(1000);
    expect(controller.state()).toBe('unavailable');
    expect(audio.ensureGraph).toHaveBeenCalledTimes(1);
    controller.dispose();
    vi.runOnlyPendingTimers();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('재생 정책으로 컨텍스트가 정지돼 있으면 대기하며 재개를 시도한다', () => {
    const { controller, graph, parameter } = setup(0.4);
    graph.context.state = 'suspended';
    controller.setEnabled(true);
    expect(controller.state()).toBe('waiting');
    expect(audio.resumeGraph).toHaveBeenCalled();
    expect(parameter.setTargetAtTime).not.toHaveBeenCalled();
    graph.context.state = 'running';
    vi.advanceTimersByTime(250);
    expect(controller.state()).toBe('active');
    expect(audio.ensureGraph).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
  it('일시정지 후 같은 영상이 재개되면 측정도 다시 시작한다', () => {
    const { controller, parameter, video } = setup(0.4);
    controller.setEnabled(true);
    Object.defineProperty(video, 'paused', { configurable: true, value: true });
    vi.advanceTimersByTime(250);
    expect(controller.state()).toBe('waiting');
    expect(parameter.setTargetAtTime).toHaveBeenLastCalledWith(1, 0, 0.1);
    Object.defineProperty(video, 'paused', { configurable: true, value: false });
    vi.advanceTimersByTime(250);
    expect(controller.state()).toBe('active');
    expect(parameter.setTargetAtTime).toHaveBeenLastCalledWith(expect.closeTo(0.2), 0, 0.15);
    expect(audio.ensureGraph).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
});
