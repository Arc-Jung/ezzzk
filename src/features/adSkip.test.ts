import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../constants/storage';
import { AD, clickSkipButtons, isClickableSkipButton, parseSkipCountdown } from './adSkip';

/**
 * 픽스처는 실측 덤프 그대로다
 * (2026-08-12 `chzzk-dom-28-ad-skip-deep.json`, 다주 채널 · 광고 43초).
 * 광고 플레이어는 **해시 없는 레거시 클래스**를 쓴다.
 */
function mountCountdownState(seconds: number): void {
  // 카운트다운 중 — 클릭 가능한 버튼이 아직 없다.
  document.body.innerHTML = `
    <div id="live_player_layout">
      <div class="vod_player_wrap pc">
        <div class="ad_info_area">
          <div class="skip_area"><p class="skip_info">${seconds}초 후 <span class="txt_skip">SKIP</span></p></div>
          <div class="link_btn_area"><a class="link_more" aria-label="광고 페이지 보기"><span class="txt">광고 페이지 보기</span></a></div>
        </div>
      </div>
    </div>
  `;
}

function mountSkippableState(): void {
  // 카운트다운 종료 후 — `button.btn_skip` 으로 교체된다 (실측 f23 이후).
  document.body.innerHTML = `
    <div id="live_player_layout">
      <div class="vod_player_wrap pc">
        <div class="ad_info_area">
          <button class="btn_skip"><span class="txt">SKIP</span></button>
          <div class="link_btn_area"><a class="link_more" aria-label="광고 페이지 보기"><span class="txt">광고 페이지 보기</span></a></div>
        </div>
      </div>
    </div>
  `;
  // jsdom 은 레이아웃을 계산하지 않으므로 실측 크기(115×43)를 모방한다.
  const button = document.querySelector('button.btn_skip') as HTMLElement;
  button.getBoundingClientRect = () =>
    ({ width: 115, height: 43, top: 0, left: 0, right: 115, bottom: 43 }) as DOMRect;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('parseSkipCountdown — 카운트다운 문구', () => {
  it('실측 문구에서 남은 초를 읽는다', () => {
    expect(parseSkipCountdown('15초 후 SKIP')).toBe(15);
    expect(parseSkipCountdown('1초 후 SKIP')).toBe(1);
  });

  it('공백·개행이 섞여도 읽는다', () => {
    expect(parseSkipCountdown('  8초 \n 후  SKIP ')).toBe(8);
  });

  it('카운트다운이 아닌 문구는 null 이다', () => {
    expect(parseSkipCountdown('SKIP')).toBeNull();
    expect(parseSkipCountdown('광고 페이지 보기')).toBeNull();
    expect(parseSkipCountdown('')).toBeNull();
  });
});

describe('isClickableSkipButton — 오클릭 방지', () => {
  it('카운트다운 종료 후의 button.btn_skip 은 클릭 대상이다', () => {
    mountSkippableState();
    const button = document.querySelector('button.btn_skip') as Element;
    expect(isClickableSkipButton(button)).toBe(true);
  });

  it('🔴 카운트다운 중 `skip_area`·`skip_info` 는 클릭 대상이 아니다', () => {
    mountCountdownState(15);
    for (const selector of ['div.skip_area', 'p.skip_info', 'span.txt_skip']) {
      const el = document.querySelector(selector) as Element;
      expect(isClickableSkipButton(el), selector).toBe(false);
    }
  });

  it('🔴 `광고 페이지 보기` 링크는 절대 클릭 대상이 아니다 (광고주 페이지가 열린다)', () => {
    mountSkippableState();
    for (const selector of ['a.link_more', 'div.link_btn_area']) {
      const el = document.querySelector(selector) as Element;
      expect(isClickableSkipButton(el), selector).toBe(false);
    }
  });

  it('보이지 않는 버튼은 클릭하지 않는다 (0×0 · display:none)', () => {
    mountSkippableState();
    const button = document.querySelector('button.btn_skip') as HTMLElement;
    button.getBoundingClientRect = () => ({ width: 0, height: 0 }) as DOMRect;
    expect(isClickableSkipButton(button)).toBe(false);
  });

  it('광고주 링크 안에 들어간 btn_skip 은 제외한다 (조상 검사)', () => {
    document.body.innerHTML = `
      <div class="vod_player_wrap">
        <a class="link_more"><button class="btn_skip">SKIP</button></a>
      </div>`;
    const button = document.querySelector('button.btn_skip') as HTMLElement;
    button.getBoundingClientRect = () =>
      ({ width: 115, height: 43, top: 0, left: 0, right: 115, bottom: 43 }) as DOMRect;
    expect(isClickableSkipButton(button)).toBe(false);
  });
});

describe('clickSkipButtons', () => {
  it('카운트다운 중에는 아무것도 누르지 않는다', () => {
    mountCountdownState(15);
    expect(clickSkipButtons()).toBe(0);
  });

  it('스킵 가능해지면 버튼을 누른다', () => {
    mountSkippableState();
    let clicks = 0;
    (document.querySelector('button.btn_skip') as HTMLElement).addEventListener('click', () => {
      clicks += 1;
    });
    expect(clickSkipButtons()).toBe(1);
    expect(clicks).toBe(1);
  });

  it('🔴 광고주 링크는 클릭되지 않는다', () => {
    mountSkippableState();
    let advertiserClicks = 0;
    (document.querySelector('a.link_more') as HTMLElement).addEventListener('click', () => {
      advertiserClicks += 1;
    });
    clickSkipButtons();
    expect(advertiserClicks).toBe(0);
  });

  it('광고가 없으면 아무 일도 하지 않는다 (예외 없음)', () => {
    document.body.innerHTML = '<div id="live_player_layout"></div>';
    expect(clickSkipButtons()).toBe(0);
  });
});

describe('AD 셀렉터', () => {
  it('광고 플레이어는 해시 없는 클래스를 쓴다 (치지직 CSS 모듈이 아니다)', () => {
    for (const selector of Object.values(AD)) {
      expect(selector).not.toContain('[class*=');
      expect(selector).not.toMatch(/_[a-z0-9]{5,6}_\d+/);
    }
  });

  it('클릭 대상은 button.btn_skip 하나뿐이다', () => {
    expect(AD.skipButton).toBe('button.btn_skip');
  });

  it('광고주 링크를 제외 목록으로 명시한다', () => {
    expect(AD.advertiserLink).toContain('link_more');
    expect(AD.advertiserLink).toContain('link_btn_area');
  });
});

describe('기본값 — 요청대로 자동 스킵이 켜져 있다', () => {
  it('adSkip.enabled 는 true 다', () => {
    expect(DEFAULT_SETTINGS.adSkip.enabled).toBe(true);
  });
});
