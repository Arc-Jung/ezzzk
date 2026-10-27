/**
 * README 데모용 스크린샷 캡처 — **실제 스트리머 방송**을 찍는다.
 *
 * - **라이브 목록에서 채널을 무작위로 골라** 실제 페이지를 찍는다. 목업이 아니라 실제 방송
 *   화면이어야 README 로서 의미가 있다.
 * - 결과물은 `screenshots/` 에 남긴다 — README 에서 참조하므로 **커밋 대상**이다.
 * - 프로필을 **동시 실행**한다. 직렬로 돌리면 수 분, 병렬이면 약 30초다.
 *
 * ⚠️ 실제 방송이라 **매 실행 결과가 다르다.** 그것이 의도다.
 * ⚠️ 성인 채널(`adult`)은 제외한다.
 * ⚠️ **광고 재생 중에는 컨트롤바가 광고 플레이어 것으로 바뀌어 우리 버튼이 사라진다**(실측
 *    2026-08-15, `demo-laptop13-watch.png` 에 "1초 후 SKIP"·"광고 페이지 보기"가 찍혔다).
 *    그래서 찍기 전에 **프리롤 광고가 끝날 때까지 기다리고**, 그래도 안 끝나면 다른 채널로 넘어간다.
 * ⚠️ **"요소가 있다"가 아니라 "보이고 눌린다"로 판정한다** — `elementFromPoint` 로 확인한다.
 *    광고 오버레이에 덮인 버튼은 `isVisible()` 만으로는 걸러지지 않았다.
 * ⚠️ 남의 방송 화면이 공개 README 에 들어간다 — 커밋 전에 프레임 내용을 확인한다.
 *
 * 실행: `yarn demo:shots`
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PROFILES,
  ROOT,
  measureOurUi,
  openLiveContext,
  seedSettings,
  warmUp,
} from './demo-context.mjs';

const OUT_DIR = resolve(ROOT, 'screenshots');
const LIVES_URL = 'https://api.chzzk.naver.com/service/v1/lives?size=20';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** 데모에 쓸 프로필만 고른다 — README 에 5장을 다 넣을 이유가 없다. */
const DEMO_PROFILES = ['laptop13', 'mobile-landscape', 'mobile-portrait'];

/** 기대 요소를 못 찾았을 때 다른 채널로 다시 시도할 횟수 (광고 중이면 컨트롤바가 없다). */
const CHANNEL_RETRIES = 4;

/**
 * 한 샷만 다시 찍고 싶을 때 쓴다 (`DEMO_SHOTS=multiview`). 디버깅용이므로 이때는
 * README 조각을 **다시 쓰지 않는다** — 일부만 담긴 표로 덮으면 README 가 깨진다.
 */
const ONLY_SHOTS =
  (process.env['DEMO_SHOTS'] ?? process.argv[2])?.split(',').filter(Boolean) ?? null;

/**
 * 광고 판별 셀렉터는 **`src/features/adSkip.ts` 의 `AD` 상수를 그대로 읽어** 쓴다.
 * 저 상수만이 실측 근거(`chzzk-dom-27`·`28`·`30`)가 붙은 출처다 — 여기서 새로 만들면 갈라진다.
 * `.mjs` 라 TS 를 import 할 수 없어 소스에서 문자열 리터럴만 뽑는다.
 */
function readAdSelectors() {
  const source = readFileSync(resolve(ROOT, 'src/features/adSkip.ts'), 'utf8');
  const pick = (key) => {
    const found = new RegExp(`${key}:\\s*'([^']+)'`).exec(source)?.[1];
    if (!found) throw new Error(`src/features/adSkip.ts 에서 AD.${key} 를 읽을 수 없습니다`);
    return found;
  };
  return { skipButton: pick('skipButton'), advertiserLink: pick('advertiserLink') };
}

const AD = readAdSelectors();

/**
 * 광고 재생 신호.
 * - 카운트다운 중: `a.link_more`(광고 페이지 보기)가 보인다
 * - 스킵 가능 시점: `button.btn_skip` 이 보인다 (`display` 만 바뀐다 — 존재 여부로는 판정 불가)
 *
 * 둘 다 안 보이면 광고 플레이어가 내려간 것이다.
 */
const AD_SELECTOR = `${AD.skipButton}, ${AD.advertiserLink}`;
/** 광고는 1분을 넘을 수 있다 (실측 92초). 상한을 넘기면 이 채널을 포기하고 다음 채널로 간다. */
const AD_WAIT_MS = 150_000;
const AD_POLL_MS = 1000;
/** 광고 사이의 짧은 빈 프레임을 "끝났다"로 오판하지 않도록 연속 N회 깨끗해야 통과시킨다. */
const AD_CLEAR_STREAK = 3;

