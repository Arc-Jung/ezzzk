/**
 * `capture-demo.mjs` 용 Playwright 컨텍스트 헬퍼.
 *
 * 확장을 로드한 브라우저 컨텍스트를 띄우고, 설정을 심고, 우리 UI(`cm-*`)를 측정한다.
 * 캡처 스크립트가 "무엇을 찍을지"만 다루도록 브라우저 셋업을 여기로 몰아 둔다.
 *
 * ⚠️ 프로필 설정은 `isMobile: false` + `hasTouch: true` + 데스크톱 UA 조합을 쓴다.
 * 이것이 "모바일에서 데스크톱 사이트 요청" 상태이며 이 저장소 실측의 기준이다.
 * `isMobile: true` 로 두면 뷰포트 메타가 없는 문서에서 크롬이 980px 기본 레이아웃 뷰포트를
 * 적용해 기기 판정이 뒤집힌다.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DIST = resolve(ROOT, 'dist');
export const STORAGE_KEY = 'ezzzk.settings';

export const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** 실측 덤프에 등장한 채널들. channelId 는 16자 이상 hex 여야 live 로 판별된다. */
export const CHANNELS = [
  { channelId: '17a4bfff01d96ffad065f641ce90bdde', channelName: '로마러' },
  { channelId: '0dad8baf12a436f722faa8e5001c5011', channelName: '따효니' },
  { channelId: 'b5ed5db484d04faf4d150aedd362f34b', channelName: '테스트3' },
  { channelId: 'c7e3f1b2a4d54e6f8a9b0c1d2e3f4a5b', channelName: '테스트4' },
];

/**
 * 필수 검증 프로필 3종 (README 「테스트 방침」). 순서는 모바일 우선.
 * 캡처 대상을 늘리지 않는다 — 이 3종이면 충분하다.
 */
export const PROFILES = [
  {
    key: 'mobile-landscape',
    label: '모바일 가로 915×412 (데스크톱 사이트)',
    viewport: { width: 915, height: 412 },
    deviceScaleFactor: 2.625,
    hasTouch: true,
    expectDeviceClass: 'mobile',
    minTargetPx: 44,
  },
  {
    key: 'mobile-portrait',
    label: '모바일 세로 412×915 (데스크톱 사이트)',
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    hasTouch: true,
    expectDeviceClass: 'mobile',
    minTargetPx: 44,
  },
  {
    key: 'tablet10-landscape',
    label: '태블릿10 가로 1180×820',
    viewport: { width: 1180, height: 820 },
    deviceScaleFactor: 2,
    hasTouch: true,
    expectDeviceClass: 'tablet-10',
    minTargetPx: 44,
  },
  {
    key: 'tablet10-portrait',
    label: '태블릿10 세로 820×1180',
    viewport: { width: 820, height: 1180 },
    deviceScaleFactor: 2,
    hasTouch: true,
    expectDeviceClass: 'tablet-10',
    minTargetPx: 44,
  },
  {
    key: 'laptop13',
    label: '노트북13 1440×900',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    hasTouch: false,
    expectDeviceClass: 'laptop',
    minTargetPx: 32,
  },
];

export async function openLiveContext(profile, { profileDir, freshProfile = true } = {}) {
  const dir = profileDir ?? resolve(ROOT, `.playwright-live/${profile.key}`);
  if (freshProfile) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  return chromium.launchPersistentContext(dir, {
    // ⚠️ 확장 로드에는 표시 가능한 브라우저가 필요하다. 리눅스에서는 xvfb-run 으로 감싼다.
    headless: false,
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
    ],
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    isMobile: false,
    hasTouch: profile.hasTouch,
    userAgent: DESKTOP_UA,
    locale: 'ko-KR',
  });
}

