/**
 * 데스크톱(chzzk.naver.com) DOM 셀렉터 집중 정의.
 *
 * 규칙 (요구사항 NFR-03 / 프론트엔드 분석 §7)
 * - A계층(ID) 최우선 → B계층(pzp-* + aria-label) → C계층(CSS 모듈 해시)
 * - C계층은 접두어 부분 일치만 쓴다. 접미 해시(_1tswz_2)는 절대 하드코딩하지 않는다.
 * - _container_ / _wrapper_ / _item_ 접두어는 너무 흔해 단독 사용 금지 — A/B 조상으로 범위를 좁힌다.
 * - 각 상수에 실측일과 실측값을 주석으로 남긴다.
 */

/** A계층 — ID. 해시 없음, 안정성 높음. (실측 2026-08-11) */
export const ID = {
  /** React 앱 루트 */
  root: '#root',
  /** 모달/팝업 포털 (실측 시점 비어 있음) */
  portal: '#portal',
  /** 라이브 레이아웃 본문. 실측: `_body_uaq06_11 _is_expanded_uaq06_22` */
  layoutBody: '#layout-body',
  /** 라이브 플레이어 컨테이너. 실측: `chzzk_player type_live has_shortcut lang_ko` */
  livePlayerLayout: '#live_player_layout',
  /** ⚠️ VOD 는 ID가 다르다 (실측 2026-08-11). 라이브와 분기 필수. */
  vodPlayerLayout: '#player_layout',
  /** 채팅 aside. 실측: width 353px, flex 0 0 auto, min-width auto */
  asideChatting: '#aside-chatting',
} as const;

/** B계층 — PrismPlayer `pzp-*`. 해시 없고 한국어 aria-label 을 가진다. (실측 2026-08-11) */
export const PLAYER = {
  /** 플레이어 루트. modifier: --playing / --live / --onlive / --vod / --muted / --pointer-mouse */
  rootPc: '.pzp-pc',
  rootMobile: '.pzp-mobile',
  video: 'video',

  playbackSwitch: 'button.pzp-pc__playback-switch',
  /** aria-label: `음소거`(=소리 켜짐) ↔ `음소거 해제`(=음소거됨) */
  volumeButton: 'button.pzp-pc__volume-button',
  /** role=slider, aria-valuenow, aria-valuetext */
  volumeSlider: 'div.pzp-pc__volume-slider',

  /**
   * ⚠️ 실측 정정 (2026-08-11 M0c): `button.pzp-pc__setting-button` 은 **3개 매칭**되고
   * querySelector 가 잡는 첫 번째는 `custom__shop-button ... --disabled` 로 0×0 / display:none 이다.
   * 그대로 쓰면 폴백이 조용히 실패한다 → aria-label 로 특정한다.
   */
  settingButton: 'button[aria-label="설정"], button.pzp-setting-button',
  /** aria-label: `넓은 화면`(=현재 좁음) ↔ `좁은 화면`(=현재 넓음). 상태 판별은 이 label 로 한다. */
  viewModeButton: 'button.pzp-viewmode-button',
  fullscreenButton: 'button.pzp-pc__fullscreen-button',

  /** 컨트롤바 버튼 그룹. 삽입 지점이며 리렌더 시 사라질 수 있다. */
  bottomButtonsLeft: 'div.pzp-pc__bottom-buttons-left',
  bottomButtonsRight: 'div.pzp-pc__bottom-buttons-right',

  /** 화질 목록. 선택 표시는 `--checked` 클래스뿐 — aria-checked 는 없다(실측). */
  qualityItem: 'li.pzp-ui-setting-quality-item',
  qualityItemChecked: 'pzp-ui-setting-pane-item--checked',
} as const;

/** 페이지 종류 판별용 (실측 2026-08-11) */
export const PAGE_KIND = {
  liveMarker: '.chzzk_player.type_live',
  vodMarker: '.chzzk_player.type_vod',
} as const;

/**
 * C계층 — 치지직 CSS 모듈. 접두어 부분 일치만 사용. (실측 2026-08-11)
 * 접미 해시는 빌드마다 바뀌므로 주석의 실측값은 참고용이다.
 */