/** 지금 화면에 광고가 떠 있는가. **보이는지**로만 판정한다 (adSkip.ts 의 원칙과 동일). */
function isAdPlaying(page) {
  return page.evaluate((selector) => {
    const visible = (el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0)
        return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    return Array.from(document.querySelectorAll(selector)).some(visible);
  }, AD_SELECTOR);
}

/**
 * 프리롤 광고가 끝날 때까지 기다린다. 상한을 넘기면 던져서 **다른 채널로 넘어가게** 한다.
 * (확장의 FR-18 이 스킵 버튼을 대신 눌러 주므로 보통은 카운트다운만 기다리면 된다.)
 */
async function waitForAdToEnd(page, label) {
  const deadline = Date.now() + AD_WAIT_MS;
  let streak = 0;
  let sawAd = false;

  while (Date.now() < deadline) {
    const playing = await isAdPlaying(page).catch(() => false);
    if (playing) {
      if (!sawAd) console.info(`    · 광고 재생 중 — 종료를 기다린다 (${label})`);
      sawAd = true;
      streak = 0;
    } else {
      streak += 1;
      if (streak >= AD_CLEAR_STREAK) {
        if (sawAd) console.info(`    · 광고 종료 확인 (${label})`);
        return;
      }
    }
    await page.waitForTimeout(AD_POLL_MS);
  }
  throw new Error(`광고가 ${AD_WAIT_MS / 1000}초 안에 끝나지 않았습니다`);
}

/**
 * 우리 UI 가 **보이고 실제로 눌리는지** 판정한다.
 * 판정 규칙은 `measureOurUi` 를 그대로 쓴다 — 캡처마다 잣대가 달라지지 않게 한 곳에 둔다.
 * `hitsSelf` 가 `elementFromPoint` 기반이라 광고 오버레이에 덮인 버튼을 걸러낸다.
 */
async function requireClickable(page, ids) {
  const measured = await page.evaluate(measureOurUi);
  for (const id of ids) {
    const found = measured.topLevel.find((item) => item.id === id);
    if (!found) throw new Error(`${id} 가 보이지 않습니다`);
    if (!found.hitsSelf) throw new Error(`${id} 가 다른 요소에 덮여 있어 누를 수 없습니다`);
  }
}

/**
 * 회귀 감시 — 슬롯 좌상단에 플레이어 우클릭 메뉴가 새어 나오는가.
 *
 * 2026-08-16 에 실제로 있었던 결함이다(`pzp-contextmenu-pane` 200×126 @ 슬롯 좌상단, 3프로필 전부).
 * 원인은 슬롯 모드 CSS 의 `#live_player_layout * { visibility: visible !important }` 가
 * 플레이어가 **스스로 숨겨 둔** 메뉴까지 되살린 것이었다. `visibility` 는 상속되므로 `*` 가
 * 애초에 불필요했고, 자손 선택자를 떼어 고쳤다(`slotFrame.ts`, 노출 9/9 → 0/9).
 *
 * 고쳐졌지만 **판정은 남긴다.** 되살아나면 README 에 그 상태가 그대로 박히기 때문이다 —
 * 그때는 조용히 저장하지 말고 실패시켜 다른 채널로 재시도하게 한다.
 */
const SLOT_CONTEXTMENU_LEAK = '슬롯 좌상단 컨텍스트 메뉴 노출 (slotFrame.ts 되살리기 CSS 회귀)';

/** 모달 컨테이너가 실제로 열려 있는지 (`openPanels` 는 내부 `.cm-sheet` 가시성으로 판정한다). */
async function requireOpenPanel(page, id) {
  const measured = await page.evaluate(measureOurUi);
  if (!measured.openPanels.includes(id)) throw new Error(`${id} 가 열려 있지 않습니다`);
}

/**
 * 🔴 실사이트의 컨트롤바는 **자동 숨김**이다 (`pzp-pc--controls` modifier).
 * 픽스처는 항상 보이게 만들어 뒀지만 실제 방송에서는 포인터를 플레이어 위로 올려야 드러난다.
 * 이 과정을 빼면 우리 버튼 클릭이 타임아웃한다 (실측: 3개 샷 전부 5초 타임아웃).
 */
async function revealControls(page) {
  const player = page.locator('#live_player_layout, .pzp-pc').first();
  if (await player.count()) {
    await player.hover({ timeout: 5000 }).catch(() => {});
    await page.mouse.move(10, 10).catch(() => {});
    await player.hover({ timeout: 5000 }).catch(() => {});
  }
  await revealTapOnlyControls(page);
  await page.waitForTimeout(500);
}

