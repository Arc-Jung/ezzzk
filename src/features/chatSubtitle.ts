/** 영상 안의 채팅 자막과 입력 버튼. 원본 채팅·재생 조작은 유지한다. */
import { ID, PLAYER } from '../constants/class';
import { DEFAULT_SETTINGS, type Settings } from '../constants/storage';
import { removeStyle, upsertStyle } from '../utils/dom';
import { readSubtitleMessages } from '../utils/chatMessages';
import { watchLatestChat } from '../utils/chatSource';
import { emoticonUrl, nicknameColor } from '../utils/chatPresentation';
export { readSubtitleMessages } from '../utils/chatMessages';
export type { SubtitleMessage } from '../utils/chatMessages';
import type { Feature } from './types';
import { createIconElement } from '../ui/icons';
import {
  CHAT_SUBTITLE_COMPOSE_BUTTON_ID,
  CHAT_SUBTITLE_COMPOSE_EVENT,
  FULLSCREEN_CHAT_POPUP_ID,
} from './fullscreenChat';

export const CHAT_SUBTITLE_ID = 'cm-chat-subtitle';
const STYLE_ID = `${CHAT_SUBTITLE_ID}-style`;
export type SubtitleSettings = Settings['chatSubtitle'];

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
    position:
      value?.position === 'right' || value?.position === 'center'
        ? value.position
        : defaults.position,
    lines: [0, 3, 4, 5, 6].includes(value?.lines ?? -1) ? value!.lines! : 0,
    fontPx: bounded(value?.fontPx, defaults.fontPx, 12, 28),
    textColor: color(value?.textColor, defaults.textColor),
    backgroundColor: color(value?.backgroundColor, defaults.backgroundColor),
    backgroundOpacity: bounded(value?.backgroundOpacity, defaults.backgroundOpacity, 0, 100),
    showNickname: value?.showNickname !== false,
    useNicknameColor: value?.useNicknameColor !== false,
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
  const margin = Math.min(width / 2, Math.round(Math.min(16, Math.max(4, width * 0.025))));
  const overlayWidth = Math.min(
    720,
    Math.floor(Math.max(0, width) * (width < 600 ? 0.92 : 0.62)),
    Math.max(0, width - 2 * margin),
  );
  const left =
    settings.position === 'left'
      ? margin
      : settings.position === 'center'
        ? (width - overlayWidth) / 2
        : width - overlayWidth - margin;
  return {
    fontPx,
    lineHeight,
    lines: Math.min(settings.lines || automatic, available),
    width: overlayWidth,
    left,
    bottom,
  };
}

export const CHAT_SUBTITLE_CSS = `
#${CHAT_SUBTITLE_ID} {
  position: absolute; z-index: 25; box-sizing: border-box;
  padding: 8px 10px; min-height: 60px; border-radius: 5px; pointer-events: none;
  text-align: left; text-shadow: 0 1px 2px #000, 0 0 2px #000;
  font-family: system-ui, sans-serif; overflow: hidden;
}
#${CHAT_SUBTITLE_ID}[hidden] { display: none !important; }
#${CHAT_SUBTITLE_ID}.cm-subtitle--empty { background: transparent !important; }
#${CHAT_SUBTITLE_ID} .cm-subtitle-lines { box-sizing: border-box; padding-right: 44px; overflow: hidden; overflow-wrap: anywhere; }
#${CHAT_SUBTITLE_ID} .cm-subtitle-message { margin: 0; padding: 0; }
#${CHAT_SUBTITLE_ID} .cm-subtitle-author { font-weight: 700; }
#${CHAT_SUBTITLE_ID} .cm-subtitle-compose-row { position: absolute; right: 4px; bottom: 2px; width: 44px; height: 44px; }
#${CHAT_SUBTITLE_COMPOSE_BUTTON_ID} {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%;
  background: transparent; color: #fff; cursor: pointer; pointer-events: auto;
  -webkit-tap-highlight-color: transparent;
}
#${CHAT_SUBTITLE_COMPOSE_BUTTON_ID}::before {
  content: ''; position: absolute; inset: 6px; border-radius: 50%;
  background: #141517cc; border: 1px solid #ffffff55;
}
#${CHAT_SUBTITLE_COMPOSE_BUTTON_ID} svg { position: relative; width: 16px; height: 16px; }
#${CHAT_SUBTITLE_COMPOSE_BUTTON_ID}:focus-visible { outline: 2px solid #00ffa3; outline-offset: -2px; }
#${CHAT_SUBTITLE_ID} .cm-subtitle-emoticon {
  display: inline-block; width: 1.3em; height: 1.3em;
  object-fit: contain; vertical-align: -0.25em;
}
`;

