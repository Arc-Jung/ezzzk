/**
 * FR-14.1 멀티뷰 구성 시트 전용 스타일.
 *
 * 🔴 이 파일이 없던 동안 `.cm-mv-*` 클래스에 **CSS 가 전혀 없어** 시트가 스타일 없는 블록
 * 나열로 렌더됐다 (실측 2026-08-12, `ui-profile-shots/laptop13--config-sheet.png`):
 * - 2단 구성이 적용되지 않아 슬롯 배치가 세로로 늘어지고 **채널 목록 전체가 접힌 화면 밖**으로
 *   밀렸다. 시트의 핵심 작업(채널 고르기)에 도달하려면 스크롤을 내려야 했다.
 * - 슬롯이 2×2 미리보기 그리드가 아니라 수직 목록이었다.
 * - "슬롯 711×449" 가 슬롯마다 반복돼 같은 정보가 4번 나왔다.
 *
 * 목업 화면 ② 의 배치(좌: 슬롯 배치 / 우: 채널 목록)를 따른다.
 */

/** 우측 채널 목록이 접히기 시작하는 시트 폭. 이보다 좁으면 1단으로 쌓는다. */
const TWO_COLUMN_MIN_PX = 680;

/**
 * ⚠️ 상단 옵션 줄에는 공용 `.cm-sheet__row` 를 쓰지 않는다.
 * 그쪽은 `justify-content: space-between` 이라 체크박스와 라벨이 화면 양끝으로 벌어진다
 * (실측 2026-08-12: "비활성 슬롯 화질 720p" 체크박스가 라벨과 1,000px 떨어져 렌더됐다).
 * 대신 `.cm-mv-options` 로 왼쪽부터 흐르게 둔다.
 *
 * ⚠️ **이 CSS 는 템플릿 리터럴 안에 들어간다 — 주석에 백틱을 쓰지 않는다.**
 * 백틱을 넣으면 문자열이 끊겨 빌드가 깨진다 (두 번 겪었다).
 */

