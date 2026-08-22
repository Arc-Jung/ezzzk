/**
 * FR-18.2 광고 차단 안내 자동 처리 테스트.
 *
 * 픽스처 구조는 **실측 덤프**를 따른다 (2026-08-15,
 * `docs/frontend-dump/chzzk-dom-adblock-notice.json`. 애드가드를 함께 로드해 진짜 모달을 띄워 떴다):
 * `div._dimmed_`(body 직계) > `div._container_`(role=alertdialog) > 본문 + `div._footer_` > `button 확인`.
 *
 * 🔴 그 실측에서 드러난 핵심: **`확인` 을 눌러도 치지직이 모달을 계속 다시 띄운다**
 * (40회 이상 클릭 로그). 그래서 클릭 → 안 되면 숨김 2단계를 검증한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEVICE_PROFILES } from '../constants/device';
import { DEFAULT_SETTINGS } from '../constants/storage';
import type { FeatureContext } from './types';
import {
  AD_BLOCK_NOTICE_TEXT,
  adBlockNoticeFeature,
  HIDDEN_ATTR,
  MAX_NOTICE_TEXT_LEN,
  canHideNoticeRoot,
  dismissAdBlockNotices,
  findAdBlockNoticeRoots,
  findConfirmButton,
  hideNotice,
  isAdBlockNotice,
  restoreHiddenNotices,
} from './adBlockNotice';

/**
 * 스크린샷의 문구를 그대로 옮긴 모달.
 * `role="alertdialog" aria-modal="true"` 는 실측 덤프의 `div._container_…` 속성 그대로다.
 */
function mountNotice(): HTMLElement {
  document.body.innerHTML = `
    <div id="root">
      <main>본 방송 페이지 내용. 여기에도 확인 버튼이 있다.
        <button type="button">확인</button>
      </main>
    </div>
    <div id="portal"></div>
    <div class="_dim_abc_1">
      <div class="_modal_abc_2" data-kind="notice" role="alertdialog" aria-modal="true">
        <strong>광고 차단 프로그램을 사용 중이신가요?</strong>
        <p>광고 차단 프로그램 사용 시 재생 환경에 영향을 미칠 수 있으니 사용 중인 확장 프로그램이 있다면, 삭제 후 서비스를 이용해 주세요.</p>
        <p>브라우저 &gt; 시크릿 모드에서 확인해 주세요. <a href="https://help.naver.com/x">자세히 보기</a></p>
        <button type="button" data-kind="confirm">확인</button>
      </div>
    </div>
  `;
  return document.querySelector('[data-kind="notice"]') as HTMLElement;
}

/** jsdom 은 레이아웃을 계산하지 않아 rect 가 0 이다 → isVisible 이 통과하도록 크기를 주입한다. */
function giveSize(el: Element, width = 240, height = 48): void {
  el.getBoundingClientRect = () =>
    ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0 }) as DOMRect;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('isAdBlockNotice', () => {
  it('문구를 포함하고 짧으면 모달로 본다', () => {
    const modal = mountNotice();
    expect(isAdBlockNotice(modal)).toBe(true);
  });

  it('🔴 페이지 전체를 담은 노드는 모달이 아니다 — 그 안의 아무 확인이나 누르면 안 된다', () => {
    mountNotice();
    const root = document.getElementById('root') as HTMLElement;
    expect(isAdBlockNotice(root)).toBe(false);
  });

  it('🔴 문구를 포함해도 길이 상한을 넘으면 모달이 아니다', () => {
    document.body.innerHTML = `<div id="long">${AD_BLOCK_NOTICE_TEXT}${'가'.repeat(MAX_NOTICE_TEXT_LEN)}</div>`;
    expect(isAdBlockNotice(document.getElementById('long') as HTMLElement)).toBe(false);
  });

  it('길이는 인자가 아니라 요소에서 직접 잰다 (중복 계산 제거)', () => {
    const modal = mountNotice();
    // 인자를 받지 않으므로 호출부 계산과 어긋날 여지가 없다.
    expect(isAdBlockNotice.length).toBe(1);
    expect(isAdBlockNotice(modal)).toBe(true);
  });

  it('문구가 없으면 모달이 아니다 (문구가 바뀌면 아무것도 하지 않는다)', () => {
    document.body.innerHTML = '<div id="x"><strong>다른 안내</strong><button>확인</button></div>';
    const el = document.getElementById('x') as HTMLElement;
    expect(isAdBlockNotice(el)).toBe(false);
  });

  it('판정 문구는 제목 일부만 쓴다', () => {
    expect(AD_BLOCK_NOTICE_TEXT).toBe('광고 차단 프로그램');
  });
});