/**
 * 탭에서만 나타나는 UI(FR-03 볼륨 컨트롤 — `volumeAlwaysVisible: false` 인 모바일·7인치급)를 띄운다.
 *
 * 🔴 `hover` 로는 안 된다. 노출 신호가 플레이어의 `pointerdown` 이라 호버만으로는 반응하지 않아
 * **모바일 데모에 볼륨 컨트롤이 한 번도 담기지 않았다**(2026-09-03 확인). 그렇다고 진짜로 클릭하면
 * 치지직이 재생/일시정지를 토글해 데모 화면이 멈춘 상태로 찍힌다 → 합성 `pointerdown` 만 보낸다.
 * 노출은 3초 뒤 자동으로 닫히므로 **찍기 직전에** 다시 부른다.
 */
async function revealTapOnlyControls(page) {
  await page
    .evaluate(() => {
      const root = document.querySelector('.pzp-pc, .pzp-mobile');
      root?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    })
    .catch(() => {});
}

/** 우리 버튼이 보이고 **눌리는 상태**가 될 때까지 기다린 뒤 누른다. */
async function clickOurButton(page, selector) {
  await revealControls(page);
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: 15_000 });
  await requireClickable(page, [selector.replace('#', '')]);
  await page.locator(selector).first().click({ timeout: 10_000 });
}

