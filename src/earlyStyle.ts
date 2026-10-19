/**
 * document_start 조기 스타일.
 *
 * 목적: FCP 시점에 채팅 폭이 점프하는 깜빡임을 막는다 (요구사항 §5.1b).
 * 여기서는 **레이아웃 값을 계산하지 않는다** — 값은 content script 가 크기 변화마다 재계산한다.
 * 조기 시점에는 최소 폭과 플레이어의 터치 제스처만 지정한다.
 *
 * ⚠️ `min-width: 0` 주입이 없으면 `_wj4te` 계열 컨테이너와 aside 의 `min-width: auto` 가
 * flex 축소를 차단해 좁은 화면에서 가로 스크롤이 생긴다 (실측 2026-08-11).
 * 데스크톱 레이아웃에는 반응형 브레이크포인트가 없고 최소폭 950px 를 고정 유지하므로,
 * 좁은 화면 대응은 전부 확장 책임이다.
 */

import { CHZZK, ID, OURS, PLAYER } from './constants/class';
import { isChzzkHost } from './pageType';

const EARLY_CSS = `
${ID.root}, ${ID.layoutBody}, main,
${CHZZK.layoutSection}, ${CHZZK.layoutWrapper} { min-width: 0 !important; }
${ID.asideChatting} { min-width: 0 !important; }
${CHZZK.mainContainer} { min-width: 0 !important; }
/*
 * 모바일의 데스크톱 사이트에서 영상 더블탭이 페이지 확대가 되는 것을 막는다.
 * 첫 터치 전에 적용해야 브라우저가 이 제스처를 줌으로 선점하지 않는다.
 * manipulation 은 스크롤·핀치 줌을 유지하며 더블탭 줌만 비활성화한다.
 * 플레이어 밖의 페이지 확대와 치지직의 클릭·더블클릭 이벤트는 그대로 둔다.
 */
${PLAYER.rootPc}, ${PLAYER.rootMobile} { touch-action: manipulation !important; }
`.trim();

function injectEarlyStyle(): void {
  if (!isChzzkHost(location.hostname)) return;
  if (document.getElementById(OURS.earlyStyleId)) return;

  const style = document.createElement('style');
  style.id = OURS.earlyStyleId;
  style.textContent = EARLY_CSS;

  // document_start 시점에는 head 가 아직 없을 수 있다.
  const parent = document.head ?? document.documentElement;
  parent.appendChild(style);
}

try {
  injectEarlyStyle();
} catch {
  // 조기 스타일 실패는 기능 실패가 아니다. 깜빡임만 남고 나머지는 정상 동작한다.
}
