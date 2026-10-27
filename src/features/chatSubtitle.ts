/** 영상 안에 표시하는 읽기 전용 채팅 자막. 원본 채팅·입력·재생 조작은 유지한다. */
import { CHZZK, ID, PLAYER } from '../constants/class';
import { DEFAULT_SETTINGS, type Settings } from '../constants/storage';
import { normalizeText, removeStyle, upsertStyle } from '../utils/dom';
import { findChatClient, readChatMessage } from '../utils/reactFiber';
import type { Feature } from './types';

export const CHAT_SUBTITLE_ID = 'cm-chat-subtitle';
const STYLE_ID = `${CHAT_SUBTITLE_ID}-style`;
export type SubtitleSettings = Settings['chatSubtitle'];
export type SubtitleMessage = { nickname: string; text: string };

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.round(value)))
    : fallback;
}

/** 저장값을 CSS에 넣기 전에 색·수치 범위를 검증한다. 이전 설정에는 기본값을 채운다. */
export function subtitleSettings(value?: Partial<SubtitleSettings>): SubtitleSettings {
  const defaults = DEFAULT_SETTINGS.chatSubtitle;
  const color = (value: unknown, fallback: string) =>
    typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
  return {
    enabled: value?.enabled === true,
    lines: [0, 3, 4, 5, 6].includes(value?.lines ?? -1) ? value!.lines! : 0,
    fontPx: bounded(value?.fontPx, defaults.fontPx, 12, 28),
    textColor: color(value?.textColor, defaults.textColor),
    backgroundColor: color(value?.backgroundColor, defaults.backgroundColor),
    backgroundOpacity: bounded(value?.backgroundOpacity, defaults.backgroundOpacity, 0, 100),
    showNickname: value?.showNickname !== false,
  };
}

export function subtitleBackground(settings: SubtitleSettings): string {
  const hex = settings.backgroundColor.slice(1);
  const rgb = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  return `rgba(${rgb.join(', ')}, ${settings.backgroundOpacity / 100})`;
}

/** object-fit: contain으로 생기는 검은 여백을 제외한 실제 영상 영역. */
export function subtitlePicture(width: number, height: number, aspect = 16 / 9) {
  const pictureWidth = Math.min(width, height * aspect);
  const pictureHeight = pictureWidth / aspect;
  return {
    width: pictureWidth,
    height: pictureHeight,
    left: (width - pictureWidth) / 2,
    bottom: (height - pictureHeight) / 2,
  };
}

/** 컨트롤 여백을 확보하고 영상 높이에 맞춰 3~6줄을 표시한다. */
export function subtitleGeometry(
  width: number,
  height: number,
  settings: SubtitleSettings,
  controlsVisible = false,
): {
  fontPx: number;
  lineHeight: number;
  lines: number;
  width: number;
  left: number;
  bottom: number;
} {
  const bottom = Math.round(
    Math.min(controlsVisible ? 80 : 20, height * (controlsVisible ? 0.25 : 0.08)),
  );
  const fontPx = Math.min(settings.fontPx, Math.max(10, Math.floor((height - bottom - 24) / 4.35)));
  const lineHeight = Math.ceil(fontPx * 1.45);
  const available = Math.max(3, Math.min(6, Math.floor((height - bottom - 24) / lineHeight)));
  const automatic = Math.max(3, Math.min(6, Math.floor((height * 0.28) / lineHeight)));
  return {
    fontPx,
    lineHeight,
    lines: Math.min(settings.lines || automatic, available),
    width: Math.min(720, Math.floor(Math.max(0, width) * (width < 600 ? 0.92 : 0.62))),
    left: Math.round(Math.min(16, Math.max(4, width * 0.025))),
    bottom,
  };
}

