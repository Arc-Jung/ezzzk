import { describe, expect, it } from 'vitest';
import { emoticonUrl, nicknameColor, subtitleParts } from './chatPresentation';
const STREAMER_EMOTE =
  'https://nng-phinf.pstatic.net/glive/subscription/emoji/40adc722447978816ce04cf2f0a70590/1/135_1777373719306.gif?type=f60_60';
const COMMON_EMOTE = 'https://ssl.pstatic.net/static/nng/glive/icon/c_34.png';
describe('채팅 표시 데이터 검증', () => {
  it('스트리머 전용 GIF와 공통 이모티콘의 원본 주소를 유지한다', () => {
    expect(emoticonUrl(STREAMER_EMOTE)).toBe(STREAMER_EMOTE);
    expect(emoticonUrl(COMMON_EMOTE)).toBe(COMMON_EMOTE);
  });
  it.each([
    'javascript:alert(1)',
    'data:image/svg+xml,<svg/>',
    'http://ssl.pstatic.net/static/nng/glive/icon/a.png',
    'https://ssl.pstatic.net.evil.test/static/nng/glive/icon/a.png',
    'https://user:password@ssl.pstatic.net/static/nng/glive/icon/a.png',
    'https://nng-phinf.pstatic.net/profile/user.png',
    'https://example.com/emoji.png',
  ])('외부 실행 주소·프로필 이미지는 표시하지 않는다: %s', (url) =>
    expect(emoticonUrl(url)).toBeNull(),
  );
  it('텍스트/이미지 순서와 대체 문구를 보존하고 추가 필드는 전달하지 않는다', () => {
    expect(
      subtitleParts([
        { type: 'text', text: '안녕 ' },
        { type: 'emoticon', src: STREAMER_EMOTE, alt: '웃음', onerror: 'bad' },
        { type: 'text', text: ' 반가워' },
      ]),
    ).toEqual([
      { type: 'text', text: '안녕 ' },
      { type: 'emoticon', src: STREAMER_EMOTE, alt: '웃음' },
      { type: 'text', text: ' 반가워' },
    ]);
    expect(
      subtitleParts([{ type: 'emoticon', src: 'https://example.com/a.png', alt: '웃음' }]),
    ).toBeUndefined();
  });
  it('이미지·텍스트·조각 수를 제한한다', () => {
    const parts = subtitleParts(
      Array.from({ length: 30 }, () => ({ type: 'emoticon', src: COMMON_EMOTE, alt: '웃음' })),
    )!;
    expect(parts.filter((p) => p.type === 'emoticon')).toHaveLength(20);
    expect(subtitleParts(Array(65).fill({ type: 'text', text: 'x' }))).toBeUndefined();
    const long = subtitleParts([
      { type: 'emoticon', src: COMMON_EMOTE, alt: '웃음' },
      { type: 'text', text: 'x'.repeat(3000) },
    ])!;
    expect(long.map((p) => (p.type === 'text' ? p.text : p.alt)).join('')).toHaveLength(1000);
  });
  it('닉네임에는 원본 HEX/RGB 색상만 허용한다', () => {
    expect(nicknameColor('#9FCE8E')).toBe('#9FCE8E');
    expect(nicknameColor('rgb(159, 206, 142)')).toBe('rgb(159, 206, 142)');
    expect(nicknameColor('red;background:url(https://example.com)')).toBeUndefined();
    expect(nicknameColor('rgb(999,0,0)')).toBeUndefined();
  });
});
