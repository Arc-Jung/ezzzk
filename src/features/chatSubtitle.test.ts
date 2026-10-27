import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../constants/storage';
import { mergeSettings } from '../storage';
import { decideDevice } from '../device';
import type { FeatureContext } from './types';
import {
  CHAT_SUBTITLE_ID,
  chatSubtitleFeature,
  readSubtitleMessages,
  subtitleBackground,
  subtitleGeometry,
  subtitlePicture,
  subtitleSettings,
} from './chatSubtitle';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('자막형 채팅 저장값과 크기', () => {
  it('상하·좌우 검은 여백을 제외하고 실제 영상 영역을 기준으로 배치한다', () => {
    expect(subtitlePicture(1440, 1000)).toEqual({ width: 1440, height: 810, left: 0, bottom: 95 });
    expect(subtitlePicture(1000, 400)).toEqual({
      width: (400 * 16) / 9,
      height: 400,
      left: (1000 - (400 * 16) / 9) / 2,
      bottom: 0,
    });
  });
  it('기존 사용자 설정을 병합하면 기본 끄기와 자동 3~6줄이 추가된다', () => {
    expect(mergeSettings({ chatFont: { sidePx: 20 } }).chatSubtitle).toEqual(
      DEFAULT_SETTINGS.chatSubtitle,
    );
    expect(subtitleSettings().enabled).toBe(false);
  });

  it('불투명도는 글자색에 영향을 주지 않고 0~100%로 적용된다', () => {
    const settings = subtitleSettings({ backgroundColor: '#123456', backgroundOpacity: 25 });
    expect(subtitleBackground(settings)).toBe('rgba(18, 52, 86, 0.25)');
    expect(settings.textColor).toBe('#ffffff');
    expect(subtitleSettings({ backgroundOpacity: 200 }).backgroundOpacity).toBe(100);
    expect(
      subtitleSettings({ backgroundColor: 'red;display:none', fontPx: NaN }).backgroundColor,
    ).toBe('#000000');
  });

  it.each([
    [412, 232, 3],
    [859, 480, 5],
    [1440, 810, 6],
  ])('%d×%d에서 자동 표시 줄 수는 %d줄이다', (width, height, count) => {
    const geometry = subtitleGeometry(width, height, subtitleSettings());
    expect(geometry.lines).toBe(count);
    expect(geometry.left + geometry.width).toBeLessThanOrEqual(width);
    expect(geometry.lines * geometry.lineHeight + geometry.bottom + 16).toBeLessThanOrEqual(height);
  });

  it('3~6줄 직접 선택을 지원하고 큰 글자·작은 영상에서는 공간에 맞춰 줄인다', () => {
    for (const lines of [3, 4, 5, 6] as const) {
      expect(subtitleGeometry(1440, 810, subtitleSettings({ lines })).lines).toBe(lines);
    }
    const small = subtitleGeometry(320, 180, subtitleSettings({ lines: 6, fontPx: 28 }), true);
    expect(small.lines).toBeGreaterThanOrEqual(3);
    expect(small.lines * small.lineHeight + small.bottom + 16).toBeLessThanOrEqual(180);
  });
});

function chatFixture() {
  document.body.innerHTML = `<div id="live_player_layout"><div class="pzp-pc"><video></video></div></div>
    <aside id="aside-chatting"><div class="_chatting_message_test"><button class="_nickname_test">
    <span class="_text_test">시청자</span></button><span class="_text_test">안녕하세요 <img alt="웃음" src="emoji.png"></span></div></aside>`;
  const player = document.querySelector<HTMLElement>('.pzp-pc')!;
  vi.spyOn(player, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    width: 859,
    height: 480,
    top: 0,
    left: 0,
    right: 859,
    bottom: 480,
    toJSON() {},
  });
  return player;
}

describe('채팅 수집과 표시 생명주기', () => {
  it('닉네임 안 _text_ span을 본문으로 오인하지 않고 이모티콘 대체 문구를 읽는다', () => {
    chatFixture();
    expect(readSubtitleMessages()).toEqual([{ nickname: '시청자', text: '안녕하세요 웃음' }]);
  });

  it('가상 스크롤에서 재사용된 노드의 최신 본문을 읽고 최근 여섯 메시지만 표시한다', () => {
    chatFixture();
    const aside = document.querySelector('aside')!;
    aside.innerHTML = Array.from(
      { length: 12 },
      (_, i) => `<div class="_chatting_message_test">내용${i}</div>`,
    ).join('');
    expect(readSubtitleMessages().map((message) => message.text)).toEqual([
      '내용6',
      '내용7',
      '내용8',
      '내용9',
      '내용10',
      '내용11',
    ]);
    aside.lastElementChild!.textContent = '새 메시지';
    expect(readSubtitleMessages().at(-1)!.text).toBe('새 메시지');
  });

  it('가상 목록의 DOM 순서가 뒤집혀 있어도 화면 아래쪽 최신 메시지를 시간순으로 표시한다', () => {
    chatFixture();
    const aside = document.querySelector('aside')!;
    aside.innerHTML = Array.from(
      { length: 8 },
      (_, i) => `<div class="_chatting_message_test">메시지${7 - i}</div>`,
    ).join('');
    [...aside.children].forEach((node, i) => {
      vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({ top: (7 - i) * 24 } as DOMRect);
    });
    expect(readSubtitleMessages().map((message) => message.text)).toEqual([
      '메시지2',
      '메시지3',
      '메시지4',
      '메시지5',
      '메시지6',
      '메시지7',
    ]);
  });

  it('일반·슬롯 플레이어 안에 표시하고 메시지를 HTML로 실행하지 않으며 해제 시 정리한다', () => {
    vi.useFakeTimers();
    const player = chatFixture();
    const content = document.querySelector('aside ._text_test:last-child')!;
    content.textContent = '<img src=x onerror=alert(1)>';
    const ctx: FeatureContext = {
      settings: mergeSettings({ chatSubtitle: { enabled: true, backgroundOpacity: 25 } }),
      device: decideDevice('mobile'),
      page: { type: 'live', channelId: 'a'.repeat(32), videoNo: null, isSlotFrame: true },
    };
    expect(chatSubtitleFeature.supports(ctx)).toBe(true);
    const stop = chatSubtitleFeature.start(ctx);
    const overlay = document.getElementById(CHAT_SUBTITLE_ID)!;
    expect(overlay.parentElement).toBe(player);
    expect(overlay.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(overlay.querySelector('img')).toBeNull();
    expect(overlay.style.backgroundColor).toBe('rgba(0, 0, 0, 0.25)');
    expect(document.querySelector('aside')).not.toBeNull();
    content.textContent = '새로운 채팅';
    vi.advanceTimersByTime(1000);
    expect(overlay.textContent).toContain('새로운 채팅');
    stop?.();
    expect(document.getElementById(CHAT_SUBTITLE_ID)).toBeNull();
    expect(document.getElementById(`${CHAT_SUBTITLE_ID}-style`)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
