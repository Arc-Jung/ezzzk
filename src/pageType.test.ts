import { describe, expect, it } from 'vitest';
import {
  detectPageType,
  hasPlayer,
  hasSideChat,
  hasWideScreenButton,
  isChzzkHost,
  isMobileHost,
  supportsMultiView,
  SLOT_FRAME_PARAM,
} from './pageType';

describe('detectPageType', () => {
  it('라이브 페이지에서 channelId 를 뽑는다', () => {
    // 실측 조사 대상 채널 (분석 문서 §조사 대상)
    const info = detectPageType('https://chzzk.naver.com/live/0dad8baf12a436f722faa8e5001c5011');
    expect(info.type).toBe('live');
    expect(info.channelId).toBe('0dad8baf12a436f722faa8e5001c5011');
    expect(info.videoNo).toBeNull();
  });

  it('VOD 페이지에서 videoNo 를 뽑는다', () => {
    const info = detectPageType('https://chzzk.naver.com/video/14636773');
    expect(info.type).toBe('vod');
    expect(info.videoNo).toBe('14636773');
    expect(info.channelId).toBeNull();
  });

  it('m.chzzk 은 라이브 경로여도 mobile-web 이다 (완전히 다른 사이트)', () => {
    const info = detectPageType('https://m.chzzk.naver.com/live/0dad8baf12a436f722faa8e5001c5011');
    expect(info.type).toBe('mobile-web');
    // 채널은 알 수 있지만 지원 범위는 화질·볼륨뿐이다.
    expect(info.channelId).toBe('0dad8baf12a436f722faa8e5001c5011');
  });

  it('플레이어 없는 치지직 페이지는 other 다', () => {
    expect(detectPageType('https://chzzk.naver.com/').type).toBe('other');
    expect(detectPageType('https://chzzk.naver.com/category/game').type).toBe('other');
  });

  it('치지직이 아닌 프레임은 unsupported 다 (all_frames 로 주입되는 광고 iframe)', () => {
    expect(detectPageType('https://ad.example.com/banner.html').type).toBe('unsupported');
    expect(detectPageType('about:blank').type).toBe('unsupported');
    expect(detectPageType('not a url').type).toBe('unsupported');
  });

  it('api 서브도메인은 대상이 아니다', () => {
    expect(detectPageType('https://api.chzzk.naver.com/service/v1/lives').type).toBe('unsupported');
  });

  it('슬롯 프레임 마커를 인식한다', () => {
    const url = `https://chzzk.naver.com/live/0dad8baf12a436f722faa8e5001c5011?${SLOT_FRAME_PARAM}=2`;
    const info = detectPageType(url);
    expect(info.type).toBe('live');
    expect(info.isSlotFrame).toBe(true);
    expect(
      detectPageType('https://chzzk.naver.com/live/0dad8baf12a436f722faa8e5001c5011').isSlotFrame,
    ).toBe(false);
  });

  it('http 도 허용한다 (manifest matches 가 *:// 다)', () => {
    expect(
      detectPageType('http://chzzk.naver.com/live/0dad8baf12a436f722faa8e5001c5011').type,
    ).toBe('live');
  });
});

describe('호스트 판별', () => {
  it('isMobileHost / isChzzkHost', () => {
    expect(isMobileHost('m.chzzk.naver.com')).toBe(true);
    expect(isMobileHost('chzzk.naver.com')).toBe(false);
    expect(isChzzkHost('chzzk.naver.com')).toBe(true);
    expect(isChzzkHost('m.chzzk.naver.com')).toBe(true);
    expect(isChzzkHost('api.chzzk.naver.com')).toBe(false);
    expect(isChzzkHost('chzzk.naver.com.evil.example')).toBe(false);
  });
});

describe('페이지별 기능 가용성', () => {
  it('플레이어는 live/vod/mobile-web 에 있다', () => {
    expect(hasPlayer('live')).toBe(true);
    expect(hasPlayer('vod')).toBe(true);
    expect(hasPlayer('mobile-web')).toBe(true);
    expect(hasPlayer('other')).toBe(false);
    expect(hasPlayer('unsupported')).toBe(false);
  });

  it('사이드 채팅은 라이브 전용이다 (VOD·모바일웹에 #aside-chatting 없음)', () => {
    expect(hasSideChat('live')).toBe(true);
    expect(hasSideChat('vod')).toBe(false);
    expect(hasSideChat('mobile-web')).toBe(false);
  });

  it('넓은 화면 버튼은 VOD 에도 있고 모바일웹에는 없다', () => {
    expect(hasWideScreenButton('live')).toBe(true);
    expect(hasWideScreenButton('vod')).toBe(true);
    expect(hasWideScreenButton('mobile-web')).toBe(false);
  });

  it('멀티뷰는 라이브 전용이다', () => {
    expect(supportsMultiView('live')).toBe(true);
    expect(supportsMultiView('vod')).toBe(false);
    expect(supportsMultiView('mobile-web')).toBe(false);
  });
});
