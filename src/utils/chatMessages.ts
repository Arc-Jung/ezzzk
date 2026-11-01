/** 페이지의 채팅 데이터에서 표시용 닉네임·본문·이모티콘만 읽는다. */
import { CHZZK } from '../constants/class';
import { normalizeText } from './dom';
import { findChatClient, readChatMessage } from './reactFiber';
import { emoticonUrl, nicknameColor, subtitleParts, type SubtitlePart } from './chatPresentation';
export type SubtitleMessage = {
  nickname: string;
  text: string;
  parts?: SubtitlePart[];
  nicknameColor?: string;
};

/** React 노드·문자열에서 원본 순서대로 텍스트와 이모티콘만 읽는다. */
function contentParts(value: unknown): SubtitlePart[] {
  const parts: SubtitlePart[] = [];
  let visited = 0;
  function visit(value: unknown, depth = 0): void {
    if (++visited > 64 || depth > 8) return;
    if (typeof value === 'string') {
      parts.push({ type: 'text', text: value.slice(0, 1000) });
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 64)) visit(item, depth + 1);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (!node.props || typeof node.props !== 'object') return;
    const fields = node.props as Record<string, unknown>;
    if (node.type === 'img') {
      const label = fields.alt ?? fields.title;
      const alt = typeof label === 'string' && label ? label.slice(0, 100) : '[이모티콘]';
      const src = emoticonUrl(fields.src);
      parts.push(src ? { type: 'emoticon', src, alt } : { type: 'text', text: alt });
    } else visit(fields.children, depth + 1);
  }
  visit(value);
  return parts;
}

function subtitleMessage(
  nickname: string,
  rawParts: SubtitlePart[],
  color?: string,
): SubtitleMessage | null {
  const text = normalizeText(
    rawParts.map((part) => (part.type === 'text' ? part.text : part.alt)).join(''),
  ).slice(0, 1000);
  if (!text) return null;
  const parts = subtitleParts(rawParts);
  const safeColor = nicknameColor(color);
  return {
    nickname: normalizeText(typeof nickname === 'string' ? nickname : '').slice(0, 100),
    text,
    ...(parts ? { parts } : {}),
    ...(safeColor ? { nicknameColor: safeColor } : {}),
  };
}

/** React 데이터가 보이지 않는 확장 격리 환경에서도 본문과 닉네임을 분리한다. */
export function readSubtitleSnapshot(root: ParentNode = document): {
  live: boolean;
  messages: SubtitleMessage[];
} {
  const nodes = [...root.querySelectorAll(CHZZK.chatMessage)];
  const anchor = nodes.at(-1);
  // 접힌 채팅은 가상 목록의 행을 모두 지운다. 스크롤러는 남아 있고
  // 같은 상위 클라이언트를 참조하므로 행 존재 여부에 구독을 묶지 않는다.
  const scroller = root.querySelector(CHZZK.chatScroller);
  const client = (scroller && findChatClient(scroller)) || (anchor && findChatClient(anchor));
  const history = client?.messageList;
  if (history !== undefined) {
    const messages = [...history]
      .sort((a, b) => (a.time ?? 0) - (b.time ?? 0))
      .slice(-6)
      .flatMap((message) => {
        const dark = document.documentElement.classList.contains('theme_dark');
        const color = dark
          ? message.displayNicknameColor?.dark
          : message.displayNicknameColor?.light;
        const result = subtitleMessage(
          message.profile?.nickname ?? '',
          contentParts(message.content),
          color,
        );
        return result ? [result] : [];
      });
    return { live: true, messages };
  }
  // 가상 목록은 DOM 순서와 표시 순서가 다를 수 있다. 화면 아래쪽의 최신 메시지를 읽는다.
  const ordered = nodes
    .map((node) => ({ node, top: node.getBoundingClientRect().top }))
    .sort((a, b) => a.top - b.top);
  const messages = ordered.slice(-6).flatMap(({ node }) => {
    const message = readChatMessage(node);
    const author = node.querySelector('[class*="_nickname_"]');
    const nickname = message?.profile?.nickname ?? normalizeText(author?.textContent);
    const dark = document.documentElement.classList.contains('theme_dark');
    const nativeColor = dark
      ? message?.displayNicknameColor?.dark
      : message?.displayNicknameColor?.light;
    const color = nativeColor ?? (author ? getComputedStyle(author).color : undefined);
    if (message?.content !== undefined) {
      const result = subtitleMessage(nickname, contentParts(message.content), color);
      return result ? [result] : [];
    }
    const copy = node.cloneNode(true) as Element;
    copy.querySelectorAll('button, [class*="_nickname_"]').forEach((element) => element.remove());
    const rawParts: SubtitlePart[] = [];
    let visited = 0;
    function visit(element: Node, depth = 0): void {
      if (++visited > 128 || depth > 12) return;
      if (element.nodeType === Node.TEXT_NODE) {
        rawParts.push({ type: 'text', text: (element.textContent ?? '').slice(0, 1000) });
        return;
      }
      if (element instanceof HTMLImageElement) {
        const alt = element.alt || element.title || '[이모티콘]';
        const src = emoticonUrl(element.currentSrc || element.src);
        rawParts.push(src ? { type: 'emoticon', src, alt } : { type: 'text', text: alt });
        return;
      }
      for (const child of element.childNodes) visit(child, depth + 1);
    }
    visit(copy);
    const result = subtitleMessage(nickname, rawParts, color);
    return result ? [result] : [];
  });
  return { live: false, messages };
}

export function readSubtitleMessages(root: ParentNode = document): SubtitleMessage[] {
  return readSubtitleSnapshot(root).messages;
}
