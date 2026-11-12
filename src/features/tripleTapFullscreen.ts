/** 영상 위의 연속 세 번 터치로 전체화면을 전환한다. */
import { OURS, PLAYER } from '../constants/class';
import type { Disposer, Feature } from './types';

export const FULLSCREEN_EXIT_INTENT = 'cm-fullscreen-exit-intent';
const SLOT_TOGGLE = 'cm-triple-tap-fullscreen';
const PLAYER_SELECTOR = `${PLAYER.rootPc}, ${PLAYER.rootMobile}`;
const INTERACTIVE =
  'button, input, textarea, select, a, [role="button"], [role="slider"], [role="dialog"], [role="menu"], [contenteditable]:not([contenteditable="false"]), .pzp-pc__bottom, .pzp-mobile__bottom, [class*="setting-pane"], [class*="contextmenu"]';
const TAP_MS = 300;
const GAP_MS = 350;
const MOVE_PX = 20;
const NEAR_PX = 36;

type Point = { x: number; y: number };
type Tap = Point & { player: HTMLElement; at: number; count: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function registerTripleTapFullscreen(isSlotFrame = false): Disposer {
  const touches = new Set<number>();
  let down: (Point & { id: number; player: HTMLElement; at: number }) | null = null;
  let sequence: Tap | null = null;
  let lastTouch: Tap | null = null;
  let pending = false;
  let disposed = false;

  const playerAt = (target: EventTarget | null) => {
    if (!(target instanceof Element) || target.closest(INTERACTIVE)) return null;
    // 부모 문서에 남은 원본 영상은 멀티뷰가 활성인 동안 조작하지 않는다.
    if (!isSlotFrame && document.getElementById(OURS.multiViewStageId)) return null;
    const player = target.closest<HTMLElement>(PLAYER_SELECTOR);
    return player?.querySelector('video') ? player : null;
  };
  const reset = () => {
    down = sequence = null;
  };
  const toggle = (target: HTMLElement) => {
    if (disposed || pending || document.pictureInPictureElement) return;
    const exiting = !!document.fullscreenElement;
    if (!exiting && (!target.requestFullscreen || document.fullscreenEnabled === false)) return;
    if (exiting && !document.exitFullscreen) return;
    // 직접 종료했다는 의사를 복귀 컨트롤러에도 전달한다.
    if (exiting) document.dispatchEvent(new Event(FULLSCREEN_EXIT_INTENT));
    pending = true;
    try {
      const request = exiting
        ? document.exitFullscreen()
        : target.requestFullscreen({ navigationUI: 'hide' });
      void request.catch(() => undefined).finally(() => (pending = false));
    } catch {
      pending = false;
    }
  };
  const onDown = (event: PointerEvent) => {
    if (!event.isTrusted) return;
    if (event.pointerType !== 'touch') {
      reset();
      lastTouch = null;
      return;
    }
    touches.add(event.pointerId);
    const player = playerAt(event.target);
    if (touches.size !== 1 || !event.isPrimary || !player) {
      reset();
      lastTouch = null;
      return;
    }
    down = {
      id: event.pointerId,
      player,
      x: event.clientX,
      y: event.clientY,
      at: performance.now(),
    };
  };
  const onMove = (event: PointerEvent) => {
    if (
      down?.id === event.pointerId &&
      distance(down, { x: event.clientX, y: event.clientY }) > MOVE_PX
    ) {
      reset();
      lastTouch = null;
    }
  };
  const onUp = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') return;
    touches.delete(event.pointerId);
    const tap = down;
    down = null;
    const now = performance.now();
    const point = { x: event.clientX, y: event.clientY };
    if (
      !event.isTrusted ||
      !tap ||
      tap.id !== event.pointerId ||
      touches.size ||
      playerAt(event.target) !== tap.player ||
      now - tap.at > TAP_MS ||
      distance(tap, point) > MOVE_PX
    ) {
      reset();
      lastTouch = null;
      return;
    }
    const count =
      sequence?.player === tap.player &&
      now - sequence.at <= GAP_MS &&
      distance(sequence, point) <= NEAR_PX
        ? sequence.count + 1
        : 1;
    lastTouch = sequence = { ...point, player: tap.player, at: now, count };
    if (count !== 3) return;
    sequence = null;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (isSlotFrame) window.parent.postMessage(SLOT_TOGGLE, location.origin);
    else toggle(tap.player);
  };
  const onCancel = (event: PointerEvent) => {
    touches.delete(event.pointerId);
    reset();
    lastTouch = null;
  };
  const onClick = (event: MouseEvent) => {
    // 두 번째 터치의 dblclick이 먼저 전체화면을 바꾸지 않게 한다. 마우스 더블클릭은 유지한다.
    if (
      !event.isTrusted ||
      !lastTouch ||
      performance.now() - lastTouch.at > GAP_MS ||
      playerAt(event.target) !== lastTouch.player ||
      distance(lastTouch, { x: event.clientX, y: event.clientY }) > NEAR_PX ||
      (event.type === 'click' && lastTouch.count < 2)
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onMessage = (event: MessageEvent) => {
    if (
      isSlotFrame ||
      event.origin !== location.origin ||
      event.data !== SLOT_TOGGLE ||
      !navigator.userActivation?.isActive
    )
      return;
    const stage = document.getElementById(OURS.multiViewStageId);
    const ownsFrame = [...(stage?.querySelectorAll('iframe') ?? [])].some(
      (frame) => frame.contentWindow === event.source,
    );
    if (ownsFrame) toggle(document.documentElement);
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      reset();
      touches.clear();
      lastTouch = null;
    }
  };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('pointercancel', onCancel, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('dblclick', onClick, true);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('fullscreenchange', reset);
  window.addEventListener('message', onMessage);
  return () => {
    disposed = true;
    reset();
    touches.clear();
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onCancel, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('dblclick', onClick, true);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('fullscreenchange', reset);
    window.removeEventListener('message', onMessage);
  };
}

export const tripleTapFullscreenFeature: Feature = {
  id: 'tripleTapFullscreen',
  watches: [],
  preserveOnDeviceChange: true,
  supports: (ctx) => ['live', 'vod', 'mobile-web'].includes(ctx.page.type),
  start: (ctx) => registerTripleTapFullscreen(ctx.page.isSlotFrame),
};
