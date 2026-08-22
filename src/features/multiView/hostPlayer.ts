/**
 * FR-14 멀티뷰 — 호스트 페이지(최상위 프레임) 원본 플레이어 정지.
 *
 * 🔴 멀티뷰 스테이지는 원본 페이지 **위에** 뜰 뿐이라 뒤의 플레이어는 계속 재생된다.
 * 같은 채널이 슬롯에도 있으면 같은 방송이 두 번 재생돼 소리가 겹친다 (2026-08-15 사용자 보고).
 * 오디오는 항상 활성 슬롯 하나만 낸다는 FR-14 보장을 지키려면 호스트 플레이어를 멈춰야 한다.
 *
 * ⚠️ 슬롯 iframe 안의 `video` 는 여기서 절대 건드리지 않는다. 슬롯 음소거는 `slotFrame.ts` 담당이고,
 * 콘텐츠 스크립트가 `all_frames: true` 로 주입되므로 슬롯 프레임에서는 이 로직이 돌면 안 된다.
 */

import { ID, PLAYER } from '../../constants/class';
import { qs } from '../../utils/dom';
import { observe, type Disposer } from '../../utils/observe';
import { info, warning } from '../../utils/log';
import { trackHostDirectedInput } from './userIntent';

/** 멀티뷰 시작 직전의 호스트 플레이어 상태. 해제 시 이 값으로 되돌린다. */
export interface HostPlaybackState {
  paused: boolean;
  muted: boolean;
}

/** 플레이어가 스스로 되살아나는지 다시 확인하는 주기. 폴링이 아니라 DOM 변화 관찰의 디바운스다. */
const GUARD_DEBOUNCE_MS = 500;
/** 기기 프로필이 `relaxObservers` 를 요구하면(저사양 등) 디바운스를 늘린다 — 다른 옵저버들과 동일한 배율. */
const GUARD_DEBOUNCE_MS_RELAXED = 1_000;

/**
 * 플레이어가 `pause()` 를 무시하고 계속 되살아날 때 재정지를 포기하는 상한.
 * 치지직 플레이어의 자체 복구 로직과 무한 핑퐁(우리가 멈추면 저쪽이 다시 켬)이 될 수 있으므로
 * `wideScreen.ts` 의 재시도 상한 패턴을 그대로 따른다. 포기해도 음소거만은 유지해 소리 겹침을 막는다.
 */
const MAX_REPAUSE_ATTEMPTS = 3;

/** 현재 상태를 스냅샷으로 뜬다. 순수 함수 — 테스트 대상. */
export function captureHostState(video: HTMLVideoElement): HostPlaybackState {
  return { paused: video.paused, muted: video.muted };
}

/**
 * 스냅샷을 되돌릴 때 취할 동작. 순수 함수 — 테스트 대상.
 *
 * 🔴 `muted` 는 **저장값 그대로** 돌려준다. 원래 음소거로 보던 사용자를 멀티뷰 해제만으로
 * 소리 나게 만들면 안 된다.
 */
export function hostRestoreActions(saved: HostPlaybackState): {
  shouldPlay: boolean;
  muted: boolean;
} {
  return { shouldPlay: !saved.paused, muted: saved.muted };
}

function hostVideo(): HTMLVideoElement | null {
  return qs<HTMLVideoElement>(`${ID.livePlayerLayout} ${PLAYER.video}`);
}

/**
 * 호스트 플레이어를 정지하고, 원복 함수를 돌려준다.
 *
 * 정지는 `pause()` + `muted = true` 를 함께 쓴다 — 치지직 플레이어가 리렌더·재접속으로
 * 스스로 다시 재생을 시도하므로 음소거가 안전망이다. 되살아나는 경우는 `play` 이벤트와
 * DOM 관찰(비디오 요소 교체 대비)로 잡아 다시 멈춘다. 타이머 폴링은 쓰지 않는다.
 *
 * `relaxed` 는 `ctx.device.profile.relaxObservers` 를 그대로 받아 디바운스를 늘린다 —
 * 이 저장소의 다른 모든 옵저버(`chatWidth`, `adSkip`, `quality` 등)와 같은 규칙이다.
 */
