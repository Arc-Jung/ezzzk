/** 전체화면에서 원본 채팅 입력·전송 UI와 연결하는 작은 입력 팝업. */
import { CHZZK, ID, PLAYER } from '../constants/class';
import { LIMITS } from '../constants/storage';
import { removeStyle, setNativeValue, upsertStyle } from '../utils/dom';
import { mountControlBarButton } from './controlBar';
import { createIconElement } from '../ui/icons';
import type { Feature } from './types';

import {
  FULLSCREEN_CHAT_BUTTON_ID,
  FULLSCREEN_CHAT_POPUP_ID,
  CHAT_SUBTITLE_COMPOSE_BUTTON_ID,
  CHAT_SUBTITLE_COMPOSE_EVENT,
} from './chatInputProtocol';
const STYLE_ID = `${FULLSCREEN_CHAT_POPUP_ID}-style`;

// CHZZK mounts a contenteditable editor after the placeholder textarea receives focus.
const ACTIVE_CHAT_EDITOR = `${ID.asideChatting} [class*="_input_"][contenteditable]`;

function isChatPlaceholder(source: HTMLElement | null): source is HTMLTextAreaElement {
  return source instanceof HTMLTextAreaElement && source.matches('[class*="_default_"]');
}

function isChatWritable(source: HTMLElement | null): source is HTMLElement {
  if (source instanceof HTMLTextAreaElement) return !source.disabled && !source.readOnly;
  const editable = source?.getAttribute('contenteditable');
  return editable === '' || editable === 'true' || editable === 'plaintext-only';
}

function readChatDraft(source: HTMLElement | null): string {
  return source instanceof HTMLTextAreaElement ? source.value : (source?.textContent ?? '');
}

function isLineBreak(event: InputEvent) {
  return (
    event.inputType === 'insertLineBreak' ||
    event.inputType === 'insertParagraph' ||
    (event.inputType === 'insertText' && /^\r?\n$/.test(event.data ?? ''))
  );
}

