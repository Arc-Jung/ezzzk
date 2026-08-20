// 치지직 토큰으로 전환 (2026-08-20, docs/chzzk-tone-ui-plan.md P2)
/**
 * 설정 패널 전용 스타일. 시트 공용 클래스(`cm-sheet__*`)로 부족한 **탭 레일·목록 레이아웃**만 담는다.
 *
 * `.css` 파일이 아니라 문자열 모듈인 이유: content script 는 `upsertStyle` 로 스타일을 주입하며
 * (`SHEET_CSS` 와 동일한 방식), 별도 CSS 파일은 확장 번들에서 자동으로 페이지에 붙지 않는다.
 */
import { BG, BORDER, FG, RADIUS, ACCENT } from '../ui/tokens';

export const SETTINGS_PANEL_CSS = `
.cm-sp { display: flex; gap: 14px; align-items: flex-start; }
.cm-sp__rail {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 0 0 auto;
  min-width: 104px;
  padding: 4px;
  border: 1px solid ${BORDER.subtle};
  border-radius: ${RADIUS.md};
  background: ${BG.raised};
}
.cm-sp__tab {
  min-height: var(--cm-target, 32px);
  /* 세로 폭만 채우면 터치 타겟이 43×44 로 미달한다 (실측 2026-08-12, 모바일 세로) — FR-12 */
  min-width: var(--cm-target, 32px);
  padding: 5px 10px;
  border: 0;
  border-radius: ${RADIUS.sm};
  background: transparent;
  color: ${FG.body};
  text-align: left;
  cursor: pointer;
}
.cm-sp__tab[aria-selected='true'] { background: ${BG.raised}; color: ${ACCENT}; font-weight: 700; }
.cm-sp__panel { flex: 1 1 auto; min-width: 0; }
.cm-sp__panel h3 { margin: 12px 0 4px; font-size: 12px; color: ${FG.muted}; }
.cm-sp__controls { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.cm-sp__controls label { display: inline-flex; align-items: center; gap: 4px; }
.cm-sp__list { list-style: none; margin: 4px 0; padding: 0; }
.cm-sp__list > li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 3px 0;
}
.cm-sp__list > li.cm-sp__list-item--stack { display: block; }
.cm-sp__list input[type='text'] { flex: 1 1 auto; min-width: 0; }
/*
 * 켜기/끄기 토글 스위치. 트랙(막대) + 노브(원) 로 그린다 — 예전엔 켜기 ●──/끄기 ──○ 처럼
 * 글자로 그린 그림이라 작은 크기에서 방향 구분이 안 됐고 폰트마다 폭도 들쑥날쑥했다(사용자 보고).
 * 표준 방향: OFF = 노브 왼쪽 · ON = 노브 오른쪽.
 * 색약 사용자는 트랙 색을 구분 못 하므로 켜기/끄기 글자를 스위치 옆(.cm-sp__toggle-text)에
 * 그대로 남긴다 — 상태를 트랙 색 + 노브 위치 + 글자 세 가지로 전달한다.
 * 터치 타겟: 이 버튼은 .cm-sheet button 규칙(min-height: var(--cm-target)) 을 그대로
 * 받으므로 모바일에서 44px 를 유지한다 — 이 파일에서 별도로 min-height 를 좁히지 않는다.
 */
.cm-sp__toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 2px;
  border: 0;
  background: transparent;
  color: ${FG.body};
  cursor: pointer;
}
.cm-sp__toggle-text { font-size: 12px; min-width: 26px; text-align: right; }
.cm-sp__toggle-track {
  position: relative;
  flex: 0 0 auto;
  width: 36px;
  height: 20px;
  border-radius: ${RADIUS.circular};
  background: ${BORDER.subtle};
  transition: background-color 0.15s ease;
}
.cm-sp__toggle[aria-checked='true'] .cm-sp__toggle-track { background: ${ACCENT}; }
.cm-sp__toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: ${RADIUS.circular};
  background: ${FG.primary};
  transition: transform 0.15s ease;
}
.cm-sp__toggle[aria-checked='true'] .cm-sp__toggle-knob { transform: translateX(16px); }

/*
  설정 패널 맨 아래의 오픈소스 라이선스 진입점.
  .cm-sp 는 탭 레일과 본문을 나란히 놓는 flex 행이라 그 **바깥**에 둔다 —
  안에 넣으면 좁은 화면에서 레일이 세로 줄로 접힐 때 탭 하나처럼 보인다.
*/
.cm-sp-foot {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid ${BORDER.subtle};
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

/* 라이선스 화면. 본문 스크롤은 .cm-sheet__body 가 하므로 여기서 높이를 잡지 않는다. */
.cm-lic h3 { margin: 14px 0 4px; font-size: 12px; color: ${FG.muted}; }
.cm-lic h3:first-child { margin-top: 0; }
.cm-lic__list { list-style: none; margin: 6px 0 0; padding: 0; }
.cm-lic__item { padding: 6px 0; border-bottom: 1px solid ${BORDER.subtle}; }
.cm-lic__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.cm-lic__name { font-weight: 700; word-break: break-word; }
.cm-lic__brief {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  padding: 4px 0;
  border-bottom: 1px solid ${BORDER.subtle};
}
.cm-lic__kind {
  flex: 0 0 auto;
  padding: 0 6px;
  border: 1px solid ${BORDER.subtle};
  border-radius: ${RADIUS.xs};
  font-size: 11px;
  color: ${FG.muted};
}
/*
  라이선스 전문은 원어 그대로 싣는다. 원문의 줄바꿈은 살리되(pre-wrap) 좁은 화면에서
  가로 스크롤이 생기지 않도록 접어 준다 — 모바일 세로(412px)에서 가로 스크롤이 생기면
  본문 전체가 옆으로 밀려 읽을 수 없다.
*/
.cm-lic__text {
  margin: 6px 0 0;
  padding: 8px;
  border: 1px solid ${BORDER.subtle};
  border-radius: ${RADIUS.sm};
  background: ${BG.raised};
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* 좁은 화면(태블릿 세로·모바일)에서는 탭 레일을 위쪽 가로 줄로 접는다. */
@media (max-width: 700px) {
  .cm-sp { flex-direction: column; }
  .cm-sp__rail { flex-direction: row; flex-wrap: wrap; width: 100%; min-width: 0; }
  .cm-sp__panel { width: 100%; }
}

/*
  🔴 **세로가 짧은 화면**(모바일 가로 915×412)도 같은 처방이 필요하다 (실측 2026-08-16, 실사이트).
  시트 높이가 80vh = 330px 로 줄면 본문에 남는 높이가 198px 뿐이라, 세로 레일에서는 탭 7개 중
  3개만 보이고 나머지는 스크롤해야 나온다. 그런데 레일이 본문과 함께 스크롤되므로 아래로 내리면
  탭 자체가 화면에서 사라져 **어느 탭에 있는지도 알 수 없다** (본문은 scrollHeight 358 /
  clientHeight 198 로 스크롤 자체는 됐다 — 잘려서 못 읽히는 것이 문제였다).
  → 레일을 가로 줄로 접어 탭 7개를 한 번에 보이게 하고, 남는 높이를 전부 내용에 준다.
  폭 조건과 달리 max-height 라 태블릿10 가로(820px)처럼 높이가 넉넉한 화면은 영향받지 않는다.
  ⚠️ 이 문자열은 템플릿 리터럴이다 — 주석에 백틱을 쓰지 않는다 (빌드가 깨진다).
*/
@media (max-height: 560px) {
  .cm-sp { flex-direction: column; }
  .cm-sp__rail { flex-direction: row; flex-wrap: wrap; width: 100%; min-width: 0; }
  .cm-sp__panel { width: 100%; }
}
/*
  하단 스크롤 신호 (감사 보고서 심각도 높음 #3, 2026-08-20).
  채팅·소리·기타 탭은 내용이 본문 스크롤 영역보다 길어 마지막 컨트롤(유저 필터·로그인 관련
  토글·라이선스 진입 등)이 스크롤 없이는 전혀 보이지 않는데, 스크롤이 더 있다는 시각 신호가
  없었다 — docs/ui-audit/settings-채팅-mobile-portrait.png · settings-소리-mobile-portrait.png ·
  settings-기타-mobile-portrait.png 를 직접 열어 잘리는 지점을 확인했다.

  본문 스크롤 자체는 이미 된다 — .cm-sheet__body 가 overflow-y: auto, min-height: 0 을
  갖는다(Sheet.tsx SHEET_CSS). 문제는 "더 있다"는 신호가 없다는 것뿐이라, 그 스크롤러 자신의
  **배경 레이어**로 신호를 얹는다. 별도 오버레이 엘리먼트를 두지 않으므로 버튼을 가려 클릭을
  막을 여지가 원천적으로 없다 — pointer-events: none 을 걸 대상 자체가 없다.

  방식: background-attachment 이중 배경 트릭(JS 스크롤 리스너 없음, 그러므로 스크롤마다 비용이
  들지 않는다).
  - 그림자 레이어(attachment: scroll — 스크롤러 자신 기준으로 고정): 뷰포트 하단에 반투명
    그라데이션을 얹어 "아래에 더 있다"를 알린다.
  - 덮개 레이어(attachment: local — 콘텐츠와 함께 스크롤): 배경색과 같은 단색을 콘텐츠의
    **맨 끝**에 고정해 콘텐츠와 함께 움직인다. 끝까지 스크롤하면 이 덮개가 뷰포트 하단과
    겹쳐 그림자를 배경색으로 덮어 사라지게 한다. 스크롤이 필요 없을 만큼 짧은 탭(예: 재생)은
    콘텐츠 끝이 이미 뷰포트 하단과 같은 자리라 처음부터 겹쳐 있어 그림자가 아예 보이지 않는다.
  configSheetCss.ts 의 .cm-sheet__body:has(.cm-mv-columns) 와 같은 패턴으로 :has() 를 써
  설정 패널(.cm-sp)에만 적용한다 — 라이선스 화면 등 다른 시트의 스크롤은 건드리지 않는다.
  ⚠️ 그림자 진하기(0.45)는 눈대중이다(미검증) — 실기기 재현 시 조정이 필요할 수 있다.
*/
.cm-sheet__body:has(.cm-sp) {
  background-image:
    linear-gradient(${BG.floating}, ${BG.floating}),
    linear-gradient(to top, rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0));
  background-repeat: no-repeat, no-repeat;
  background-position: bottom, bottom;
  background-size: 100% 26px, 100% 26px;
  background-attachment: local, scroll;
  background-color: ${BG.floating};
}
`.trim();
