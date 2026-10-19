import { playbackScreenMode } from '../constants/storage';
import { OURS, PLAYER } from '../constants/class';
import { info, warning } from '../utils/log';
import type { Feature } from './types';

type PlaybackSession = { key: string; attempted: boolean; pending: boolean; completed: boolean };
// 전체화면으로 인한 뷰포트 변경은 기능을 재시작한다. 같은 페이지의 완료 상태를 보존해
// Esc 로 나온 사용자를 다시 전체화면으로 밀어 넣지 않는다.
let session: PlaybackSession | undefined;

export const autoFullscreenFeature: Feature = {
  id: 'autoFullscreen',
  watches: ['wideScreen'],
  supports: (ctx) => !ctx.page.isSlotFrame && ctx.page.type !== 'unsupported',
  start: (ctx) => {
    // 홈 등으로 나갔다 같은 방송으로 돌아오는 SPA 탐색도 새 재생으로 취급한다.
    if (ctx.page.type === 'other' || playbackScreenMode(ctx.settings.wideScreen) !== 'fullscreen') {
      session = undefined;
      return;
    }
    const route = location.pathname;
    const key = `${ctx.page.type}:${ctx.page.channelId ?? ctx.page.videoNo ?? location.pathname}`;
    if (session?.key !== key) session = { key, attempted: false, pending: false, completed: false };
    const current = session;
    if (current.completed) return;
    let disposed = false;

    const playingVideo = (): HTMLVideoElement | null => {
      const video = document.querySelector<HTMLVideoElement>(
        `${PLAYER.rootPc} video, ${PLAYER.rootMobile} video`,
      );
      return video && !video.paused && !video.ended && video.readyState >= 2 ? video : null;
    };

    const attempt = (fromGesture: boolean) => {
      if (disposed || current.completed || current.pending) return;
      const video = playingVideo();
      // 멀티뷰의 숨겨진 원본이나 슬롯 하나가 무대 전체를 가로채지 않게 한다.
      if (!video || document.getElementById(OURS.multiViewStageId)) return;
      if (document.fullscreenElement) {
        current.completed = true;
        return;
      }
      if (!fromGesture && current.attempted) return;
      const player = video.closest<HTMLElement>(`${PLAYER.rootPc}, ${PLAYER.rootMobile}`);
      if (!player?.requestFullscreen || document.fullscreenEnabled === false) return;
      current.attempted = true;
      current.pending = true;
      // 입력 핸들러에서 바로 요청한다. 타이머를 거치면 사용자 활성화를 잃을 수 있다.
      try {
        void player.requestFullscreen({ navigationUI: 'hide' }).then(
          () => {
            current.pending = false;
            current.completed = true;
            info('automatic fullscreen entered');
          },
          (error: unknown) => {
            current.pending = false;
            warning('automatic fullscreen blocked; waiting for a player gesture', error);
          },
        );
      } catch (error) {
        current.pending = false;
        warning('automatic fullscreen request failed', error);
      }
    };

    const onPlaying = (event: Event) => {
      if (event.target === playingVideo()) attempt(false);
    };
    const onFullscreenChange = () => {
      if (document.fullscreenElement) current.completed = true;
    };
    const onGesture = (event: Event) => {
      if (!event.isTrusted || !navigator.userActivation?.isActive) return;
      const target = event.target;
      const video = playingVideo();
      const player = video?.closest(`${PLAYER.rootPc}, ${PLAYER.rootMobile}`);
      if (!(target instanceof Element) || !player?.contains(target)) return;
      // 설정·탐색·수동 전체화면 버튼 조작은 가로채지 않는다.
      if (target.closest('button, input, select, textarea, a, [role="button"], [role="slider"]'))
        return;
      if (event instanceof KeyboardEvent && ![' ', 'Enter', 'k', 'K'].includes(event.key)) return;
      attempt(true);
    };
    document.addEventListener('playing', onPlaying, true);
    document.addEventListener('click', onGesture, true);
    document.addEventListener('keydown', onGesture, true);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    attempt(false);
    return () => {
      disposed = true;
      if (location.pathname !== route && session === current) session = undefined;
      document.removeEventListener('playing', onPlaying, true);
      document.removeEventListener('click', onGesture, true);
      document.removeEventListener('keydown', onGesture, true);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  },
};
