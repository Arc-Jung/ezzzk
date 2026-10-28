/// <reference types="@crxjs/vite-plugin/client" />
import sourceFile from './chatSourceMain.ts?script&module';
import type { SubtitleMessage } from './chatMessages';
import { CHAT_SOURCE_CHANNEL, parseChatSourceReply } from './chatSourceProtocol';

const SCRIPT_ID = 'cm-chat-source-main';
let serial = 0;

/** 격리된 content script가 원본 채팅 스크롤과 무관한 최신 목록을 구독한다. */
export function watchLatestChat(onChange: () => void) {
  const id = `${Date.now()}:${++serial}`;
  const path = location.pathname;
  let current: SubtitleMessage[] | null = null;
  let previous = '';
  let lastRequest = -Infinity;
  let disposed = false;
  const receive = (event: MessageEvent<unknown>) => {
    if (disposed || event.source !== window || event.origin !== location.origin) return;
    const reply = parseChatSourceReply(event.data);
    if (!reply || reply.id !== id || reply.path !== path || location.pathname !== path) return;
    const next = reply.live ? reply.messages : null;
    const signature = JSON.stringify(next);
    current = next;
    if (signature !== previous) {
      previous = signature;
      onChange();
    }
  };
  window.addEventListener('message', receive);
  if (!document.getElementById(SCRIPT_ID)) {
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.type = 'module';
    script.src = chrome.runtime.getURL(sourceFile);
    document.documentElement.appendChild(script);
  }
  return {
    read: () => current,
    refresh() {
      if (disposed || location.pathname !== path || Date.now() - lastRequest < 200) return;
      lastRequest = Date.now();
      window.postMessage({ channel: CHAT_SOURCE_CHANNEL, kind: 'read', id, path }, location.origin);
    },
    dispose() {
      disposed = true;
      window.removeEventListener('message', receive);
      current = null;
    },
  };
}
