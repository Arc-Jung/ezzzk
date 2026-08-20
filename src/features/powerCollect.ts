/**
 * FR-06 통나무(파워) 자동 수집.
 *
 * ⚠️ 기본값은 **끄기**다 (`settings.powerCollect.enabled === false`). 약관·계정 리스크가 있어
 * 사용자가 명시적으로 켤 때만 동작한다.
 *
 * 경로
 * - 주 경로(약 60초): `GET  /service/v1/channels/{channelId}/log-power` → `content.claims[].claimId`
 *                     `PUT  /service/v1/channels/{channelId}/log-power/claims/{claimId}`
 * - 보조 경로(약 5초): 채팅 영역의 `통나무 받기` 버튼을 찾아 클릭.
 *
 * 이 API 는 **비공개 내부 API** 라 예고 없이 바뀔 수 있다. **실패를 정상 흐름으로 취급**하고,
 * 개별 실패는 무시하고 다음 주기에 재시도한다. 누적 실패는 `warning` 로그만 남긴다.
 *
 * ⚠️ 오클릭 위험 (실측 2026-08-11): 채팅 aside 안에 통나무 **랭킹 UI** 가 있다.
 *   `div[class*="_container_wl8bq_"]` > `button[class*="_ranking_button_wl8bq_"]`,
 *   `button[class*="_arrow_button_wl8bq_"][aria-label="주간 통나무 파워 랭킹으로"]` × 2
 * `통나무`·`파워` 텍스트로 버튼을 찾으면 **이 랭킹 화살표를 누르게 된다.** 반드시 제외한다.
 *
 * ⚪ **UNVERIFIED**: `통나무 받기` 버튼 **실물은 관측하지 못했다** (조사가 비로그인 상태였다).
 * 따라서 보조 경로의 매칭 규칙은 추정이며, 아무것도 못 찾으면 **조용히 아무 일도 하지 않는다.**
 *
 * 참조: chzzk-plus `src/feature/powerCollect.ts` (kyechan99/chzzk-plus, MIT License).
 * API 경로·주기·랭킹 제외 아이디어를 차용했다.
 */

import { CHZZK, ID, POWER_EXCLUDE_SELECTORS } from '../constants/class';
import { hasSideChat } from '../pageType';
import { normalizeText, qs, qsa } from '../utils/dom';
import { guardAsync, info, warning } from '../utils/log';
import type { Feature } from './types';

const API_BASE = 'https://api.chzzk.naver.com/service/v1';

/** 주 경로 주기 — 미수령 목록 조회·수령 */
const API_INTERVAL_MS = 60_000;
/** 보조 경로 주기 — 버튼 탐색·클릭 */
const BUTTON_INTERVAL_MS = 5_000;
/** 진입 직후 1회 실행 지연 — 페이지 초기화가 끝날 시간을 준다. */
const FIRST_RUN_DELAY_MS = 3_000;
/** 이만큼 연속 실패하면 warning 을 한 번 남긴다. */
const FAILURE_WARN_THRESHOLD = 5;

/** 통나무 수령을 의미하는 단어 조합. 둘 다 있어야 후보로 본다. */
const POWER_WORDS = /(통나무|파워|power|log)/i;
const CLAIM_WORDS = /(받기|수령|claim|receive)/i;

/**
 * 보조 경로의 클릭 대상 판정. **순수 함수** — 오클릭 회귀를 테스트로 고정한다.
 * `text` 를 인자로 받는 이유: 호출부가 `textContent` 와 `aria-label` 을 합쳐 정규화해 넘기기 때문이다.
 */
export function isEligiblePowerButton(el: Element, text: string): boolean {
  // 랭킹 UI·아코디언 버튼은 무조건 제외한다 (실측 오클릭 위험).
  for (const selector of POWER_EXCLUDE_SELECTORS) {
    try {
      if (el.closest(selector)) return false;
    } catch {
      return false;
    }
  }

  const className = typeof el.className === 'string' ? el.className : '';
  if (/ranking/i.test(className)) return false;

  const ariaLabel = el.getAttribute('aria-label') ?? '';
  if (ariaLabel.includes('랭킹')) return false;

  // 클래스에 power_button 이 있으면 강한 신호로 본다 (chzzk-plus 와 동일 판단).
  if (className.includes('power_button')) return true;

  return POWER_WORDS.test(text) && CLAIM_WORDS.test(text);
}

