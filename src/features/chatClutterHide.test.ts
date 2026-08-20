import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../constants/storage';
import {
  buildClutterCss,
  CLUTTER,
  type ClutterSettings,
  SHORT_LOGIN_PLACEHOLDER,
} from './chatClutterHide';

/**
 * 픽스처는 상상이 아니라 **실측 덤프에서 가져온 실제 구조**다
 * (2026-08-12 `chzzk-dom-25-chat-clutter.json`, 라이브 5채널 · 1920×1080).
 * 해시는 실측 그대로 두고, 셀렉터가 접두어 부분 일치로 잡히는지를 검증한다.
 */
function mountAside(): void {
  document.body.innerHTML = `
    <aside id="aside-chatting" class="_container_b8csn_2">
      <div class="_container_1e2su_2" data-kind="header"><h2 class="_title_1e2su_12">채팅</h2></div>
      <div class="_container_11aky_1 _banner_b8csn_41" data-kind="ad-banner">1 / 1광고 시청 중입니다.배너 닫기</div>
      <div class="_container_wl8bq_2" data-kind="ranking">
        <strong class="_title_wl8bq_22 _ranking_close_wl8bq_50">주간 후원 랭킹</strong>
        <button class="_ranking_button_wl8bq_30">1등핑크먕치즈101,000</button>
      </div>
      <div class="_container_8lqsk_1">
        <div class="_wrapper_8lqsk_25">
          <div class="_item_8lqsk_7 _big_padding_8lqsk_53" data-kind="drops">
            <div class="_container_s1cb2_1 _default_s1cb2_10">
              <div class="_inner_s1cb2_15">
                <p class="_title_s1cb2_57">드롭스 캠페인이 진행 중인 방송입니다!</p>
              </div>
            </div>
          </div>
          <div class="_item_8lqsk_7 _big_padding_8lqsk_53" data-kind="notice">
            <div class="_container_s1cb2_1 _filter_s1cb2_22">
              공지쾌적한 시청 환경을 위해 일부 메시지는 필터링 됩니다. 클린 라이브
            </div>
          </div>
          <div class="_item_8lqsk_7" data-kind="welcome">
            <div class="_container_s1cb2_1 _welcome_s1cb2_18">채팅방에 오신 것을 환영합니다!</div>
          </div>
          <div class="_item_8lqsk_7" data-kind="user-message">
            <div class="_container_1y6kj_1">
              <div class="_chatting_message_1y6kj_21">
                <button class="_nickname_1y6kj_37">시청자A</button>
                <span class="_text_1y6kj_1">드롭스 받았다 ㅋㅋ</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="_area_b8csn_49">
        <div class="_container_1k5b6_2"><textarea class="_input_1k5b6_59"></textarea></div>
        <div class="_tools_1k5b6_125">
          <div class="_donation_1k5b6_132">
            <button class="_donation_text_1k5b6_137" data-kind="donate">후원하기</button>
            <span class="_tooltip_1k5b6_181" data-kind="free-cheese">
              <a class="_link_1k5b6_220">내 치즈로 이동</a>
              <button class="_button_close_1k5b6_229">툴팁 닫기</button>
            </span>
            <div class="_action_1k5b6_140" data-kind="donate-icons">
              <button class="_container_vgt54_2">아이콘</button>
            </div>
          </div>
          <button class="_send_button_1k5b6_1" data-kind="send">채팅</button>
        </div>
      </div>
    </aside>
  `;
}

const ALL_ON: ClutterSettings = {
  header: true,
  ranking: true,
  drops: true,
  adBanner: true,
  freeCheese: true,
  cleanLive: true,
  shortLoginPlaceholder: true,
};
const ALL_OFF: ClutterSettings = {
  header: false,
  ranking: false,
  drops: false,
  adBanner: false,
  freeCheese: false,
  cleanLive: false,
  shortLoginPlaceholder: false,
};

/** 실제 CSS 를 붙이고 `display` 로 판정한다 — 문자열 비교가 아니라 렌더 결과를 본다. */
function applyCss(settings: ClutterSettings): void {
  document.getElementById('cm-test-style')?.remove();
  const style = document.createElement('style');
  style.id = 'cm-test-style';
  style.textContent = buildClutterCss(settings);
  document.head.appendChild(style);
}

const isHidden = (kind: string): boolean => {
  const el = document.querySelector(`[data-kind="${kind}"]`);
  if (!el) throw new Error(`fixture missing: ${kind}`);
  return getComputedStyle(el).display === 'none';
};

beforeEach(() => {
  mountAside();
});