export function suspendHostPlayer({
  isSlotFrame,
  relaxed = false,
}: {
  isSlotFrame: boolean;
  relaxed?: boolean;
}): Disposer {
  // 슬롯 프레임에서는 절대 동작하지 않는다 — 슬롯 영상까지 멈춰 버린다.
  if (isSlotFrame) return () => {};

  let saved: HostPlaybackState | null = null;
  let watched: HTMLVideoElement | null = null;
  // 재정지 시도 횟수. 새 비디오 요소가 붙을 때마다 초기화한다 (attach 참조).
  let repauseAttempts = 0;
  let gaveUpRepausing = false;
  /**
   * 사용자가 호스트 플레이어를 **직접** 재생·음소거 해제했다.
   * 그 뒤로는 이 플레이어와 싸우지 않는다 — 사용자가 소리 겹침을 감수하고 고른 것이다.
   * 자체 복구(사용자 활성화 없음)와는 `hostInput.isActive()` 로 구분한다.
   */
  let surrendered = false;
  /**
   * 🔴 **정지 시점부터** 우리 UI 밖의 사용자 조작만 센다 (2026-08-22 수정).
   * 예전에는 `isUserInitiated()`(= `navigator.userActivation.isActive`) 하나로 판정해
   * **멀티뷰를 여는 클릭 자체**가 "사용자가 원본을 재생시켰다"로 잡혔다 — 자세한 근거는
   * `userIntent.ts` 의 `trackHostDirectedInput` 주석 참조.
   */
  const hostInput = trackHostDirectedInput();
  /** 우리가 마지막으로 건 `muted`. `volumechange` 가 우리 조작인지 가르는 표시다. */
  let appliedMuted: boolean | null = null;

  const mute = (video: HTMLVideoElement) => {
    appliedMuted = true;
    video.muted = true;
  };

  const surrenderToUser = (what: string) => {
    if (surrendered) return;
    surrendered = true;
    warning(`host player was ${what} by the user; multiview stops re-suspending it`);
  };

  const onPlay = (event: Event) => {
    const video = event.currentTarget as HTMLVideoElement | null;
    if (!video || surrendered) return;
    // 사용자가 직접 눌러 재생한 것이면 되돌리지 않는다.
    if (hostInput.isActive()) {
      surrenderToUser('resumed');
      return;
    }
    // 상한을 넘겨 포기한 뒤에도 음소거만은 계속 유지한다 — 소리 겹침만은 막아야 한다.
    if (gaveUpRepausing) {
      mute(video);
      return;
    }
    repauseAttempts += 1;
    if (repauseAttempts > MAX_REPAUSE_ATTEMPTS) {
      gaveUpRepausing = true;
      mute(video);
      warning(
        `host player kept resuming, gave up repausing after ${MAX_REPAUSE_ATTEMPTS} attempts`,
      );
      return;
    }
    video.pause();
    mute(video);
  };

  /**
   * 사용자가 호스트 플레이어의 음소거를 직접 풀었는지 본다.
   * 여기서는 다시 음소거하지 않는다 — 되돌리면 사용자와 싸우는 핑퐁이 된다.
   * 플레이어가 스스로 되살린 경우(활성화 없음)는 `play` 경로가 그대로 처리한다.
   */
  const onVolumeChange = (event: Event) => {
    const video = event.currentTarget as HTMLVideoElement | null;
    if (!video || surrendered) return;
    if (video.muted === appliedMuted) return;
    if (video.muted) return;
    if (!hostInput.isActive()) return;
    surrenderToUser('unmuted');
  };

  const attach = () => {
    if (surrendered) return;
    const video = hostVideo();
    if (!video || video === watched) return;
    // 비디오 요소가 교체될 수 있으므로 이전 요소의 리스너를 먼저 뗀다.
    watched?.removeEventListener('play', onPlay);
    watched?.removeEventListener('volumechange', onVolumeChange);
    watched = video;
    // 새 비디오 요소이므로 재정지 시도 횟수도 함께 초기화한다.
    repauseAttempts = 0;
    gaveUpRepausing = false;
    // 스냅샷은 최초 1회만 — 이미 우리가 멈춘 상태를 다시 저장하면 원복이 무의미해진다.
    if (saved === null) {
      saved = captureHostState(video);
      info('multiview suspending host player');
    }
    video.addEventListener('play', onPlay);
    video.addEventListener('volumechange', onVolumeChange);
    video.pause();
    mute(video);
  };

  attach();

  /**
   * 플레이어가 리렌더로 다시 붙거나 늦게 준비되는 경우를 잡는다.
   *
   * 🔴 **관찰 대상을 `document.documentElement` 전체가 아니라 `#live_player_layout`
   * (없으면 `document.body`)으로 좁힌다.** 문서 전체를 관찰하면 `<head>` 갱신(스타일 주입)과
   * 라이브 채팅 메시지 하나하나가 이 옵저버를 깨워, 멀티뷰가 열려 있는 내내 불필요하게 돈다
   * (NFR-04 위반, 코드 리뷰 지적).
   * `#live_player_layout` 은 이 저장소 전역에서 플레이어 영역을 가리키는 안정적 앵커로 쓰인다
   * (`layoutArbiter.ts`, `pageType.ts`, `adSkip.ts`, `quality.ts` 등) — 컨테이너 자체가
   * 리렌더로 통째로 교체되는 사례는 확인되지 않았고, 안쪽 비디오 요소만 교체된다.
   * 다만 **컨테이너 자체가 교체되는 경우가 생기면** 이 옵저버는 그 순간을 놓칠 수 있다 —
   * 그때는 상위 컨테이너(`document.body`)를 관찰 대상으로 승격해야 한다.
   */
  const guardTarget = qs(ID.livePlayerLayout) ?? document.body;
  const stopGuard = observe(guardTarget, attach, {
    debounceMs: relaxed ? GUARD_DEBOUNCE_MS_RELAXED : GUARD_DEBOUNCE_MS,
  });

  return () => {
    stopGuard();
    hostInput.stop();
    const video = watched;
    watched = null;
    const snapshot = saved;
    saved = null;
    if (!video) return;
    video.removeEventListener('play', onPlay);
    video.removeEventListener('volumechange', onVolumeChange);
    if (!snapshot) return;
    /**
     * 사용자가 직접 손댄 뒤에는 우리가 만든 상태가 아니므로 되돌리지 않는다.
     * 여기서 스냅샷을 복원하면 사용자가 켠 소리를 멀티뷰 해제가 다시 끄는 꼴이 된다.
     */
    if (surrendered) {
      info('host player was left as the user set it');
      return;
    }
    const { shouldPlay, muted } = hostRestoreActions(snapshot);
    video.muted = muted;
    // 자동 재생이 막히거나(브라우저 정책) 구현이 없는 환경(jsdom)에서도 원복 자체는 성공해야 한다.
    if (shouldPlay) {
      try {
        const started: unknown = video.play();
        if (started instanceof Promise) started.catch(() => {});
      } catch {
        warning('host player resume was rejected');
      }
    }
    info('multiview restored host player');
  };
}
