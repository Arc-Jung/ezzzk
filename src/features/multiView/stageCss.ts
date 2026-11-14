import { OURS } from '../../constants/class';
import { ACCENT, FONT_FAMILY, RADIUS, UI_STATE } from '../../ui/tokens';

const STAGE_BAR_COMPACT_MAX_PX = 600;

/**
 * 스테이지 컨테이너의 폭은 CSS 에 박지 않고 `layout()` 이 무대 폭으로 인라인 지정한다.
 *
 * 멀티뷰 중에는 기존 우측 채팅을 비활성화하므로(2026-08-12 결정) 현재 무대 폭 = 뷰포트 폭이다.
 * 그래도 `inset: 0` 대신 인라인 폭을 쓰는 이유: 무대 폭이 뷰포트와 달라지는 구성이 다시
 * 생기면 **컨테이너가 무대보다 넓어 검은 띠(죽은 공간)가 남는 버그**가 되살아난다.
 * 실제로 그 버그를 겪었다 — 사이드 채팅 353px 을 남겼을 때 컨테이너가 그 위를 덮어
 * 채팅은 안 보이고 폭만 368px 낭비됐다 (`multiview-shots/`). 폭 결정 지점을 한 곳으로 묶어 둔다.
 */
export function buildStageCss(touchTargetPx: number, alwaysShowHeader: boolean): string {
  return `
#${OURS.multiViewStageId} {
  position: fixed;
  top: 0;
  left: 0;
  height: 100%;
  z-index: ${OURS.topZIndex - 2};
  background: #000;
  font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', -apple-system, sans-serif;
  color: #e9ecef;
  font-size: 12px;
}
#${OURS.multiViewStageId} .cm-slot {
  position: absolute;
  overflow: hidden;
  background: #000;
  outline: 1px solid #1c1f22;
}
#${OURS.multiViewStageId} .cm-slot iframe {
  display: block;
  border: 0;
  width: 100%;
}
#${OURS.multiViewStageId} .cm-slot__head {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  background: linear-gradient(#000c, transparent);
  z-index: 2;
  /* 터치 기기는 호버로만 드러나는 요소를 두지 않는다 (FR-12). */
  opacity: ${alwaysShowHeader ? 1 : 0};
  transition: opacity 120ms;
}
#${OURS.multiViewStageId} .cm-slot:hover .cm-slot__head { opacity: 1; }
#${OURS.multiViewStageId} .cm-slot__head button {
  min-width: ${touchTargetPx}px;
  min-height: ${touchTargetPx}px;
  border: 1px solid #2a2d31;
  border-radius: 5px;
  background: #1c1f22cc;
  color: #e9ecef;
  cursor: pointer;
}
/* 슬롯 채팅 스트립 — 1줄 고정, 말줄임, 이미지 미렌더 (FR-14.2) */
#${OURS.multiViewStageId} .cm-slot-chat-strip {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
  padding: 4px 6px;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 0;
}
#${OURS.multiViewStageId} .cm-slot-chat-strip--overlay {
  background: linear-gradient(transparent, #000c);
  text-shadow: 0 1px 2px #000;
}
#${OURS.multiViewStageId} .cm-slot-chat-strip--reserve { background: #0e0f11; }
#${OURS.multiViewStageId} .cm-slot-chat-line {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#${OURS.multiViewStageId} .cm-slot-chat-line b { font-weight: 600; margin-right: 4px; }
#${OURS.multiViewStageId} .cm-slot__error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 12px;
  color: #ffb454;
}
/* 재생이 시작되지 않는 슬롯 안내 (2026-08-24). 로드 자체는 성공한 상태라 error 와 색을 달리한다. */
#${OURS.multiViewStageId} .cm-slot__notice {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 12px;
  color: #ffd479;
  background: rgba(0, 0, 0, 0.55);
  pointer-events: none;
}
/* 광고 상태는 영상·스킵 버튼을 가리지 않는 작은 안내로 표시한다. */
#${OURS.multiViewStageId} .cm-slot__ad-notice {
  position: absolute;
  left: 12px;
  top: calc(28px + var(--cm-bar-overlap, 0px));
  max-width: calc(100% - 24px);
  box-sizing: border-box;
  padding: 6px 10px;
  border-radius: 6px;
  color: #211800;
  background: #ffdc73;
  border: 1px solid #fff3bd;
  font-size: 13px;
  font-weight: 600;
  z-index: 3;
  pointer-events: none;
}
#${OURS.multiViewStageId} .cm-slot__ad-notice strong { font-size: 14px; font-weight: 800; }
#${OURS.multiViewStageId} .cm-slot__retry {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 12px;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  pointer-events: none;
}
/**
 * 스테이지 조작 바. **가운데 상단**에 둔다 (사용자 요청 2026-08-15).
 * 하단 가운데에 두면 플레이어 컨트롤바·채팅 스트립과 같은 자리를 다퉈 다른 버튼을 가린다.
 *
 * 바가 차지하는 위쪽 띠는 stageTopInset() 이 슬롯 배치에서 떼어 낸다 — 슬롯 헤더 버튼이
 * 바에 덮여 눌리지 않던 회귀(2026-08-16)를 배치 단계에서 구조적으로 막는다.
 * 그래서 top 값은 그대로 띠 높이에 반영되니 불필요하게 키우지 않는다.
 */
/*
  🔴 바는 절대 뷰포트를 넘지 않는다 (실측 회귀 2026-08-18: 412px 세로에서 좌우가 잘려
  멀티뷰 해제 버튼을 누를 수 없었다). 넘치면 줄바꿈한다 — 늘어난 높이는 stageTopInset() 이
  슬롯 배치 띠로 환산하므로 슬롯과 겹치지 않는다.
*/
#${OURS.multiViewStageId} .cm-stage-bar {
  /*
   * 실측 회귀 — left: 50% + transform: translateX(-50%) 로 가운데를 맞추면, width 를
   * fit-content 로 줘도 그 계산의 "가용 폭" 자체가 "컨테이너 폭 − left" 로 반토막난다
   * (412px 뷰포트에서 206px). CSS 절대 위치 스펙상 inset 한쪽(left)만 정해지면 shrink-to-fit
   * 계산이 그 한쪽만 기준으로 잡히기 때문이다 — 라벨을 다 숨겨도 그 반쪽 폭 안에서 계속
   * 줄바꿈되던 원인이 이것이었다. left·right 를 둘 다 0 으로 고정하고 margin: 0 auto 로
   * 가운데를 맞추면 가용 폭이 컨테이너 전체 폭이 된다 — 표준적인 "shrink-to-fit 가운데" 기법.
   */
  width: fit-content;
  max-width: calc(100vw - 8px);
  flex-wrap: wrap;
  justify-content: center;
  position: absolute;
  left: 0;
  right: 0;
  margin: 0 auto;
  top: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  background: #16181bbf;
  border: 1px solid ${UI_STATE.border};
  border-radius: ${RADIUS.lg};
  font-family: ${FONT_FAMILY};
  box-shadow: 0 4px 16px #0003;
  z-index: 3;
}
/*
  영상 위에서는 배경을 더 투명하게 한다.

  세로 자세는 슬롯을 가운데로 모아 위쪽에 검은 여백이 남으므로, 바는 대개 그 여백에 앉아
  영상을 하나도 가리지 않는다. 기본 배경은 불투명도 75%, 영상 위에서는 40% 로 낮추고,
  버튼 배경도 70% 로 해 뒤 영상이 비치면서 글자와 아이콘은 선명하게 유지한다.
  판정은 syncLayout() 의 barOverlapsSlots() 가 하고 data-overlay 로 넘어온다.
*/
#${OURS.multiViewStageId} .cm-stage-bar[data-overlay='true'] {
  background: #16181b66;
}
/*
  🔴 2026-08-16 회귀 방지 — 바가 슬롯 헤더 버튼을 덮으면 버튼이 눌리지 않는다
  (실측: 버튼 중심점의 elementFromPoint 가 div.cm-stage-bar).
  예전에는 바가 차지하는 띠를 슬롯 배치에서 통째로 떼어 내 겹칠 수 없게 했지만, 그러면
  바 높이만큼 영상이 작아진다. 지금은 겹치는 슬롯의 헤더만 바 아래로 밀어 클릭 경로를
  비운다 — 영상은 무대 전체를 쓰고 헤더는 여전히 눌린다.
*/
#${OURS.multiViewStageId} .cm-slot[data-under-bar='true'] .cm-slot__head {
  padding-top: calc(4px + var(--cm-bar-overlap, 0px));
}
#${OURS.multiViewStageId} .cm-stage-bar button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: ${touchTargetPx}px;
  min-height: ${touchTargetPx}px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: ${RADIUS.sm};
  background: #1c1f2280;
  font: inherit;
  transition: background-color 140ms ease, border-color 140ms ease;
  color: #e9ecef;
  cursor: pointer;
}
#${OURS.multiViewStageId} .cm-stage-bar button[aria-pressed='true'] {
  background: ${UI_STATE.selected};
  border-color: ${UI_STATE.selectedBorder};
}
#${OURS.multiViewStageId} .cm-stage-bar button:focus-visible {
  outline: 2px solid ${ACCENT}; outline-offset: 2px;
}
@media (hover: hover) {
  #${OURS.multiViewStageId} .cm-stage-bar button:hover {
    background: ${UI_STATE.hover}; border-color: ${UI_STATE.border};
  }
}
@media (prefers-reduced-motion: reduce) {
  #${OURS.multiViewStageId} .cm-stage-bar button { transition: none; }
}
#${OURS.multiViewStageId} .cm-stage-bar__label {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
#${OURS.multiViewStageId} .cm-stage-bar output { min-width: 40px; text-align: center; }
/*
  사이드 채팅 패널 (요청 2026-08-18).
  🔴 무대 오른쪽 **바깥**에 붙인다. 컨테이너 폭은 layout() 이 viewport - chatWidth 로 줄이므로
  패널은 그 옆 빈 자리를 차지한다 — 슬롯을 덮지 않는다(겹침 판정이 이것을 감시한다).
  치지직 원본 aside 는 계속 접힌 상태다: 그것은 호스트 채널 채팅이라 활성 슬롯과 어긋난다.
*/
#${OURS.multiViewStageId} .cm-stage-chat {
  position: absolute;
  top: 0;
  left: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: #141517;
  border-left: 1px solid #2a2d31;
  color: #e6e6e6;
  font-size: 12px;
  overflow: hidden;
}
#${OURS.multiViewStageId} .cm-stage-chat__head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid #2a2d31;
  font-weight: 700;
  white-space: nowrap;
}
#${OURS.multiViewStageId} .cm-stage-chat__title {
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 목록만 스크롤한다 — 헤더가 밀려 올라가면 어느 방송 채팅인지 알 수 없다. */
#${OURS.multiViewStageId} .cm-stage-chat__list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 6px 8px;
  line-height: 1.5;
}
#${OURS.multiViewStageId} .cm-stage-chat__line {
  overflow-wrap: anywhere;
}
#${OURS.multiViewStageId} .cm-stage-chat__line b {
  margin-right: 4px;
  font-weight: 600;
}
/* 전체 화면 전용 채팅 폭 컨트롤 */
#${OURS.multiViewStageId} .cm-stage-chat-controls {
  display: none;
  align-items: center;
  gap: 4px;
  padding-left: 8px;
  border-left: 1px solid #2a2d31;
}
#${OURS.multiViewStageId} .cm-stage-chat-controls output { min-width: 48px; }
/*
  🔴 좁은 화면에서 조작 바 1줄 압축 (사용자 보고: 3줄로 접혀 무대를 잡아먹음).
  버튼 크기(터치 타겟)는 절대 줄이지 않는다 — 라벨 글자만 숨기고 아이콘만 남긴다.
  간격은 오히려 넓힌다: 촘촘해 보이는 건 버튼이 커서가 아니라 간격이 부족해서다.
  라벨을 숨겨도 버튼의 aria-label 이 그대로 접근성 이름을 맡는다 (createBar 참고).
  laptop13(1440) 처럼 이 경계보다 넓은 화면은 그대로 라벨이 보인다.
*/
@media (max-width: ${STAGE_BAR_COMPACT_MAX_PX}px) {
  #${OURS.multiViewStageId} .cm-stage-bar {
    gap: 12px;
  }
  #${OURS.multiViewStageId} .cm-stage-bar__label {
    display: none;
  }
}
`.trim();
}
