import { describe, expect, it, vi } from 'vitest';
import {
  AudioRouter,
  audioPlan,
  effectiveActiveSlot,
  nextActiveSlot,
  slotFromAudioShortcut,
} from './audioRouter';
import type { SlotIndex } from '../../constants/storage';

/**
 * 🔴 정책 변경 (요청 2026-08-20): **모든 슬롯이 소리를 낸다.**
 * 예전에는 활성 슬롯 하나만 소리를 내고 나머지를 강제 음소거했다. 슬롯마다 음소거·볼륨 컨트롤이
 * 있어 사용자가 직접 조절하면 되고, 강제 음소거는 2026-08-15 "켜도 다시 음소거로 돌아간다"
 * 사용자 보고의 원인이기도 했다.
 */
describe('audioPlan — 등록된 슬롯을 전부 들리게 한다', () => {
  it('모든 슬롯이 active 다', () => {
    expect(audioPlan([1, 2, 3, 4])).toEqual([
      { slot: 1, active: true },
      { slot: 2, active: true },
      { slot: 3, active: true },
      { slot: 4, active: true },
    ]);
  });

  it('번호가 비어 있어도 등록된 것만 전부 켠다', () => {
    expect(audioPlan([1, 3])).toEqual([
      { slot: 1, active: true },
      { slot: 3, active: true },
    ]);
  });

  it('슬롯이 없으면 빈 계획이다', () => {
    expect(audioPlan([])).toEqual([]);
  });

  it('음소거 지시(active: false)를 만들지 않는다 — 끄는 것은 사용자 몫이다', () => {
    for (const registered of [[1], [2, 3], [3, 4], [1, 2, 3, 4]] as SlotIndex[][]) {
      expect(audioPlan(registered).every((p) => p.active)).toBe(true);
    }
  });
});

describe('nextActiveSlot — 슬롯이 비워졌을 때', () => {
  it('현재 슬롯이 살아 있으면 유지한다', () => {
    expect(nextActiveSlot([1, 2, 3], 2)).toBe(2);
  });

  it('현재 슬롯이 사라지면 남은 첫 슬롯으로 옮긴다', () => {
    expect(nextActiveSlot([1, 3], 2)).toBe(1);
    expect(nextActiveSlot([3, 4], 1)).toBe(3);
  });

  it('전부 사라지면 1 로 되돌린다', () => {
    expect(nextActiveSlot([], 3)).toBe(1);
  });
});

describe('slotFromAudioShortcut — Alt+Shift+1~4', () => {
  const ev = (init: Partial<KeyboardEventInit> & { code: string }) =>
    new KeyboardEvent('keydown', { altKey: false, shiftKey: false, ...init });

  it('Alt+Shift+숫자를 슬롯 번호로 읽는다', () => {
    for (const n of [1, 2, 3, 4]) {
      expect(slotFromAudioShortcut(ev({ code: `Digit${n}`, altKey: true, shiftKey: true }))).toBe(
        n,
      );
    }
  });

  it('Shift 조합에서 event.key 가 기호로 바뀌어도 code 로 읽어 동작한다', () => {
    const event = new KeyboardEvent('keydown', {
      code: 'Digit1',
      key: '!',
      altKey: true,
      shiftKey: true,
    });
    expect(slotFromAudioShortcut(event)).toBe(1);
  });

  it('Alt 또는 Shift 가 빠지면 대상이 아니다 (FR-04 Alt+1~9 와 충돌 방지)', () => {
    expect(slotFromAudioShortcut(ev({ code: 'Digit1', altKey: true, shiftKey: false }))).toBeNull();
    expect(slotFromAudioShortcut(ev({ code: 'Digit1', altKey: false, shiftKey: true }))).toBeNull();
    expect(slotFromAudioShortcut(ev({ code: 'Digit1' }))).toBeNull();
  });

  it('5 이상·문자 키는 거부한다', () => {
    expect(slotFromAudioShortcut(ev({ code: 'Digit5', altKey: true, shiftKey: true }))).toBeNull();
    expect(slotFromAudioShortcut(ev({ code: 'KeyM', altKey: true, shiftKey: true }))).toBeNull();
  });
});

