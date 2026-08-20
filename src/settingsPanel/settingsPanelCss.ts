/**
 * 설정 패널 전용 스타일. 시트 공용 클래스(`cm-sheet__*`)로 부족한 **탭 레일·목록 레이아웃**만 담는다.
 *
 * `.css` 파일이 아니라 문자열 모듈인 이유: content script 는 `upsertStyle` 로 스타일을 주입하며
 * (`SHEET_CSS` 와 동일한 방식), 별도 CSS 파일은 확장 번들에서 자동으로 페이지에 붙지 않는다.
 */

export const SETTINGS_PANEL_CSS = `
.cm-sp { display: flex; gap: 14px; align-items: flex-start; }
.cm-sp__rail {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 0 0 auto;
  min-width: 104px;
  padding: 4px;
  border: 1px solid #2a2d31;
  border-radius: 8px;
  background: #1c1f22;
}
.cm-sp__tab {
  min-height: var(--cm-target, 32px);
  /* 세로 폭만 채우면 터치 타겟이 43×44 로 미달한다 (실측 2026-08-12, 모바일 세로) — FR-12 */
  min-width: var(--cm-target, 32px);
  padding: 5px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #e9ecef;
  text-align: left;
  cursor: pointer;
}
.cm-sp__tab[aria-selected='true'] { background: #23262a; color: #00ffa3; font-weight: 700; }
.cm-sp__panel { flex: 1 1 auto; min-width: 0; }
.cm-sp__panel h3 { margin: 12px 0 4px; font-size: 12px; color: #9aa0a6; }
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
  설정 패널 맨 아래의 오픈소스 라이선스 진입점.
  .cm-sp 는 탭 레일과 본문을 나란히 놓는 flex 행이라 그 **바깥**에 둔다 —
  안에 넣으면 좁은 화면에서 레일이 세로 줄로 접힐 때 탭 하나처럼 보인다.
*/
.cm-sp-foot {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid #2a2d31;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

/* 라이선스 화면. 본문 스크롤은 .cm-sheet__body 가 하므로 여기서 높이를 잡지 않는다. */
.cm-lic h3 { margin: 14px 0 4px; font-size: 12px; color: #9aa0a6; }
.cm-lic h3:first-child { margin-top: 0; }
.cm-lic__list { list-style: none; margin: 6px 0 0; padding: 0; }
.cm-lic__item { padding: 6px 0; border-bottom: 1px solid #23262a; }
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
  border-bottom: 1px solid #23262a;
}
.cm-lic__kind {
  flex: 0 0 auto;
  padding: 0 6px;
  border: 1px solid #2a2d31;
  border-radius: 4px;
  font-size: 11px;
  color: #9aa0a6;
}
/*
  라이선스 전문은 원어 그대로 싣는다. 원문의 줄바꿈은 살리되(pre-wrap) 좁은 화면에서
  가로 스크롤이 생기지 않도록 접어 준다 — 모바일 세로(412px)에서 가로 스크롤이 생기면
  본문 전체가 옆으로 밀려 읽을 수 없다.
*/
.cm-lic__text {
  margin: 6px 0 0;
  padding: 8px;
  border: 1px solid #2a2d31;
  border-radius: 6px;
  background: #1c1f22;
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
`.trim();
