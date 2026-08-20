import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../constants/storage';
import { DEVICE_PROFILES } from '../constants/device';
import { chzzkCleanBotFeature, ensureCleanBotDisabled, isCleanBotOn } from './chzzkCleanBot';
import type { FeatureContext } from './types';

describe('isCleanBotOn — 드롭다운 항목 문구로만 판정한다', () => {
  it('`꺼짐` 이 포함되면 꺼진 상태', () => {
    expect(isCleanBotOn('클린봇꺼짐')).toBe(false);
  });

  it('`켜짐` 이 포함되면 켜진 상태', () => {
    expect(isCleanBotOn('클린봇켜짐')).toBe(true);
  });

  it('null · 모르는 문구는 판정 불가', () => {
    expect(isCleanBotOn(null)).toBeNull();
    expect(isCleanBotOn('')).toBeNull();
    expect(isCleanBotOn('클린봇')).toBeNull();
  });
});

/**
 * 실측 DOM 구조(`etc/probe/chzzk-cleanbot.json`, 2026-08-20)를 그대로 흉내 낸다:
 * 더보기 메뉴 버튼 → 드롭다운(`_container_11w2f`) → `클린봇` 항목 → 확인 다이얼로그
 * (`role=alertdialog`, `_cleanbot_` 접두어) → `#toggle_cleanbot` 체크박스 + `확인` 버튼.
 */
