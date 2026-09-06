/**
 * 방송 재개 감시 (요청 2026-09-06). 계획: `docs/live-resume-plan.md`.
 *
 * 방송이 끝난 채널 페이지를 열어 둔 채 기다리는 사용자를, 방송이 다시 시작되면 자동으로
 * 재생 화면에 넣어 준다.
 *
 * 실측 2026-09-06 (`etc/probe/offline-page.json`)
 * - 종료된 `/live/{channelId}` 는 **플레이어가 아예 렌더되지 않는다** (`video` ·
 *   `#live_player_layout` · `.pzp-pc` 전부 없음). 대신 `다음 라이브를 기대해주세요!` 안내와
 *   다시보기 목록이 뜨고, `#aside-chatting` 채팅은 그대로 살아 있다.
 * - `GET polling/v3/channels/{id}/live-status` → `{"content":{"status":"OPEN"|"CLOSE"}}`.
 *   비로그인·무인증 200 이고 `access-control-allow-origin: https://chzzk.naver.com` 이라
 *   콘텐츠 스크립트에서 그대로 부를 수 있다 (`host_permissions` 불필요).
 *
 * 🔴 **1분마다 페이지를 새로고침하지 않는다.** 확인은 상태 API 로 하고, `OPEN` 으로 바뀐
 * 그때 한 번만 새로고침한다. 종료 화면에도 채팅과 다시보기 목록이 살아 있어 1분마다 새로
 * 읽으면 읽던 위치와 입력 중이던 글자가 그때마다 날아간다 (계획 §3 의 대조표).
 *
 * 🔴 **새로고침 루프가 이 기능의 유일한 심각 위험이다.** `OPEN` 인데 페이지가 여전히 종료
 * 화면으로 렌더되면(CDN 지연 등) 영원히 새로고침한다. 채널별 연속 시도 횟수를
 * `sessionStorage` 에 적어 상한을 두고, 상한을 넘으면 멈춘다 — 새로고침을 넘어 살아남는
 * 저장소는 이것뿐이다 (`chrome.storage` 는 비동기라 언로드 직전 쓰기가 보장되지 않는다).
 */

import { LIVE_PRESENCE } from '../constants/class';
import { qs } from '../utils/dom';
import { info, warning } from '../utils/log';
import type { Feature } from './types';

/**
 * 상태 확인 주기 — **처음 촘촘하게 보다가 느슨해진다** (요청 2026-09-06).
 *
 * 방송이 막 끝난 직후가 다시 켜질 확률이 가장 높다(광고·잠깐 자리비움·송출 사고). 그 구간은
 * 1분마다 본다. 그 뒤로도 기다리는 사람은 "언젠가 켜지면"을 기다리는 것이라 1분 해상도가
 * 필요 없다 — 10분으로 늦춰 열어 둔 탭이 하루 종일 요청을 쏘지 않게 한다.
 *
 * 1분 × 10회 = 처음 10분은 촘촘히, 그 뒤는 10분 간격.
 */
export const POLL_INTERVAL_MS = 60_000;
export const SLOW_POLL_INTERVAL_MS = 10 * 60_000;
/** 촘촘한 주기로 도는 확인 횟수. */
export const FAST_POLL_COUNT = 10;

/**
 * 다음 확인까지 기다릴 시간. **순수 함수 — 테스트가 직접 검증한다.**
 *
 * @param completedPolls 지금까지 마친 상태 확인 횟수.
 */
export function pollIntervalFor(completedPolls: number): number {
  return completedPolls < FAST_POLL_COUNT ? POLL_INTERVAL_MS : SLOW_POLL_INTERVAL_MS;
}

/**
 * 마운트 후 첫 판정까지의 대기. 로딩 중에도 플레이어는 아직 없으므로 바로 판정하면
 * 정상 진입을 종료로 오인한다. `playbackStall.ts` 의 8초보다 짧게 잡은 이유는 이쪽 판정이
 * 최종적으로 API 로 확정되기 때문이다 — DOM 은 게이트일 뿐이다.
 */
