import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../utils/chatSource', () => ({
  watchLatestChat: () => ({ read: () => null, reset() {}, refresh() {}, dispose() {} }),
}));

import { mergeSettings } from '../storage';
import { decideDevice } from '../device';
import type { FeatureContext } from './types';
import { CHAT_SUBTITLE_ID, chatSubtitleFeature } from './chatSubtitle';
import { readSubtitleMessages } from '../utils/chatMessages';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
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
  it('화면 크기와 영상 비율이 바뀌면 같은 영상·채팅·입력 버튼을 유지하며 여백 배치를 갱신한다', () => {
    vi.useFakeTimers();
    const player = chatFixture();
    const video = player.querySelector('video')!;
    let width = 1280;
    let height = 1158;
    vi.mocked(player.getBoundingClientRect).mockImplementation(
      () => ({ width, height, left: 0, top: 0, right: width, bottom: height }) as DOMRect,
    );
    const stop = chatSubtitleFeature.start({
      settings: mergeSettings({ chatSubtitle: { enabled: true, useBottomSpace: true } }),
      device: decideDevice('auto'),
      page: { type: 'live', channelId: 'a'.repeat(32), videoNo: null, isSlotFrame: false },
    });
    const overlay = document.getElementById(CHAT_SUBTITLE_ID)!;
    const button = overlay.querySelector('button');
    const row = overlay.querySelector('.cm-subtitle-message');
    expect(overlay.dataset['placement']).toBe('bottom-space');
    width = 915;
    height = 412;
    vi.advanceTimersByTime(1000);
    expect(overlay.dataset['placement']).toBe('video');
    width = 1280;
    height = 1158;
    vi.advanceTimersByTime(1000);
    expect(overlay.dataset['placement']).toBe('bottom-space');
    const controls = document.createElement('div');
    controls.className = 'pzp-pc__bottom';
    player.appendChild(controls);
    vi.spyOn(controls, 'getBoundingClientRect').mockReturnValue({
      top: 1054,
      bottom: 1158,
      height: 104,
    } as DOMRect);
    player.classList.add('pzp-pc--controls');
    vi.advanceTimersByTime(1000);
    expect(overlay.style.bottom).toBe('112px');
    expect(overlay.dataset['lines']).toBe('3');
    Object.defineProperties(video, { videoWidth: { value: 720 }, videoHeight: { value: 1280 } });
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(overlay.dataset['placement']).toBe('video');
    expect(player.querySelector('video')).toBe(video);
    expect(overlay.querySelector('button')).toBe(button);
    expect(overlay.querySelector('.cm-subtitle-message')).toBe(row);
    expect(document.querySelectorAll(`#${CHAT_SUBTITLE_ID}`)).toHaveLength(1);
    stop?.();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('일시정지 중 표시 DOM이 비워져도 playing에서 같은 채팅을 복구하고 새 채팅을 갱신한다', () => {
    vi.useFakeTimers();
    const player = chatFixture();
    const stop = chatSubtitleFeature.start({
      settings: mergeSettings({ chatSubtitle: { enabled: true } }),
      device: decideDevice('auto'),
      page: { type: 'live', channelId: 'a'.repeat(32), videoNo: null, isSlotFrame: false },
    });
    const overlay = document.getElementById(CHAT_SUBTITLE_ID)!;
    const expected = overlay.textContent;
    const lines = overlay.firstElementChild!;
    player.querySelector('video')!.dispatchEvent(new Event('pause'));
    lines.replaceChildren();
    overlay.replaceChildren();
    player.querySelector('video')!.dispatchEvent(new Event('playing'));
    expect(overlay.firstElementChild).toBe(lines);
    expect(overlay.textContent).toBe(expected);
    document.querySelector('aside ._text_test:last-child')!.textContent = '재생 재개 후 새 채팅';
    vi.advanceTimersByTime(1000);
    expect(overlay.textContent).toContain('재생 재개 후 새 채팅');
    stop?.();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('송출 중단으로 플레이어가 사라졌다가 새 video로 돌아오면 즉시 다시 붙는다', () => {
    vi.useFakeTimers();
    const player = chatFixture();
    const stop = chatSubtitleFeature.start({
      settings: mergeSettings({ chatSubtitle: { enabled: true } }),
      device: decideDevice('auto'),
      page: { type: 'live', channelId: 'a'.repeat(32), videoNo: null, isSlotFrame: true },
    });
    const overlay = document.getElementById(CHAT_SUBTITLE_ID)!;
    player.remove();
    vi.advanceTimersByTime(1000);
    expect(overlay.isConnected).toBe(false);
    const replacement = player.cloneNode(false) as HTMLElement;
    replacement.innerHTML = '<video></video>';
    vi.spyOn(replacement, 'getBoundingClientRect').mockReturnValue(player.getBoundingClientRect());
    document.querySelector('#live_player_layout')!.appendChild(replacement);
    document.querySelector('aside ._text_test:last-child')!.textContent = '방송 복구 후 새 채팅';
    replacement.querySelector('video')!.dispatchEvent(new Event('loadedmetadata'));
    expect(overlay.parentElement).toBe(replacement);
    expect(overlay.hidden).toBe(false);
    expect(overlay.textContent).toContain('방송 복구 후 새 채팅');
    stop?.();
    replacement.querySelector('video')!.dispatchEvent(new Event('playing'));
    expect(document.getElementById(CHAT_SUBTITLE_ID)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
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

  it('원본 이모티콘을 그리며 로드 실패 시 대체 문구를 표시하고 닉네임 색상을 끌 수 있다', () => {
    vi.useFakeTimers();
    chatFixture();
    const author = document.querySelector('aside ._nickname_test') as HTMLElement;
    author.style.color = '#9FCE8E';
    const image = document.querySelector('aside img') as HTMLImageElement;
    image.src = 'https://nng-phinf.pstatic.net/glive/subscription/emoji/channel/1/emote.gif';
    const ctx: FeatureContext = {
      settings: mergeSettings({ chatSubtitle: { enabled: true } }),
      device: decideDevice('mobile'),
      page: { type: 'live', channelId: 'a'.repeat(32), videoNo: null, isSlotFrame: false },
    };
    const stop = chatSubtitleFeature.start(ctx);
    const overlay = document.getElementById(CHAT_SUBTITLE_ID)!;
    const emote = overlay.querySelector('img')!;
    expect(emote.src).toBe(image.src);
    expect(emote.alt).toBe('웃음');
    expect(emote.referrerPolicy).toBe('no-referrer');
    expect(overlay.querySelector<HTMLElement>('.cm-subtitle-author')!.style.color).toBe(
      'rgb(159, 206, 142)',
    );
    emote.dispatchEvent(new Event('error'));
    expect(overlay.querySelector('img')).toBeNull();
    expect(overlay.textContent).toContain('웃음');
    stop?.();
    const stopPlain = chatSubtitleFeature.start({
      ...ctx,
      settings: mergeSettings({ chatSubtitle: { enabled: true, useNicknameColor: false } }),
    });
    expect(
      document.querySelector<HTMLElement>('#cm-chat-subtitle .cm-subtitle-author')!.style.color,
    ).toBe('');
    stopPlain?.();
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