export const chatSubtitleFeature: Feature = {
  id: 'chatSubtitle',
  preserveOnDeviceChange: true,
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
    const composeRow = document.createElement('div');
    composeRow.className = 'cm-subtitle-compose-row';
    const compose = document.createElement('button');
    compose.id = CHAT_SUBTITLE_COMPOSE_BUTTON_ID;
    compose.type = 'button';
    const popupOpen = !!document.getElementById(FULLSCREEN_CHAT_POPUP_ID);
    const composeLabel = popupOpen ? '채팅 입력 닫기' : '채팅 입력 열기';
    compose.setAttribute('aria-label', composeLabel);
    compose.title = composeLabel;
    compose.setAttribute('aria-haspopup', 'dialog');
    compose.setAttribute('aria-controls', FULLSCREEN_CHAT_POPUP_ID);
    compose.setAttribute('aria-expanded', String(popupOpen));
    compose.appendChild(createIconElement('chatBubble'));
    compose.addEventListener('click', (event) => {
      event.stopPropagation();
      compose.dispatchEvent(new Event(CHAT_SUBTITLE_COMPOSE_EVENT, { bubbles: true }));
    });
    for (const type of ['pointerdown', 'pointerup', 'dblclick', 'keydown', 'keyup'])
      compose.addEventListener(type, (event) => event.stopPropagation());
    composeRow.appendChild(compose);
    overlay.appendChild(composeRow);
    overlay.style.color = settings.textColor;
    overlay.style.backgroundColor = subtitleBackground(settings);
    let mounted: HTMLElement | null = null;
    let observedAside: Element | null = null;
    let previous = '';
    let resize: ResizeObserver | undefined;
    const source = watchLatestChat(() => sync());
    const sync = () => {
      const player = document.querySelector<HTMLElement>(`${ID.livePlayerLayout} ${PLAYER.rootPc}`);
      if (!player) {
        resize?.disconnect();
        playerMutation.disconnect();
        mounted = null;
        mutation.disconnect();
        observedAside = null;
        source.reset();
        overlay.remove();
        return;
      }
      if (player !== mounted) {
        source.reset();
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
      if (lines.parentElement !== overlay || composeRow.parentElement !== overlay)
        overlay.replaceChildren(lines, composeRow);
      const aside = document.querySelector(ID.asideChatting);
      if (aside !== observedAside) {
        source.reset();
        mutation.disconnect();
        observedAside = aside;
        if (aside) mutation.observe(aside, { childList: true, subtree: true, characterData: true });
      }
      source.refresh();
      const messages = source.read() ?? readSubtitleMessages();
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
        rect.width === 0 ||
        rect.height === 0 ||
        (!ctx.page.isSlotFrame && document.getElementById('cm-multiview-stage') !== null);
      overlay.style.width = `${geometry.width}px`;
      overlay.style.left = `${picture.left + geometry.left}px`;
      overlay.style.bottom = `${picture.bottom + geometry.bottom}px`;
      overlay.style.fontSize = `${geometry.fontPx}px`;
      lines.hidden = messages.length === 0;
      overlay.classList.toggle('cm-subtitle--empty', messages.length === 0);
      overlay.style.lineHeight = `${geometry.lineHeight}px`;
      lines.style.maxHeight = `${geometry.lines * geometry.lineHeight}px`;
      overlay.dataset['lines'] = String(geometry.lines);
      const next = JSON.stringify(messages);
      if (next !== previous || lines.childElementCount !== messages.length) {
        previous = next;
        lines.replaceChildren(
          ...messages.map((message) => {
            const row = document.createElement('div');
            row.className = 'cm-subtitle-message';
            if (settings.showNickname && message.nickname) {
              const author = document.createElement('span');
              author.className = 'cm-subtitle-author';
              author.textContent = `${message.nickname}: `;
              const color = settings.useNicknameColor
                ? nicknameColor(message.nicknameColor)
                : undefined;
              if (color) author.style.color = color;
              row.appendChild(author);
            }
            if (message.parts) {
              for (const part of message.parts) {
                if (part.type === 'text') row.appendChild(document.createTextNode(part.text));
                else {
                  const src = emoticonUrl(part.src);
                  if (!src) {
                    row.appendChild(document.createTextNode(part.alt));
                    continue;
                  }
                  const image = document.createElement('img');
                  image.className = 'cm-subtitle-emoticon';
                  image.alt = part.alt;
                  image.title = part.alt;
                  image.referrerPolicy = 'no-referrer';
                  image.draggable = false;
                  image.addEventListener(
                    'error',
                    () => image.replaceWith(document.createTextNode(part.alt)),
                    { once: true },
                  );
                  image.src = src;
                  row.appendChild(image);
                }
              }
            } else row.appendChild(document.createTextNode(message.text));
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
    // 미디어 이벤트는 버블링하지 않는다. 캡처로 교체된 video의 재생 이벤트도 받는다.
    const onPlaybackResume = (event: Event) => {
      if (
        !(event.target instanceof HTMLVideoElement) ||
        !event.target.closest(`${ID.livePlayerLayout} ${PLAYER.rootPc}`)
      )
        return;
      source.reset();
      sync();
    };
    const resumeEvents = ['play', 'playing', 'loadedmetadata', 'canplay'] as const;
    for (const type of resumeEvents) document.addEventListener(type, onPlaybackResume, true);
    const timer = setInterval(sync, 1000);
    document.addEventListener('fullscreenchange', sync);
    sync();
    return () => {
      source.dispose();
      clearInterval(timer);
      if (pending !== undefined) clearTimeout(pending);
      mutation.disconnect();
      playerMutation.disconnect();
      resize?.disconnect();
      document.removeEventListener('fullscreenchange', sync);
      for (const type of resumeEvents) document.removeEventListener(type, onPlaybackResume, true);
      overlay.remove();
      removeStyle(STYLE_ID);
    };
  },
};
