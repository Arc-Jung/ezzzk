/**
 * FR-14 부모(멀티뷰 페이지) ↔ 슬롯(iframe 안 content script) postMessage 프로토콜.
 *
 * ⚠️ 확장 페이지에서는 iframe 내부 `video` 를 만질 수 없다 (실측: 크로스 오리진,
 * `contentDocument === null`). 슬롯 제어는 **`all_frames: true` 로 주입된 content script** 만
 * 할 수 있고, 부모와는 postMessage 로만 통신한다.
 *
 * ⚠️ `event.origin` 을 치지직 도메인으로 반드시 검증한다. 검증 없이 받으면 임의 페이지가
 * 슬롯 제어 메시지를 보낼 수 있다.
 */

import { CHZZK_ORIGINS } from '../../constants/class';
import type { SlotIndex } from '../../constants/storage';

/** 프로토콜 식별자. 치지직 자체 메시지와 섞이지 않게 붙인다. */
export const MV_CHANNEL = 'ezzzk/multiview' as const;

/** 부모 → 슬롯 */
export type ParentToSlot =
  | { channel: typeof MV_CHANNEL; dir: 'p2s'; kind: 'enterSlotMode'; slot: SlotIndex }
  | { channel: typeof MV_CHANNEL; dir: 'p2s'; kind: 'exitSlotMode'; slot: SlotIndex }
  | { channel: typeof MV_CHANNEL; dir: 'p2s'; kind: 'setAudio'; slot: SlotIndex; active: boolean }
  | { channel: typeof MV_CHANNEL; dir: 'p2s'; kind: 'setVolume'; slot: SlotIndex; percent: number }
  | {
      channel: typeof MV_CHANNEL;
      dir: 'p2s';
      kind: 'setQuality';
      slot: SlotIndex;
      target: string;
      /**
       * true(활성 슬롯 지시) 면 목표가 목록에 없을 때 최고 화질로 폴백한다.
       * false(비활성 슬롯 대역폭 하향 지시) 면 목표 이하 중 가장 높은 것으로만 대체하고,
       * 그것도 없으면 아무것도 하지 않는다 — 목표를 못 찾았다고 화질을 올리면
       * 대역폭을 아끼려는 원래 의도와 정반대가 된다.
       */
      raiseIfMissing: boolean;
    }
  | {
      channel: typeof MV_CHANNEL;
      dir: 'p2s';
      kind: 'setChatLines';
      slot: SlotIndex;
      lines: number;
    };

/** 슬롯 → 부모 */
export type SlotToParent =
  | {
      channel: typeof MV_CHANNEL;
      dir: 's2p';
      kind: 'ready';
      slot: SlotIndex;
      channelName: string | null;
    }
  | {
      channel: typeof MV_CHANNEL;
      dir: 's2p';
      kind: 'state';
      slot: SlotIndex;
      muted: boolean;
      volumePercent: number;
      quality: string | null;
      online: boolean;
      viewerCount: number | null;
    }
  | {
      channel: typeof MV_CHANNEL;
      dir: 's2p';
      kind: 'chat';
      slot: SlotIndex;
      /** 슬롯 스트립용 최소 필드만 보낸다. 배지·이모티콘 이미지는 렌더하지 않는다. */
      messages: { nickname: string; text: string; color: string | null }[];
    }
  /**
   * 사용자가 이 슬롯의 음소거를 **직접** 풀었다 → 활성 오디오 슬롯으로 승격해 달라.
   * 사용자와 싸우는 대신 의도를 따른다. 승격하면 이전 활성 슬롯이 음소거되므로
   * "오디오는 항상 한 슬롯만"(FR-14) 은 유지된다.
   */
  | { channel: typeof MV_CHANNEL; dir: 's2p'; kind: 'requestAudio'; slot: SlotIndex }
  /**
   * 슬롯 안에서 오디오 단축키(`Alt+Shift+1~4`)를 눌렀다 → 그 슬롯으로 옮겨 달라.
   *
   * 🔴 필요한 이유 (실측 2026-08-18): 슬롯을 한 번 누르면 `document.activeElement` 가 **iframe**
   * 이 되어 키 입력이 슬롯 문서로 간다. 부모의 `window` keydown 리스너는 그 뒤로 아무것도 받지
   * 못해 **단축키가 죽었다.** 프레임이 대신 받아 넘긴다. 여기 `slot` 은 보낸 슬롯이 아니라
   * **눌린 숫자에 해당하는 슬롯**이다 — 부모가 그 슬롯의 존재를 확인하고 옮긴다.
   */
  | { channel: typeof MV_CHANNEL; dir: 's2p'; kind: 'audioShortcut'; slot: SlotIndex }
  | { channel: typeof MV_CHANNEL; dir: 's2p'; kind: 'error'; slot: SlotIndex; reason: string };

export type MvMessage = ParentToSlot | SlotToParent;

/** origin 이 치지직인가. 문자열 비교만 한다 — 부분 일치는 쓰지 않는다. */
export function isAllowedOrigin(origin: string): boolean {
  return (CHZZK_ORIGINS as readonly string[]).includes(origin);
}

/** 프로토콜에 맞는 메시지인지 확인한다. 검증에 실패하면 무시한다. */
export function parseMvMessage(
  data: unknown,
  origin: string,
  expectedDir: 'p2s' | 's2p',
): MvMessage | null {
  if (!isAllowedOrigin(origin)) return null;
  if (typeof data !== 'object' || data === null) return null;
  const msg = data as Record<string, unknown>;
  if (msg.channel !== MV_CHANNEL) return null;
  if (msg.dir !== expectedDir) return null;
  if (typeof msg.kind !== 'string') return null;
  if (typeof msg.slot !== 'number' || msg.slot < 1 || msg.slot > 4) return null;
  return data as MvMessage;
}

/** 슬롯 iframe URL. 슬롯 안 content script 가 자기 역할을 알 수 있도록 마커를 붙인다. */
export function slotFrameUrl(channelId: string, slot: SlotIndex): string {
  const url = new URL(`https://chzzk.naver.com/live/${channelId}`);
  url.searchParams.set('cmSlot', String(slot));
  return url.toString();
}
