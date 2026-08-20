import { describe, expect, it } from 'vitest';
import { isAllowedOrigin, MV_CHANNEL, parseMvMessage, slotFrameUrl } from './messages';

describe('isAllowedOrigin — postMessage origin 검증', () => {
  it('치지직 도메인 2개만 허용한다', () => {
    expect(isAllowedOrigin('https://chzzk.naver.com')).toBe(true);
    expect(isAllowedOrigin('https://m.chzzk.naver.com')).toBe(true);
  });

  it('유사 도메인·부분 일치를 거부한다', () => {
    expect(isAllowedOrigin('https://chzzk.naver.com.evil.example')).toBe(false);
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
    expect(isAllowedOrigin('http://chzzk.naver.com')).toBe(false);
    expect(isAllowedOrigin('https://api.chzzk.naver.com')).toBe(false);
    expect(isAllowedOrigin('null')).toBe(false);
    expect(isAllowedOrigin('')).toBe(false);
  });
});

describe('parseMvMessage', () => {
  const valid = { channel: MV_CHANNEL, dir: 'p2s', kind: 'enterSlotMode', slot: 2 };

  it('올바른 메시지를 통과시킨다', () => {
    expect(parseMvMessage(valid, 'https://chzzk.naver.com', 'p2s')).toEqual(valid);
  });

  it('허용되지 않은 origin 은 거부한다 (검증 없으면 임의 페이지가 슬롯을 제어한다)', () => {
    expect(parseMvMessage(valid, 'https://evil.example', 'p2s')).toBeNull();
  });

  it('다른 채널·방향의 메시지를 거부한다', () => {
    expect(
      parseMvMessage({ ...valid, channel: 'other' }, 'https://chzzk.naver.com', 'p2s'),
    ).toBeNull();
    expect(parseMvMessage({ ...valid, dir: 's2p' }, 'https://chzzk.naver.com', 'p2s')).toBeNull();
  });

  it('슬롯 번호 범위를 검증한다 (1~4)', () => {
    for (const slot of [0, 5, -1, 99]) {
      expect(parseMvMessage({ ...valid, slot }, 'https://chzzk.naver.com', 'p2s')).toBeNull();
    }
    for (const slot of [1, 2, 3, 4]) {
      expect(parseMvMessage({ ...valid, slot }, 'https://chzzk.naver.com', 'p2s')).not.toBeNull();
    }
  });

  it('형태가 깨진 값을 거부한다', () => {
    for (const bad of [null, undefined, 'string', 42, [], { channel: MV_CHANNEL }]) {
      expect(parseMvMessage(bad, 'https://chzzk.naver.com', 'p2s')).toBeNull();
    }
    expect(parseMvMessage({ ...valid, kind: 123 }, 'https://chzzk.naver.com', 'p2s')).toBeNull();
    expect(parseMvMessage({ ...valid, slot: '2' }, 'https://chzzk.naver.com', 'p2s')).toBeNull();
  });
});

describe('slotFrameUrl', () => {
  it('슬롯 마커를 붙인 라이브 URL 을 만든다', () => {
    const url = slotFrameUrl('0dad8baf12a436f722faa8e5001c5011', 3);
    expect(url).toBe('https://chzzk.naver.com/live/0dad8baf12a436f722faa8e5001c5011?cmSlot=3');
  });

  it('슬롯마다 다른 URL 이다', () => {
    const a = slotFrameUrl('abc123abc123abc1', 1);
    const b = slotFrameUrl('abc123abc123abc1', 2);
    expect(a).not.toBe(b);
  });
});
