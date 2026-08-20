/** 기능 모듈 공통 계약. 기능 1개 = 파일 1개 (NFR-09). */

import type { DeviceDecision } from '../device';
import type { PageInfo } from '../pageType';
import type { Settings } from '../constants/storage';

export type Disposer = () => void;

export type FeatureContext = {
  page: PageInfo;
  device: DeviceDecision;
  settings: Settings;
};

export type Feature = {
  /** 로그·디버그용 식별자 */
  id: string;
  /**
   * 이 기능이 **재시작해야 하는** 설정 섹션 목록.
   *
   * 🔴 설정 변경에 전 기능을 재시작하면 안 된다 (실측 결함):
   * - 설정 패널이 **사용자가 값을 바꾸는 순간 닫힌다** (패널 자신이 재시작되며 언마운트된다)
   * - 멀티뷰가 오디오 슬롯을 바꿀 때마다 **iframe 4개를 다시 로드한다**
   * - 볼륨을 올리면 재시작이 `restoreLast: false` 기준으로 기본값을 다시 적용해 **되돌아간다**
   *
   * 그래서 변경된 섹션과 교집합이 있는 기능만 재시작한다.
   * - `[]` → 설정 변경으로 절대 재시작하지 않는다. 스스로 최신 설정을 읽는 기능
   *   (설정 패널·멀티뷰처럼 자체 상태를 들고 있는 UI)이 여기 해당한다.
   * - 생략 → 보수적으로 항상 재시작한다.
   *
   * 라우팅·기기 유형 변경은 이 값과 무관하게 전 기능을 재시작한다.
   */
  watches?: readonly (keyof Settings)[];
  /**
   * 이 페이지·기기·설정에서 동작 대상인가.
   * false 면 옵저버를 아예 걸지 않는다 (NFR-02b · NFR-04).
   */
  supports: (ctx: FeatureContext) => boolean;
  /**
   * 기능을 시작한다. 정리 함수를 돌려주면 라우팅·설정 변경 시 호출된다.
   * 예외는 호출부에서 격리되므로 여기서 삼키지 않아도 된다 (NFR-05).
   */
  start: (ctx: FeatureContext) => Disposer | void;
};