export const SETTLE_MS = 5_000;

/** 같은 채널에서 연속으로 허용하는 새로고침 횟수. 넘으면 멈추고 경고를 남긴다. */
export const MAX_RELOADS = 3;

/**
 * 상한 카운터의 유효 시간. 방송이 켜졌다 꺼졌다를 반복하는 채널에서 옛 카운터가 남아
 * 정상 동작을 막지 않게 한다.
 */
export const RELOAD_WINDOW_MS = 10 * 60_000;

const STATUS_URL = (channelId: string) =>
  `https://api.chzzk.naver.com/polling/v3/channels/${channelId}/live-status`;

/** `sessionStorage` 키. 새로고침을 넘어 상한 카운터를 유지하는 유일한 저장소다. */
export const LIVE_RESUME_STORAGE_KEY = 'ezzzk.liveResume.reloads';

export type LiveStatus = 'OPEN' | 'CLOSE' | 'UNKNOWN';

export type ReloadState = { channelId: string; count: number; at: number };

/**
 * 응답에서 방송 상태를 읽는다. **순수 함수 — 테스트가 직접 검증한다.**
 *
 * 스키마가 바뀌면 조용히 `undefined` 가 되어 "영원히 CLOSE" 로 굳는 것이 가장 나쁘다.
 * 모르는 모양은 `UNKNOWN` 으로 돌려 호출부가 경고를 남기게 한다.
 */
export function parseLiveStatus(body: unknown): LiveStatus {
  if (typeof body !== 'object' || body === null) return 'UNKNOWN';
  const content = (body as { content?: unknown }).content;
  if (typeof content !== 'object' || content === null) return 'UNKNOWN';
  const status = (content as { status?: unknown }).status;
  if (status === 'OPEN' || status === 'CLOSE') return status;
  return 'UNKNOWN';
}

/** 저장된 카운터를 읽는다. 형태가 깨졌거나 유효 시간이 지났으면 없는 것으로 본다. */
export function readReloadState(raw: string | null, channelId: string, now: number): ReloadState {
  const empty: ReloadState = { channelId, count: 0, at: now };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as Partial<ReloadState>;
    if (parsed.channelId !== channelId) return empty;
    if (typeof parsed.count !== 'number' || typeof parsed.at !== 'number') return empty;
    if (now - parsed.at > RELOAD_WINDOW_MS) return empty;
    return { channelId, count: parsed.count, at: parsed.at };
  } catch {
    return empty;
  }
}

/**
 * 새로고침해도 되는가. **순수 함수 — 테스트가 직접 검증한다.**
 *
 * `OPEN` 이 아니면 아무것도 하지 않고, 상한을 넘었으면 멈춘다.
 */
export function shouldReload(status: LiveStatus, state: ReloadState): boolean {
  if (status !== 'OPEN') return false;
  return state.count < MAX_RELOADS;
}

/** 플레이어가 이미 붙어 있으면 방송중이다 — 감시할 이유가 없다. */
function hasPlayer(): boolean {
  return LIVE_PRESENCE.playerMarkers.some((selector) => qs(selector) !== null);
}

