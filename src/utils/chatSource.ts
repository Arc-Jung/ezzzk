/// <reference types="@crxjs/vite-plugin/client" />
import sourceFile from './chatSourceMain.ts?script&module';
import type { SubtitleMessage } from './chatMessages';
import { CHAT_SOURCE_CHANNEL, parseChatSourceReply } from './chatSourceProtocol';

const SCRIPT_ID = 'cm-chat-source-main';
let serial = 0;

/** 실패한 모듈 URL은 브라우저가 캐시하므로 재시도에는 새 URL을 쓴다. */
function ensureSourceScript() {
  const previous = document.getElementById(SCRIPT_ID);
  if (previous) {
    const retryAt = previous.dataset['retryAt'];
    if (retryAt === undefined || performance.now() < Number(retryAt)) return;
    previous.remove();
  }
  const script = document.createElement('script');
  script.id = SCRIPT_ID;
  script.type = 'module';
  const url = new URL(chrome.runtime.getURL(sourceFile));
  url.searchParams.set('attempt', String(++serial));
  script.src = url.href;
  script.addEventListener(
    'error',
    () => {
      // 일시적인 로드 실패로 과거 DOM 채팅에 영구 고정되지 않게 복구한다.
      script.dataset['retryAt'] = String(performance.now() + 5000);
    },
    { once: true },
  );
  document.documentElement.appendChild(script);
}

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
  ensureSourceScript();
  return {
    read: () => current,
    refresh() {
      if (disposed || location.pathname !== path || performance.now() - lastRequest < 200) return;
      lastRequest = performance.now();
      ensureSourceScript();
      window.postMessage({ channel: CHAT_SOURCE_CHANNEL, kind: 'read', id, path }, location.origin);
    },
    dispose() {
      disposed = true;
      window.removeEventListener('message', receive);
      current = null;
    },
  };
}
