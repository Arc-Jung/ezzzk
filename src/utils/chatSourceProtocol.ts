import { nicknameColor, subtitleParts } from './chatPresentation';
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

/** 페이지 실행 환경에서도 제한된 텍스트·이모티콘·닉네임 색상만 전달받는다. */
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
    const parts = subtitleParts(message.parts);
    const color = nicknameColor(message.nicknameColor);
    messages.push({
      nickname: message.nickname.slice(0, 100),
      text: message.text.slice(0, 1000),
      ...(parts ? { parts } : {}),
      ...(color ? { nicknameColor: color } : {}),
    });
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
