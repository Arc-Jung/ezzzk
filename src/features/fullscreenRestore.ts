/** 앱 전환으로 잃은 전체화면을 복원한다. 직접 종료한 경우에는 복원하지 않는다. */
import { OURS, PLAYER } from '../constants/class';
import type { Disposer, Feature } from './types';

const PLAYER_SELECTOR = `${PLAYER.rootPc}, ${PLAYER.rootMobile}`;
const EXIT_BUTTON = `${PLAYER.fullscreenButton}, .pzp-mobile__fullscreen-button, [data-cm-fullscreen-toggle]`;
const INTERACTIVE =
  'button, input, textarea, select, a, [role="button"], [role="slider"], [contenteditable="true"]';
const SLOT_GESTURE = 'cm-fullscreen-restore-gesture';

export function keepFullscreenOnReturn(isSlotFrame = false): Disposer {
  let target: HTMLElement | null = null;
  let selector = PLAYER_SELECTOR;
  let stage = false;
  let wanted = false;
  let away = false;
  let restore = false;
  let attempted = false;
  let disposed = false;
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  let pending: { cancelled: boolean; element: HTMLElement } | null = null;
  const visible = () => document.visibilityState !== 'hidden' && document.hasFocus();
  const clearTimer = () => {
    if (exitTimer !== undefined) clearTimeout(exitTimer);
    exitTimer = undefined;
  };
  const forget = () => {
    clearTimer();
    wanted = away = restore = attempted = false;
    target = null;
    if (pending) pending.cancelled = true;
  };
  const resolveTarget = () => {
    if (stage && !document.getElementById(OURS.multiViewStageId)) return null;
    return target?.isConnected ? target : document.querySelector<HTMLElement>(selector);
  };
  const request = (gesture: boolean) => {
    if (
      disposed ||
      !wanted ||
      !restore ||
      pending ||
      !visible() ||
      document.fullscreenElement ||
      document.pictureInPictureElement
    )
      return;
    if (!gesture && attempted) return;
    const element = resolveTarget();
    if (!element?.requestFullscreen || document.fullscreenEnabled === false) return;
    target = element;
    attempted = true;
    const operation = { cancelled: false, element };
    pending = operation;
    const finish = () => {
      if (pending === operation) pending = null;
      // 최소화 직전에 승인된 비동기 요청도 사용자의 종료 의사를 되돌리지 않는다.
      if (operation.cancelled && document.fullscreenElement === element)
        void document.exitFullscreen().catch(() => undefined);
    };
    try {
      // 복귀 시 한 번 시도하고, 제스처 제한으로 거부되면 다음 영상 입력까지 기다린다.
      void element.requestFullscreen({ navigationUI: 'hide' }).then(finish, finish);
    } catch {
      finish();
    }
  };
  const markAway = () => {
    if (!wanted) return;
    away = true;
    attempted = false;
    restore = !document.fullscreenElement;
  };
  const resume = () => {
    if (!wanted || !visible() || document.pictureInPictureElement) return;
    if (document.fullscreenElement) {
      away = restore = false;
      return;
    }
    if (away) {
      clearTimer();
      restore = true;
      request(false);
    }
  };
  const onFullscreen = () => {
    clearTimer();
    const element = document.fullscreenElement;
    if (element instanceof HTMLIFrameElement) {
      // 슬롯 내부 전체화면은 슬롯 문서가 복원한다. 부모와의 중복 요청을 막는다.
      forget();
      return;
    }
    if (element instanceof HTMLElement) {
      if (pending?.cancelled) return;
      const isStage = !!document.getElementById(OURS.multiViewStageId);
      if (!element.matches('video') && !element.querySelector('video') && !isStage) return;
      target = element;
      stage =
        isStage && (element === document.documentElement || element.id === OURS.multiViewStageId);
      selector = stage
        ? element === document.documentElement
          ? 'html'
          : `#${OURS.multiViewStageId}`
        : element.matches('video')
          ? `${PLAYER.rootPc} video, ${PLAYER.rootMobile} video`
          : element.matches(PLAYER.rootPc)
            ? PLAYER.rootPc
            : element.matches(PLAYER.rootMobile)
              ? PLAYER.rootMobile
              : element.id
                ? `#${CSS.escape(element.id)}`
                : PLAYER_SELECTOR;
      wanted = true;
      away = restore = attempted = false;
      return;
    }
    if (!wanted) return;
    if (away || !visible() || document.pictureInPictureElement) {
      away = restore = true;
      resume();
    } else {
      // 일부 브라우저는 전체화면 종료를 visibilitychange/blur보다 먼저 보낸다.
      exitTimer = setTimeout(() => {
        exitTimer = undefined;
        if (away || !visible()) {
          away = restore = true;
          resume();
        } else forget();
      }, 250);
    }
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') markAway();
    else resume();
  };
  const onBlur = () => {
    // 같은 페이지의 iframe에 포커스가 옮겨간 것은 앱 전환이 아니다.
    if (!document.hasFocus()) markAway();
  };
  const onInput = (event: Event) => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const key = event instanceof KeyboardEvent ? event : null;
    const editing = event.target.closest('input, textarea, select, [contenteditable="true"]');
    if (
      (!editing && (key?.key === 'Escape' || key?.key.toLowerCase() === 'f')) ||
      (!key && event.target.closest(EXIT_BUTTON))
    ) {
      if (wanted) forget();
      return;
    }
    if (!navigator.userActivation?.isActive || event.target.closest(INTERACTIVE)) return;
    if (key && ![' ', 'Enter', 'k', 'K'].includes(key.key)) return;
    // iframe 안의 입력은 부모의 입력 리스너에 도달하지 않는다.
    if (isSlotFrame) window.parent.postMessage(SLOT_GESTURE, location.origin);
    if (!restore) return;
    const element = resolveTarget();
    if (element?.contains(event.target)) request(true);
  };
  const onMessage = (event: MessageEvent) => {
    if (
      event.origin !== location.origin ||
      event.data !== SLOT_GESTURE ||
      !navigator.userActivation?.isActive ||
      !restore
    )
      return;
    const ownsFrame = [
      ...document.querySelectorAll<HTMLIFrameElement>(`#${OURS.multiViewStageId} iframe`),
    ].some((frame) => frame.contentWindow === event.source);
    if (ownsFrame) request(true);
  };
  const onKeyUp = (event: KeyboardEvent) => {
    // 브라우저가 전체화면 Esc의 keydown을 먼저 처리하는 경우도 있다.
    if (event.key === 'Escape') onInput(event);
  };
  const onPipEnter = () => {
    if (!wanted) return;
    clearTimer();
    away = restore = true;
  };
  const onPipLeave = () => resume();
  document.addEventListener('enterpictureinpicture', onPipEnter, true);
  document.addEventListener('leavepictureinpicture', onPipLeave, true);
  document.addEventListener('fullscreenchange', onFullscreen, true);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('playing', resume, true);
  document.addEventListener('pointerup', onInput, true);
  document.addEventListener('click', onInput, true);
  document.addEventListener('keydown', onInput, true);
  document.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', resume);
  window.addEventListener('pagehide', markAway);
  window.addEventListener('pageshow', resume);
  window.addEventListener('message', onMessage);
  onFullscreen();
  return () => {
    disposed = true;
    forget();
    document.removeEventListener('enterpictureinpicture', onPipEnter, true);
    document.removeEventListener('leavepictureinpicture', onPipLeave, true);
    document.removeEventListener('fullscreenchange', onFullscreen, true);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('playing', resume, true);
    document.removeEventListener('pointerup', onInput, true);
    document.removeEventListener('click', onInput, true);
    document.removeEventListener('keydown', onInput, true);
    document.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', resume);
    window.removeEventListener('pagehide', markAway);
    window.removeEventListener('pageshow', resume);
    window.removeEventListener('message', onMessage);
  };
}

export const fullscreenRestoreFeature: Feature = {
  id: 'fullscreenRestore',
  watches: [],
  preserveOnDeviceChange: true,
  supports: (ctx) => ['live', 'vod', 'mobile-web'].includes(ctx.page.type),
  start: (ctx) => keepFullscreenOnReturn(ctx.page.isSlotFrame),
};