const SHOTS = [
  {
    key: 'watch',
    file: (p) => `demo-${p}-watch.png`,
    caption: '기본 시청 화면 — 채팅 부가 요소 숨김 + 컨트롤바 버튼 삽입',
    multiView: false,
    setup: async (page) => {
      // 광고가 끝난 직후에는 컨트롤바 재구성에 시간이 걸린다 — 삽입될 때까지 기다린다.
      await page
        .locator('#cm-settings-button')
        .first()
        .waitFor({ state: 'attached', timeout: 20_000 });
      // 삽입 버튼이 보이는 상태로 찍는다 — 자동 숨김 상태면 데모에 아무것도 안 보인다.
      await revealControls(page);
    },
    /**
     * 삽입한 UI 3종이 보이고 실제로 눌리는 상태여야 데모로서 의미가 있다.
     * 볼륨 컨트롤(FR-03)을 넣은 이유: 모바일에서 탭 노출이 안 되면 조용히 빠진 채로 저장됐다
     * (2026-09-03 — 그때까지 모든 모바일 데모에 볼륨이 없었다).
     */
    verify: (page) =>
      requireClickable(page, ['cm-settings-button', 'cm-multiview-button', 'cm-volume-control']),
  },
  {
    key: 'settings',
    file: (p) => `demo-${p}-settings.png`,
    caption: '설정 패널 (FR-09.2)',
    multiView: false,
    setup: async (page) => {
      await clickOurButton(page, '#cm-settings-button');
      await page.waitForTimeout(1200);
    },
    verify: (page) => requireOpenPanel(page, 'cm-settings-panel'),
  },
  {
    key: 'config-sheet',
    file: (p) => `demo-${p}-multiview-config.png`,
    caption: '멀티뷰 구성 시트 — 조작은 상단, 인기 방송 30개씩 추가 로드',
    multiView: false,
    setup: async (page) => {
      await clickOurButton(page, '#cm-multiview-button');
      await page.waitForTimeout(2500);
      /*
       * 🔴 `멀티` 는 **저장된 구성이 있으면 스테이지를 연다**(이어보기, 2026-08-19). 그때 구성 시트로
       * 가는 길은 스테이지 조작 바의 `구성` 이다 — 실제 사용자 경로와 같다.
       * 예전 경로만 밟던 구현은 3프로필 전부 `cm-multiview-sheet 가 열려 있지 않습니다` 로 실패했다.
       */
      const sheetOpen = await page
        .locator('#cm-multiview-sheet .cm-sheet')
        .count()
        .then((n) => n > 0);
      if (!sheetOpen) {
        await clickOurButton(page, '#cm-multiview-stage [aria-label="멀티뷰 구성 열기"]');
        await page.waitForTimeout(2500);
      }
    },
    /** 시트가 열린 것만으로는 부족하다 — 채널 목록이 실제로 채워져야 보여줄 화면이 된다. */
    verify: async (page) => {
      await requireOpenPanel(page, 'cm-multiview-sheet');
      const rows = await page.locator('#cm-multiview-sheet .cm-mv-channels > li').count();
      if (rows === 0) throw new Error('멀티뷰 구성 시트에 채널 목록이 없습니다');
    },
  },
  {
    key: 'multiview',
    file: (p) => `demo-${p}-multiview.png`,
    caption: '멀티뷰 시청 화면 (4분할 · 화면 비율에 맞춰 배치)',
    multiView: true,
    setup: async (page) => {
      const stage = page.locator('#cm-multiview-stage .cm-slot').first();
      try {
        await stage.waitFor({ state: 'attached', timeout: 60_000 });
      } catch {
        /**
         * 복원 경로가 안 먹으면 정식 경로로 연다 — 구성 시트에서 `멀티뷰 시작`.
         * 복원은 저장된 설정에 의존해 실사이트에서 타이밍에 밀릴 수 있다.
         */
        await clickOurButton(page, '#cm-multiview-button');
        await page.waitForTimeout(2500);
        await page
          .locator('#cm-multiview-sheet button[aria-label="멀티뷰 시작"]')
          .click({ timeout: 10_000 });
        await stage.waitFor({ state: 'attached', timeout: 20_000 });
      }
      /*
       * 슬롯들이 실제 방송을 받아 그리기까지 넉넉히 기다린다.
       * 사이드 채팅(BETA)은 슬롯 컨트롤러가 채팅을 200ms 배치로 올려 준 뒤에야 채워지므로,
       * 10초로는 **본문이 빈 순간**이 찍혔다 (2026-08-19 실측) → 채팅이 흐를 시간까지 준다.
       */
      await page.waitForTimeout(16_000);
      // iframe 껍데기만 준비된 검은 화면을 촬영하지 않는다.
      for (const frame of page.frames().filter((entry) => entry !== page.mainFrame())) {
        await frame.evaluate(async () => {
          const video = document.querySelector('video');
          if (video?.paused) {
            void video.play().catch(() => {
              /* 아래 재생 검증에서 실패 사유를 보고한다. */
            });
          }
        });
      }
      const deadline = Date.now() + 60_000;
      let states = [];
      let previousTimes = new Map();
      let playingStreak = 0;
      while (Date.now() < deadline) {
        states = await Promise.all(
          page
            .frames()
            .filter((entry) => entry !== page.mainFrame())
            .map((frame) =>
              frame
                .evaluate(() => {
                  const video = document.querySelector('video');
                  return video
                    ? {
                        slot: new URL(location.href).searchParams.get('cmSlot'),
                        readyState: video.readyState,
                        currentTime: video.currentTime,
                        width: video.videoWidth,
                        paused: video.paused,
                        error: video.error?.message ?? null,
                      }
                    : null;
                })
                .catch(() => null),
            ),
        );
        if (
          states.filter(
            (state) =>
              state &&
              state.slot &&
              state.readyState >= 4 &&
              !state.paused &&
              !state.error &&
              state.width > 0 &&
              state.currentTime > (previousTimes.get(state.slot) ?? Infinity),
          ).length >= 4
        ) {
          playingStreak += 1;
          if (playingStreak >= 3) return;
        } else {
          playingStreak = 0;
        }
        previousTimes = new Map(
          states.filter(Boolean).map((state) => [state.slot, state.currentTime]),
        );
        await page.waitForTimeout(1000);
      }
      throw new Error(`방송 4개가 재생되지 않았습니다: ${JSON.stringify(states)}`);
    },
    /** 슬롯 껍데기만 있는 화면은 데모로 쓸 수 없다 — iframe 이 붙었는지까지 본다. */
    verify: async (page) => {
      const frames = await page.locator('#cm-multiview-stage .cm-slot iframe').count();
      if (frames === 0) throw new Error('멀티뷰 슬롯에 iframe 이 붙지 않았습니다');

      /*
       * 사이드 채팅(BETA)이 켜져 있으면 **본문이 채워진 상태**여야 보여줄 화면이다.
       * 패널만 있고 줄이 없으면 다른 채널로 다시 찍는다 — 빈 패널이 README 에 박히면
       * 기능이 동작하지 않는 것처럼 보인다.
       */
      const chat = await page.evaluate(() => {
        const panel = document.querySelector('#cm-multiview-stage .cm-stage-chat');
        if (!panel) return null;
        return { lines: panel.querySelectorAll('.cm-stage-chat__line').length };
      });
      // 패널을 켜고 찍는 날이 오면(슬롯 채팅 수집이 고쳐지면) 빈 패널은 저장하지 않는다.
      if (chat && chat.lines === 0) throw new Error('사이드 채팅 패널이 비어 있습니다');

      // 저장은 하되, 알려진 결함이 프레임에 찍혔는지는 사람이 알 수 있게 남긴다.
      let leaked = 0;
      for (const frame of page.frames()) {
        const shown = await frame
          .evaluate(() => {
            const pane = document.querySelector('[class*="pzp-contextmenu-pane"]');
            if (!pane) return false;
            const r = pane.getBoundingClientRect();
            return getComputedStyle(pane).visibility === 'visible' && r.width > 0 && r.height > 0;
          })
          .catch(() => false);
        if (shown) leaked += 1;
      }
      // 새어 나오면 저장하지 않는다 — 던져서 재시도·다른 채널로 넘긴다 (조용히 넘기면 README 에 박힌다).
      if (leaked > 0) throw new Error(`슬롯 ${leaked}개 — ${SLOT_CONTEXTMENU_LEAK}`);
    },
  },
];