describe('AudioRouter — 슬롯 추가·전환 시마다 재확인', () => {
  function makeFrame() {
    const postMessage = vi.fn();
    const frame = { contentWindow: { postMessage } } as unknown as HTMLIFrameElement;
    return { frame, postMessage };
  }

  it('슬롯을 등록하면 즉시 전체를 재확인한다', () => {
    const router = new AudioRouter();
    const a = makeFrame();
    router.register(1, a.frame);
    expect(a.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'setAudio', slot: 1, active: true }),
      'https://chzzk.naver.com',
    );
  });

  it('두 번째 슬롯이 붙으면 그 슬롯도 소리를 낸다 (정책 변경 2026-08-20)', () => {
    const router = new AudioRouter();
    const a = makeFrame();
    const b = makeFrame();
    router.register(1, a.frame);
    router.register(2, b.frame);

    for (const frame of [a, b]) {
      expect(frame.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'setAudio', active: true }),
        'https://chzzk.naver.com',
      );
    }
  });
  it('초점을 전환해도 이전 슬롯을 음소거하지 않는다', () => {
    const router = new AudioRouter();
    const a = makeFrame();
    const b = makeFrame();
    router.register(1, a.frame);
    router.register(2, b.frame);
    router.setActive(2);

    const muted = a.postMessage.mock.calls.filter(
      (c) => c[0].kind === 'setAudio' && c[0].active === false,
    );
    expect(muted).toHaveLength(0);
    expect(router.getActive()).toBe(2);
  });
  it('등록되지 않은 슬롯을 지정하면 희망만 기록하고 소리는 등록된 슬롯이 낸다', () => {
    const router = new AudioRouter();
    const a = makeFrame();
    router.register(1, a.frame);
    router.setActive(3);
    // 3번은 아직 없으므로 실제 소리는 1번이 낸다. (희망 3 은 기억되어 등록되면 넘어간다 — B4 회귀 참조)
    expect(router.getActive()).toBe(1);

    const c = makeFrame();
    router.register(3, c.frame);
    expect(router.getActive()).toBe(3);
  });

  it('활성 슬롯을 제거하면 남은 슬롯으로 옮긴다', () => {
    const router = new AudioRouter();
    const a = makeFrame();
    const b = makeFrame();
    router.register(1, a.frame);
    router.register(2, b.frame);
    router.setActive(2);
    router.unregister(2);
    expect(router.getActive()).toBe(1);
  });

  it("postMessage 대상 origin 을 명시한다 ('*' 금지)", () => {
    const router = new AudioRouter();
    const a = makeFrame();
    router.register(1, a.frame);
    for (const call of a.postMessage.mock.calls) {
      expect(call[1]).toBe('https://chzzk.naver.com');
      expect(call[1]).not.toBe('*');
    }
  });

  /**
   * 🔴 정책 변경(2026-08-20) 회귀 고정 — **등록 시점에 한 번만 켠다.**
   * 주기적으로 다시 켜면 사용자가 끈 슬롯이 되살아나 조작을 빼앗는다.
   */
  /**
   * 🔴 회귀 고정 — `register` 는 iframe `load` 와 컨트롤러 `ready` 두 번 불린다. `load` 시점 지시는
   * 컨트롤러가 없어 **유실되므로** 재등록에서 반드시 다시 보내야 한다. "한 번만 보내기"로 막았더니
   * 슬롯이 음소거로 남았다 (실측 2026-08-20 `verify-multiview-audio`, 사용자 클릭 0회).
   */
  it('재등록(ready)에서도 소리 켜기를 다시 보낸다 — load 시점 지시는 유실된다', () => {
    const router = new AudioRouter();
    const a = makeFrame();
    router.register(1, a.frame); // iframe load
    router.register(1, a.frame); // 컨트롤러 ready

    const sends = a.postMessage.mock.calls.filter(
      (c) => c[0].kind === 'setAudio' && c[0].active === true,
    );
    expect(sends).toHaveLength(2);
  });

  it('초점 슬롯을 바꿔도 음소거 지시를 보내지 않는다 (소리는 전부 유지)', () => {
    const router = new AudioRouter();
    const a = makeFrame();
    const b = makeFrame();
    router.register(1, a.frame);
    router.register(2, b.frame);

    router.setActive(2);

    for (const frame of [a, b]) {
      const muteCalls = frame.postMessage.mock.calls.filter(
        (c) => c[0].kind === 'setAudio' && c[0].active === false,
      );
      expect(muteCalls).toHaveLength(0);
    }
  });

  it('조작 바 볼륨은 모든 슬롯에 간다 (마스터 볼륨)', () => {
    const router = new AudioRouter();
    const a = makeFrame();
    const b = makeFrame();
    router.register(1, a.frame);
    router.register(2, b.frame);

    router.setVolume(70);

    for (const frame of [a, b]) {
      expect(frame.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'setVolume', percent: 70 }),
        'https://chzzk.naver.com',
      );
    }
  });
});

