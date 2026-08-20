import { describe, expect, it } from 'vitest';
import { CHZZK, ID, OURS, PLAYER, POWER_EXCLUDE_SELECTORS, PROMO, CHZZK_ORIGINS } from './class';
import { MOBILE_DISABLED_FEATURES, MOBILE_PLAYER } from './classMobile';
import { CLUTTER } from '../features/chatClutterHide';
import { AD } from '../features/adSkip';

/**
 * 셀렉터 문자열의 **형태**를 검사한다 (요구사항 §8.0 "셀렉터 문자열 상수의 형태 검사").
 * 실제 DOM 결합은 Playwright 로 검증한다 — 여기서는 규칙 위반을 회귀로 고정한다.
 */

/**
 * `_container_1tswz_2` 처럼 **접미 줄번호까지** 박힌 패턴.
 *
 * ⚠️ 뒤에 영숫자가 더 오면 안 된다(`(?![a-z0-9])`). 이 조건이 없으면 `_tools_1k5b6` 를
 * "`tools` 해시 + `_1` 줄번호"로 잘못 읽어 **정상 셀렉터를 위반으로 판정한다**(실제로 겪었다).
 * 우리가 금지하는 것은 해시 뒤의 **줄번호**이지 해시 자체가 아니다.
 */
const HARDCODED_HASH = /_[a-z0-9]{5,6}_\d+(?![a-z0-9])/;

function allSelectorStrings(): { path: string; value: string }[] {
  const out: { path: string; value: string }[] = [];
  const walk = (name: string, obj: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') out.push({ path: `${name}.${key}`, value });
      else if (Array.isArray(value)) {
        value.forEach((v, i) => {
          if (typeof v === 'string') out.push({ path: `${name}.${key}[${i}]`, value: v });
        });
      } else if (typeof value === 'object' && value !== null) {
        walk(`${name}.${key}`, value as Record<string, unknown>);
      }
    }
  };
  walk('ID', ID);
  walk('PLAYER', PLAYER);
  walk('CHZZK', CHZZK);
  walk('MOBILE_PLAYER', MOBILE_PLAYER);
  // constants/ 밖에서 정의된 셀렉터도 포함한다 — 여기 빠지면 형태 검사가 실제 출하물을 못 덮는다.
  walk('PROMO', PROMO);
  walk('CLUTTER', CLUTTER);
  walk('AD', AD);
  POWER_EXCLUDE_SELECTORS.forEach((v, i) =>
    out.push({ path: `POWER_EXCLUDE_SELECTORS[${i}]`, value: v }),
  );
  return out;
}

describe('HARDCODED_HASH 정규식 자체 검증', () => {
  it('실제 위반(접미 줄번호까지 박힌 것)을 잡는다', () => {
    for (const bad of [
      '[class*="_container_1tswz_2"]',
      '._chatting_message_1y6kj_21',
      'div._wrapper_8lqsk_25',
      '[class*="_banner_b8csn_41"]',
    ]) {
      expect(HARDCODED_HASH.test(bad), bad).toBe(true);
    }
  });

  it('줄번호 없는 정상 접두어는 위반이 아니다', () => {
    for (const good of [
      '[class*="_container_1tswz"]',
      '[class*="_tools_1k5b6"]',
      '[class*="_tooltip_1k5b6"]',
      '[class*="_banner_b8csn"]',
      '#aside-chatting',
      'button.pzp-viewmode-button',
    ]) {
      expect(HARDCODED_HASH.test(good), good).toBe(false);
    }
  });
});

describe('셀렉터 규칙 — 접미 해시 하드코딩 금지 (NFR-03)', () => {
  it('어떤 셀렉터에도 CSS 모듈 해시가 박혀 있지 않다', () => {
    const offenders = allSelectorStrings().filter(({ value }) => HARDCODED_HASH.test(value));
    expect(offenders).toEqual([]);
  });

  it('C계층 접두어 부분 일치는 [class*="..."] 형태로만 쓴다', () => {
    for (const [key, value] of Object.entries(CHZZK)) {
      // 접두어는 `_container_wj4te` 처럼 해시 앞부분까지 포함할 수 있어 숫자를 허용한다.
      expect(value, `CHZZK.${key}`).toMatch(/\[class\*="_[a-z0-9_]+"\]/);
    }
  });

  it('흔한 접두어(_container_ / _wrapper_ / _item_)는 A/B 계층 조상으로 범위를 좁힌다', () => {
    const risky = ['_container_', '_wrapper_', '_item_'];
    for (const [key, value] of Object.entries(CHZZK)) {
      if (!risky.some((prefix) => value.includes(prefix))) continue;
      const scoped =
        value.startsWith('#') ||
        value.startsWith('main') ||
        value.startsWith('section') ||
        value.startsWith('div') ||
        value.startsWith('aside');
      expect(scoped, `CHZZK.${key} 는 조상으로 범위를 좁혀야 한다: ${value}`).toBe(true);
    }
  });
});