export const CHZZK = {
  /** 실측 `section._container_wj4te_1` — min-width: auto ⚠️ */
  layoutSection: 'section[class*="_container_wj4te"]',
  /** 실측 `div._wrapper_wj4te_16` — display:flex row. 폭 배분의 핵심 컨테이너. min-width: auto ⚠️ */
  layoutWrapper: 'div[class*="_wrapper_wj4te"]',
  /** 실측 `main._container_1tswz_2 _show_chat_1tswz_17` — flex: 1 1 0% */
  mainContainer: 'main[class*="_container_1tswz"]',

  /** 채팅 스크롤 컨테이너. 실측 `div._wrapper_8lqsk_25` — overflow-y: auto, h=761 */
  chatScroller: '#aside-chatting [class*="_wrapper_8lqsk"]',
  /** 채팅 리스트 항목. 실측 `div._item_8lqsk_7` × 25~28 (가상 스크롤) */
  chatItem: '#aside-chatting [class*="_item_"]',
  /** 실측 `div._chatting_message_1y6kj_21` — h=28 (폰트 14px 원본) */
  chatMessage: '#aside-chatting [class*="_chatting_message_"]',
  /** 실측 `button._nickname_1y6kj_37` — aria-haspopup=true */
  chatNickname: '#aside-chatting [class*="_chatting_message_"] [class*="_nickname_"]',

  /** 실측 `textarea._input_1k5b6_...`. contenteditable 이 아니라 textarea 다. */
  chatInput: '#aside-chatting textarea[class*="_input_"]',
  /**
   * 채팅 **입력 영역** — 입력창과 도구 행을 함께 품는 블록 (실측 `div._area_b8csn_49` 353×105).
   *
   * ⚠️ `textarea.parentElement` 는 이 영역이 **아니다.** 실측 계층은
   * `_area_b8csn_49 > _container_1k5b6_2(313×42) > textarea` 이고 도구 행(`_tools_`)은
   * `_container_1k5b6_2` 의 **형제**다 (2026-08-11 `docs/frontend-dump/chzzk-dom-25-chat-clutter.json`).
   * 부모만 보고 도구 행을 찾으면 실사이트에서는 영원히 못 찾는다.
   */
  chatInputArea: '#aside-chatting [class*="_area_"]',
  /** 실측 `button._send_button_1k5b6_...` 텍스트 `채팅`. 비로그인 시 disabled. */
  chatSendButton: '#aside-chatting button[class*="_send_button_"]',

  /**
   * 입력창 아래 **도구 행** (실측 2026-08-15, `scripts/fixtures/live-page.html`).
   * 실측 `div._tools_1k5b6_125` — `display:flex; align-items:center`.
   * 자식은 왼쪽 `_donation_`(후원 관련 버튼 묶음) / 오른쪽 `_send_button_`(채팅).
   * 우리 버튼 묶음(`OURS.toolsSlotClass`)을 여기에 흐름 배치로 끼워 넣는다.
   *
   * 🔴 실측 정정 (2026-08-21, 실사이트 비로그인, mobile-portrait 412×915 · laptop13 1440×900):
   * **이모티콘 버튼은 이 도구 행 안에 없다.** 입력창(`textarea`)의 **형제**로 입력 컨테이너
   * (`_container_*`, `_area_` 의 다른 자식) 안에 있다 — blind 텍스트 `이모티콘`,
   * `aria-haspopup="true"`, class `*_input_button_*`. 그 컨테이너의 실측 여유폭은 26px 로
   * 최소 터치 타겟(모바일 44px / 랩탑 32px)보다 작아 우리 버튼을 넣으면 `freeWidthIn` 게이트가
   * 거의 항상 플로팅 폴백으로 보낸다 — 그래서 문구 버튼은 여전히 이 도구 행의 `_donation_`
   * 앞에 둔다 (`resolveToolsSlot` 참고). 근거: `etc/probe/chat-tools-row.json`.
   */
  chatTools: '#aside-chatting [class*="_tools_"]',
  /**
   * 도구 행 왼쪽의 **후원 관련 버튼 묶음** (실측 `div._donation_1k5b6_132`).
   * ⚠️ 내부 버튼 `_donation_text_` 도 `_donation_` 부분 일치에 걸리지만 문서 순서상
   * 바깥 블록이 먼저 잡힌다 — 반드시 `querySelector`(첫 매칭)로만 쓴다.
   *
   * 🔴 실측 정정 (2026-08-21, 실사이트 비로그인, mobile-portrait · laptop13): 내부 `_action_`
   * 안의 버튼 2개는 **이모티콘이 아니다.** `aria-label` 도 텍스트도 둘 다 없다
   * (`aria-haspopup="true"` 만 있음) — 후원(슈퍼챗류) 관련으로 보인다.
   * **`aria-label`·텍스트로 찾으려 하지 마라 — 둘 다 없다.** 이전 주석("_donation_ = 후원하기+
   * 이모티콘")은 실측 근거 없는 추정이었고 오류였다.
   */
  chatDonation: '#aside-chatting [class*="_donation_"]',

  /**
   * ⚠️ 통나무 랭킹 영역 (실측 `div._container_wl8bq_`).
   * FR-06 보조 버튼 탐색에서 **반드시 제외**한다. `통나무`·`파워` 텍스트로 찾으면
   * `aria-label="주간 통나무 파워 랭킹으로"` 화살표를 누르게 된다.
   */
  powerRankingContainer: '#aside-chatting [class*="_container_wl8bq"]',
} as const;

