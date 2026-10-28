/** 페이지 실행 환경 전용. 최신 공개 채팅의 닉네임·본문만 응답한다. */
import { readSubtitleSnapshot } from './chatMessages';
import { CHAT_SOURCE_CHANNEL } from './chatSourceProtocol';

const marker = '__ezzzkChatSourceInstalled';
const state = window as unknown as Record<string, unknown>;
if (state[marker] !== true) {
  state[marker] = true;
  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      !event.data ||
      typeof event.data !== 'object'
    )
      return;
    const data = event.data as Record<string, unknown>;
    if (
      data.channel !== CHAT_SOURCE_CHANNEL ||
      data.kind !== 'read' ||
      typeof data.id !== 'string' ||
      data.id.length > 100 ||
      data.path !== location.pathname
    )
      return;
    const snapshot = readSubtitleSnapshot();
    window.postMessage(
      {
        channel: CHAT_SOURCE_CHANNEL,
        kind: 'snapshot',
        id: data.id,
        path: location.pathname,
        ...snapshot,
      },
      location.origin,
    );
  });
}