describe('findConfirmButton', () => {
  it('모달 안의 `확인` 버튼을 찾는다', () => {
    const modal = mountNotice();
    expect(findConfirmButton(modal)?.dataset['kind']).toBe('confirm');
  });

  it('🔴 `자세히 보기` 링크는 후보가 아니다 — 외부로 나간다', () => {
    const modal = mountNotice();
    const found = findConfirmButton(modal);
    expect(found?.tagName.toLowerCase()).toBe('button');
    expect(found?.closest('a')).toBeNull();
  });

  it('`확인` 이 아닌 버튼은 누르지 않는다', () => {
    document.body.innerHTML = `
      <div data-kind="notice"><strong>광고 차단 프로그램 안내</strong>
        <button>삭제하기</button><button>취소</button>
      </div>`;
    const modal = document.querySelector('[data-kind="notice"]') as HTMLElement;
    expect(findConfirmButton(modal)).toBeNull();
  });

  it('앵커로 감싼 `확인` 도 제외한다', () => {
    document.body.innerHTML = `
      <div data-kind="notice"><strong>광고 차단 프로그램 안내</strong>
        <a href="/x"><button>확인</button></a>
      </div>`;
    const modal = document.querySelector('[data-kind="notice"]') as HTMLElement;
    expect(findConfirmButton(modal)).toBeNull();
  });
});

describe('dismissAdBlockNotices', () => {
  it('모달의 확인만 누른다 — 본문의 동명 버튼은 건드리지 않는다', () => {
    mountNotice();
    const modalConfirm = document.querySelector('[data-kind="confirm"]') as HTMLElement;
    const pageConfirm = document.querySelector('main button') as HTMLElement;
    giveSize(modalConfirm);
    giveSize(pageConfirm);

    let modalClicks = 0;
    let pageClicks = 0;
    modalConfirm.addEventListener('click', () => {
      modalClicks += 1;
    });
    pageConfirm.addEventListener('click', () => {
      pageClicks += 1;
    });

    expect(dismissAdBlockNotices().clicked).toBe(1);
    expect(modalClicks).toBe(1);
    expect(pageClicks).toBe(0);
  });

  it('조상·자손이 함께 매칭돼도 한 번만 누른다', () => {
    mountNotice();
    const confirm = document.querySelector('[data-kind="confirm"]') as HTMLElement;
    giveSize(confirm);
    let clicks = 0;
    confirm.addEventListener('click', () => {
      clicks += 1;
    });
    dismissAdBlockNotices();
    expect(clicks).toBe(1);
  });

  it('보이지 않는 버튼은 누르지 않는다 (0×0 = 아직 표시 전)', () => {
    mountNotice();
    // rect 를 주입하지 않으면 jsdom 에서 0×0 이라 isVisible 이 false 다.
    expect(dismissAdBlockNotices().clicked).toBe(0);
  });

  it('팝업이 없으면 아무 일도 하지 않는다', () => {
    document.body.innerHTML = '<div id="root"><button>확인</button></div>';
    expect(dismissAdBlockNotices().clicked).toBe(0);
  });

  /**
   * 실측 2026-08-15: 클릭은 정확히 됐는데 치지직이 모달을 계속 되살렸다.
   * 그 상황에서 화면을 덮은 오버레이를 치우는 경로를 검증한다.
   */
  it('escalate 모드에서는 누르지 않고 오버레이를 숨긴다', () => {
    mountNotice();
    const confirm = document.querySelector('[data-kind="confirm"]') as HTMLElement;
    giveSize(confirm);
    let clicks = 0;
    confirm.addEventListener('click', () => {
      clicks += 1;
    });

    const result = dismissAdBlockNotices(true);

    expect(result).toEqual({ clicked: 0, hidden: 1 });
    expect(clicks).toBe(0);
    const overlay = document.querySelector('._dim_abc_1') as HTMLElement;
    expect(overlay.style.display).toBe('none');
    expect(overlay.getAttribute(HIDDEN_ATTR)).toBe('true');
  });

  it('숨긴 오버레이는 다시 처리하지 않는다', () => {
    mountNotice();
    dismissAdBlockNotices(true);
    expect(dismissAdBlockNotices(true)).toEqual({ clicked: 0, hidden: 0 });
  });

  it('숨김은 오버레이 하나만 대상으로 한다 — 페이지 본문은 그대로다', () => {
    mountNotice();
    dismissAdBlockNotices(true);
    const root = document.getElementById('root') as HTMLElement;
    expect(root.style.display).toBe('');
    expect(root.hasAttribute(HIDDEN_ATTR)).toBe(false);
  });

  it('findAdBlockNoticeRoots 는 문구를 담은 바깥 오버레이를 찾는다', () => {
    mountNotice();
    const roots = findAdBlockNoticeRoots();
    expect(roots).toHaveLength(1);
    expect(roots[0]?.className).toBe('_dim_abc_1');
  });

  it('hideNotice 는 노드를 지우지 않는다 — 리액트 언마운트 예외를 피한다', () => {
    const overlay = mountNotice().parentElement as HTMLElement;
    hideNotice(overlay);
    expect(overlay.isConnected).toBe(true);
    expect(overlay.style.pointerEvents).toBe('none');
  });

  it('링크만 있는 모달에서는 누르지 않는다', () => {
    document.body.innerHTML = `
      <div><div data-kind="notice" role="alertdialog"><strong>광고 차단 프로그램 안내</strong>
        <a href="/x">확인</a>
      </div></div>`;
    expect(dismissAdBlockNotices().clicked).toBe(0);
  });
});