/** FR-06 보조 버튼 탐색 시 제외할 셀렉터·조건 (실측 2026-08-11 오클릭 위험 확인) */
export const POWER_EXCLUDE_SELECTORS = [
  '[class*="_wl8bq_"]',
  '[class*="ranking"]',
  '[aria-expanded]',
] as const;

/**
 * FR-13 치트키 팝업.
 * ⚠️ `body > div` 중 텍스트에 `치트키` 가 있는 첫 요소를 숨기면 `#root` 가 매칭돼
 * 페이지 전체가 사라진다 (실험 실증). 크기·위치 조건을 반드시 함께 쓴다.
 */
export const PROMO = {
  /** body 직계 후보 */
  bodyDirectChild: 'body > div',
  /** 명시 제외 목록 */
  excludeIds: ['root', 'portal', 'fb-root', 'naver-splugin-wrap', 'naver-splugin-dimmed'],
  /** 실측 배너: `div._container_1l6oy_2`, 394×113, x=763 y=887 (1920×1080) */
  banner: { minW: 250, maxW: 600, minH: 50, maxH: 300, text: '치트키' },
  /** 플레이어 내 툴팁. `#live_player_layout div.pzp-pc__bottom-buttons-left > div.tooltip` */
  playerTooltip: '#live_player_layout div.pzp-pc__bottom-buttons-left > div.tooltip',
} as const;

