/**
 * NFR-02b 페이지 종류 판별.
 * 라이브 / VOD / 모바일웹을 구분해 해당 기능만 초기화한다. 불필요한 옵저버를 걸지 않는다.
 *
 * ⚠️ `all_frames: true` 라 치지직이 삽입하는 광고·소셜 iframe 에도 주입된다.
 * 대상 프레임이 아니면 즉시 반환해야 한다.
 */

import { ID, PAGE_KIND } from './constants/class';
import { qs } from './utils/dom';

export type PageType =
  /** chzzk.naver.com/live/{channelId} */
  | 'live'
  /** chzzk.naver.com/video/{videoNo} */
  | 'vod'
  /** m.chzzk.naver.com — 완전히 다른 사이트. 화질·볼륨만 지원 */
  | 'mobile-web'
  /** 치지직이지만 플레이어가 없는 페이지(홈·카테고리 등) */
  | 'other'
  /** 치지직 도메인이 아닌 프레임(광고·소셜 iframe 등) — 즉시 반환 대상 */
  | 'unsupported';

export type PageInfo = {
  type: PageType;
  /** 라이브 채널 ID (live 만) */
  channelId: string | null;
  /** VOD 번호 (vod 만) */
  videoNo: string | null;
  /** 이 프레임이 멀티뷰 슬롯으로 로드된 것인지 (FR-14) */
  isSlotFrame: boolean;
};

const LIVE_PATH = /^\/live\/([0-9a-f]{16,})/i;
const VIDEO_PATH = /^\/video\/(\d+)/;

/** 멀티뷰가 슬롯 iframe URL 에 붙이는 마커. 슬롯 안 content script 가 자기 역할을 안다. */
export const SLOT_FRAME_PARAM = 'cmSlot';

export function isMobileHost(hostname: string): boolean {
  return hostname === 'm.chzzk.naver.com';
}

export function isChzzkHost(hostname: string): boolean {
  return hostname === 'chzzk.naver.com' || isMobileHost(hostname);
}

/**
 * URL 만으로 판별한다. DOM 이 아직 없는 document_start 시점에도 쓸 수 있다.
 * DOM 기반 교차 검증은 `refineWithDom` 으로 한다.
 */
export function detectPageType(url: string): PageInfo {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { type: 'unsupported', channelId: null, videoNo: null, isSlotFrame: false };
  }

  if (!isChzzkHost(parsed.hostname)) {
    return { type: 'unsupported', channelId: null, videoNo: null, isSlotFrame: false };
  }

  const isSlotFrame = parsed.searchParams.get(SLOT_FRAME_PARAM) !== null;

  if (isMobileHost(parsed.hostname)) {
    // m.chzzk 은 라이브든 아니든 지원 범위가 같다(화질·볼륨). 별도 세분화가 필요 없다.
    const live = LIVE_PATH.exec(parsed.pathname);
    return {
      type: 'mobile-web',
      channelId: live?.[1] ?? null,
      videoNo: null,
      isSlotFrame,
    };
  }

  const live = LIVE_PATH.exec(parsed.pathname);
  if (live) {
    return { type: 'live', channelId: live[1] ?? null, videoNo: null, isSlotFrame };
  }

  const video = VIDEO_PATH.exec(parsed.pathname);
  if (video) {
    return { type: 'vod', channelId: null, videoNo: video[1] ?? null, isSlotFrame };
  }

  return { type: 'other', channelId: null, videoNo: null, isSlotFrame };
}

/**
 * DOM 으로 교차 검증한다 (NFR-03b: 상태는 URL 패턴만이 아니라 표준 DOM 속성으로 판별).
 * URL 이 /live/ 인데 플레이어가 type_vod 로 렌더되는 경우 등을 잡는다.
 */
export function refineWithDom(info: PageInfo): PageInfo {
  if (info.type === 'unsupported' || info.type === 'mobile-web') return info;

  if (qs(PAGE_KIND.vodMarker)) return { ...info, type: 'vod' };
  if (qs(PAGE_KIND.liveMarker)) return { ...info, type: 'live' };

  // 마커가 아직 없으면 플레이어 컨테이너 ID 로 본다 (라이브는 live_player_layout, VOD 는 player_layout).
  if (qs(ID.vodPlayerLayout) && !qs(ID.livePlayerLayout)) return { ...info, type: 'vod' };
  if (qs(ID.livePlayerLayout)) return { ...info, type: 'live' };

  return info;
}

/** 플레이어가 있는 페이지인가 — 화질·볼륨 기능의 전제 */
export function hasPlayer(type: PageType): boolean {
  return type === 'live' || type === 'vod' || type === 'mobile-web';
}

/** 사이드 채팅(#aside-chatting)이 있는 페이지인가 — FR-04/05/11/15 의 전제 */
export function hasSideChat(type: PageType): boolean {
  return type === 'live';
}

/** 넓은 화면 버튼이 있는 페이지인가 — FR-07 의 전제 (VOD 에도 있고 m.chzzk 에는 없다) */
export function hasWideScreenButton(type: PageType): boolean {
  return type === 'live' || type === 'vod';
}

/** 멀티뷰(FR-14) 진입점을 노출할 페이지인가 */
export function supportsMultiView(type: PageType): boolean {
  return type === 'live';
}