export const fullscreenChatFeature: Feature = {
  id: 'fullscreenChat',
  watches: [],
  preserveOnDeviceChange: true,
  supports: (ctx) => ctx.page.type === 'live',
  start: (ctx) => {
    let button: HTMLButtonElement | null = null;
    let popup: HTMLFormElement | null = null;
    let popupHost: HTMLElement | null = null;
    let invoker: HTMLElement | null = null;
    let openedFullscreen = false;
    let editor: HTMLInputElement | null = null;
    let send: HTMLButtonElement | null = null;
    let note: HTMLParagraphElement | null = null;
    let composing = false;
    let draftPending = false;
    let activatedPlaceholder: HTMLTextAreaElement | null = null;
    let nativeActivationAt = -Infinity;
    let enterTimer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    let lastSentAt = -Infinity;
    let poll: ReturnType<typeof setInterval> | undefined;
    let alive = true;
    const input = () =>
      document.querySelector<HTMLElement>(ACTIVE_CHAT_EDITOR) ??
      document.querySelector<HTMLTextAreaElement>(CHZZK.chatInput);
    const activateNativeEditor = () => {
      const source = input();
      if (!isChatPlaceholder(source) || !isChatWritable(source) || activatedPlaceholder === source)
        return;
      activatedPlaceholder = source;
      nativeActivationAt = performance.now();
      // Run the site's normal focus handler without taking focus from the popup or opening a second keyboard.
      source.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    };
    const nativeSend = () => document.querySelector<HTMLButtonElement>(CHZZK.chatSendButton);
    const fullscreenHost = () => {
      const host = document.fullscreenElement;
      const player = document.querySelector(ID.livePlayerLayout);
      return host instanceof HTMLElement &&
        host.tagName !== 'VIDEO' &&
        player &&
        (host.contains(player) || player.contains(host))
        ? host
        : null;
    };
    upsertStyle(
      STYLE_ID,
      `
#${FULLSCREEN_CHAT_BUTTON_ID}[hidden] { display: none !important; }
/* The site's delayed focus must not move the keyboard back to the native editor. */
body:has(#${FULLSCREEN_CHAT_POPUP_ID}) ${ACTIVE_CHAT_EDITOR} { visibility: hidden !important; }
#${FULLSCREEN_CHAT_POPUP_ID} {
  position: fixed; z-index: 2147483647; box-sizing: border-box;
  right: max(12px, env(safe-area-inset-right)); bottom: var(--cm-chat-bottom, 76px);
  width: min(340px, calc(var(--cm-chat-viewport-width, 100vw) - 24px));
  max-height: calc(var(--cm-chat-viewport-height, 100vh) - var(--cm-chat-visible-bottom, 76px) - 12px); overflow: auto;
  padding: 10px; border: 1px solid #ffffff40; border-radius: 12px;
  background: rgba(20, 21, 23, .94); color: #fff; font: 13px/1.4 sans-serif;
  box-shadow: 0 4px 20px #0006;
}
#${FULLSCREEN_CHAT_POPUP_ID} .cm-fullscreen-chat-header,
#${FULLSCREEN_CHAT_POPUP_ID} .cm-fullscreen-chat-footer { display: flex; align-items: center; gap: 8px; }
#${FULLSCREEN_CHAT_POPUP_ID} .cm-fullscreen-chat-header { justify-content: space-between; }
#${FULLSCREEN_CHAT_POPUP_ID} button {
  box-sizing: border-box; min-width: 44px; min-height: 44px; border: 0;
  border-radius: 8px; background: #ffffff12; color: inherit; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;
}
#${FULLSCREEN_CHAT_POPUP_ID} .cm-fullscreen-chat-editor {
  box-sizing: border-box; display: block; width: 100%; height: 44px; min-height: 44px;
  margin: 6px 0; padding: 8px; resize: none; border: 1px solid #ffffff55;
  border-radius: 8px; background: #0004; color: #fff; font: 16px/1.4 sans-serif;
}
#${FULLSCREEN_CHAT_POPUP_ID} .cm-fullscreen-chat-note { margin: 0; flex: 1; min-width: 0; color: #c5c6ca; font-size: 12px; }
#${FULLSCREEN_CHAT_POPUP_ID} .cm-fullscreen-chat-send { padding: 0 12px; background: #00ffa3; color: #111; }
#${FULLSCREEN_CHAT_POPUP_ID} button:disabled { opacity: .45; cursor: default; }
#${FULLSCREEN_CHAT_POPUP_ID} :focus-visible { outline: 2px solid #00ffa3; outline-offset: 2px; }
`,
    );
    const paintButton = () => {
      if (button) button.hidden = !fullscreenHost();
      for (const node of [button, document.getElementById(CHAT_SUBTITLE_COMPOSE_BUTTON_ID)]) {
        if (!node) continue;
        node.setAttribute('aria-expanded', String(!!popup));
        node.setAttribute('aria-controls', FULLSCREEN_CHAT_POPUP_ID);
        node.setAttribute('aria-haspopup', 'dialog');
        const prefix = node === button ? '전체화면 채팅' : '채팅 입력';
        node.setAttribute('aria-label', `${prefix} ${popup ? '닫기' : '열기'}`);
        node.title = node.getAttribute('aria-label')!;
      }
    };
    const position = () => {
      const viewport = window.visualViewport;
      popup?.style.setProperty('--cm-chat-viewport-width', `${viewport?.width ?? innerWidth}px`);
      popup?.style.setProperty('--cm-chat-viewport-height', `${viewport?.height ?? innerHeight}px`);
      const keyboard = Math.max(
        0,
        innerHeight - (viewport?.height ?? innerHeight) - (viewport?.offsetTop ?? 0),
      );
      const clearance = keyboard > 100 ? 12 : Math.min(76, (viewport?.height ?? innerHeight) * 0.2);
      popup?.style.setProperty('--cm-chat-visible-bottom', `${clearance}px`);
      popup?.style.setProperty('--cm-chat-bottom', `${keyboard + clearance}px`);
    };
    const close = (restoreFocus = false) => {
      const focusTarget = invoker ?? button;
      clearInterval(poll);
      clearTimeout(enterTimer);
      enterTimer = undefined;
      poll = undefined;
      popup?.remove();
      popup = null;
      popupHost = null;
      invoker = null;
      openedFullscreen = false;
      editor = null;
      send = null;
      note = null;
      composing = false;
      draftPending = false;
      activatedPlaceholder = null;
      nativeActivationAt = -Infinity;
      paintButton();
      if (restoreFocus && focusTarget?.isConnected && !focusTarget.closest('[hidden]'))
        focusTarget.focus();
    };
    const copyDraft = () => {
      const source = input();
      if (!editor || !isChatWritable(source) || isChatPlaceholder(source)) return;
      draftPending = false;
      if (readChatDraft(source) === editor.value) return;
      if (source instanceof HTMLTextAreaElement) {
        setNativeValue(source, editor.value);
      } else {
        source.textContent = editor.value;
        source.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      }
    };
    const sync = () => {
      if (!popup || !editor || !send || !note) return;
      const source = input();
      if (
        !popupHost?.isConnected ||
        !popupHost.contains(popup) ||
        (document.fullscreenElement && !document.fullscreenElement.contains(popup))
      ) {
        close();
        return;
      }
      const unavailable = !isChatWritable(source);
      if (editor.disabled !== unavailable) editor.disabled = unavailable;
      if (draftPending) copyDraft();
      else if (source && !composing) {
        const draft = readChatDraft(source);
        if (editor.value !== draft) editor.value = draft;
      }
      const limit =
        source instanceof HTMLTextAreaElement && source.maxLength > 0 ? source.maxLength : 400;
      if (editor.maxLength !== limit) editor.maxLength = limit;
      const placeholder = source?.getAttribute('placeholder') || '채팅을 입력해주세요';
      if (editor.placeholder !== placeholder) editor.placeholder = placeholder;
      const original = nativeSend();
      const disabled =
        busy ||
        unavailable ||
        draftPending ||
        !editor.value.trim() ||
        !original ||
        original.disabled ||
        performance.now() - lastSentAt < LIMITS.chatSendIntervalMs;
      if (send.disabled !== disabled) send.disabled = disabled;
      let message = 'Enter로 전송';
      if (placeholder.includes('로그인')) message = '치지직에 로그인한 뒤 채팅을 보낼 수 있습니다.';
      else if (draftPending && performance.now() - nativeActivationAt < 1000)
        message = '치지직 채팅 입력창을 여는 중입니다.';
      else if (
        unavailable ||
        (editor.value.trim() && (!original || original.disabled || draftPending))
      )
        message = '현재 치지직에서 채팅을 보낼 수 없습니다.';
      if (note.textContent !== message) note.textContent = message;
    };
    const submit = () => {
      if (!editor || composing || busy) return;
      copyDraft();
      const source = input();
      const original = nativeSend();
      if (
        !isChatWritable(source) ||
        isChatPlaceholder(source) ||
        draftPending ||
        !original ||
        original.disabled ||
        !editor.value.trim() ||
        performance.now() - lastSentAt < LIMITS.chatSendIntervalMs
      )
        return;
      // 전송은 사용자가 누른 경우에만 원본 버튼으로 처리한다. 클라이언트 토큰·send API는 사용하지 않는다.
      busy = true;
      send!.disabled = true;
      lastSentAt = performance.now();
      original.click();
      busy = false;
      sync();
    };
    // Android IME는 Enter keydown 대신 beforeinput/input으로 줄바꿈을 전달할 수 있다.
    // 같은 입력 묶음의 최종 한글·input 반영 뒤 전송하고 중복 이벤트는 합친다.
    const queueEnter = () => {
      clearTimeout(enterTimer);
      enterTimer = setTimeout(() => {
        enterTimer = undefined;
        if (!editor || composing) return;
        copyDraft();
        submit();
      }, 0);
    };
    const toggle = (trigger: HTMLElement | null, host: HTMLElement | null) => {
      if (popup) {
        invoker = trigger ?? invoker;
        close(true);
        return;
      }
      if (!host) return;
      invoker = trigger;
      popupHost = host;
      openedFullscreen = !!document.fullscreenElement;
      popup = document.createElement('form');
      popup.id = FULLSCREEN_CHAT_POPUP_ID;
      popup.setAttribute('role', 'dialog');
      popup.setAttribute('aria-label', '전체화면 채팅 입력');
      popup.addEventListener('submit', (event) => {
        event.preventDefault();
        event.stopPropagation();
        submit();
      });
      const header = document.createElement('div');
      header.className = 'cm-fullscreen-chat-header';
      const title = document.createElement('strong');
      title.textContent = '채팅 입력';
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.setAttribute('aria-label', '채팅 입력 닫기');
      dismiss.appendChild(createIconElement('close'));
      dismiss.addEventListener('click', () => close(true));
      header.append(title, dismiss);
      editor = document.createElement('input');
      editor.type = 'text';
      editor.className = 'cm-fullscreen-chat-editor';
      editor.setAttribute('aria-label', '전체화면 채팅 내용');
      editor.setAttribute('enterkeyhint', 'send');
      editor.value = readChatDraft(input());
      editor.addEventListener('compositionstart', () => {
        composing = true;
      });
      editor.addEventListener('compositionend', () => {
        composing = false;
      });
      editor.addEventListener('beforeinput', (event) => {
        if (!isLineBreak(event) || event.isComposing) return;
        event.preventDefault();
        queueEnter();
      });
      editor.addEventListener('input', (event) => {
        if (event instanceof InputEvent && isLineBreak(event) && !event.isComposing) {
          // 취소할 수 없는 IME 입력도 처리한다. 한 줄 입력창은 개행을 저장하지 않는다.
          queueEnter();
        }
        draftPending = true;
        activateNativeEditor();
        sync();
      });
      editor.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.isComposing && !composing && event.keyCode !== 229) {
          event.preventDefault();
          submit();
        }
      });
      const footer = document.createElement('div');
      footer.className = 'cm-fullscreen-chat-footer';
      note = document.createElement('p');
      note.className = 'cm-fullscreen-chat-note';
      note.setAttribute('aria-live', 'polite');
      send = document.createElement('button');
      send.type = 'submit';
      send.className = 'cm-fullscreen-chat-send';
      send.textContent = '전송';
      footer.append(note, send);
      popup.append(header, editor, footer);
      // 입력·조작이 플레이어의 재생 토글/전체화면 제스처로 전달되지 않게 한다.
      for (const name of ['click', 'dblclick', 'pointerdown', 'pointerup', 'keydown', 'keyup'])
        popup.addEventListener(name, (event) => event.stopPropagation());
      popup.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          close(true);
        }
      });
      host.appendChild(popup);
      activateNativeEditor();
      sync();
      position();
      paintButton();
      if (!editor.disabled) editor.focus({ preventScroll: true });
      poll = setInterval(sync, 250);
    };
    const stopButton = mountControlBarButton({
      id: FULLSCREEN_CHAT_BUTTON_ID,
      ariaLabel: '전체화면 채팅 열기',
      icon: 'chatBubble',
      before: PLAYER.clipButton,
      minTargetPx: Math.max(44, ctx.device.profile.touchTargetPx),
      onClick: () => toggle(button, fullscreenHost()),
      onMount: (node) => {
        button = node;
        paintButton();
      },
    });
    const onFullscreenChange = () => {
      const host = fullscreenHost();
      if (
        popup &&
        ((openedFullscreen && !host) ||
          (document.fullscreenElement && !document.fullscreenElement.contains(popup)))
      )
        close();
      else if (popup && host) {
        popupHost = host;
        openedFullscreen = true;
      }
      paintButton();
    };
    const onCompose = (event: Event) => {
      const trigger = event.target;
      if (!(trigger instanceof HTMLElement) || trigger.id !== CHAT_SUBTITLE_COMPOSE_BUTTON_ID)
        return;
      const player = trigger.closest<HTMLElement>(`${PLAYER.rootPc}, ${PLAYER.rootMobile}`);
      if (!player || !document.querySelector(ID.livePlayerLayout)?.contains(player)) return;
      if (document.fullscreenElement && !document.fullscreenElement.contains(trigger)) return;
      toggle(trigger, fullscreenHost() ?? player);
    };
    const onInput = () => {
      if (alive && popup) sync();
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener(CHAT_SUBTITLE_COMPOSE_EVENT, onCompose);
    document.addEventListener('input', onInput);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    window.addEventListener('resize', position);
    return () => {
      alive = false;
      close();
      stopButton();
      removeStyle(STYLE_ID);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener(CHAT_SUBTITLE_COMPOSE_EVENT, onCompose);
      document.removeEventListener('input', onInput);
      window.visualViewport?.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('scroll', position);
      window.removeEventListener('resize', position);
    };
  },
};
