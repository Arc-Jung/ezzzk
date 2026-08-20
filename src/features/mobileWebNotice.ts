/**
 * FR-10.4 `m.chzzk` 안내.
 *
 * 🔴 **자동 리다이렉트는 원리적으로 불가능하다** (실측 2026-08-12,
 * `chzzk-dom-33-desktop-redirect.json`).
 * 모바일 UA 로 `chzzk.naver.com` 에 가면 치지직이 다시 `m.chzzk.naver.com` 으로 보낸다.
 * 그래서 우리가 리다이렉트하면 **무한 루프**가 된다. 억제 수단을 12가지 시도했고 **전부 실패**했다:
 * - 쿼리 파라미터 8종 (`?nomobile=1` · `?desktop=1` · `?pc=1` · `?full=1` · `?mode=pc` ·
 *   `?device=pc` · `?m=0` · 없음) → 12/12 모두 `m.chzzk` 로 귀결
 * - 쿠키 4종 (`nomobile` · `PC_VIEW` · `view` · `device`, `domain=.naver.com`) → 전부 실패
 *
 * 유일한 방법은 `declarativeNetRequest` 로 UA 를 위조하는 것인데, 광범위 host 권한이 필요해
 * **NFR-06(권한 최소화)과 정면으로 충돌**하고 스토어 심사 부담이 커진다 (요구사항 FR-10.4 미채택 경로).
 * → 강제 이동·강제 UA 변경은 하지 않고 **안내만 1회 노출**한다. 사용자가 브라우저의
 * "데스크톱 사이트 요청"을 켜면 그 순간부터 모든 기능이 동작한다.
 */

import { OURS } from '../constants/class';
import { upsertStyle, removeStyle } from '../utils/dom';
import { info } from '../utils/log';
import type { Feature } from './types';

const NOTICE_ID = 'cm-mobile-web-notice';
const NOTICE_STYLE_ID = 'cm-mobile-web-notice-style';
/** 안내를 이미 닫았는지. `chrome.storage` 가 아니라 세션 단위로 둔다 — 매 세션 1회면 충분하다. */
const DISMISS_KEY = 'ezzzk.mobileNoticeDismissed';

function noticeCss(touchTargetPx: number): string {
  return `
#${NOTICE_ID} {
  position: fixed;
  left: 8px;
  right: 8px;
  bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  z-index: ${OURS.topZIndex};
  padding: 12px 14px;
  border-radius: 10px;
  background: #16181bf2;
  border: 1px solid #2a2d31;
  color: #e9ecef;
  font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', -apple-system, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}
#${NOTICE_ID} b { color: #00ffa3; }
#${NOTICE_ID} p { margin: 0 0 8px; }
#${NOTICE_ID} ol { margin: 0 0 10px; padding-left: 18px; }
#${NOTICE_ID} li { margin: 2px 0; }
#${NOTICE_ID} .cm-notice-actions { display: flex; justify-content: flex-end; gap: 8px; }
#${NOTICE_ID} button {
  min-height: ${Math.max(40, touchTargetPx)}px;
  padding: 0 14px;
  border: 1px solid #2a2d31;
  border-radius: 6px;
  background: #1c1f22;
  color: #e9ecef;
  font-size: 13px;
  cursor: pointer;
}
`.trim();
}

export const mobileWebNoticeFeature: Feature = {
  id: 'mobileWebNotice',
  watches: [],
  supports: (ctx) => ctx.page.type === 'mobile-web' && !ctx.page.isSlotFrame,
  start: (ctx) => {
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === '1') return;
    } catch {
      // 시크릿 모드 등에서 sessionStorage 접근이 막힐 수 있다. 그때는 그냥 노출한다.
    }

    upsertStyle(NOTICE_STYLE_ID, noticeCss(ctx.device.profile.touchTargetPx));

    const box = document.createElement('div');
    box.id = NOTICE_ID;
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');

    const message = document.createElement('p');
    message.innerHTML =
      '이 페이지(<b>m.chzzk</b>)에는 채팅과 넓은 화면이 없어 <b>화질·볼륨만</b> 동작합니다.';
    const steps = document.createElement('ol');
    steps.innerHTML =
      '<li>브라우저 <b>⋮</b> 메뉴를 엽니다</li>' +
      '<li><b>데스크톱 사이트</b>(데스크톱 사이트 요청)를 켭니다</li>' +
      '<li>가로로 돌리면 영상이 잘리지 않고 채팅이 함께 표시됩니다</li>';

    const actions = document.createElement('div');
    actions.className = 'cm-notice-actions';

    const dismiss = (remember: boolean) => {
      if (remember) {
        try {
          sessionStorage.setItem(DISMISS_KEY, '1');
        } catch {
          // 저장 실패는 무시한다 — 다음 진입에 다시 보이는 것뿐이다.
        }
      }
      box.remove();
    };

    const laterButton = document.createElement('button');
    laterButton.type = 'button';
    laterButton.setAttribute('aria-label', '안내 닫기');
    laterButton.textContent = '닫기';
    laterButton.addEventListener('click', () => dismiss(false));

    const neverButton = document.createElement('button');
    neverButton.type = 'button';
    neverButton.setAttribute('aria-label', '이 세션에서 다시 보지 않기');
    neverButton.textContent = '다시 보지 않기';
    neverButton.addEventListener('click', () => dismiss(true));

    actions.append(laterButton, neverButton);
    box.append(message, steps, actions);
    document.body.appendChild(box);

    info('mobile web notice shown (auto redirect is not possible without UA override)');

    return () => {
      box.remove();
      removeStyle(NOTICE_STYLE_ID);
    };
  },
};
