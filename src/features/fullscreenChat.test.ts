import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../utils/chatSource', () => ({
  watchLatestChat: () => ({ read: () => null, reset() {}, refresh() {}, dispose() {} }),
}));
import { createElement, useState, act, type ChangeEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_SETTINGS } from '../constants/storage';
import { decideDevice } from '../device';
import {
  fullscreenChatFeature,
  FULLSCREEN_CHAT_BUTTON_ID,
  FULLSCREEN_CHAT_POPUP_ID,
  CHAT_SUBTITLE_COMPOSE_BUTTON_ID,
} from './fullscreenChat';
import { chatSubtitleFeature } from './chatSubtitle';
import type { FeatureContext } from './types';

let stop: (() => void) | void;
let stopOverlay: (() => void) | void;
let fullscreen: Element | null;
const context = (): FeatureContext => ({
  settings: DEFAULT_SETTINGS,
  device: decideDevice('mobile'),
  page: { type: 'live', channelId: 'a'.repeat(32), videoNo: null, isSlotFrame: false },
});
const button = () => document.getElementById(FULLSCREEN_CHAT_BUTTON_ID) as HTMLButtonElement;
const popup = () => document.getElementById(FULLSCREEN_CHAT_POPUP_ID);
const editor = () => popup()!.querySelector('input')!;
const input = () => document.querySelector('#aside-chatting textarea') as HTMLTextAreaElement;
const send = () => popup()!.querySelector('.cm-fullscreen-chat-send') as HTMLButtonElement;
const nativeSend = () => document.querySelector('#aside-chatting button') as HTMLButtonElement;
const enterFullscreen = () => {
  fullscreen = document.getElementById('live_player_layout');
  document.dispatchEvent(new Event('fullscreenchange'));
};
const edit = (text: string) => {
  editor().value = text;
  editor().dispatchEvent(new Event('input', { bubbles: true }));
};
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
  });
  fullscreen = null;
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreen,
  });
  document.body.innerHTML = `<div id="root"><div id="live_player_layout"><div class="pzp-pc pzp-pc--controls">
    <video></video><div class="pzp-pc__bottom-buttons-right"><button aria-label="기존 버튼"></button><button class="custom__clip-button" aria-label="클립 만들기"></button><button aria-label="설정"></button></div>
    </div></div><aside id="aside-chatting"><textarea class="_input_test" maxlength="400"></textarea><button class="_send_button_test" disabled>채팅</button></aside></div>`;
  input().addEventListener('input', () => {
    nativeSend().disabled = !input().value.trim();
  });
  stop = fullscreenChatFeature.start(context());
});
afterEach(() => {
  stopOverlay?.();
  stopOverlay = undefined;
  stop?.();
  stop = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('전체화면 채팅 입력', () => {
  const mountOverlay = () => {
    const player = document.querySelector<HTMLElement>('.pzp-pc')!;
    vi.spyOn(player, 'getBoundingClientRect').mockReturnValue({
      width: 640,
      height: 360,
    } as DOMRect);
    document
      .querySelector('#aside-chatting')!
      .insertAdjacentHTML(
        'afterbegin',
        '<div class="_chatting_message_test"><span class="_nickname_test">시청자</span><span class="_text_test">안녕하세요</span></div>',
      );
    stopOverlay = chatSubtitleFeature.start({
      ...context(),
      settings: {
        ...DEFAULT_SETTINGS,
        chatSubtitle: { ...DEFAULT_SETTINGS.chatSubtitle, enabled: true },
      },
    });
    return document.getElementById(CHAT_SUBTITLE_COMPOSE_BUTTON_ID) as HTMLButtonElement;
  };
  it('오버레이 말풍선으로 팝업을 열고 같은 원본 채팅에 전송하며 닫으면 초점을 돌려준다', () => {
    const compose = mountOverlay();
    const playbackClick = vi.fn();
    document.querySelector('.pzp-pc')!.addEventListener('click', playbackClick);
    const sent: string[] = [];
    nativeSend().addEventListener('click', () => {
      sent.push(input().value);
      input().value = '';
    });
    enterFullscreen();
    compose.click();
    expect(fullscreen!.contains(popup())).toBe(true);
    expect(compose.getAttribute('aria-expanded')).toBe('true');
    edit('오버레이에서 한글 전송');
    popup()!.querySelector<HTMLButtonElement>('.cm-fullscreen-chat-send')!.click();
    expect(sent).toEqual(['오버레이에서 한글 전송']);
    expect(editor().value).toBe('');
    popup()!.querySelector<HTMLButtonElement>('[aria-label="채팅 입력 닫기"]')!.click();
    expect(document.activeElement).toBe(compose);
    expect(compose.getAttribute('aria-expanded')).toBe('false');
    expect(playbackClick).not.toHaveBeenCalled();
  });
  it('부모 문서가 전체화면인 멀티뷰 슬롯에서도 로컬 채팅 입력을 사용한다', () => {
    const compose = mountOverlay();
    const sent: string[] = [];
    nativeSend().addEventListener('click', () => sent.push(input().value));
    expect(button().hidden).toBe(true);
    compose.click();
    expect(document.querySelector('.pzp-pc')!.contains(popup())).toBe(true);
    edit('이 방송 채팅');
    popup()!.querySelector<HTMLButtonElement>('.cm-fullscreen-chat-send')!.click();
    expect(sent).toEqual(['이 방송 채팅']);
  });
  it('아직 채팅이 없어도 말풍선 버튼으로 입력을 시작할 수 있다', async () => {
    const compose = mountOverlay();
    document.querySelector('._chatting_message_test')!.remove();
    await vi.advanceTimersByTimeAsync(1000);
    const overlay = compose.closest<HTMLElement>('#cm-chat-subtitle')!;
    expect(overlay.hidden).toBe(false);
    expect(overlay.classList.contains('cm-subtitle--empty')).toBe(true);
    expect(overlay.querySelector<HTMLElement>('.cm-subtitle-lines')!.hidden).toBe(true);
    enterFullscreen();
    compose.click();
    expect(editor().disabled).toBe(false);
  });
  it('전체화면에서만 버튼을 표시하고 클립 바로 왼쪽에 놓는다', async () => {
    expect(button().hidden).toBe(true);
    expect(button().nextElementSibling?.getAttribute('aria-label')).toBe('클립 만들기');
    enterFullscreen();
    expect(button().hidden).toBe(false);
    document.querySelector('.custom__clip-button')!.remove();
    document
      .querySelector('.pzp-pc__bottom-buttons-right')!
      .insertAdjacentHTML('beforeend', '<button aria-label="클립 만들기"></button>');
    await vi.advanceTimersByTimeAsync(200);
    expect(button().nextElementSibling?.getAttribute('aria-label')).toBe('클립 만들기');
    button().click();
    expect(fullscreen!.contains(popup())).toBe(true);
    expect(popup()?.getAttribute('role')).toBe('dialog');
    expect(document.activeElement).toBe(editor());
  });
  it('원본 초안을 가져와 편집하고 닫기·전체화면 종료 후에도 유지한다', () => {
    input().value = '작성 중';
    enterFullscreen();
    button().click();
    expect(editor().value).toBe('작성 중');
    edit('한글 초안');
    expect(input().value).toBe('한글 초안');
    popup()!.querySelector<HTMLButtonElement>('[aria-label="채팅 입력 닫기"]')!.click();
    expect(popup()).toBeNull();
    expect(input().value).toBe('한글 초안');
    button().click();
    expect(editor().value).toBe('한글 초안');
    fullscreen = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(popup()).toBeNull();
    expect(button().hidden).toBe(true);
    expect(input().value).toBe('한글 초안');
  });
  it('Enter는 원본 버튼을 한 번 누르고 한글 조합·빈 입력은 전송하지 않는다', async () => {
    const clicked = vi.fn();
    nativeSend().addEventListener('click', () => {
      clicked();
      input().value = '';
    });
    enterFullscreen();
    button().click();
    edit('테스트');
    editor().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
    );
    editor().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    editor().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(clicked).not.toHaveBeenCalled();
    editor().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    editor().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(editor().value).toBe('');
    edit('두 번째');
    send().click();
    expect(clicked).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1250);
    send().click();
    expect(clicked).toHaveBeenCalledTimes(2);
  });
  it('원본에서 전송이 금지되거나 입력창이 사라지면 전송하지 않는다', async () => {
    const clicked = vi.fn();
    nativeSend().addEventListener('click', clicked);
    enterFullscreen();
    button().click();
    edit('전송 금지');
    nativeSend().disabled = true;
    await vi.advanceTimersByTimeAsync(250);
    expect(send().disabled).toBe(true);
    editor().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    editor().dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertLineBreak',
        bubbles: true,
        cancelable: true,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(clicked).not.toHaveBeenCalled();
    input().remove();
    await vi.advanceTimersByTimeAsync(250);
    expect(editor().disabled).toBe(true);
    expect(send().disabled).toBe(true);
  });
  it.each(['insertLineBreak', 'insertParagraph', 'insertText'])(
    'Android의 keydown 없는 %s 입력으로 마지막 한글까지 한 번만 전송한다',
    async (inputType) => {
      const sent: string[] = [];
      nativeSend().addEventListener('click', () => {
        sent.push(input().value);
        input().value = '';
      });
      enterFullscreen();
      button().click();
      expect(editor().getAttribute('enterkeyhint')).toBe('send');
      editor().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      edit('아옹아오');
      editor().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      // Android IME가 Enter keydown을 보내지 않고 최종 글자와 줄바꿈 의도만 전달한다.
      editor().value = '아옹아옹';
      const newline = new InputEvent('beforeinput', {
        inputType,
        data: inputType === 'insertText' ? '\n' : null,
        bubbles: true,
        cancelable: true,
      });
      editor().dispatchEvent(newline);
      expect(newline.defaultPrevented).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(sent).toEqual(['아옹아옹']);
      expect(editor().value).toBe('');
    },
  );
  it('줄바꿈 직후 도착한 조합 완료와 마지막 input을 기다리고 조합 확정만으로는 전송하지 않는다', async () => {
    const sent: string[] = [];
    nativeSend().addEventListener('click', () => {
      sent.push(input().value);
      input().value = '';
    });
    enterFullscreen();
    button().click();
    editor().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    edit('마지막 한그');
    editor().dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertLineBreak',
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(sent).toEqual([]);
    editor().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    edit('마지막 한글');
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual(['마지막 한글']);
    await vi.advanceTimersByTimeAsync(1250);
    editor().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    edit('확정만');
    editor().dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        keyCode: 229,
        isComposing: true,
        bubbles: true,
      }),
    );
    editor().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual(['마지막 한글']);
  });
  it('229 keydown 뒤 취소 불가능한 줄바꿈 input도 개행 없이 한 번 전송한다', async () => {
    const sent: string[] = [];
    nativeSend().addEventListener('click', () => {
      sent.push(input().value);
      input().value = '';
    });
    enterFullscreen();
    button().click();
    edit('마지막 한글');
    editor().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Unidentified', keyCode: 229, bubbles: true }),
    );
    editor().dispatchEvent(
      new InputEvent('beforeinput', { inputType: 'insertLineBreak', bubbles: true }),
    );
    editor().value = '마지막\n 한글';
    editor().dispatchEvent(
      new InputEvent('input', { inputType: 'insertLineBreak', bubbles: true }),
    );
    editor().dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual(['마지막 한글']);
    expect(editor().value).toBe('');
  });
  it('조합 중 입력과 붙여넣기로 자동 전송하지 않고 한 줄 입력만 유지한다', async () => {
    const clicked = vi.fn();
    nativeSend().addEventListener('click', clicked);
    enterFullscreen();
    button().click();
    edit('한글');
    editor().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const composing = new InputEvent('beforeinput', {
      inputType: 'insertLineBreak',
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    editor().dispatchEvent(composing);
    expect(composing.defaultPrevented).toBe(false);
    editor().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    editor().value = '붙여넣은\n여러 줄';
    editor().dispatchEvent(
      new InputEvent('input', {
        inputType: 'insertFromPaste',
        data: '붙여넣은\n여러 줄',
        bubbles: true,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(clicked).not.toHaveBeenCalled();
    expect(editor().type).toBe('text');
    expect(input().value).toBe('붙여넣은여러 줄');
  });
  it.each(['Enter', 'Shift+Enter', 'form'])('%s는 줄바꿈 대신 한 번 전송한다', (method) => {
    const sent: string[] = [];
    nativeSend().addEventListener('click', () => {
      sent.push(input().value);
      input().value = '';
    });
    enterFullscreen();
    button().click();
    edit('한 줄 채팅');
    expect(send().textContent).toBe('전송');
    expect(popup()!.textContent).not.toContain('줄바꿈');
    if (method === 'form')
      popup()!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    else
      editor().dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          shiftKey: method === 'Shift+Enter',
          bubbles: true,
          cancelable: true,
        }),
      );
    expect(sent).toEqual(['한 줄 채팅']);
    expect(editor().value).toBe('');
  });
  it('Enter keydown과 beforeinput이 모두 와도 중복 전송하지 않고 닫힌 팝업의 예약 전송을 취소한다', async () => {
    const clicked = vi.fn();
    nativeSend().addEventListener('click', clicked);
    enterFullscreen();
    button().click();
    edit('한 번');
    editor().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    editor().dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertLineBreak',
        bubbles: true,
        cancelable: true,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(clicked).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1250);
    edit('닫기 전 초안');
    editor().dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertLineBreak',
        bubbles: true,
        cancelable: true,
      }),
    );
    popup()!.querySelector<HTMLButtonElement>('[aria-label="채팅 입력 닫기"]')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(input().value).toBe('닫기 전 초안');
  });
  it('팝업 클릭·타이핑이 플레이어로 전파되지 않고 해제 시 노드·구독을 정리한다', async () => {
    const clicked = vi.fn();
    const keyed = vi.fn();
    document.getElementById('live_player_layout')!.addEventListener('click', clicked);
    document.getElementById('live_player_layout')!.addEventListener('keydown', keyed);
    enterFullscreen();
    button().click();
    editor().click();
    editor().dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(clicked).not.toHaveBeenCalled();
    expect(keyed).not.toHaveBeenCalled();
    stop?.();
    stop = undefined;
    expect(popup()).toBeNull();
    expect(button()).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['button', 'ime'])(
    'React 제어 입력에서도 %s 전송이 최신 값과 원본의 초기화를 반영한다',
    async (method) => {
      stop?.();
      document.body.replaceChildren();
      const mount = document.createElement('div');
      document.body.append(mount);
      const received: string[] = [];
      function Fixture() {
        const [value, setValue] = useState('원본 초안');
        return createElement(
          'div',
          null,
          createElement(
            'div',
            { id: 'live_player_layout' },
            createElement(
              'div',
              { className: 'pzp-pc pzp-pc--controls' },
              createElement(
                'div',
                { className: 'pzp-pc__bottom-buttons-right' },
                createElement('button', { 'aria-label': '클립 만들기' }),
              ),
            ),
          ),
          createElement(
            'aside',
            { id: 'aside-chatting' },
            createElement('textarea', {
              className: '_input_test',
              value,
              onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setValue(event.target.value),
            }),
            createElement(
              'button',
              {
                className: '_send_button_test',
                disabled: !value.trim(),
                onClick: () => {
                  received.push(value);
                  setValue('');
                },
              },
              '채팅',
            ),
          ),
        );
      }
      const root = createRoot(mount);
      await act(async () => root.render(createElement(Fixture)));
      stop = fullscreenChatFeature.start(context());
      enterFullscreen();
      button().click();
      await act(async () => edit('React 최신 입력'));
      expect(input().value).toBe('React 최신 입력');
      await act(async () => {
        if (method === 'button') send().click();
        else {
          editor().dispatchEvent(
            new InputEvent('beforeinput', {
              inputType: 'insertLineBreak',
              bubbles: true,
              cancelable: true,
            }),
          );
          await vi.advanceTimersByTimeAsync(0);
        }
      });
      await vi.advanceTimersByTimeAsync(250);
      expect(received).toEqual(['React 최신 입력']);
      expect(editor().value).toBe('');
      stop?.();
      stop = undefined;
      await act(async () => root.unmount());
    },
  );
  it('라이브와 슬롯의 개별 플레이어 전체화면을 지원하고 VOD는 제외한다', () => {
    expect(fullscreenChatFeature.supports(context())).toBe(true);
    expect(
      fullscreenChatFeature.supports({ ...context(), page: { ...context().page, type: 'vod' } }),
    ).toBe(false);
    expect(
      fullscreenChatFeature.supports({
        ...context(),
        page: { ...context().page, isSlotFrame: true },
      }),
    ).toBe(true);
  });
});
