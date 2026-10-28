import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./chatSourceMain.ts?script&module', () => ({ default: 'chatSource.js' }));
import { watchLatestChat } from './chatSource';
import { CHAT_SOURCE_CHANNEL, parseChatSourceReply } from './chatSourceProtocol';
import { readSubtitleSnapshot } from './chatMessages';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.replaceChildren();
  document.getElementById('cm-chat-source-main')?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('격리 환경의 최신 채팅 소스', () => {
  it('원본 DOM이 예전 채팅에 머물러도 최신 목록을 읽고 원본은 건드리지 않는다', () => {
    document.body.innerHTML =
      '<aside id="aside-chatting"><div class="_chatting_message_test">예전 채팅</div></aside>';
    const el = document.querySelector('aside > div')!;
    const client = {
      messageList: [{ time: 1, content: '새 채팅', profile: { nickname: '시청자' } }],
      messageLimitCount: 200,
    };
    Object.assign(el, { __reactFiber$test: { memoizedProps: { client } } });
    expect(readSubtitleSnapshot()).toEqual({
      live: true,
      messages: [{ nickname: '시청자', text: '새 채팅' }],
    });
    client.messageList = [{ time: 2, content: '다음 채팅', profile: { nickname: '새 시청자' } }];
    expect(readSubtitleSnapshot().messages.at(-1)?.text).toBe('다음 채팅');
    expect(el.textContent).toBe('예전 채팅');
    client.messageList = [];
    expect(readSubtitleSnapshot()).toEqual({ live: true, messages: [] });
  });

  it('최신 이모티콘 메시지도 과거 문자열 채팅으로 되돌리지 않고 표시한다', () => {
    document.body.innerHTML =
      '<aside id="aside-chatting"><div class="_chatting_message_test">예전 채팅</div></aside>';
    Object.assign(document.querySelector('aside > div')!, {
      __reactFiber$test: {
        memoizedProps: {
          client: {
            messageLimitCount: 200,
            messageList: [
              { time: 1, content: '예전 채팅', profile: { nickname: '이전' } },
              {
                time: 2,
                content: ['새 ', { type: 'img', props: { alt: '웃음', src: 'not forwarded' } }],
                profile: { nickname: '현재' },
              },
            ],
          },
        },
      },
    });
    expect(readSubtitleSnapshot().messages.at(-1)).toEqual({ nickname: '현재', text: '새 웃음' });
  });

  it('현재 요청·현재 경로·같은 프레임 응답만 적용하고 해제 후에는 받지 않는다', () => {
    vi.stubGlobal('chrome', {
      runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
    });
    const send = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const changed = vi.fn();
    const source = watchLatestChat(changed);
    stop = source.dispose;
    source.refresh();
    source.refresh();
    expect(send).toHaveBeenCalledTimes(1);
    const request = send.mock.calls[0]![0] as { id: string; path: string };
    const reply = {
      channel: CHAT_SOURCE_CHANNEL,
      kind: 'snapshot',
      ...request,
      live: true,
      messages: [{ nickname: '새 시청자', text: '새 메시지' }],
    };
    // request.kind는 read이므로 응답 종류를 다시 지정한다.
    reply.kind = 'snapshot';
    const receive = (data: unknown, origin = location.origin, from: MessageEventSource = window) =>
      window.dispatchEvent(new MessageEvent('message', { data, origin, source: from }));
    receive({ ...reply, id: 'old-session' });
    receive(reply, 'https://example.com');
    receive({ ...reply, path: '/another-channel' });
    expect(source.read()).toBeNull();
    receive(reply);
    expect(source.read()).toEqual(reply.messages);
    expect(changed).toHaveBeenCalledTimes(1);
    receive(reply);
    expect(changed).toHaveBeenCalledTimes(1);
    source.dispose();
    receive({ ...reply, messages: [] });
    expect(source.read()).toBeNull();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('오버레이로 넘기는 데이터는 제한된 닉네임·본문만 포함한다', () => {
    const reply = parseChatSourceReply({
      channel: CHAT_SOURCE_CHANNEL,
      kind: 'snapshot',
      id: '1',
      path: '/',
      live: true,
      messages: [
        { nickname: 'x'.repeat(200), text: '<img src=x>'.repeat(200), ignored: 'not forwarded' },
      ],
    });
    expect(reply?.messages[0]?.nickname).toHaveLength(100);
    expect(reply?.messages[0]?.text).toHaveLength(1000);
    expect(Object.keys(reply!.messages[0]!)).toEqual(['nickname', 'text']);
    expect(parseChatSourceReply({ ...reply, messages: [{ nickname: 'x', text: {} }] })).toBeNull();
    expect(
      parseChatSourceReply({ ...reply, messages: Array(7).fill({ nickname: 'x', text: 'y' }) }),
    ).toBeNull();
  });
});