/** 확장이 삽입하는 노드의 ID·클래스. 치지직 것과 겹치지 않게 `cm-` 접두어를 쓴다. */
export const OURS = {
  /** document_start 조기 스타일 */
  earlyStyleId: 'cm-early-style',
  /** FR-15 채팅 폰트 단일 style 태그 (값만 교체, 노드를 매번 만들지 않는다) */
  chatFontStyleId: 'cm-chat-font-style',
  /** FR-05/10 레이아웃 오버라이드 단일 style 태그 */
  layoutStyleId: 'cm-layout-style',
  /** FR-03 볼륨 컨트롤 */
  volumeControlId: 'cm-volume-control',
  /** FR-03 모바일 전용 — 볼륨 컨트롤을 담는 버튼 줄 바로 위의 전용 줄 */
  volumeRowId: 'cm-volume-row',
  /** FR-09.2 컨트롤바 설정 버튼 (⚙*) */
  settingsButtonId: 'cm-settings-button',
  /** FR-14 컨트롤바 멀티 버튼 */
  multiViewButtonId: 'cm-multiview-button',
  /** FR-09.2 설정 패널 (body 직계) */
  settingsPanelId: 'cm-settings-panel',
  /** FR-14 구성 시트 (body 직계) */
  multiViewSheetId: 'cm-multiview-sheet',
  /** FR-14 멀티뷰 스테이지 (body 직계) */
  multiViewStageId: 'cm-multiview-stage',
  /** FR-16 채팅 부가 요소(헤더·랭킹·드롭스) 숨김 */
  chatClutterStyleId: 'cm-chat-clutter-style',
  /** FR-11 유저 필터 패널 */
  chatFilterPanelId: 'cm-chat-filter-panel',
  /** FR-04 채팅 프리셋 칩 목록 */
  chatPresetBarId: 'cm-chat-preset-bar',
  /**
   * 치지직 도구 행(`CHZZK.chatTools`)에 끼워 넣는 **우리 버튼 묶음** 공통 클래스.
   * 기능별 전용 클래스가 아니다 — 문구 버튼 외에 FR-05 폭 조절 등 다른 묶음도 같은
   * 클래스를 쓰고 `data-side="left" | "right"` 로 좌/우 정렬만 구분한다 (2026-08-15).
   */
  toolsSlotClass: 'cm-tools-slot',
  /**
   * FR-14 멀티뷰 BETA 뱃지 (2026-08-16).
   *
   * 멀티뷰는 아직 불안정하므로 **컨트롤바 멀티 버튼 · 구성 시트 제목 · 스테이지 조작 바**
   * 세 지점에 같은 문구로 붙인다. 문구·클래스를 한 곳에 모아 세 지점이 어긋나지 않게 한다.
   */
  betaBadgeClass: 'cm-beta-badge',
  /** 스크린 리더 전용(화면에는 보이지 않는) 보조 설명 노드 */
  srOnlyClass: 'cm-sr-only',
  /**
   * 멀티뷰 스테이지가 화면 전체를 덮으면 호스트 컨트롤바의 설정(⚙) 버튼이 가려져 누를 수
   * 없다(사용자 보고 2026-08-23 — 멀티뷰 중 볼륨·컴프레서 설정에 접근할 방법이 없었다).
   * 두 기능(`multiView`·`settingsPanel`)을 직접 결합하지 않고 `window` 커스텀 이벤트로
   * 느슨하게 연결한다 — 같은 content script 안에서 도는 다른 기능이라 굳이
   * `chrome.runtime` 메시지(백그라운드 왕복)를 거칠 필요가 없다.
   */
  openSettingsEventName: 'cm-open-settings',
  /**
   * FR-02 — 부모(멀티뷰 스테이지)가 자기 프레임에서 받은 **사용자 제스처**를 슬롯 프레임으로
   * 중계할 때 쓰는 `window` 커스텀 이벤트 이름 (2026-08-27).
   *
   * 🔴 슬롯은 각자 다른 프레임이라 사용자가 슬롯 A 를 눌러도 슬롯 B·C·D 의 `click` 리스너는
   * 영영 조용하다 — 자동재생 정책에 걸려 음소거로 시작한 슬롯이 `volume.ts` 의 제스처 재시도를
   * 기다리다 그대로 굳던 경로다. 부모가 `postMessage`(`multiView/messages.ts` 의 `userGesture`)
   * 로 알리고, 슬롯 컨트롤러가 이 이벤트로 프레임 안에 퍼뜨린다.
   */
  userGestureEvent: 'cm-user-gesture',
  /** 최상위 z-index (목업 실측값) */
  topZIndex: 2147483647,
} as const;

/**
 * BETA 뱃지 문구. 세 지점(컨트롤바 버튼 · 구성 시트 제목 · 스테이지 조작 바)이 공유한다.
 * `OURS` 는 값이 전부 `cm-` 접두어여야 하는 식별자 묶음이라 표시 문구는 여기 따로 둔다.
 */
export const BETA_BADGE_TEXT = 'BETA';

/** 치지직 도메인 — postMessage origin 검증에 쓴다 (FR-14) */
export const CHZZK_ORIGINS = ['https://chzzk.naver.com', 'https://m.chzzk.naver.com'] as const;
