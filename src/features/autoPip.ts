/** 브라우저가 허용한 자동 PiP 요청에만 응답한다. 홈/blur에서 권한을 우회하지 않는다. */
import { ID, OURS, PLAYER } from '../constants/class';
import { isVisible } from '../utils/dom';
import { warning } from '../utils/log';
import { isPlayerAdActive } from './adSkip';
import type { Disposer, Feature } from './types';

// TypeScript 5.6의 DOM 타입에는 이 표준 액션이 아직 없다. 미지원 브라우저는 등록 시 거부한다.
const AUTO_PIP_ACTION = 'enterpictureinpicture' as MediaSessionAction;

export function registerAutoPip(): Disposer | void {
  const session = navigator.mediaSession;
  if (!session?.setActionHandler || !document.pictureInPictureEnabled) return;
  let disposed = false;
  let pending = false;
  const enter = () => {
    if (
      disposed ||
      pending ||
      document.pictureInPictureElement ||
      document.getElementById(OURS.multiViewStageId) ||
      isPlayerAdActive(document.querySelector(ID.livePlayerLayout))
    )
      return;
    // 광고에서 본방송으로 전환·SPA 리렌더 뒤에도 오래된 video를 붙잡지 않는다.
    const video = [
      ...document.querySelectorAll<HTMLVideoElement>(
        `${PLAYER.rootPc} video, ${PLAYER.rootMobile} video`,
      ),
    ].find(
      (el) =>
        !el.paused &&
        !el.ended &&
        el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        el.videoWidth > 0 &&
        !el.disablePictureInPicture &&
        !el.closest('.vod_player_wrap') &&
        isVisible(el) &&
        !isPlayerAdActive(el.closest(`${PLAYER.rootPc}, ${PLAYER.rootMobile}`)),
    );
    if (!video?.requestPictureInPicture) return;
    pending = true;
    const failed = (error: unknown) => {
      pending = false;
      if (!disposed) warning('automatic PiP request rejected', error);
    };
    try {
      // 브라우저가 전달한 PiP 전용 승인을 잃지 않도록 입력 콜백에서 바로 요청한다.
      void video.requestPictureInPicture().then(() => {
        pending = false;
        // 설정을 끈 뒤 늦게 승인된 요청만 취소한다. 이미 열린 PiP는 강제로 닫지 않는다.
        if (disposed && document.pictureInPictureElement === video)
          void document.exitPictureInPicture().catch(() => undefined);
      }, failed);
    } catch (error) {
      failed(error);
    }
  };
  try {
    session.setActionHandler(AUTO_PIP_ACTION, enter);
  } catch {
    // 액션 미지원 환경의 재생·수동 PiP는 그대로 둔다.
    return;
  }
  return () => {
    disposed = true;
    try {
      session.setActionHandler(AUTO_PIP_ACTION, null);
    } catch {
      // 문서 종료·브라우저 기능 해제 중에도 다른 기능의 정리를 막지 않는다.
    }
  };
}

export const autoPipFeature: Feature = {
  id: 'autoPip',
  watches: ['autoPip'],
  preserveOnDeviceChange: true,
  supports: (ctx) =>
    ctx.settings.autoPip.enabled &&
    !ctx.page.isSlotFrame &&
    ['live', 'vod', 'mobile-web'].includes(ctx.page.type),
  start: () => registerAutoPip(),
};