/**
 * M7 회귀 — 오숨김 방어. 텍스트 길이 상한 하나에만 기대면 로딩·오류로 본문이 짧은 순간에
 * `#root` 가 매칭돼 앱 전체가 `display:none` 이 된다. 결과가 백지 화면이라 반드시 막아야 한다.
 */
describe('canHideNoticeRoot', () => {
  it('실측 구조의 오버레이는 숨겨도 된다 (role=alertdialog 를 품고 있다)', () => {
    mountNotice();
    const overlay = document.querySelector('._dim_abc_1') as HTMLElement;
    expect(canHideNoticeRoot(overlay)).toBe(true);
  });

  it('🔴 `#root` 는 짧은 텍스트로 매칭되더라도 절대 숨기지 않는다', () => {
    document.body.innerHTML = `
      <div id="root">
        <div class="_dim_abc_1">
          <div role="alertdialog" aria-modal="true">광고 차단 프로그램을 사용 중이신가요?
            <button type="button" data-kind="confirm">확인</button>
          </div>
        </div>
      </div>`;
    const root = document.getElementById('root') as HTMLElement;
    // 로딩 중이라 본문이 짧아 텍스트 판정은 통과해 버린다.
    expect(isAdBlockNotice(root)).toBe(true);
    expect(canHideNoticeRoot(root)).toBe(false);

    const result = dismissAdBlockNotices(true);
    expect(result).toEqual({ clicked: 0, hidden: 0 });
    expect(root.style.display).toBe('');
    expect(root.hasAttribute(HIDDEN_ATTR)).toBe(false);
  });

  it('🔴 `#root` 를 품은 조상도 숨기지 않는다', () => {
    document.body.innerHTML = `
      <div id="wrap">광고 차단 프로그램
        <div id="root"></div>
        <div role="alertdialog">확인</div>
      </div>`;
    expect(canHideNoticeRoot(document.getElementById('wrap') as HTMLElement)).toBe(false);
  });

  it('대화상자 속성이 전혀 없으면 숨기지 않는다', () => {
    document.body.innerHTML = '<div id="plain">광고 차단 프로그램 안내</div>';
    expect(canHideNoticeRoot(document.getElementById('plain') as HTMLElement)).toBe(false);
  });
});

/**
 * M6 회귀 — 성능. 옵저버가 초당 5회 돌므로 게이트가 없으면 매번 `#root.textContent`
 * (채팅 로그 전체, 수십 KB)를 읽게 된다 (NFR-02b/NFR-04).
 */
