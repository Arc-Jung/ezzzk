/** 페이지의 채팅 데이터에서 표시용 닉네임·본문만 읽는다. */
import { CHZZK } from '../constants/class';
import { normalizeText } from './dom';
import { findChatClient, readChatMessage } from './reactFiber';
export type SubtitleMessage = { nickname: string; text: string };

/** 네이티브가 이모티콘을 React 노드 배열로 바꾼 경우에도 표시용 텍스트만 읽는다. */
function contentText(value: unknown, depth = 0): string {
  if (typeof value === 'string') return value;
  if (depth >= 4) return '';
  if (Array.isArray(value))
    return value
      .slice(0, 100)
      .map((item) => contentText(item, depth + 1))
      .join('');
  if (!value || typeof value !== 'object') return '';
  const node = value as Record<string, unknown>;
  const props = node['props'];
  if (!props || typeof props !== 'object') return '';
  const fields = props as Record<string, unknown>;
  if (node['type'] === 'img') {
    const label = fields['alt'] ?? fields['title'];
    return typeof label === 'string' ? label.slice(0, 100) : '[이모티콘]';
  }
  return contentText(fields['children'], depth + 1);
}

/** React 데이터가 보이지 않는 확장 격리 환경에서도 본문과 닉네임을 분리한다. */
export function readSubtitleSnapshot(root: ParentNode = document): {
  live: boolean;
  messages: SubtitleMessage[];
} {
  const nodes = [...root.querySelectorAll(CHZZK.chatMessage)];
  const anchor = nodes.at(-1);
  const history = anchor ? findChatClient(anchor)?.messageList : undefined;
  if (history !== undefined) {
    const messages = [...history]
      .sort((a, b) => (a.time ?? 0) - (b.time ?? 0))
      .slice(-6)
      .flatMap((message) => {
        const text = normalizeText(contentText(message.content));
        return text
          ? [{ nickname: message.profile?.nickname ?? '', text: text.slice(0, 1000) }]
          : [];
      });
    return { live: true, messages };
  }
  // 가상 목록은 DOM 순서와 표시 순서가 다를 수 있다. 화면 아래쪽의 최신 메시지를 읽는다.
  const ordered = nodes
    .map((node) => ({ node, top: node.getBoundingClientRect().top }))
    .sort((a, b) => a.top - b.top);
  const messages = ordered.slice(-6).flatMap(({ node }) => {
    const message = readChatMessage(node);
    if (typeof message?.content === 'string') {
      const text = normalizeText(message.content);
      return text ? [{ nickname: message.profile?.nickname ?? '', text: text.slice(0, 1000) }] : [];
    }
    const nickname = normalizeText(node.querySelector('[class*="_nickname_"]')?.textContent);
    const copy = node.cloneNode(true) as Element;
    // _text_ 는 닉네임에도 쓰인다. 첫 번째 span을 본문으로 선택하지 않는다.
    copy.querySelectorAll('button, [class*="_nickname_"]').forEach((element) => element.remove());
    copy
      .querySelectorAll('img')
      .forEach((image) => image.replaceWith(image.getAttribute('alt') ?? ''));
    const text = normalizeText(copy.textContent);
    return text ? [{ nickname, text: text.slice(0, 1000) }] : [];
  });
  return { live: false, messages };
}

export function readSubtitleMessages(root: ParentNode = document): SubtitleMessage[] {
  return readSubtitleSnapshot(root).messages;
}