describe('실측으로 정정된 셀렉터 (회귀 고정)', () => {
  it('설정 버튼은 aria-label 로 특정한다 — .pzp-pc__setting-button 단독 사용 금지', () => {
    // 실측: 3개 매칭되고 querySelector 가 잡는 첫 번째는 0×0 / display:none 인 상점 버튼이다.
    expect(PLAYER.settingButton).toContain('aria-label="설정"');
    expect(PLAYER.settingButton).not.toBe('button.pzp-pc__setting-button');
  });

  it('VOD 플레이어 컨테이너 ID 는 라이브와 다르다', () => {
    expect(ID.livePlayerLayout).toBe('#live_player_layout');
    expect(ID.vodPlayerLayout).toBe('#player_layout');
    expect(ID.livePlayerLayout).not.toBe(ID.vodPlayerLayout);
  });

  it('화질 선택 표시는 클래스로 판별한다 (aria-checked 는 없다)', () => {
    expect(PLAYER.qualityItemChecked).toBe('pzp-ui-setting-pane-item--checked');
  });
});

describe('FR-06 통나무 보조 버튼 제외 조건 (오클릭 방지)', () => {
  it('랭킹 영역·aria-expanded 를 모두 제외 대상으로 둔다', () => {
    expect(POWER_EXCLUDE_SELECTORS).toContain('[class*="_wl8bq_"]');
    expect(POWER_EXCLUDE_SELECTORS).toContain('[class*="ranking"]');
    expect(POWER_EXCLUDE_SELECTORS).toContain('[aria-expanded]');
  });
});

describe('FR-13 치트키 팝업 판정 조건', () => {
  it('#root 를 명시적으로 제외한다 (페이지 전체 사라짐 오탐 실증)', () => {
    expect(PROMO.excludeIds).toContain('root');
    expect(PROMO.excludeIds).toContain('portal');
    expect(PROMO.excludeIds).toContain('fb-root');
    expect(PROMO.excludeIds).toContain('naver-splugin-wrap');
    expect(PROMO.excludeIds).toContain('naver-splugin-dimmed');
  });

  it('크기 조건이 실측 배너(394×113)를 포함하고 #root(1920×1080)를 배제한다', () => {
    const { minW, maxW, minH, maxH } = PROMO.banner;
    expect(394).toBeGreaterThanOrEqual(minW);
    expect(394).toBeLessThanOrEqual(maxW);
    expect(113).toBeGreaterThanOrEqual(minH);
    expect(113).toBeLessThanOrEqual(maxH);
    expect(1920).toBeGreaterThan(maxW);
    expect(1080).toBeGreaterThan(maxH);
  });
});

describe('모바일 셀렉터 분리 (FR-10.4)', () => {
  it('m.chzzk 셀렉터는 pzp-mobile 계열이며 데스크톱 상수를 재사용하지 않는다', () => {
    expect(MOBILE_PLAYER.root).toBe('.pzp-mobile');
    expect(MOBILE_PLAYER.bottomButtonsLeft).toContain('pzp-mobile__');
    expect(MOBILE_PLAYER.bottomButtonsLeft).not.toBe(PLAYER.bottomButtonsLeft);
  });

  it('m.chzzk 에서 비활성할 기능 목록에 채팅·레이아웃 계열이 모두 있다', () => {
    for (const id of [
      'chatWidth',
      'wideScreen',
      'ultraWide',
      'chatPreset',
      'chatUserFilter',
      'chatFont',
      'powerCollect',
      'multiView',
    ]) {
      expect(MOBILE_DISABLED_FEATURES).toContain(id);
    }
  });
});

describe('우리 삽입 노드 (충돌 방지)', () => {
  it('모든 ID 가 cm- 접두어를 갖는다', () => {
    for (const [key, value] of Object.entries(OURS)) {
      if (typeof value !== 'string') continue;
      expect(value, `OURS.${key}`).toMatch(/^cm-/);
    }
  });

  it('최상위 z-index 는 목업 실측값과 같다', () => {
    expect(OURS.topZIndex).toBe(2147483647);
  });
});

describe('postMessage origin 검증 대상 (FR-14)', () => {
  it('치지직 도메인 2개만 허용한다', () => {
    expect(CHZZK_ORIGINS).toEqual(['https://chzzk.naver.com', 'https://m.chzzk.naver.com']);
  });
});
