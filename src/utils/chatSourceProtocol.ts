import type { SubtitleMessage } from './chatMessages';

export const CHAT_SOURCE_CHANNEL = 'ezzzk:chat-source:v1';
export type ChatSourceReply = {
  channel: typeof CHAT_SOURCE_CHANNEL;
  kind: 'snapshot';
  id: string;
  path: string;
  live: boolean;
  messages: SubtitleMessage[];
};

/** 페이지 실행 환경에서 받은 값도 닉네임·일반 텍스트로 제한한다. */
export function parseChatSourceReply(value: unknown): ChatSourceReply | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (
    data.channel !== CHAT_SOURCE_CHANNEL ||
    data.kind !== 'snapshot' ||
    typeof data.id !== 'string' ||
    data.id.length > 100 ||
    typeof data.path !== 'string' ||
    typeof data.live !== 'boolean' ||
    !Array.isArray(data.messages) ||
    data.messages.length > 6
  )
    return null;
  const messages: SubtitleMessage[] = [];
  for (const item of data.messages) {
    if (!item || typeof item !== 'object') return null;
    const message = item as Record<string, unknown>;
    if (typeof message.nickname !== 'string' || typeof message.text !== 'string') return null;
    messages.push({ nickname: message.nickname.slice(0, 100), text: message.text.slice(0, 1000) });
  }
  return {
    channel: CHAT_SOURCE_CHANNEL,
    kind: 'snapshot',
    id: data.id,
    path: data.path,
    live: data.live,
    messages,
  };
}
