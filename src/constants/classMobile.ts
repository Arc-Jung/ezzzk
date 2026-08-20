/**
 * m.chzzk.naver.com 전용 셀렉터.
 *
 * ⚠️ 모바일 웹은 데스크톱과 **완전히 다른 사이트**다 (실측 2026-08-11, 분석 문서 §6).
 * - 플레이어가 `pzp-mobile__*` 계열
 * - `#layout-body` · `#aside-chatting` · 넓은 화면 버튼이 **모두 없다**
 * - 채팅 메시지 노드 0개, 채팅 입력 textarea 없음
 * - 초기 상태 `muted=true, volume=1`, `pzp-mobile--muted-indicator` 노출
 *
 * 따라서 v1 에서 m.chzzk 가 지원하는 범위는 **화질(FR-01)·볼륨(FR-02/03)** 뿐이다.
 * 데스크톱 상수를 재사용하지 않는다 — 별 파일로 완전히 분리한다.
 */

export const MOBILE_PLAYER = {
  /** 플레이어 루트. modifier: --pointer-touch / --muted-indicator */
  root: '.pzp-mobile',
  video: 'video',

  /** ⚠️ 모바일은 modifier 없이 `chzzk_player` 만 붙는다 (실측). */
  playerLayout: '#live_player_layout',

  /** 컨트롤 그룹 — 데스크톱의 `pzp-pc__bottom-buttons-*` 와 이름이 다르다. */
  bottomButtonsLeft: 'div.pzp-mobile__bottom-buttons-left',
  bottomButtonsRight: 'div.pzp-mobile__bottom-buttons-right',

  volumeButton: 'button.pzp-mobile__volume-button',
  settingButton: 'button[aria-label="설정"]',

  /**
   * 화질 목록. ⚠️ **각 항목이 2회 중복 매칭된다** (실측: 자동/1080p(원본)/720p/480p/360p/144p).
   * 텍스트 기준 중복 제거가 필수.
   */
  qualityItem: 'li.pzp-ui-setting-quality-item',
  qualityItemChecked: 'pzp-ui-setting-pane-item--checked',

  /** `음소거를 해제하려면 탭해주세요` 버튼 — 사용자 제스처 재시도 시점 신호로 쓸 수 있다. */
  mutedIndicator: '.pzp-mobile--muted-indicator',
} as const;

/** body 직계 오버레이 — FR-13 오탐 후보가 데스크톱보다 많다 (실측). */
export const MOBILE_BODY_OVERLAYS = ['naver-splugin-wrap', 'naver-splugin-dimmed'] as const;

/** m.chzzk 에서 비활성화해야 하는 기능 (표시할 대상 자체가 없다) */
export const MOBILE_DISABLED_FEATURES = [
  'chatWidth', // FR-05  — #aside-chatting 없음
  'wideScreen', // FR-07 — 넓은 화면 버튼 없음
  'ultraWide', // FR-10 — 채팅 UI 없음
  'chatPreset', // FR-04 — 입력창 없음
  'chatUserFilter', // FR-11 — 채팅 노드 0개
  'chatFont', // FR-15 — 채팅 없음
  'powerCollect', // FR-06 — 채팅 aside 없음
  'multiView', // FR-14 — 데스크톱 전용
] as const;