describe('effectiveActiveSlot — 희망 슬롯 vs 실제 등록 상태', () => {
  it('등록된 프레임이 없으면 null (아직 지시할 대상이 없다)', () => {
    expect(effectiveActiveSlot([], 1)).toBeNull();
  });

  it('희망 슬롯이 등록되어 있으면 그것을 쓴다', () => {
    expect(effectiveActiveSlot([1, 2, 3], 2)).toBe(2);
  });

  it('희망 슬롯이 없으면 등록된 가장 앞 슬롯으로 대체한다', () => {
    expect(effectiveActiveSlot([2, 3], 1)).toBe(2);
    expect(effectiveActiveSlot([4], 1)).toBe(4);
  });
});

describe('AudioRouter — 프레임 로드 전에 지정된 활성 슬롯 (B4 회귀)', () => {
  function makeFrame() {
    const postMessage = vi.fn();
    return {
      frame: { contentWindow: { postMessage } } as unknown as HTMLIFrameElement,
      postMessage,
    };
  }

  /**
   * 🔴 회귀 고정: `stage.open()` 은 iframe `load` **전에** `setActive(저장된 슬롯)` 을 부른다.
   * 이전 구현은 "프레임이 없다"며 지정을 버려서 저장된 `activeSlot` 이 항상 무시됐다.
   */
  it('프레임 등록 전에 지정한 초점 슬롯이 등록 뒤에도 유지된다', () => {
    const router = new AudioRouter();
    router.setActive(3); // 아직 아무 프레임도 없다
    expect(router.getActive()).toBe(3);

    const a = makeFrame();
    const b = makeFrame();
    router.register(1, a.frame);
    router.register(3, b.frame);

    expect(router.getActive()).toBe(3);
    // 두 슬롯 모두 소리를 낸다 — 초점은 채팅·화질용이지 음소거용이 아니다.
    for (const frame of [a, b]) {
      expect(frame.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'setAudio', active: true }),
        'https://chzzk.naver.com',
      );
    }
  });
  it('희망 슬롯이 끝까지 안 붙어도 등록된 슬롯이 소리를 낸다 (무음 방지)', () => {
    const router = new AudioRouter();
    router.setActive(1); // 1번은 이 구성에 없다
    const c = makeFrame();
    router.register(3, c.frame);

    expect(router.getActive()).toBe(3);
    expect(c.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'setAudio', slot: 3, active: true }),
      'https://chzzk.naver.com',
    );
  });

  it('setVolume 은 실제로 소리 나는 슬롯에 보낸다 (희망 슬롯이 아니라)', () => {
    const router = new AudioRouter();
    router.setActive(1);
    const c = makeFrame();
    router.register(3, c.frame);
    c.postMessage.mockClear();

    router.setVolume(70);
    expect(c.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'setVolume', slot: 3, percent: 70 }),
      'https://chzzk.naver.com',
    );
  });

  it('고장난 슬롯을 unregister 하면 초점이 남은 슬롯으로 넘어간다', () => {
    const router = new AudioRouter();
    const a = makeFrame();
    const b = makeFrame();
    router.register(1, a.frame);
    router.register(2, b.frame);
    router.setActive(1);

    router.unregister(1);

    expect(router.getActive()).toBe(2);
  });
});
