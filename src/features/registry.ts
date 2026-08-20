/**
 * 기능 등록표. 초기화 순서가 여기서 결정된다.
 *
 * 순서 규칙
 * 1. **promoHide** 를 먼저 — 프로모션 배너가 컨트롤바 레이아웃을 밀기 전에 숨긴다.
 * 2. **chatFont** 를 채팅 관련 기능보다 먼저 — FR-11 필터 패널과 FR-14.2 슬롯 스트립이
 *    이 CSS 변수(`--cm-chat-font-*`)를 참조한다.
 * 3. **wideScreen(FR-07) → ultraWide(FR-10) → chatWidth(FR-05)** 순서.
 *    넓은 화면을 먼저 켜지 않으면 영상이 높이를 채우지 못해 레터박스가 남는다(실측).
 *    폭 자체는 `layoutArbiter` 가 우선순위(멀티뷰 > FR-10 > FR-05)로 조정하므로
 *    등록 순서가 폭 경쟁을 결정하지는 않는다.
 * 4. **multiView** 는 마지막 — 활성 시 폭 결정 1순위를 가져가고, 슬롯 프레임에서는
 *    컨트롤러만 돈다.
 */

import { adBlockNoticeFeature } from './adBlockNotice';
import { adSkipFeature } from './adSkip';
import { chatCleanFilterFeature } from './chatCleanFilter';
import { chatClutterHideFeature } from './chatClutterHide';
import { chatFontFeature } from './chatFont';
import { chatPresetFeature } from './chatPreset';
import { chatUserFilterFeature } from './chatUserFilter';
import { chatWidthFeature } from './chatWidth';
import { mobileWebNoticeFeature } from './mobileWebNotice';
import { multiViewFeature } from './multiView';
import { powerCollectFeature } from './powerCollect';
import { promoHideFeature } from './promoHide';
import { qualityFeature } from './quality';
import { ultraWideFeature } from './ultraWideLayout';
import { volumeFeature } from './volume';
import { wideScreenFeature } from './wideScreen';
import { settingsPanelFeature } from '../settingsPanel';
import type { Feature } from './types';

export const FEATURES: Feature[] = [
  adSkipFeature, // FR-18 — 광고가 끝나야 컨트롤바가 뜨므로 가장 먼저 둔다
  adBlockNoticeFeature, // FR-18.2 — 광고 차단 안내 모달이 재생 화면을 덮으므로 함께 먼저 둔다
  mobileWebNoticeFeature, // FR-10.4 — m.chzzk 안내 (자동 리다이렉트는 불가능, 아래 주석 참조)
  promoHideFeature, // FR-13
  chatClutterHideFeature, // FR-16
  chatFontFeature, // FR-15
  qualityFeature, // FR-01
  volumeFeature, // FR-02, FR-03
  wideScreenFeature, // FR-07
  ultraWideFeature, // FR-10
  chatWidthFeature, // FR-05
  chatPresetFeature, // FR-04
  chatUserFilterFeature, // FR-11
  chatCleanFilterFeature, // 클린 채팅 필터 (기본 끄기)
  powerCollectFeature, // FR-06
  settingsPanelFeature, // FR-09.2
  multiViewFeature, // FR-14
];