/** React 데이터가 보이지 않는 확장 격리 환경에서도 본문과 닉네임을 분리한다. */
export function readSubtitleMessages(root: ParentNode = document): SubtitleMessage[] {
  const nodes = [...root.querySelectorAll(CHZZK.chatMessage)];
  const anchor = nodes.at(-1);
  const history = anchor ? findChatClient(anchor)?.messageList : undefined;
  if (history?.length) {
    return [...history]
      .sort((a, b) => (a.time ?? 0) - (b.time ?? 0))
      .slice(-6)
      .flatMap((message) => {
        const text = typeof message.content === 'string' ? normalizeText(message.content) : '';
        return text
          ? [{ nickname: message.profile?.nickname ?? '', text: text.slice(0, 1000) }]
          : [];
      });
  }
  // 가상 목록은 DOM 순서와 표시 순서가 다를 수 있다. 화면 아래쪽의 최신 메시지를 읽는다.
  const ordered = nodes
    .map((node) => ({ node, top: node.getBoundingClientRect().top }))
    .sort((a, b) => a.top - b.top);
  return ordered.slice(-6).flatMap(({ node }) => {
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
}

export const CHAT_SUBTITLE_CSS = `
#${CHAT_SUBTITLE_ID} {
  position: absolute; z-index: 25; box-sizing: border-box;
  padding: 8px 10px; border-radius: 5px; pointer-events: none;
  text-align: left; text-shadow: 0 1px 2px #000, 0 0 2px #000;
  font-family: system-ui, sans-serif; overflow: hidden;
}
#${CHAT_SUBTITLE_ID}[hidden] { display: none !important; }
#${CHAT_SUBTITLE_ID} .cm-subtitle-lines { overflow: hidden; overflow-wrap: anywhere; }
#${CHAT_SUBTITLE_ID} .cm-subtitle-message { margin: 0; padding: 0; }
#${CHAT_SUBTITLE_ID} .cm-subtitle-author { font-weight: 700; }
`;

export const chatSubtitleFeature: Feature = {
  id: 'chatSubtitle',
  watches: ['chatSubtitle'],
  supports: (ctx) =>
    ctx.page.type === 'live' && subtitleSettings(ctx.settings.chatSubtitle).enabled,
  start: (ctx) => {
    const settings = subtitleSettings(ctx.settings.chatSubtitle);
    upsertStyle(STYLE_ID, CHAT_SUBTITLE_CSS);
    const overlay = document.createElement('div');
    overlay.id = CHAT_SUBTITLE_ID;
    overlay.setAttribute('role', 'region');
    overlay.setAttribute('aria-label', '자막형 채팅');
    // 빠르게 갱신되는 원본 채팅을 스크린 리더가 중복해서 읽지 않게 한다.
    overlay.setAttribute('aria-live', 'off');
    const lines = document.createElement('div');
    lines.className = 'cm-subtitle-lines';
    overlay.appendChild(lines);
    overlay.style.color = settings.textColor;
    overlay.style.backgroundColor = subtitleBackground(settings);
    let mounted: HTMLElement | null = null;
    let observedAside: Element | null = null;
    let previous = '';
    let resize: ResizeObserver | undefined;
    const sync = () => {
      const player = document.querySelector<HTMLElement>(`${ID.livePlayerLayout} ${PLAYER.rootPc}`);
      if (!player) {
        resize?.disconnect();
        playerMutation.disconnect();
        mounted = null;
        mutation.disconnect();
        observedAside = null;
        overlay.remove();
        return;
      }
      if (player !== mounted) {
        resize?.disconnect();
        playerMutation.disconnect();
        mounted = player;
        playerMutation.observe(player, { attributes: true, attributeFilter: ['class'] });
        if (typeof ResizeObserver !== 'undefined') {
          resize = new ResizeObserver(sync);
          resize.observe(player);
        }
      }
      if (overlay.parentElement !== player) player.appendChild(overlay);
      const aside = document.querySelector(ID.asideChatting);
      if (aside !== observedAside) {
        mutation.disconnect();
        observedAside = aside;
        if (aside) mutation.observe(aside, { childList: true, subtree: true, characterData: true });
      }
      const messages = readSubtitleMessages();
      const rect = player.getBoundingClientRect();
      const video = player.querySelector('video');
      const aspect =
        video && video.videoWidth > 0 && video.videoHeight > 0
          ? video.videoWidth / video.videoHeight
          : 16 / 9;
      const picture = subtitlePicture(rect.width, rect.height, aspect);
      const geometry = subtitleGeometry(
        picture.width,
        picture.height,
        settings,
        player.classList.contains('pzp-pc--controls'),
      );
      overlay.hidden =
        messages.length === 0 ||
        rect.width === 0 ||
        rect.height === 0 ||
        (!ctx.page.isSlotFrame && document.getElementById('cm-multiview-stage') !== null);
      overlay.style.width = `${geometry.width}px`;
      overlay.style.left = `${picture.left + geometry.left}px`;
      overlay.style.bottom = `${picture.bottom + geometry.bottom}px`;
      overlay.style.fontSize = `${geometry.fontPx}px`;
      overlay.style.lineHeight = `${geometry.lineHeight}px`;
      lines.style.maxHeight = `${geometry.lines * geometry.lineHeight}px`;
      overlay.dataset['lines'] = String(geometry.lines);
      const next = JSON.stringify(messages);
      if (next !== previous) {
        previous = next;
        lines.replaceChildren(
          ...messages.map((message) => {
            const row = document.createElement('div');
            row.className = 'cm-subtitle-message';
            if (settings.showNickname && message.nickname) {
              const author = document.createElement('span');
              author.className = 'cm-subtitle-author';
              author.textContent = `${message.nickname}: `;
              row.appendChild(author);
            }
            row.appendChild(document.createTextNode(message.text));
            return row;
          }),
        );
      }
      lines.scrollTop = lines.scrollHeight;
    };
    // DOM 갱신을 제한하고, 채팅이 몰릴 때도 주기적으로 동기화한다.
    let pending: ReturnType<typeof setTimeout> | undefined;
    const mutation = new MutationObserver(() => {
      if (pending !== undefined) return;
      pending = setTimeout(() => {
        pending = undefined;
        sync();
      }, 200);
    });
    const playerMutation = new MutationObserver(sync);
    const timer = setInterval(sync, 1000);
    document.addEventListener('fullscreenchange', sync);
    sync();
    return () => {
      clearInterval(timer);
      if (pending !== undefined) clearTimeout(pending);
      mutation.disconnect();
      playerMutation.disconnect();
      resize?.disconnect();
      document.removeEventListener('fullscreenchange', sync);
      overlay.remove();
      removeStyle(STYLE_ID);
    };
  },
};