/** `content.claims[].claimId` 만 뽑는다. 형태가 어긋나면 빈 배열 — 실패는 정상 흐름이다. */
export function extractClaimIds(apiResponse: unknown): string[] {
  if (typeof apiResponse !== 'object' || apiResponse === null) return [];
  const content = (apiResponse as Record<string, unknown>)['content'];
  if (typeof content !== 'object' || content === null) return [];
  const claims = (content as Record<string, unknown>)['claims'];
  if (!Array.isArray(claims)) return [];

  const ids: string[] = [];
  for (const claim of claims) {
    if (typeof claim !== 'object' || claim === null) continue;
    const claimId = (claim as Record<string, unknown>)['claimId'];
    if (typeof claimId === 'string' && claimId.length > 0) ids.push(claimId);
    else if (typeof claimId === 'number') ids.push(String(claimId));
  }
  return ids;
}

/**
 * 로그인 여부 추정. 전송 버튼이 `disabled` 면 비로그인이다 (실측 2026-08-11).
 * 확실한 판정 수단이 아니므로 **막지 않고 조용히 건너뛰는 용도로만** 쓴다.
 */
function looksLoggedOut(): boolean {
  const sendButton = qs<HTMLButtonElement>(CHZZK.chatSendButton);
  return sendButton !== null && sendButton.disabled;
}

export const powerCollectFeature: Feature = {
  id: 'powerCollect',
  watches: ['powerCollect'],
  // 데스크톱 라이브 전용. 기본값이 꺼짐이라 켜지 않으면 옵저버·타이머를 아예 만들지 않는다.
  supports: (ctx) =>
    ctx.settings.powerCollect.enabled &&
    hasSideChat(ctx.page.type) &&
    !ctx.page.isSlotFrame &&
    ctx.page.channelId !== null,
  start: (ctx) => {
    const channelId = ctx.page.channelId;
    if (channelId === null) return;

    let disposed = false;
    let collecting = false;
    let consecutiveFailures = 0;
    let warnedAtFailures = 0;

    const noteFailure = (): void => {
      consecutiveFailures += 1;
      if (
        consecutiveFailures >= FAILURE_WARN_THRESHOLD &&
        consecutiveFailures !== warnedAtFailures
      ) {
        warnedAtFailures = consecutiveFailures;
        warning(`log-power claim failed ${consecutiveFailures} times in a row, still retrying`);
      }
    };

    const collectViaApi = async (): Promise<void> => {
      if (disposed || collecting || looksLoggedOut()) return;
      collecting = true;
      try {
        const res = await fetch(`${API_BASE}/channels/${channelId}/log-power`, {
          credentials: 'include',
        });
        if (!res.ok) {
          // 401(권한 없음) 등은 오류가 아니라 "지금은 대상이 아님" 이다.
          noteFailure();
          return;
        }

        const ids = extractClaimIds(await res.json());
        if (ids.length === 0) {
          consecutiveFailures = 0;
          warnedAtFailures = 0;
          return;
        }

        let claimed = 0;
        for (const claimId of ids) {
          if (disposed) break;
          try {
            const put = await fetch(
              `${API_BASE}/channels/${channelId}/log-power/claims/${encodeURIComponent(claimId)}`,
              { method: 'PUT', credentials: 'include' },
            );
            if (put.ok) claimed += 1;
          } catch {
            // 개별 실패는 무시하고 다음 주기에 재시도한다.
          }
        }

        if (claimed > 0) {
          consecutiveFailures = 0;
          warnedAtFailures = 0;
          info(`log-power claimed ${claimed}/${ids.length}`);
        } else {
          noteFailure();
        }
      } catch {
        noteFailure();
      } finally {
        collecting = false;
      }
    };

    /**
     * 보조 경로. ⚪ 실물 버튼 미확인 상태라 **못 찾으면 아무 일도 하지 않고 조용히 물러난다.**
     */
    const clickPowerButton = (): void => {
      if (disposed || looksLoggedOut()) return;
      const aside = qs(ID.asideChatting);
      if (!aside) return;

      const target = qsa<HTMLButtonElement>('button', aside).find((button) => {
        const text = normalizeText(
          `${button.textContent ?? ''} ${button.getAttribute('aria-label') ?? ''}`,
        );
        return isEligiblePowerButton(button, text);
      });
      if (!target || target.disabled) return;

      target.click();
      info('log-power button clicked (secondary path)');
    };

    const apiTimer = setInterval(() => {
      void guardAsync('powerCollect.api', collectViaApi);
    }, API_INTERVAL_MS);
    const buttonTimer = setInterval(clickPowerButton, BUTTON_INTERVAL_MS);
    const firstRun = setTimeout(() => {
      void guardAsync('powerCollect.api', collectViaApi);
    }, FIRST_RUN_DELAY_MS);

    info(`power collect started for channel ${channelId}`);

    return () => {
      disposed = true;
      clearInterval(apiTimer);
      clearInterval(buttonTimer);
      clearTimeout(firstRun);
    };
  },
};