describe('buildClutterCss — 실측 구조에 적용한 렌더 결과', () => {
  it('전부 켜면 헤더 · 랭킹 · 광고 배너 · 드롭스가 사라진다', () => {
    applyCss(ALL_ON);
    expect(isHidden('header')).toBe(true);
    expect(isHidden('ranking')).toBe(true);
    expect(isHidden('ad-banner')).toBe(true);
    expect(isHidden('drops')).toBe(true);
  });

  /**
   * 2026-08-12 결정 변경: 클린 라이브 안내가 채팅 목록을 많이 가려 **기본 숨김**으로 바꿨다.
   * 이전에는 "드롭스와 같은 `_container_s1cb2_` 클래스라 같이 사라지면 안 된다"는 계약이었다 —
   * 그 취지(변형 modifier 로만 구분한다)는 아래 환영 메시지 테스트가 계속 지킨다.
   */
  it('공지(클린 라이브)는 cleanLive 를 켜면 숨고, 끄면 남는다', () => {
    applyCss(ALL_ON);
    expect(isHidden('notice')).toBe(true);

    applyCss({ ...ALL_ON, cleanLive: false });
    expect(isHidden('notice')).toBe(false);
  });

  it('🔴 환영 메시지도 남는다', () => {
    applyCss(ALL_ON);
    expect(isHidden('welcome')).toBe(false);
  });

  it("🔴 사용자가 채팅에 '드롭스' 라고 쳐도 남는다 (시스템 카드가 아니다)", () => {
    applyCss(ALL_ON);
    expect(isHidden('user-message')).toBe(false);
  });

  it('전부 끄면 아무것도 숨지 않는다 (원복)', () => {
    applyCss(ALL_OFF);
    for (const kind of ['header', 'ranking', 'ad-banner', 'drops', 'notice', 'welcome']) {
      expect(isHidden(kind), kind).toBe(false);
    }
    expect(buildClutterCss(ALL_OFF)).toBe('');
  });

  it('항목별로 독립적으로 켜고 끌 수 있다', () => {
    applyCss({
      header: true,
      ranking: false,
      drops: false,
      adBanner: false,
      freeCheese: false,
      cleanLive: false,
      shortLoginPlaceholder: false,
    });
    expect(isHidden('header')).toBe(true);
    expect(isHidden('ranking')).toBe(false);
    expect(isHidden('ad-banner')).toBe(false);
    expect(isHidden('drops')).toBe(false);
  });

  it('전송 버튼(`채팅`)과 입력 영역은 절대 숨기지 않는다', () => {
    applyCss(ALL_ON);
    const send = document.querySelector('[class*="_send_button_"]') as HTMLElement;
    expect(getComputedStyle(send).display).not.toBe('none');
    const area = document.querySelector('[class*="_area_b8csn"]') as HTMLElement;
    expect(getComputedStyle(area).display).not.toBe('none');
  });

  it('채팅 스크롤러는 숨기지 않는다', () => {
    applyCss(ALL_ON);
    const scroller = document.querySelector('[class*="_wrapper_8lqsk"]') as HTMLElement;
    expect(getComputedStyle(scroller).display).not.toBe('none');
  });

  it('DOM 제거가 아니라 display:none 이다 (React 재삽입·경고 회피)', () => {
    applyCss(ALL_ON);
    expect(document.querySelector('[data-kind="ranking"]')).not.toBeNull();
    expect(buildClutterCss(ALL_ON)).toContain('display: none !important');
  });

  it('같은 입력이면 같은 CSS 다 (멱등 — style 내용만 교체한다)', () => {
    expect(buildClutterCss(ALL_ON)).toBe(buildClutterCss(ALL_ON));
  });
});

describe('CLUTTER 셀렉터 규칙', () => {
  it('헤더 셀렉터가 `채팅` 헤더 하나만 잡는다 (전송 버튼이 아니다)', () => {
    const matches = document.querySelectorAll(CLUTTER.header);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.textContent?.trim()).toBe('채팅');
  });

  it('랭킹·광고 배너 셀렉터가 각각 하나만 잡는다', () => {
    expect(document.querySelectorAll(CLUTTER.ranking)).toHaveLength(1);
    expect(document.querySelectorAll(CLUTTER.adBanner)).toHaveLength(1);
  });

  it('드롭스 카드 셀렉터가 공지·환영을 잡지 않는다', () => {
    const matches = document.querySelectorAll(CLUTTER.dropsCard);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.textContent).toContain('드롭스');
  });

  it('헤더·랭킹·배너는 직계 자식만 본다 (스크롤러 안쪽 오매칭 방지)', () => {
    for (const selector of [CLUTTER.header, CLUTTER.ranking, CLUTTER.adBanner]) {
      expect(selector).toContain('>');
    }
  });

  it('모든 셀렉터가 #aside-chatting 으로 범위를 좁히거나 카드 한정이다', () => {
    for (const [key, selector] of Object.entries(CLUTTER)) {
      const scoped = selector.includes('#aside-chatting') || selector.includes('_s1cb2');
      expect(scoped, `CLUTTER.${key}`).toBe(true);
    }
  });

  // 접미 해시 금지 규칙은 `constants/class.test.ts` 가 CLUTTER 까지 훑어 전담한다.
  // 여기서 정규식을 복제했더니 lookahead 가 빠져 `_tools_1k5b6` 를 위반으로 오판했다 → 중복 제거.
});