export async function warmUp(context, channelId = CHANNELS[0].channelId) {
  const page = await context.newPage();
  // 실사이트는 픽스처보다 느리므로 타임아웃을 넉넉히 둔다.
  await page.goto(`https://chzzk.naver.com/live/${channelId}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForTimeout(3000);
  await page.close();
}

/**
 * 페이지에서 우리 UI(`cm-*`)를 전부 훑어 측정한다. **페이지 안에서 실행된다**(`page.evaluate`).
 *
 * 캡처 스크립트가 "찍을 만한 상태인가"를 판정할 때 쓴다 — 요소의 존재가 아니라
 * **화면에 보이고 눌리는가**를 본다.
 *
 * ⚠️ `getBoundingClientRect` 는 **조상의 클립을 모른다.** 멀티뷰가 채팅 aside 를 폭 0 +
 * `overflow: hidden` 으로 접으면 그 안의 UI 가 rect 상 남아 화면 밖에 있는 것처럼 보인다
 * (실측 2026-08-12, 오탐 5건의 원인) → 조상 클립과 교차시켜 실제 가시 영역을 구한다.
 */
export function measureOurUi() {
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      position: cs.position,
      zIndex: cs.zIndex,
      pointerEvents: cs.pointerEvents,
    };
  };

  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0)
      return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;

    let clip = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    for (let p = el.parentElement; p; p = p.parentElement) {
      const pcs = getComputedStyle(p);
      if (pcs.overflow === 'visible' && pcs.overflowX === 'visible' && pcs.overflowY === 'visible')
        continue;
      const pr = p.getBoundingClientRect();
      clip = {
        left: Math.max(clip.left, pr.left),
        top: Math.max(clip.top, pr.top),
        right: Math.min(clip.right, pr.right),
        bottom: Math.min(clip.bottom, pr.bottom),
      };
      if (clip.right <= clip.left || clip.bottom <= clip.top) return false;
    }
    return true;
  };

  /**
   * 자기 중심점에서 스스로가 최상단인가. `z-index` 숫자 비교로는 판단할 수 없다 —
   * 컨트롤바 버튼은 `z-index: auto` 라 `Number('auto')` 가 NaN 이 되어 비교가 무의미하다.
   */
  const hitsSelf = (el) => {
    const r = el.getBoundingClientRect();
    const cx = Math.round(r.x + r.width / 2);
    const cy = Math.round(r.y + r.height / 2);
    if (cx < 0 || cy < 0 || cx >= window.innerWidth || cy >= window.innerHeight) return false;
    const top = document.elementFromPoint(cx, cy);
    return top !== null && (el === top || el.contains(top) || top.contains(el));
  };

  /** 서로 독립적으로 떠 있어야 하는 최상위 UI 만 짝지어 본다 (자손끼리 겹침은 정상). */
  const TOP_LEVEL_IDS = [
    'cm-multiview-stage',
    'cm-multiview-sheet',
    'cm-settings-panel',
    'cm-chat-filter-panel',
    'cm-chat-preset-bar',
    'cm-volume-control',
    'cm-settings-button',
    'cm-multiview-button',
  ];

  const topLevel = TOP_LEVEL_IDS.map((id) => {
    const el = document.getElementById(id);
    return el && visible(el) ? { id, rect: rect(el), hitsSelf: hitsSelf(el) } : null;
  }).filter(Boolean);

  /**
   * 🔴 컨테이너 높이가 0 이면 위 목록에서 빠진다 — 프리셋 바가 그렇다(플로팅으로 바꿨다).
   * 이 누락 때문에 프리셋 아이콘이 FR-05 폭 조절 컨트롤과 겹치는 것을 놓쳤다 (2026-08-13).
   */
  for (const [id, selector] of [['cm-preset-actions', '.cm-preset-actions']]) {
    const el = document.querySelector(selector);
    if (el && visible(el)) topLevel.push({ id, rect: rect(el), hitsSelf: hitsSelf(el) });
  }

  const describe = (el) =>
    el
      ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${
          typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/)[0] : ''
        }`
      : 'null';

  /**
   * 그 버튼을 **실제로 누를 수 있는가** (판정 2 의 재료).
   *
   * `inViewport: false` 는 덮인 게 아니라 **중심점이 뷰포트 밖**이라는 뜻이다. 1920×950 에서
   * 토글 버튼 중심이 y=950.3 이라 `elementFromPoint` 가 `null` 이던 결함이 이 부류였다
   * (2026-08-15). 두 원인을 구분해야 "왜 못 누르는가"를 보고할 수 있다.
   */
  /** 모달·스테이지는 뒤를 덮는 것이 의도된 동작이다 — 이 안에 있는 것에 덮인 건 결함이 아니다. */
  const OVERLAY_SEL =
    '#cm-multiview-stage, #cm-settings-panel, #cm-multiview-sheet, #cm-chat-filter-panel';
  const inOverlay = (el) =>
    !!(
      el &&
      el.closest &&
      (el.closest(OVERLAY_SEL) ||
        (typeof el.className === 'string' && /cm-sheet-backdrop/.test(el.className)))
    );

  const reach = (el) => {
    const r = el.getBoundingClientRect();
    const cx = Math.round(r.x + r.width / 2);
    const cy = Math.round(r.y + r.height / 2);
    if (cx < 0 || cy < 0 || cx >= window.innerWidth || cy >= window.innerHeight)
      return {
        inViewport: false,
        hitsSelf: false,
        topAtCenter: null,
        inOverlay: inOverlay(el),
        coveredByOverlay: false,
      };
    const top = document.elementFromPoint(cx, cy);
    return {
      inViewport: true,
      hitsSelf: top !== null && (el === top || el.contains(top) || top.contains(el)),
      topAtCenter: describe(top),
      inOverlay: inOverlay(el),
      coveredByOverlay: inOverlay(top),
    };
  };

  const buttons = Array.from(
    document.querySelectorAll(
      '#cm-multiview-stage button, #cm-settings-panel button, #cm-chat-filter-panel button, ' +
        '#cm-chat-preset-bar button, .cm-preset-actions button, #cm-volume-control button, ' +
        'button#cm-settings-button, button#cm-multiview-button, .cm-controlbar-item',
    ),
  )
    .filter(visible)
    .map((el) => ({
      label: el.getAttribute('aria-label') || el.textContent?.trim()?.slice(0, 12) || el.id,
      owner: el.closest('[id^="cm-"]')?.id ?? (el.id.startsWith('cm-') ? el.id : 'controlbar'),
      rect: rect(el),
    }));

  /**
   * 판정 2 대상 — **셀렉터를 하드코딩하지 않고** `cm-` 접두어로 발견한 우리 버튼 전부.
   * 위 `buttons`(터치 타겟 검사용)는 목록을 열거하므로 새 UI 가 빠진다. 실제로 폭 조절
   * 컨트롤(`.cm-chat-width-control`)이 그 목록에 없어 "중심점이 뷰포트 밖" 결함을 놓쳤다.
   */
  const clickables = (() => {
    const found = new Set();
    for (const sel of [
      '[id^="cm-"] button',
      '[class*="cm-"] button',
      'button[id^="cm-"]',
      '.cm-controlbar-item',
      '.cm-preset-chip',
    ]) {
      for (const el of document.querySelectorAll(sel)) found.add(el);
    }
    return Array.from(found)
      .filter(visible)
      .filter((el) => !(el.disabled || el.getAttribute('aria-disabled') === 'true'))
      .map((el) => ({
        label: el.getAttribute('aria-label') || el.textContent?.trim()?.slice(0, 16) || el.id,
        owner:
          el.closest('[id^="cm-"]')?.id ??
          (el.id.startsWith('cm-')
            ? el.id
            : (el.closest('[class*="cm-"]')?.className ?? 'unknown')),
        rect: rect(el),
        ...reach(el),
      }));
  })();

  return {
    viewport: {
      w: Math.round(window.visualViewport?.width ?? document.documentElement.clientWidth),
      h: Math.round(window.visualViewport?.height ?? document.documentElement.clientHeight),
    },
    deviceClass: document.documentElement.getAttribute('data-cm-device'),
    touchAttr: document.documentElement.getAttribute('data-cm-touch'),
    scroll: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    },
    aside: (() => {
      const el = document.getElementById('aside-chatting');
      return el ? rect(el) : null;
    })(),
    /**
     * FR-05 하단 배치(세로 자세)인가. 이 모드에서 채팅이 차지하는 축은 **높이**다 —
     * 폭만 보면 "조작해도 안 변한다"로 오판한다 (실측 2026-08-15 `ratio-9to16`).
     */
    bottomLayout: (document.getElementById('cm-layout-style')?.textContent ?? '').includes(
      'flex-direction: column',
    ),
    /** 영상 크기는 `video` rect 가 아니라 `pictureW = min(w, h×16/9)` 로 본다. */
    picture: (() => {
      const video = document.querySelector('video');
      if (!video) return null;
      const r = video.getBoundingClientRect();
      return {
        pictureW: Math.round(Math.min(r.width, (r.height * 16) / 9)),
        pictureH: Math.round(Math.min(r.height, (r.width * 9) / 16)),
      };
    })(),
    topLevel,
    /** 실제로 떠 있는 모달 컨테이너 id — 내부 `.cm-sheet`/패널 본체가 보이는지로 판정한다. */
    openPanels: ['cm-multiview-sheet', 'cm-settings-panel', 'cm-chat-filter-panel'].filter((id) => {
      const host = document.getElementById(id);
      if (!host) return false;
      const body = host.querySelector('.cm-sheet, .cm-sheet-backdrop') ?? host;
      return visible(body);
    }),
    buttons,
    clickables,
    stageSlots: Array.from(document.querySelectorAll('#cm-multiview-stage .cm-slot')).length,
  };
}

export async function seedSettings(context, patch) {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  await worker.evaluate(
    async ([key, patchJson]) => {
      const stored = await chrome.storage.local.get(key);
      const current = stored[key] ?? {};
      const patchObj = JSON.parse(patchJson);
      const next = { ...current };
      for (const [section, value] of Object.entries(patchObj)) {
        next[section] =
          value && typeof value === 'object' && !Array.isArray(value)
            ? { ...(current[section] ?? {}), ...value }
            : value;
      }
      await chrome.storage.local.set({ [key]: next });
    },
    [STORAGE_KEY, JSON.stringify(patch)],
  );
}