describe('findAdBlockNoticeRoots 성능 게이트', () => {
  it('🔴 대화상자 속성이 없으면 textContent 를 아예 읽지 않는다', () => {
    mountNotice();
    for (const el of Array.from(document.querySelectorAll('[role="alertdialog"]'))) {
      el.removeAttribute('role');
      el.removeAttribute('aria-modal');
    }

    let reads = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body > div'))) {
      Object.defineProperty(el, 'textContent', {
        configurable: true,
        get() {
          reads += 1;
          return '광고 차단 프로그램';
        },
      });
    }

    expect(findAdBlockNoticeRoots()).toEqual([]);
    expect(reads).toBe(0);
  });

  it('대화상자가 있으면 평소처럼 찾는다', () => {
    mountNotice();
    expect(findAdBlockNoticeRoots()).toHaveLength(1);
  });
});

/** m7 회귀 — 기능을 끄면 화면도 원복한다 (`ultraWideLayout`·`chatWidth` 와 같은 규약). */
describe('restoreHiddenNotices', () => {
  it('숨긴 오버레이의 인라인 스타일과 표시 속성을 되돌린다', () => {
    mountNotice();
    dismissAdBlockNotices(true);
    const overlay = document.querySelector('._dim_abc_1') as HTMLElement;
    expect(overlay.style.display).toBe('none');

    restoreHiddenNotices();

    expect(overlay.style.display).toBe('');
    expect(overlay.style.pointerEvents).toBe('');
    expect(overlay.hasAttribute(HIDDEN_ATTR)).toBe(false);
  });
});

/** 라이프사이클 — 클릭 재시도 카운터(m6)와 disposer 복원(m7). */
describe('adBlockNoticeFeature 라이프사이클', () => {
  const ctx: FeatureContext = {
    page: { type: 'live', channelId: 'a'.repeat(32), videoNo: null, isSlotFrame: false },
    device: {
      deviceClass: 'desktop',
      profile: DEVICE_PROFILES.desktop,
      signals: {
        longSide: 1920,
        shortSide: 1080,
        hasTouch: false,
        canHover: true,
        coarsePointer: false,
        devicePixelRatio: 1,
        uaMobile: null,
      },
      reason: 'test fixture',
    },
    settings: DEFAULT_SETTINGS,
  };

  /**
   * 모달을 띄우고 확인 버튼을 누를 수 있는 상태로 만든다.
   * 오버레이에도 크기를 준다 — 검증 단계가 `isVisible(root)` 로 "아직 떠 있는가"를 판정한다.
   */
  function mountClickableNotice(): HTMLElement {
    mountNotice();
    giveSize(document.querySelector('._dim_abc_1') as HTMLElement, 1920, 1080);
    const confirm = document.querySelector('[data-kind="confirm"]') as HTMLElement;
    giveSize(confirm);
    return confirm;
  }

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('🔴 정상적으로 닫힌 뒤에는 재시도 카운터가 초기화된다 — 3번째 모달도 1회 눌러 본다', async () => {
    vi.useFakeTimers();
    const dispose = adBlockNoticeFeature.start(ctx);

    // 1클릭에 닫히는 모달을 두 번 겪는다 (카운터가 누적되면 안 된다).
    for (let i = 0; i < 2; i += 1) {
      const confirm = mountClickableNotice();
      confirm.addEventListener('click', () => {
        document.querySelector('._dim_abc_1')?.remove();
      });
      await vi.advanceTimersByTimeAsync(3_000);
      expect(document.querySelector('._dim_abc_1')).toBeNull();
    }

    // 세 번째는 아무리 눌러도 안 닫히는 모달이다.
    const stubborn = mountClickableNotice();
    let clicks = 0;
    stubborn.addEventListener('click', () => {
      clicks += 1;
    });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(clicks).toBe(1);
    const overlay = document.querySelector('._dim_abc_1') as HTMLElement;
    expect(overlay.getAttribute(HIDDEN_ATTR)).toBe('true');

    dispose?.();
  });

  it('🔴 기능을 끄면(disposer) 숨긴 모달이 다시 보인다', async () => {
    vi.useFakeTimers();
    const dispose = adBlockNoticeFeature.start(ctx);

    mountClickableNotice();
    await vi.advanceTimersByTimeAsync(5_000);
    const overlay = document.querySelector('._dim_abc_1') as HTMLElement;
    expect(overlay.getAttribute(HIDDEN_ATTR)).toBe('true');

    dispose?.();

    expect(overlay.style.display).toBe('');
    expect(overlay.hasAttribute(HIDDEN_ATTR)).toBe(false);
  });
});
