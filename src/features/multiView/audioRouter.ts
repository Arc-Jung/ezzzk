/**
 * FR-14 오디오 라우팅.
 *
 * 🔴 **정책 변경 (요청 2026-08-20): 모든 슬롯이 소리를 낸다.**
 * 예전에는 "오디오는 항상 1개 슬롯만"이었다. 슬롯마다 음소거·볼륨 컨트롤이 이미 있어 사용자가
 * 자유롭게 조절할 수 있으므로, 우리가 강제로 하나만 남길 이유가 없다. 강제 음소거는
 * 2026-08-15 "켜도 다시 음소거로 돌아간다" 사용자 보고의 원인이기도 했다.
 *
 * 그래서 이 모듈은 이제 **음소거를 강제하지 않는다.** 남은 역할은 두 가지다.
 * - 슬롯이 등록될 때 **한 번** 소리를 켜 준다 (기본 상태를 "들린다"로 만든다).
 * - `활성 슬롯` 개념은 유지하되 **오디오가 아니라 초점**(사이드 채팅 대상·화질 우선순위·초록
 *   테두리)에만 쓴다.
 *
 * ⚠️ 등록 이후에는 다시 켜지 않는다. 사용자가 끈 슬롯을 우리가 되살리면 조작을 빼앗는다.
 */

import type { SlotIndex } from '../../constants/storage';
import { MV_CHANNEL, type ParentToSlot } from './messages';
import { info } from '../../utils/log';

export type SlotFrames = Map<SlotIndex, HTMLIFrameElement>;

/**
 * 실제로 소리를 낼 슬롯. **순수 함수** — 테스트 대상.
 *
 * 🔴 **희망 슬롯이 아직 등록되지 않았을 수 있다** (실측 결함).
 * `stage.open()` 은 iframe 이 `load` 되기 **전에** 활성 슬롯을 지정한다. 등록된 프레임이
 * 없다고 지정을 버리면 저장된 `activeSlot` 이 사라지고, 1번 슬롯이 배치되지 않은 구성에서는
 * **모든 슬롯이 음소거로 남아 아무 소리도 나지 않는다.**
 * → 희망 슬롯이 등록되어 있으면 그것을, 아니면 **등록된 가장 앞 슬롯**을 쓴다.
 */
export function effectiveActiveSlot(registered: SlotIndex[], desired: SlotIndex): SlotIndex | null {
  if (registered.length === 0) return null;
  if (registered.includes(desired)) return desired;
  return [...registered].sort((a, b) => a - b)[0] ?? null;
}

/**
 * 등록된 슬롯을 **모두** 들리게 하는 지시문 목록. 순수 함수 — 테스트 대상.
 *
 * 🔴 예전에는 `desiredSlot` 하나만 `active: true` 였다(나머지 강제 음소거). 정책 변경으로
 * 전부 참이다 — 끄는 것은 사용자 몫이고, 각 슬롯에 음소거·볼륨 버튼이 있다.
 */
export function audioPlan(slots: SlotIndex[]): { slot: SlotIndex; active: boolean }[] {
  return slots.map((slot) => ({ slot, active: true }));
}

/** 활성 슬롯을 다음 후보로 옮긴다 (슬롯이 비워졌을 때). */
export function nextActiveSlot(slots: SlotIndex[], current: SlotIndex): SlotIndex {
  if (slots.includes(current)) return current;
  return [...slots].sort((a, b) => a - b)[0] ?? 1;
}

/** `Alt+Shift+1~4` 로 눌린 슬롯 번호. 대상이 아니면 null. */
export function slotFromAudioShortcut(event: KeyboardEvent): SlotIndex | null {
  if (!event.altKey || !event.shiftKey) return null;
  // event.code 를 쓴다 — Shift 조합에서는 event.key 가 `!@#$` 로 바뀐다.
  const match = /^Digit([1-4])$/.exec(event.code);
  if (!match) return null;
  return Number(match[1]) as SlotIndex;
}

export class AudioRouter {
  private frames: SlotFrames = new Map();
  /**
   * 사용자가 원하는 슬롯. 프레임 등록 여부와 **무관하게** 기억한다.
   * 등록 전에 지정된 값을 버리면 저장된 구성이 사라진다 (위 `effectiveActiveSlot` 주석 참조).
   */
  private desired: SlotIndex = 1;

  register(slot: SlotIndex, frame: HTMLIFrameElement): void {
    this.frames.set(slot, frame);
    /*
     * 🔴 **등록할 때마다 보낸다.** 처음에는 "슬롯당 한 번"으로 막았는데, `register` 는
     * iframe `load` 와 컨트롤러 `ready` 두 번 불린다 — `load` 시점 지시는 컨트롤러가 아직 없어
     * **유실된다.** 그 상태로 재전송을 막으니 슬롯이 음소거로 남았다
     * (실측 2026-08-20 `verify-multiview-audio`: 슬롯 1 `muted: true`, 사용자 클릭 0회).
     *
     * 사용자 조작을 덮을 위험은 없다: `register` 는 로드·기동 시점에만 불리고, 주기적 재확인
     * (`enforce`) 경로는 이 정책 변경으로 없앴다.
     */
    this.post({ channel: MV_CHANNEL, dir: 'p2s', kind: 'setAudio', slot, active: true });
  }

  unregister(slot: SlotIndex): void {
    this.frames.delete(slot);
    this.desired = nextActiveSlot([...this.frames.keys()], this.desired);
  }

  /**
   * 초점 슬롯을 지정한다 — **오디오가 아니라** 사이드 채팅 대상·화질 우선순위·활성 표시용이다.
   * 소리는 모든 슬롯이 내므로 여기서 음소거를 건드리지 않는다.
   */
  setActive(slot: SlotIndex): void {
    this.desired = slot;
    if (!this.frames.has(slot)) {
      info(`focus slot ${slot} requested before its frame loaded; will apply on register`);
    }
  }

  /** 지금 초점(사이드 채팅·화질 우선순위) 슬롯. 등록된 프레임이 없으면 희망 슬롯을 그대로 돌려준다. */
  getActive(): SlotIndex {
    return effectiveActiveSlot([...this.frames.keys()], this.desired) ?? this.desired;
  }

  /**
   * 등록된 슬롯을 전부 들리게 만든다. **사용자 요청(예: 조작 바 '전체 소리 켜기')에만 쓴다.**
   * 주기적으로 부르면 사용자가 끈 슬롯을 되살리게 되므로 자동 호출 경로를 두지 않는다.
   */
  unmuteAll(): void {
    for (const { slot, active } of audioPlan([...this.frames.keys()])) {
      this.post({ channel: MV_CHANNEL, dir: 'p2s', kind: 'setAudio', slot, active });
    }
  }

  /** 조작 바 볼륨은 **모든 슬롯**에 적용한다 (마스터 볼륨). 개별 조절은 슬롯 안 컨트롤로 한다. */
  setVolume(percent: number): void {
    for (const slot of this.frames.keys()) {
      this.post({ channel: MV_CHANNEL, dir: 'p2s', kind: 'setVolume', slot, percent });
    }
  }

  private post(message: ParentToSlot): void {
    const frame = this.frames.get(message.slot);
    // 대상 origin 을 명시한다 — '*' 로 보내면 임의 페이지가 지시문을 읽을 수 있다.
    frame?.contentWindow?.postMessage(message, 'https://chzzk.naver.com');
  }
}