export const liveResumeFeature: Feature = {
  id: 'liveResume',
  watches: ['liveResume'],
  supports: (ctx) =>
    ctx.settings.liveResume.enabled &&
    ctx.page.type === 'live' &&
    ctx.page.channelId !== null &&
    // 슬롯이 제멋대로 리로드되면 멀티뷰 무대가 깨진다.
    !ctx.page.isSlotFrame,
  start: (ctx) => {
    // 🔴 `const channelId = ctx.page.channelId` 뒤에 null 검사를 두면 안 된다. 아래
    //    `function fetchStatus` 선언은 호이스팅되어 좁혀지기 전 타입(`string | null`)을 본다.
    //    검사를 먼저 하고 그다음에 캡처해야 `string` 으로 확정된다.
    if (ctx.page.channelId === null) return;
    const channelId = ctx.page.channelId;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** 지금까지 마친 상태 확인 횟수. 주기가 촘촘한 구간에서 느슨한 구간으로 넘어가는 기준이다. */
    let completedPolls = 0;

    const clearTimer = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };

    const schedule = (delayMs: number) => {
      clearTimer();
      timer = setTimeout(() => void tick(), delayMs);
    };

    const loadState = (): ReloadState =>
      readReloadState(sessionStorage.getItem(LIVE_RESUME_STORAGE_KEY), channelId, Date.now());

    const saveState = (state: ReloadState) => {
      try {
        sessionStorage.setItem(LIVE_RESUME_STORAGE_KEY, JSON.stringify(state));
      } catch (e) {
        // 사파리 프라이빗 모드 등에서 던진다. 카운터를 못 쓰면 상한이 무의미해지므로
        // 새로고침 자체를 포기한다 — 루프를 만드는 것보다 안 되는 편이 낫다.
        warning('liveResume: sessionStorage is unavailable; skipping reload', e);
        throw e;
      }
    };

    const clearState = () => {
      try {
        sessionStorage.removeItem(LIVE_RESUME_STORAGE_KEY);
      } catch (e) {
        /*
         * 🔴 조용히 삼키지 않는다. 처음 구현에서 여기가 빈 `catch {}` 였고, 안에서 던진
         * `ReferenceError`(존재하지 않는 상수를 참조했다)를 통째로 먹어 **기능이 아무 일도
         * 하지 않는데 원인은 어디에도 안 남는** 상태를 만들었다. 저장소를 못 지우는 것 자체는
         * 치명적이지 않지만(유효 시간이 지나면 스스로 무효가 된다) 이유는 남겨야 한다.
         */
        warning('liveResume: could not clear the reload counter', e);
      }
    };

    /**
     * 🔴 **절대 던지지 않는다.** 던지면 `tick` 이 거부되고 다음 주기를 예약하는 코드에
     * 닿지 못해 **폴링이 영원히 멈춘다** — 네트워크가 한 번 끊긴 것만으로 기능이 죽는다.
     * 실패는 전부 `UNKNOWN` 으로 접어 호출부가 다음 주기를 잡게 한다.
     */
    async function fetchStatus(): Promise<LiveStatus> {
      try {
        const response = await fetch(STATUS_URL(channelId), {
          credentials: 'omit',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
          warning(`liveResume: live-status responded ${response.status}`);
          return 'UNKNOWN';
        }
        return parseLiveStatus(await response.json());
      } catch (e) {
        warning('liveResume: live-status request failed', e);
        return 'UNKNOWN';
      }
    }

    async function tick(): Promise<void> {
      if (disposed) return;

      if (hasPlayer()) {
        // 방송이 붙었다. 이 페이지에서 감시할 일이 끝났고, 상한 카운터도 역할을 다했다.
        clearState();
        info('liveResume: player is present; stopping watch');
        return;
      }

      const status = await fetchStatus();
      if (disposed) return;
      completedPolls += 1;

      if (status !== 'OPEN') {
        if (status === 'UNKNOWN') {
          warning('liveResume: could not read live status; retrying next cycle');
        }
        schedule(pollIntervalFor(completedPolls));
        return;
      }

      const state = loadState();
      if (!shouldReload(status, state)) {
        warning(
          `liveResume: status is OPEN but the page stayed offline after ` +
            `${state.count} reloads; giving up on this channel`,
        );
        return;
      }

      try {
        saveState({ channelId, count: state.count + 1, at: Date.now() });
      } catch {
        return;
      }
      info(`liveResume: broadcast resumed; reloading (${state.count + 1}/${MAX_RELOADS})`);
      location.reload();
    }

    schedule(SETTLE_MS);

    return () => {
      disposed = true;
      clearTimer();
    };
  },
};