export const CONFIG_SHEET_CSS = `
.cm-mv-splits {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  padding: 6px 10px;
  border: 1px solid #2a2d31;
  border-radius: 8px;
}
.cm-mv-splits legend { padding: 0 4px; font-size: 11px; color: #9aa0a6; }
.cm-mv-splits label { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.cm-disabled { opacity: 0.4; }

/*
  🔴 멀티뷰 시트 본문은 **자기 자신이 스크롤되지 않고**, 안쪽 채널 목록만 스크롤되게 한다.
  본문과 목록이 둘 다 스크롤되면 아래 .cm-mv-scroll 주석의 사고가 난다.
  :has() 로 멀티뷰 시트일 때만 적용해 다른 시트(설정 패널 등)의 스크롤을 건드리지 않는다.
*/
.cm-sheet__body:has(.cm-mv-columns) {
  display: flex;
  flex-direction: column;
  min-height: 0;
  /* 목록 끝에서 스크롤이 이어져도 뒤 페이지까지 번지지 않게 시트에서 멈춘다. */
  overscroll-behavior: contain;
}

/* 좌: 슬롯 배치 / 우: 채널 목록 (목업 화면 ②) */
.cm-mv-columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
  gap: 14px;
  align-items: stretch;
  margin-top: 10px;
  /* 본문에서 남은 높이를 전부 차지한다. min-height:0 이 없으면 grid 가 줄지 않는다. */
  flex: 1 1 auto;
  min-height: 0;
}
@media (max-width: ${TWO_COLUMN_MIN_PX}px) {
  /* 1단으로 쌓일 때는 슬롯 배치는 내용 높이, 채널 목록이 남은 높이를 갖는다. */
  .cm-mv-columns {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
  }
  /*
    🔴 좁은 화면에서는 시트를 더 높게 쓴다 (실측 2026-08-15, mobile-portrait 412×915).
    공용 시트 높이 min(600px, 80vh) 로는 본문 가시 높이가 468px 뿐인데 위쪽 옵션만 354px,
    슬롯 배치 99px 이라 목록을 넣기 전에 이미 넘쳤다 (본문 넘침 156px). 그 결과 슬롯 ① 의
    "소리 활성" 라디오가 본문 바닥(692px)에 걸쳐 하단 푸터에 가렸다.
    옵션을 줄이는 대신(기능을 없애지 않는다) 세로를 더 준다 — 92vh 로도 목록은 2행뿐이다.
    멀티뷰 시트에만 적용한다(:has). 다른 시트는 목업 실측값 그대로 둔다.
  */
  .cm-sheet-backdrop:has(.cm-mv-columns) .cm-sheet { height: min(860px, 92vh); }
}
.cm-mv-columns > section { min-width: 0; }
.cm-mv-columns h3 { margin: 0 0 6px; font-size: 12px; color: #9aa0a6; }

/* 슬롯 미리보기 — 분할 수에 맞춘 그리드 */
.cm-mv-grid {
  display: grid;
  gap: 6px;
}
.cm-mv-grid[data-split='2'] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.cm-mv-grid[data-split='3'] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.cm-mv-grid[data-split='3'] .cm-mv-cell:first-child { grid-row: span 2; }
.cm-mv-grid[data-split='4'] { grid-template-columns: repeat(2, minmax(0, 1fr)); }

.cm-mv-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 8px;
  background: #1a1c1f;
  border: 1px solid #2a2d31;
  border-radius: 8px;
}
.cm-mv-cell__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
}
/* 채널명이 길어도 ✕ 버튼을 밀어내지 않게 한다 */
.cm-mv-cell__head > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cm-mv-cell__head button { flex: 0 0 auto; }
.cm-mv-audio { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }

/* 채널 목록 */
.cm-mv-list { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
/*
  🔴 채널 목록에 **자체 스크롤 영역**을 준다 (실측 2026-08-12).
  무한 스크롤로 목록이 230개까지 자라면 시트 본문 전체가 함께 늘어나
  아래쪽 설정(슬롯 채팅 줄·배치 방식·비활성 슬롯 화질)에 **도달할 수 없었다.**
  목록만 스크롤되게 묶어 두면 아래 설정이 항상 화면에 남는다.

  🔴 다만 높이를 고정값(max-height: min(48vh, 420px))으로 주면 **같은 사고가 되풀이된다**
  (실측 2026-08-15, laptop13 1440×900):
  - .cm-sheet__body 가시 영역은 204~696px 인데 .cm-mv-scroll 은 414~834px 로 잡혀,
    스크롤 상자의 **아래 138px 가 footer.cm-sheet__foot 뒤에 영구히 숨었다.**
  - 게다가 overscroll-behavior: contain 이라 목록 끝에서 바깥 본문으로 스크롤이 이어지지 않아,
    마지막 행(7번 따효니)의 슬롯 배치 버튼 ①②③④ 를 **어떤 방법으로도 누를 수 없었다.**
  → 높이는 고정값이 아니라 **본문에서 헤더·푸터·위쪽 옵션을 뺀 남은 높이**로 정한다.
    flex 로 계산하므로 창 크기가 바뀌면 자동으로 다시 잡힌다 (§FR-12.1: 캐시하지 않는다).
  → 스크롤 연쇄는 바깥 .cm-sheet__body 에서 막는다. 여기서 contain 으로 막으면 위 사고가 난다.
*/
.cm-mv-scroll {
  flex: 1 1 auto;
  min-height: 72px;
  overflow-y: auto;
  padding-right: 4px;
}
.cm-mv-channels {
  list-style: none;
  margin: 0 0 6px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cm-mv-channels > li {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 3px 6px;
  border-radius: 6px;
}
.cm-mv-channels > li:hover { background: #1f2226; }
/* 채널명이 남는 폭을 먹고, 시청자 수·배치 버튼은 밀리지 않는다 */
.cm-mv-channels > li > span:first-child {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cm-mv-channels > li > span:not(:first-child) { flex: 0 0 auto; }
.cm-mv-channels .cm-sheet__btn { padding: 2px 7px; }
.cm-offline { opacity: 0.55; }

.cm-stepper { display: inline-flex; align-items: center; gap: 4px; }
.cm-stepper output { min-width: 24px; text-align: center; }

/* 상단 옵션 줄 — 왼쪽부터 자연스럽게 흐르게 둔다 (아래 주석 참조) */
.cm-mv-options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 18px;
  padding: 5px 0;
}
.cm-mv-options > label { display: inline-flex; align-items: center; gap: 5px; }
.cm-mv-options > span:first-child { color: #9aa0a6; }
`.trim();