describe('기본값 — 요청대로 모두 숨김으로 시작한다', () => {
  it('header · ranking · drops · adBanner 전부 true', () => {
    expect(DEFAULT_SETTINGS.chatClutter).toEqual({
      header: true,
      ranking: true,
      drops: true,
      adBanner: true,
      freeCheese: true,
      cleanLive: true,
      shortLoginPlaceholder: true,
    });
  });
});

describe('무료 치즈 받기 툴팁 숨김 (FR-16 대상 추가)', () => {
  it('툴팁만 숨기고 후원하기·아이콘·전송 버튼은 남긴다', () => {
    applyCss(ALL_ON);
    expect(isHidden('free-cheese')).toBe(true);
    expect(isHidden('donate')).toBe(false);
    expect(isHidden('donate-icons')).toBe(false);
    expect(isHidden('send')).toBe(false);
  });

  it('입력창은 숨기지 않는다', () => {
    applyCss(ALL_ON);
    const textarea = document.querySelector('textarea') as HTMLElement;
    expect(getComputedStyle(textarea).display).not.toBe('none');
  });

  it('끄면 툴팁이 보인다', () => {
    applyCss({ ...ALL_ON, freeCheese: false, cleanLive: false, shortLoginPlaceholder: false });
    expect(isHidden('free-cheese')).toBe(false);
  });

  it('셀렉터가 tools 줄 안으로 범위를 좁힌다 (다른 툴팁 오매칭 방지)', () => {
    expect(CLUTTER.freeCheeseTooltip).toContain('_tools_1k5b6');
    expect(CLUTTER.freeCheeseTooltip).toContain('#aside-chatting');
    expect(document.querySelectorAll(CLUTTER.freeCheeseTooltip)).toHaveLength(1);
  });

  it('기본값은 숨김이다', () => {
    expect(DEFAULT_SETTINGS.chatClutter.freeCheese).toBe(true);
  });
});

describe('클린 라이브 안내 숨김 (2026-08-12 요청)', () => {
  const all = (value: boolean): ClutterSettings => ({
    header: value,
    ranking: value,
    drops: value,
    adBanner: value,
    freeCheese: value,
    cleanLive: value,
    shortLoginPlaceholder: value,
  });

  it('cleanLive 를 켜면 `_filter_` 변형 카드를 품은 항목을 숨긴다', () => {
    const css = buildClutterCss(all(true));
    expect(css).toContain('_filter_s1cb2');
    expect(css).toMatch(/_item_[^{]*:has\([^)]*_filter_s1cb2[^)]*\)/);
  });

  it('끄면 규칙이 없다', () => {
    expect(buildClutterCss({ ...all(false), cleanLive: false })).not.toContain('_filter_s1cb2');
  });

  it('환영 메시지(`_welcome_`)는 절대 대상이 아니다 — 변형으로만 구분한다', () => {
    // 전부 켠 상태에서도 `_welcome_` 를 노리는 규칙이 있으면 안 된다.
    expect(buildClutterCss(all(true))).not.toContain('_welcome_');
  });

  it('드롭스와 클린 라이브는 서로 독립적으로 켜고 끌 수 있다', () => {
    const onlyDrops = buildClutterCss({ ...all(false), drops: true });
    expect(onlyDrops).toContain('_default_s1cb2');
    expect(onlyDrops).not.toContain('_filter_s1cb2');

    const onlyClean = buildClutterCss({ ...all(false), cleanLive: true });
    expect(onlyClean).toContain('_filter_s1cb2');
    expect(onlyClean).not.toContain('_default_s1cb2');
  });

  it('축약 문구는 3글자다', () => {
    expect(SHORT_LOGIN_PLACEHOLDER).toBe('로그인');
    expect(SHORT_LOGIN_PLACEHOLDER.length).toBe(3);
  });

  it('로그인 입력창 셀렉터가 비로그인 변형만 노린다', () => {
    expect(CLUTTER.loginTextarea).toContain('_not_login_');
    expect(CLUTTER.loginTextarea).toContain('#aside-chatting');
  });
});