// 새 배치는 기존 4분할과 별도 파일로 남겨 두 배치를 모두 비교할 수 있게 한다.
const gridShot = SHOTS.find((shot) => shot.key === 'multiview');
const subtitleShot = {
  key: 'chat-subtitle',
  subtitle: true,
  explicitOnly: true,
  multiView: false,
  caption: '자막형 채팅 — 영상 좌측 하단',
  file: (p) => `demo-${p}-chat-subtitle.png`,
  setup: async (page) => {
    await page
      .locator('#cm-chat-subtitle:not([hidden]) .cm-subtitle-message')
      .last()
      .waitFor({ state: 'visible', timeout: 20_000 });
    // DOM 순서가 뒤집혀 있어도 화면의 최신 채팅을 따라가는지 확인한다.
    await page.waitForFunction(
      () => {
        const overlay = document.getElementById('cm-chat-subtitle');
        const nodes = [
          ...document.querySelectorAll('#aside-chatting [class*="_chatting_message_"]'),
        ]
          .map((node) => ({ node, top: node.getBoundingClientRect().top }))
          .sort((a, b) => a.top - b.top)
          .slice(-3);
        return nodes.some(({ node }) => {
          const copy = node.cloneNode(true);
          copy
            .querySelectorAll('button, [class*="_nickname_"]')
            .forEach((element) => element.remove());
          copy
            .querySelectorAll('img')
            .forEach((image) => image.replaceWith(image.getAttribute('alt') ?? ''));
          const text = copy.textContent.replace(/\s+/g, ' ').trim();
          return text && overlay.textContent.includes(text);
        });
      },
      undefined,
      { timeout: 15_000 },
    );
  },
  verify: async (page) => {
    const result = await page.locator('#cm-chat-subtitle').evaluate((overlay) => {
      const rect = overlay.getBoundingClientRect();
      const player = overlay.parentElement.getBoundingClientRect();
      return {
        lines: Number(overlay.dataset.lines),
        pointerEvents: getComputedStyle(overlay).pointerEvents,
        fits:
          rect.left >= player.left &&
          rect.right <= player.right + 1 &&
          rect.top >= player.top &&
          rect.bottom <= player.bottom + 1,
      };
    });
    if (!result.fits || result.lines < 3 || result.lines > 6 || result.pointerEvents !== 'none') {
      throw new Error(`자막 표시 영역 오류: ${JSON.stringify(result)}`);
    }
  },
};
SHOTS.push(subtitleShot);
SHOTS.push({
  ...subtitleShot,
  key: 'chat-subtitle-fullscreen',
  caption: '전체화면 자막형 채팅',
  file: (p) => `demo-${p}-chat-subtitle-fullscreen.png`,
  setup: async (page) => {
    await subtitleShot.setup(page);
    await revealControls(page);
    await page.locator('button.pzp-pc__fullscreen-button').first().click();
    await page.waitForFunction(() =>
      document.fullscreenElement?.contains(document.getElementById('cm-chat-subtitle')),
    );
    await page.waitForTimeout(600);
  },
});
SHOTS.push({
  ...subtitleShot,
  key: 'chat-subtitle-settings',
  caption: '자막형 채팅 설정 — 배경색·불투명도·글자 크기',
  file: (p) => `demo-${p}-chat-subtitle-settings.png`,
  setup: async (page) => {
    await subtitleShot.setup(page);
    const openChatSettings = async () => {
      await clickOurButton(page, '#cm-settings-button');
      await page.getByRole('tab', { name: '채팅 탭', exact: true }).click();
    };
    await openChatSettings();
    await page.getByRole('button', { name: '자막형 채팅 글자 크기 늘리기', exact: true }).click();
    await page.getByLabel('자막형 채팅 배경 불투명도', { exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    // 실제 설정 UI에서 끄고 켠 뒤 새로고침에도 보존되는지 확인한다.
    await page
      .getByRole('switch', { name: '영상 좌측 하단에 채팅 표시 켜짐', exact: true })
      .click();
    await page.locator('#cm-chat-subtitle').waitFor({ state: 'detached' });
    await page
      .getByRole('switch', { name: '영상 좌측 하단에 채팅 표시 꺼짐', exact: true })
      .click();
    await page.waitForTimeout(800);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await subtitleShot.setup(page);
    await page.waitForFunction(() => {
      const overlay = document.getElementById('cm-chat-subtitle');
      return overlay && overlay.style.backgroundColor === 'rgba(0, 0, 0, 0.7)';
    });
    await waitForAdToEnd(page, '자막 설정 새로고침');
    await openChatSettings();
    await page.getByLabel('자막형 채팅 배경 불투명도', { exact: true }).scrollIntoViewIfNeeded();
  },
  verify: async (page) => {
    await requireOpenPanel(page, 'cm-settings-panel');
    const font = await page
      .getByLabel('자막형 채팅 글자 크기 현재 값', { exact: true })
      .textContent();
    if (font.trim() !== '17 px') throw new Error(`자막 글자 크기 저장 실패: ${font}`);
  },
});
SHOTS.push({
  ...gridShot,
  key: 'chat-subtitle-multiview',
  subtitle: true,
  explicitOnly: true,
  file: (p) => `demo-${p}-chat-subtitle-multiview.png`,
  caption: '멀티뷰 슬롯별 자막형 채팅',
  setup: async (page) => {
    await gridShot.setup(page);
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const states = await Promise.all(
        page
          .frames()
          .filter((frame) => frame.url().includes('cmSlot='))
          .map((frame) =>
            frame
              .evaluate(() => ({
                messages: document.querySelectorAll('#aside-chatting [class*="_chatting_message_"]')
                  .length,
                visible: !!document.querySelector(
                  '#cm-chat-subtitle:not([hidden]) .cm-subtitle-message',
                ),
              }))
              .catch(() => ({ messages: 0, visible: false })),
          ),
      );
      if (
        states.some((state) => state.visible) &&
        states.every((state) => state.messages === 0 || state.visible)
      )
        return;
      await page.waitForTimeout(500);
    }
    throw new Error('멀티뷰 슬롯의 실제 채팅 자막을 확인하지 못했습니다');
  },
});
SHOTS.push({
  ...gridShot,
  key: 'multiview-main-sidebar',
  file: (p) => `demo-${p}-multiview-main-sidebar.png`,
  caption: '멀티뷰 시청 — 메인 70% + 오른쪽 3개',
  layout: 'main-sidebar',
  landscapeOnly: true,
  verify: async (page) => {
    await gridShot.verify(page);
    const sizes = await page.locator('#cm-multiview-stage .cm-slot').evaluateAll((cells) =>
      cells
        .map((cell) => ({
          slot: Number(cell.dataset.slot),
          ...Object.fromEntries(
            ['x', 'y', 'width', 'height'].map((key) => [key, cell.getBoundingClientRect()[key]]),
          ),
        }))
        .sort((a, b) => a.slot - b.slot),
    );
    if (sizes.length !== 4) throw new Error('메인 배치에 방송 4개가 필요합니다');
    const [main, ...side] = sizes;
    if (
      Math.abs(main.width / (main.width + side[0].width) - 0.7) > 0.01 ||
      side.some((rect) => rect.x <= main.x || rect.width !== side[0].width) ||
      !(side[0].y < side[1].y && side[1].y < side[2].y)
    ) {
      throw new Error('메인 70% + 오른쪽 3개 배치가 적용되지 않았습니다');
    }
  },
});

/** 라이브 목록에서 성인 채널을 걸러 **무작위 순서**로 돌려준다. */
async function fetchLiveChannels() {
  const res = await fetch(LIVES_URL, { headers: { 'User-Agent': UA } });
  const rows = ((await res.json())?.content?.data ?? []).filter((row) => !row?.adult);
  const channels = rows
    .map((row) => ({
      channelId: row?.channel?.channelId,
      channelName: row?.channel?.channelName ?? '',
    }))
    // channelId 는 16자 이상 hex 여야 확장이 live 로 판별한다.
    .filter((c) => typeof c.channelId === 'string' && /^[0-9a-f]{16,}$/i.test(c.channelId));

  // 무작위 섞기 — 매 실행마다 다른 방송이 찍히는 것이 데모의 목적이다.
  for (let i = channels.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [channels[i], channels[j]] = [channels[j], channels[i]];
  }
  if (channels.length === 0) throw new Error('라이브 채널을 가져올 수 없습니다');
  return channels;
}

async function captureProfile(profile, channels) {
  const context = await openLiveContext(profile, {
    profileDir: resolve(ROOT, `etc/tmp/playwright/demo/${profile.key}`),
    // 촬영 환경의 오디오 장치 오류가 영상 시계까지 멈추지 않게 한다.
    browserArgs: ['--disable-audio-output'],
  });
  const done = [];
  const failed = [];

  try {
    await warmUp(context, channels[0].channelId);

    for (const [shotIndex, shot] of SHOTS.entries()) {
      // 일부 샷만 다시 찍고 싶을 때: `DEMO_SHOTS=multiview node scripts/capture-demo.mjs`
      if (ONLY_SHOTS && !ONLY_SHOTS.includes(shot.key)) continue;
      if (shot.explicitOnly && !ONLY_SHOTS) continue;
      if (shot.landscapeOnly && profile.viewport.height > profile.viewport.width) continue;
      let saved = false;
      let lastReason = '(원인 미기록)';

      for (let attempt = 0; attempt < CHANNEL_RETRIES && !saved; attempt += 1) {
        // 샷·시도마다 다른 채널을 쓴다 — 한 채널이 광고 중이어도 다음 채널로 넘어간다.
        const main = channels[(shotIndex + attempt) % channels.length];
        /*
         * 🔴 **구성 시트 샷에는 슬롯을 심지 않는다.** `멀티` 는 저장된 구성이 있으면 스테이지를
         * 여는 이어보기 경로를 타므로(2026-08-19), 슬롯을 심어 두면 시트가 아니라 스테이지가 뜬다
         * (3프로필 전부 이 이유로 실패했다). 이 샷은 "처음 세팅" 화면이므로 빈 구성이 맞다.
         */
        const slots =
          shot.key === 'config-sheet'
            ? []
            : Array.from({ length: 4 }, (_, i) => channels[(attempt + i) % channels.length]).map(
                (c, i) => ({
                  index: i + 1,
                  channelId: c.channelId,
                  channelName: c.channelName,
                }),
              );

        await seedSettings(context, {
          debug: false,
          chatSubtitle: {
            enabled: shot.subtitle ?? false,
            lines: 0,
            fontPx: 16,
            textColor: '#ffffff',
            backgroundColor: '#000000',
            backgroundOpacity: 65,
            showNickname: true,
          },
          multiView: {
            enabled: shot.multiView,
            restoreLastLayout: true,
            defaultSplit: 4,
            layout: shot.layout ?? 'grid',
            activeSlot: 1,
            slots,
            /*
             * 🔴 데모에서는 사이드 채팅(BETA)을 끈다. 실사이트에서 **슬롯 채팅 수집이 비어 있어**
             * (실측 2026-08-19 `scripts/probe-slot-chat-live.mjs`: 패널·스트립 모두 24초 내내 0줄)
             * 켜 두면 빈 패널이 찍혀 기능이 고장난 것처럼 보인다. 원인(슬롯 모드에서 치지직 채팅이
             * 채워지지 않음)은 별도로 다룬다 — 그때 이 설정을 되돌린다.
             */
            chatMode: 'none',
          },
        });

        const page = await context.newPage();
        try {
          await page.goto(`https://chzzk.naver.com/live/${main.channelId}`, {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
          });
          /**
           * 🔴 멀티뷰 샷은 **`visible` 로 기다리면 안 된다.** 복원된 멀티뷰가 채팅 aside 를
           * 폭 0 + `overflow: hidden` 으로 접으므로 `#aside-chatting` 은 영영 보이지 않는다
           * (실측 2026-08-15: 멀티뷰 3샷 전부 이 지점에서 30초 타임아웃 — 실패 원인이었다).
           */
          await page.waitForSelector('#aside-chatting', {
            state: shot.multiView ? 'attached' : 'visible',
            timeout: 30_000,
          });
          // 플레이어·채팅이 안정화되기까지 기다린다 (실측: 로드 직후 값이 흔들린다).
          await page.waitForTimeout(6000);
          /**
           * 🔴 **프리롤 광고가 끝난 뒤에 찍는다.** 광고 중에는 컨트롤바가 광고 플레이어 것으로
           * 바뀌어 우리 버튼이 사라지고, 화면도 방송이 아니라 광고가 찍힌다.
           * 상한을 넘기면 던져서 다음 채널로 넘어간다.
           */
          if (!shot.multiView)
            await waitForAdToEnd(page, `${profile.key}/${shot.key} · ${main.channelName}`);
          await shot.setup(page);

          /**
           * 🔴 기대한 UI 가 **보이고 눌리는 상태**가 아니면 저장하지 않는다.
           * 기능이 보이지 않는 데모 스크린샷은 없는 것보다 나쁘다 — README 에 올라가면
           * 동작하지 않는 것처럼 보인다.
           */
          await shot.verify(page);

          if (profile.key.startsWith('fold8') && !shot.multiView) {
            // 참조 화면도 검은 플레이어가 아니라 실제 재생 중인 프레임을 저장한다.
            await page.waitForFunction(
              () => {
                const video = document.querySelector('#live_player_layout video');
                return video && video.readyState >= 3 && !video.paused && !video.error;
              },
              undefined,
              { timeout: 30_000 },
            );
            const before = await page
              .locator('#live_player_layout video')
              .first()
              .evaluate((video) => video.currentTime);
            await page.waitForTimeout(1200);
            const advancing = await page
              .locator('#live_player_layout video')
              .first()
              .evaluate((video, previous) => video.currentTime > previous, before);
            if (!advancing) throw new Error('참조 화면의 영상 재생 시간이 진행되지 않습니다');
          }

          if (shot.key === 'watch') await revealControls(page);

          // 탭 노출은 3초 뒤 닫힌다 — 판정과 저장 사이에 닫히지 않게 직전에 한 번 더 띄운다.
          await revealTapOnlyControls(page);

          const file = shot.file(profile.key);
          await page.screenshot({ path: resolve(OUT_DIR, file) });
          done.push({
            profile: profile.key,
            shot: shot.key,
            file,
            caption: shot.caption,
            channel: main.channelName,
            readme: shot.readme !== false,
          });
          console.info(`  ✓ ${file}  (${main.channelName})`);
          saved = true;
        } catch (e) {
          lastReason = `${main.channelName}: ${String(e).split('\n')[0]}`;
          console.info(
            `    · 재시도 ${attempt + 1}/${CHANNEL_RETRIES} ${profile.key}/${shot.key} — ${lastReason}`,
          );
          const diagnosticDir = resolve(ROOT, 'etc/shots/demo-failures');
          mkdirSync(diagnosticDir, { recursive: true });
          await page
            .screenshot({ path: resolve(diagnosticDir, `${profile.key}-${shot.key}.png`) })
            .catch((error) =>
              console.info(`    · 실패 화면 저장 불가: ${String(error).split('\n')[0]}`),
            );
        } finally {
          await page.close();
        }
      }

      if (!saved) {
        // 판정하지 않는다 — 못 찍은 것만 알린다.
        failed.push({ profile: profile.key, shot: shot.key, reason: lastReason });
        console.info(`  ✗ ${profile.key}/${shot.key} — ${lastReason}`);
      }
    }
  } finally {
    await context.close();
  }
  return { done, failed };
}

async function main() {
  rmSync(resolve(ROOT, 'etc/tmp/playwright/demo'), { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const channels = await fetchLiveChannels();
  console.info(`[demo] 라이브 채널 ${channels.length}개 (성인 채널 제외, 무작위 순서)`);
  console.info(
    `[demo] 후보: ${channels
      .slice(0, 6)
      .map((c) => c.channelName)
      .join(', ')}`,
  );

  const profiles = PROFILES.filter((p) =>
    (process.argv[3]?.split(',') ?? DEMO_PROFILES).includes(p.key),
  );
  console.info(`[demo] 프로필 ${profiles.length}종 동시 캡처 → ${OUT_DIR}`);

  const results = await Promise.all(profiles.map((p) => captureProfile(p, channels)));
  const done = results.flatMap((r) => r.done);
  const failed = results.flatMap((r) => r.failed);

  /**
   * README 에 붙일 마크다운 조각 (손으로 경로를 적다 틀리는 것을 막는다).
   * `readme: false` 인 샷은 뺀다 — README 표와 이 조각이 어긋나면 안 된다.
   */
  const md = [
    '<!-- `yarn demo:shots` 로 생성된 목록. 실제 방송을 찍으므로 매 실행마다 채널이 다르다. -->',
    '<!-- 멀티뷰 시청 화면은 슬롯 컨텍스트 메뉴가 새어 나오면 저장 자체가 실패한다. -->',
    '',
    ...done
      .filter((d) => d.readme)
      .map(
        (d) =>
          `| ${d.caption} (${d.profile} · ${d.channel}) | ![${d.caption}](screenshots/${d.file}) |`,
      ),
  ].join('\n');
  if (ONLY_SHOTS) console.info('[demo] DEMO_SHOTS 지정 실행 — README 조각은 갱신하지 않는다');
  else writeFileSync(resolve(OUT_DIR, 'README-snippet.md'), md + '\n');

  console.info(`\n[demo] ${done.length}장 저장, 실패 ${failed.length}건`);
  console.info('[demo] README 조각: screenshots/README-snippet.md');
  console.info('[demo] ⚠️ 남의 방송 화면이다 — 커밋 전에 프레임 내용을 확인한다.');
  if (failed.length > 0) {
    for (const f of failed) console.info(`  - ${f.profile}/${f.shot}: ${f.reason}`);
  }
}

main().catch((e) => {
  console.error('[demo] 실행 실패:', e);
  process.exit(1);
});