describe('ensureCleanBotDisabled — 이미 꺼져 있으면 절대 누르지 않는다', () => {
  let moreButton: HTMLButtonElement;
  let panel: HTMLDivElement;
  let menuItem: HTMLButtonElement;
  let moreClicks = 0;

  /** 클린봇 초기 상태를 `on`/`off` 로 두고 DOM 을 구성한다. `respondsToConfirm` 은 확인 다이얼로그
   * 흐름을 구현할지 — 없음 상황(UI 못 찾음)을 테스트할 때 false 로 둔다. */
  function mountAside(initialOn: boolean, { respondsToConfirm = true } = {}) {
    document.body.innerHTML = '';
    moreClicks = 0;
    let on = initialOn;

    const aside = document.createElement('aside');
    aside.id = 'aside-chatting';
    document.body.appendChild(aside);

    moreButton = document.createElement('button');
    moreButton.setAttribute('aria-label', '더보기 메뉴');
    aside.appendChild(moreButton);

    panel = document.createElement('div');
    panel.className = '_container_11w2f_1';
    // 실측처럼 기본은 닫힌 상태로 두고 더보기 버튼 클릭으로 열고 닫는다(토글).
    panel.style.display = 'none';
    aside.appendChild(panel);

    menuItem = document.createElement('button');
    const renderMenuItem = () => {
      menuItem.textContent = `클린봇${on ? '켜짐' : '꺼짐'}`;
    };
    renderMenuItem();
    panel.appendChild(menuItem);

    moreButton.addEventListener('click', () => {
      moreClicks += 1;
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    if (!respondsToConfirm) return { renderMenuItem, setOn: (v: boolean) => (on = v) };

    menuItem.addEventListener('click', () => {
      if (!on) return; // 실사이트도 꺼진 상태에서 누르면 같은 다이얼로그가 뜨지만 테스트 범위 밖.
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'alertdialog');
      dialog.className = '_container_jao35_20 _cleanbot_8lqsk_67';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = 'toggle_cleanbot';
      checkbox.checked = on;

      const label = document.createElement('label');
      label.setAttribute('for', 'toggle_cleanbot');
      // jsdom 은 `<label for>` 클릭을 연결된 체크박스로 전달해 기본 동작(checked 반전)을
      // 그대로 수행한다 — 실브라우저와 같은 동작이라 별도 리스너를 붙이지 않는다.

      const confirmButton = document.createElement('button');
      confirmButton.textContent = '확인';
      confirmButton.addEventListener('click', () => {
        on = checkbox.checked;
        renderMenuItem();
        dialog.remove();
      });

      const cancelButton = document.createElement('button');
      cancelButton.textContent = '취소';
      cancelButton.addEventListener('click', () => dialog.remove());

      dialog.append(checkbox, label, cancelButton, confirmButton);
      document.body.appendChild(dialog);
    });

    return { renderMenuItem, setOn: (v: boolean) => (on = v) };
  }

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('켜져 있으면 정확히 1회 꺼서 true 를 돌려준다', async () => {
    mountAside(true);

    await expect(ensureCleanBotDisabled()).resolves.toBe(true);

    // 🔴 드롭다운을 **한 번만** 연다. 재시도가 겹쳐 두 번 열면 두 번째가 클린봇을 되켠다.
    expect(moreClicks).toBe(1);
    expect(menuItem.textContent).toBe('클린봇꺼짐');
    expect(document.getElementById('toggle_cleanbot')).toBeNull(); // 확인 후 다이얼로그 정리됨
  });

  it('🔴 이미 꺼져 있으면 다이얼로그를 열지 않고 아무것도 누르지 않는다', async () => {
    mountAside(false);
    let menuItemClicks = 0;
    menuItem.addEventListener('click', () => {
      menuItemClicks += 1;
    });

    await expect(ensureCleanBotDisabled()).resolves.toBe(true);

    expect(menuItemClicks).toBe(0);
    // 상태를 읽으려면 드롭다운을 열어야 하고, 읽은 뒤 **같은 버튼으로 도로 닫는다**
    // (열고 닫기를 겸하는 버튼이다). 열어 둔 채 나가면 사용자 화면에 메뉴가 남는다.
    expect(moreClicks).toBe(2);
    expect(document.getElementById('toggle_cleanbot')).toBeNull();
    expect(menuItem.textContent).toBe('클린봇꺼짐');
  });

  it('더보기 메뉴 버튼이 없으면 null — 예외를 던지지 않는다', async () => {
    document.body.innerHTML = '<aside id="aside-chatting"></aside>';
    await expect(ensureCleanBotDisabled()).resolves.toBeNull();
  });

  it('드롭다운 항목을 못 찾으면 null 이고, 열어 둔 메뉴를 닫는다', async () => {
    document.body.innerHTML = '';
    const aside = document.createElement('aside');
    aside.id = 'aside-chatting';
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', '더보기 메뉴');
    let clicks = 0;
    btn.addEventListener('click', () => {
      clicks += 1;
    });
    aside.appendChild(btn);
    document.body.appendChild(aside);

    await expect(ensureCleanBotDisabled()).resolves.toBeNull();
    // 열고 닫기 2회 — 열지 못했어도 같은 버튼으로 닫아 상태를 남기지 않는다.
    expect(clicks).toBe(2);
  });

  it('메뉴 항목 문구를 판정할 수 없으면 누르지 않고 null 을 돌려준다', async () => {
    mountAside(true);
    menuItem.textContent = '클린봇';
    let clicks = 0;
    menuItem.addEventListener('click', () => {
      clicks += 1;
    });

    await expect(ensureCleanBotDisabled()).resolves.toBeNull();
    expect(clicks).toBe(0);
  });

  it('확인 다이얼로그를 못 찾으면 null 을 돌려주고 예외를 던지지 않는다', async () => {
    mountAside(true, { respondsToConfirm: false });
    await expect(ensureCleanBotDisabled()).resolves.toBeNull();
  });

  it('중간에 취소되면 더 진행하지 않고 null 을 돌려준다', async () => {
    mountAside(true);
    await expect(ensureCleanBotDisabled({ isCancelled: () => true })).resolves.toBeNull();
    // 다이얼로그까지 가지 않았으니 상태는 그대로다.
    expect(document.getElementById('toggle_cleanbot')).toBeNull();
  });
});

/** Feature 계약 — 재시도 상한과 supports 조건 (`chzzkCleanBotFeature`). */
describe('chzzkCleanBotFeature', () => {
  const baseCtx: FeatureContext = {
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

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('기본 설정은 disable: true 다', () => {
    expect(DEFAULT_SETTINGS.chzzkCleanBot).toEqual({ disable: true });
  });

  it('설정이 꺼져 있으면 지원하지 않는다', () => {
    const ctx: FeatureContext = {
      ...baseCtx,
      settings: { ...DEFAULT_SETTINGS, chzzkCleanBot: { disable: false } },
    };
    expect(chzzkCleanBotFeature.supports(ctx)).toBe(false);
  });

  it('사이드 채팅이 없는 페이지(VOD)는 지원하지 않는다', () => {
    const ctx: FeatureContext = { ...baseCtx, page: { ...baseCtx.page, type: 'vod' } };
    expect(chzzkCleanBotFeature.supports(ctx)).toBe(false);
  });

  it('멀티뷰 슬롯 프레임은 지원하지 않는다', () => {
    const ctx: FeatureContext = { ...baseCtx, page: { ...baseCtx.page, isSlotFrame: true } };
    expect(chzzkCleanBotFeature.supports(ctx)).toBe(false);
  });

  it('라이브 + 클린봇 끄기 설정이면 지원한다', () => {
    expect(chzzkCleanBotFeature.supports(baseCtx)).toBe(true);
  });

  it('재시도 상한을 넘기면 계속 켜져 있어도 조용히 포기한다', async () => {
    vi.useFakeTimers();

    const aside = document.createElement('aside');
    aside.id = 'aside-chatting';
    document.body.appendChild(aside);

    const moreButton = document.createElement('button');
    moreButton.setAttribute('aria-label', '더보기 메뉴');
    aside.appendChild(moreButton);

    // 항상 켜짐으로 응답하고, 다이얼로그는 절대 뜨지 않게 해 계속 실패(null)하게 만든다.
    const panel = document.createElement('div');
    panel.className = '_container_11w2f_1';
    aside.appendChild(panel);
    const menuItem = document.createElement('button');
    menuItem.textContent = '클린봇켜짐';
    panel.appendChild(menuItem);
    let menuItemClicks = 0;
    menuItem.addEventListener('click', () => {
      menuItemClicks += 1;
      // 확인 다이얼로그를 절대 열지 않는다 — ensureCleanBotDisabled 가 매번 null 을 돌려주게 한다.
    });

    const dispose = chzzkCleanBotFeature.start(baseCtx);

    await vi.advanceTimersByTimeAsync(20_000);

    expect(menuItemClicks).toBe(3); // MAX_ATTEMPTS
    expect(menuItem.textContent).toBe('클린봇켜짐'); // 끝내 꺼지지 않음

    dispose?.();
  });

  it('요소를 전혀 못 찾아도 예외를 던지지 않는다', async () => {
    vi.useFakeTimers();
    // #aside-chatting 자체가 없다.
    const dispose = chzzkCleanBotFeature.start(baseCtx);
    await expect(vi.advanceTimersByTimeAsync(20_000)).resolves.not.toThrow();
    dispose?.();
  });
});
