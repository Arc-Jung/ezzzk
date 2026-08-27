/**
 * FR-14 슬롯 안에서 도는 컨트롤러 (iframe 내부 content script).
 *
 * ⚠️ 확장 페이지에서는 iframe 내부 `video` 에 접근할 수 없다 (실측: 크로스 오리진,
 * `contentDocument === null`). 슬롯 제어는 **`all_frames: true` 로 주입된 이 코드만** 할 수 있다.
 * manifest 에서 `all_frames` 가 빠지면 슬롯 제어가 전부 실패한다.
 *
 * ⚠️ 각 iframe 은 치지직 **전체 페이지**를 싣기 때문에 헤더·좌측 사이드바·채팅·클립 목록이
 * 함께 들어와 영상이 슬롯의 절반 이하로 작아진다 (실측 `mv-01`). 이 처리 없이는 멀티뷰가
 * 성립하지 않으므로 **영상 외 요소를 숨기고 영상을 슬롯 전체로 확장**한다.
 */

import { ID, OURS, PLAYER } from '../../constants/class';
import type { QualityTarget, SlotIndex } from '../../constants/storage';
import {
  qs,
  qsa,
  qsVisible,
  retry,
  upsertStyle,
  removeStyle,
  normalizeText,
} from '../../utils/dom';
import { debounce, observe, type Disposer } from '../../utils/observe';
import { info, warning } from '../../utils/log';
import { findChatClient, readChatMessage } from '../../utils/reactFiber';
import { MV_CHANNEL, parseMvMessage, slotFromAudioShortcut, type SlotToParent } from './messages';
import { isUserInitiatedStrict } from './userIntent';
import {
  activateQualityItem,
  matchesTarget,
  normalizeQualityLabel,
  parseQualityLabel,
  pickQualityItem,
  targetHeightPx,
  type QualityPick,
} from '../quality';

const SLOT_STYLE_ID = 'cm-slot-mode-style';
/** 슬롯 스트립 렌더는 부모가 한다. 여기서는 200ms 배치로 데이터만 넘긴다 (저사양 프레임 예산). */
const CHAT_BATCH_MS = 200;
const STATE_REPORT_MS = 2_000;

/**
 * 슬롯 모드 CSS.
 *
 * `#root` 전체를 `visibility: hidden` 으로 덮고 플레이어만 되살린다.
 * 해시 클래스를 몰라도 헤더·사이드바·채팅·상세·푸터가 모두 사라지므로,
 * 치지직 빌드가 바뀌어도 이 방식은 깨지지 않는다.
 *
 * 🔴 **되살리기는 플레이어 루트 한 요소에만 건다.** `visibility` 는 상속되므로
 * `${ID.livePlayerLayout} { visibility: visible }` 하나로 영상·컨트롤바·설정 버튼이 전부 되살아난다.
 * 예전에는 `${ID.livePlayerLayout} * { visibility: visible !important }` 로 자손 전체에 못을 박았는데,
 * 이것이 **플레이어가 스스로 숨겨 둔 것까지 되살려** 우클릭 컨텍스트 메뉴(`도움말 / 라이선스 /
 * 디버그 정보 다운로드`)가 모든 슬롯 좌상단에 상시 노출됐다 (실측 2026-08-16:
 * `div.pzp-contextmenu-pane` 200×126 @ (0,0), 2·3·4분할 9슬롯 전부).
 * 치지직은 이 메뉴를 `visibility` 로만 토글한다 (실측 규칙:
 * `.pzp-pc .pzp-pc__contextmenu-pane { visibility: hidden }` /
 * `.pzp-pc--context > .pzp-pc__contextmenu-pane { visibility: visible }`)
 * — `!important` 자손 규칙은 이 토글의 꺼짐 쪽을 통째로 무력화한다.
 * 같은 이유로 우리 볼륨 탭의 공간 예약(`visibility: hidden`, `features/volume.ts`)도 무너뜨렸다.
 * **자손 선택자를 다시 넣지 않는다** (회귀 고정: `slotFrame.test.ts`).
 */
export function buildSlotModeCss(): string {
  return `
html, body {
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  background: #000 !important;
}
${ID.root} { visibility: hidden !important; }
${ID.livePlayerLayout} { visibility: visible !important; }
${ID.livePlayerLayout} {
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  min-width: 0 !important;
  margin: 0 !important;
  z-index: ${OURS.topZIndex - 1} !important;
}
/* 영상은 잘리지 않게 contain 으로 맞춘다. 슬롯 비율이 16:9 면 여백이 0 이 된다. */
${ID.livePlayerLayout} video { object-fit: contain !important; }
/* 치트키 배너 등 body 직계 오버레이는 슬롯에서 항상 숨긴다. */
body > div:not(${ID.root}):not(${ID.portal}) { display: none !important; }
`.trim();
}

function currentVideo(): HTMLVideoElement | null {
  return qs<HTMLVideoElement>(`${ID.livePlayerLayout} ${PLAYER.video}`);
}

/** 승격 요청 최소 간격. 초당 여러 번 눌러도 부모에게 한 번만 간다 (핑퐁·폭주 방지). */
const PROMOTE_COOLDOWN_MS = 1_000;

export interface SlotAudio {
  /** 리렌더로 video 요소가 교체됐을 수 있으니 리스너를 다시 붙인다. */
  reattach(): void;
  dispose(): void;
}

/**
 * 사용자가 슬롯의 음소거를 직접 풀면 초점 승격을 요청한다(사이드채팅 대상·화질 우선순위용 —
 * 오디오와는 무관하다. `messages.ts` `requestAudio` 주석 참조). 이게 이 함수의 유일한 역할이다.
 *
 * 🔴 실측 확정 (2026-08-23): 볼륨·음소거 자동 해제·컴프레서는 더 이상 여기서 다루지 않는다.
 * 슬롯도 결국 `chzzk.naver.com` 의 같은 페이지를 그대로 iframe 으로 로드하므로, 싱글뷰와
 * 완전히 같은 `volumeFeature`(`volume.ts`, FR-02·FR-03·FR-19) 가 슬롯 안에서도 그대로 돈다
 * (`volumeFeature.supports` 에서 슬롯 프레임 제외를 걷어냈다). 예전에는 부모가 마스터 볼륨을
 * 브로드캐스트하고, 슬롯 등록 시 1회 언마요트하고, 슬롯마다 별도 컴프레서 그래프를 만드는
 * 세 벌의 축소판을 따로 유지했다 — 사용자 지적대로 "따로 두면 파편화돼 오류가 생긴다"가
 * 정확히 이 상황이었다(예: 컴프레서 토글 버튼이 통째로 빠진 채 여러 번 세션이 지나갔다).
 * 싱글뷰 기능을 그대로 재사용하면 이 세 벌이 전부 없어도 된다 — 오직 "초점 승격 신호"만
 * 멀티뷰 고유 개념이라 남긴다.
 */
export function createSlotAudio(
  getVideo: () => HTMLVideoElement | null,
  onPromotionRequest: () => void,
): SlotAudio {
  let watched: HTMLVideoElement | null = null;
  let lastRequestAt = 0;
  /** 마지막으로 관찰한 `muted`. **음소거 → 해제**로 실제로 바뀐 순간만 승격 요청 대상이다. */
  let lastMuted: boolean | null = null;

  const onVolumeChange = (event: Event): void => {
    const video = event.currentTarget as HTMLVideoElement | null;
    if (!video) return;
    const wasMuted = lastMuted;
    lastMuted = video.muted;
    // 볼륨만 바뀌어도 `volumechange` 가 온다 — 음소거가 실제로 풀린 경우만 승격 대상이다.
    if (wasMuted !== true || video.muted) return;
    /*
     * 플레이어(또는 volumeFeature 의 자동 음소거 해제)가 스스로 바꾼 값이면 승격 요청을 보내지 않는다.
     * 🔴 **엄격판**을 쓴다 — `isUserActivation.isActive` 만 보면 우리 자동재생 폴백의 합성 클릭이
     * 만든 활성화에 걸려, 자동으로 푼 음소거가 매번 "사용자가 풀었다"로 올라가 초점 슬롯을
     * 제멋대로 옮긴다 (실측 2026-08-27 `etc/probe/mv-unmute.json`).
     */
    if (!isUserInitiatedStrict()) return;

    const now = Date.now();
    if (now - lastRequestAt < PROMOTE_COOLDOWN_MS) return;
    lastRequestAt = now;
    onPromotionRequest();
  };

  const attach = (video: HTMLVideoElement): void => {
    if (video === watched) return;
    // 비디오 요소가 교체될 수 있으므로 이전 요소의 리스너를 먼저 뗀다.
    watched?.removeEventListener('volumechange', onVolumeChange);
    watched = video;
    lastMuted = video.muted;
    video.addEventListener('volumechange', onVolumeChange);
  };

  return {
    reattach(): void {
      const video = getVideo();
      if (!video) return;
      attach(video);
    },
    dispose(): void {
      watched?.removeEventListener('volumechange', onVolumeChange);
      watched = null;
    },
  };
}

function readState(slot: SlotIndex): SlotToParent {
  const video = currentVideo();
  const checked = qsa(`${PLAYER.qualityItem}.${PLAYER.qualityItemChecked}`)[0];
  const playerRoot = qs(PLAYER.rootPc);
  return {
    channel: MV_CHANNEL,
    dir: 's2p',
    kind: 'state',
    slot,
    muted: video?.muted ?? true,
    volumePercent: Math.round((video?.volume ?? 0) * 100),
    quality: checked ? normalizeText(checked.textContent) : null,
    // `pzp-pc--onlive` 는 실측으로 확인된 라이브 여부 modifier 다.
    online: playerRoot?.classList.contains('pzp-pc--onlive') ?? false,
    viewerCount: null,
  };
}

/**
 * 슬롯 채팅 스트립용 최근 메시지.
 * 가상 스크롤이라 DOM 복사는 성립하지 않는다 → FR-11 과 같은 데이터 경로를 재사용한다.
 * 배지·이모티콘 이미지는 넘기지 않는다(성능 + 스트립 높이 고정).
 */
export function collectRecentChat(
  lines: number,
): { nickname: string; text: string; color: string | null }[] {
  if (lines <= 0) return [];

  const anyMessage = qs(`${ID.asideChatting} [class*="_chatting_message_"]`);
  if (!anyMessage) return [];

  const client = findChatClient(anyMessage);
  const isDark = document.documentElement.classList.contains('theme_dark');

  const source = client?.messageList ?? [];
  const recent = source.slice(-lines);
  if (recent.length > 0) {
    return recent.map((msg) => ({
      nickname: msg.profile?.nickname ?? '',
      text: msg.content ?? '',
      color: isDark
        ? (msg.displayNicknameColor?.dark ?? null)
        : (msg.displayNicknameColor?.light ?? null),
    }));
  }

  // 클라이언트 인스턴스에 닿지 못하면 화면에 남아 있는 노드에서 읽는다(폴백 1단계).
  return qsa(`${ID.asideChatting} [class*="_chatting_message_"]`)
    .slice(-lines)
    .map((el) => {
      const parsed = readChatMessage(el);
      return {
        nickname:
          parsed?.profile?.nickname ?? normalizeText(qs('[class*="_nickname_"]', el)?.textContent),
        text: parsed?.content ?? normalizeText(qs('[class*="_text_"]', el)?.textContent),
        color: isDark
          ? (parsed?.displayNicknameColor?.dark ?? null)
          : (parsed?.displayNicknameColor?.light ?? null),
      };
    });
}

/**
 * 슬롯 컨트롤러를 시작한다. 슬롯 프레임에서만 호출된다.
 * 부모와의 통신은 postMessage 이고 origin 을 치지직으로 검증한다.
 *
 * ⚠️ 볼륨·자동 음소거 해제·컴프레서는 여기서 다루지 않는다 — 슬롯도 같은 페이지를 그대로
 * 불러오므로 `volumeFeature`(`volume.ts`)가 슬롯 안에서도 독립적으로 돈다(2026-08-23).
 */
export function startSlotController(slot: SlotIndex): Disposer {
  upsertStyle(SLOT_STYLE_ID, buildSlotModeCss());
  info(`slot controller started for slot ${slot}`);

  let chatLines = 0;

  const post = (message: SlotToParent) => {
    // 부모 origin 을 명시한다. '*' 로 보내면 임의 페이지가 채팅 내용을 읽을 수 있다.
    window.parent.postMessage(message, 'https://chzzk.naver.com');
  };

  const audio = createSlotAudio(currentVideo, () => {
    info(`slot ${slot} was unmuted by the user; requesting audio promotion`);
    post({ channel: MV_CHANNEL, dir: 's2p', kind: 'requestAudio', slot });
  });
  audio.reattach();

  /**
   * 🔴 **슬롯을 눌러 활성 전환하는 경로는 부모에서 동작하지 않는다** (실측 2026-08-18,
   * `multiview-scenario-shots/report.json` M-03).
   *
   * 부모는 `cell.addEventListener('click', …)` 로 "슬롯 클릭 = 오디오·채팅 활성 전환"을
   * 의도했지만, 슬롯 셀 위를 iframe 이 통째로 덮는다 — 슬롯 가운데의 `elementFromPoint` 가
   * `IFRAME` 이라 부모 리스너에는 클릭이 **영영 도달하지 않는다**. 그래서 5개 프로필 전부에서
   * 탭해도 활성 슬롯이 바뀌지 않았다(단축키가 꺼진 모바일·7인치급에서는 전환 수단이 없었다).
   *
   * → 프레임 안에서 받은 포인터 입력을 부모로 넘긴다. 새 메시지를 만들지 않고 `requestAudio`
   *   를 그대로 쓴다 — 부모는 이미 이것을 "그 슬롯을 활성으로"로 처리하고, 활성 슬롯이면
   *   무시하므로 중복도 안전하다.
   * ⚠️ `pointerdown` 캡처 + passive 로 받는다. 치지직 플레이어의 재생·컨트롤 조작을 막지 않기
   *   위해 `preventDefault`·`stopPropagation` 을 쓰지 않는다.
   */
  const onPointerDown = () => {
    post({ channel: MV_CHANNEL, dir: 's2p', kind: 'requestAudio', slot });
  };
  document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });

  /**
   * 오디오 단축키(`Alt+Shift+1~4`)를 프레임에서도 받아 부모로 넘긴다.
   *
   * 🔴 슬롯을 한 번 누르면 포커스가 iframe 으로 넘어가(실측 2026-08-18: 탭 뒤
   * `document.activeElement` = `IFRAME`) 부모의 keydown 리스너가 더 이상 아무것도 받지 못한다.
   * 즉 **슬롯을 만진 뒤에는 단축키가 죽는다.** 판정은 부모가 한다 — 기기 프로필에서 단축키가
   * 꺼져 있으면(모바일·7인치급) 부모가 무시하므로 여기서는 기기 판정을 흉내내지 않는다.
   */
  const onKeyDown = (event: KeyboardEvent) => {
    const target = slotFromAudioShortcut(event);
    if (target === null) return;
    event.preventDefault();
    post({ channel: MV_CHANNEL, dir: 's2p', kind: 'audioShortcut', slot: target });
  };
  window.addEventListener('keydown', onKeyDown);

  const sendChat = debounce(() => {
    if (chatLines <= 0) return;
    post({
      channel: MV_CHANNEL,
      dir: 's2p',
      kind: 'chat',
      slot,
      messages: collectRecentChat(chatLines),
    });
  }, CHAT_BATCH_MS);

  const onMessage = (event: MessageEvent) => {
    const message = parseMvMessage(event.data, event.origin, 'p2s');
    if (!message || message.slot !== slot) return;

    switch (message.kind) {
      case 'enterSlotMode':
        upsertStyle(SLOT_STYLE_ID, buildSlotModeCss());
        break;
      case 'exitSlotMode':
        removeStyle(SLOT_STYLE_ID);
        break;
      case 'setQuality':
        void applySlotQuality(message.target, message.raiseIfMissing, slot);
        break;
      case 'setChatLines':
        chatLines = message.lines;
        sendChat();
        break;
      /*
       * 부모 프레임에서 사용자가 무언가를 눌렀다 → 프레임 안에 그대로 퍼뜨린다.
       * `volume.ts` 의 음소거 해제 재시도가 이 이벤트를 기다린다 (`messages.ts` 주석 참조).
       * 여기서 직접 `video.muted` 를 만지지 않는다 — 볼륨 담당은 `volumeFeature` 하나뿐이다.
       */
      case 'userGesture':
        window.dispatchEvent(new Event(OURS.userGestureEvent));
        break;
    }
    post(readState(slot));
  };

  window.addEventListener('message', onMessage);

  // 준비 완료를 알린다. 부모는 이걸 받고 슬롯을 등록한다.
  post({
    channel: MV_CHANNEL,
    dir: 's2p',
    kind: 'ready',
    slot,
    channelName: document.title || null,
  });

  const stateTimer = setInterval(() => post(readState(slot)), STATE_REPORT_MS);

  const chatRoot = qs(ID.asideChatting);
  const stopChatObserve = chatRoot
    ? observe(chatRoot, () => sendChat(), { debounceMs: 0 })
    : undefined;

  // 슬롯 모드 CSS 가 리렌더로 지워지면 다시 넣는다.
  const stopStyleGuard = observe(
    document.documentElement,
    () => {
      if (!document.getElementById(SLOT_STYLE_ID)) upsertStyle(SLOT_STYLE_ID, buildSlotModeCss());
      // 리렌더로 video 요소가 교체됐을 수 있으니 리스너를 다시 붙인다 (음소거는 건드리지 않는다).
      audio.reattach();
    },
    { debounceMs: 500 },
  );

  return () => {
    window.removeEventListener('message', onMessage);
    document.removeEventListener('pointerdown', onPointerDown, { capture: true });
    window.removeEventListener('keydown', onKeyDown);
    clearInterval(stateTimer);
    sendChat.cancel();
    stopChatObserve?.();
    stopStyleGuard();
    audio.dispose();
    removeStyle(SLOT_STYLE_ID);
  };
}

/**
 * 비활성 슬롯 하향 목표가 목록에 없을 때 대체 항목을 고른다.
 *
 * 🔴 활성 슬롯(`pickQualityItem`, quality.ts)과 **폴백 방향이 정반대**다. 활성 슬롯은
 * 화질을 최대한 올리는 게 목적이라 목표가 없으면 "최고 화질"로 대체해도 되지만, 이 함수는
 * 대역폭을 아끼려는 하향 지시(`INACTIVE_SLOT_QUALITY`)를 처리한다 — 목표가 없다고
 * 최고 화질로 올려버리면 대역폭 절약이라는 원래 목적과 정반대로 움직인다. 그래서
 * **목표 이하 중 가장 높은 항목**만 고르고, 그런 항목도 없으면(목록에 목표보다 낮은 화질이
 * 전혀 없음) 아무것도 하지 않는다(`null`) — "올리지 않는다"가 항상 이긴다.
 *
 * 라벨 파싱·매칭은 `quality.ts` 의 순수 함수를 그대로 쓴다(복붙 금지 — 복붙하면 한쪽만
 * 고쳤을 때 또 갈라진다, 이번 버그가 정확히 그 결과였다).
 */
export function pickCappedQualityItem(labels: string[], target: QualityTarget): QualityPick | null {
  const unique: { index: number; text: string }[] = [];
  const seen = new Set<string>();
  labels.forEach((raw, index) => {
    const text = normalizeQualityLabel(raw);
    if (text.length === 0 || seen.has(text)) return;
    seen.add(text);
    unique.push({ index, text });
  });
  if (unique.length === 0) return null;

  const hit = unique.find((item) => matchesTarget(item.text, target));
  if (hit) return { index: hit.index, reason: `target match "${hit.text}"` };

  // auto/best 는 상한을 특정할 수 없다 — 하향 지시로는 쓰이지 않지만 방어적으로 처리한다.
  const capPx = targetHeightPx(target);
  if (capPx === null) return null;

  let best: { index: number; text: string; height: number } | null = null;
  for (const item of unique) {
    const { heightPx } = parseQualityLabel(item.text);
    // 목표보다 높은 화질은 후보에서 제외한다 — 하향 지시에서 올리면 안 된다.
    if (heightPx === null || heightPx > capPx) continue;
    if (best === null || heightPx > best.height) {
      best = { index: item.index, text: item.text, height: heightPx };
    }
  }
  if (best === null) return null;

  return {
    index: best.index,
    reason: `target ${target} unavailable, capped fallback to "${best.text}"`,
  };
}

/**
 * 슬롯 안 화질 변경.
 *
 * `quality.ts` 와 같은 해석 함수(`pickQualityItem`/`pickCappedQualityItem` 은 둘 다
 * `parseQualityLabel`/`matchesTarget`/`normalizeQualityLabel` 을 공유한다)를 써서 목표가
 * 목록에 없을 때도 조용히 포기하지 않는다.
 *
 * @param target 목표 화질.
 * @param slot 로그용 슬롯 번호. 🔴 이게 없어 실측 로그(2026-08-24)에서
 *   `slot quality list not found` 가 **어느 슬롯 얘기인지 알 수 없었다** — 4슬롯 중 하나만
 *   재생되지 않던 원인을 좁히는 데 시간을 더 썼다.
 * @param raiseIfMissing true(활성 슬롯) 면 목표가 없을 때 최고 화질로 폴백한다.
 *   false(비활성 슬롯 대역폭 하향) 면 목표 이하 중 가장 높은 것으로만 대체하고,
 *   그것도 없으면 아무것도 하지 않는다 — `pickCappedQualityItem` 주석 참조.
 *
 * 🔴 하위 호환: 확장 리로드 타이밍에 구버전 부모(이 필드를 안 보내는 빌드)가 새 슬롯
 * 컨트롤러와 만나면 `raiseIfMissing` 이 `undefined` 로 온다. `=== true` 로만 올림을
 * 허용해 **안전한 쪽(캡 — 절대 올리지 않음)** 으로 떨어지게 한다. 반대로 두면
 * (기본을 "올림"으로) 방향을 모르는 상태에서 화질을 올려버려 대역폭 절약이 깨질 수 있다.
 */
export async function applySlotQuality(
  target: string,
  raiseIfMissing: boolean,
  slot: SlotIndex | null = null,
): Promise<void> {
  const label = slot === null ? 'slot' : `slot ${slot}`;
  const { items, close } = await ensureQualityList();
  if (items.length === 0) {
    warning(`${label} quality list not found; skipping quality change`);
    close();
    return;
  }
  try {
    const labels = items.map((item) => item.textContent ?? '');
    const pick =
      raiseIfMissing === true
        ? pickQualityItem(labels, target as QualityTarget)
        : pickCappedQualityItem(labels, target as QualityTarget);
    if (!pick) {
      warning(`${label} quality "${target}" not in list; leaving as-is`);
      return;
    }
    const wanted = items[pick.index];
    if (!wanted || wanted.classList.contains(PLAYER.qualityItemChecked)) return;
    info(`${label} quality: ${pick.reason}`);

    /**
     * 🔴 실측 확정 (2026-08-23): 여기서 목표 항목을 정확히 찾고도 `wanted.click()` 만으로는
     * 거의 항상 반영되지 않았다(실측 6회 중 5회, 목표 360p 지시에도 1080p 유지). 원인은
     * 복붙 누락이었다 — `quality.ts` 의 `activateQualityItem` 은 **키보드 Enter 를 우선
     * 시도하고(치지직 메뉴가 실제로 반응하는 경로), `.click()` 은 그것이 안 먹혔을 때만
     * 쓰는 폴백**인데, 여기서는 라벨 매칭 함수만 공유하고 활성화 방식은 `.click()` 만
     * 새로 짠 것이 갈라져 있었다 (바로 위 함수 docstring이 "복붙 금지"를 경고했던 지점인데
     * 활성화 로직 자체가 빠져 있었다). 공유 함수를 그대로 쓴다.
     */
    await activateQualityItem(wanted, PLAYER.qualityItemChecked);
  } finally {
    // 🔴 실측 확정 (2026-08-23): 예전엔 `ensureQualityList` 가 목록을 읽자마자 메뉴를
    // 다시 닫아 버려, 그 뒤에 여기서 누른 항목이 **이미 닫힌 메뉴 안**이었다 — 목표 화질을
    // 매번 정확히 찾아내고도 클릭이 반영되지 않았다(실측: 목표 360p 지시에도 1080p 유지).
    // `quality.ts` 의 `applyOnce` 와 같은 순서로, **누른 뒤에만** 닫는다.
    close();
  }
}

/**
 * 화질 목록을 DOM 에 올린다.
 *
 * 🔴 **목록은 설정 메뉴를 열기 전에는 비어 있을 수 있다** (FR-01 과 같은 결함).
 * 열지 않고 `querySelectorAll` 만 하면 목록이 0개라 **비활성 슬롯 화질 하향이 조용히 무효**가 되고
 * 슬롯 4개가 모두 1080p 로 재생된다. 설정 버튼을 눌러 렌더시킨 뒤 다시 읽는다.
 *
 * ⚠️ 설정 버튼은 `button[aria-label="설정"]` 으로 찾는다. `.pzp-pc__setting-button` 은 3개 매칭되고
 * 첫 번째가 `display: none` 인 상점 버튼이다 (실측) — `qsVisible` 로 보이는 것만 고른다.
 *
 * 🔴 실측 확정 (2026-08-23): 부모가 슬롯 `ready` 직후 화질을 딱 한 번만 지시하는데
 * (`stage.ts` `applyQuality`), 그 시점엔 플레이어가 아직 컨트롤 바를 렌더하지 않아
 * 설정 버튼이 안 보일 때가 있었다. 이전 코드는 버튼이 안 보이면 즉시 포기하고 재시도가
 * 전혀 없어 — 설정한 목표 화질이 다시는 적용되지 않고 치지직 자체 기본 화질(대개 최고 화질)
 * 로 영구히 남았다. 목록과 마찬가지로 **버튼이 나타날 때까지도 재시도**한다.
 *
 * 🔴 실측 확정 (2026-08-23, 더 치명적인 쪽): 우리가 연 메뉴는 **호출자가 목표 항목을 누른
 * 뒤에** 닫아야 한다. 예전에는 이 함수가 목록을 다 읽자마자 스스로 닫아 버려서, 호출자
 * (`applySlotQuality`)가 반환된 `HTMLElement` 를 눌러도 이미 닫힌(숨겨진) 메뉴 안이었다 —
 * 목표 매칭 자체는 매번 성공하는데 클릭만 반영되지 않아 화질이 영원히 치지직 기본값에
 * 머물렀다. 그래서 여기서는 **닫지 않고**, 우리가 연 경우에만 호출자가 나중에 부를 수 있는
 * `close` 콜백을 함께 돌려준다.
 */
async function ensureQualityList(): Promise<{ items: HTMLElement[]; close: () => void }> {
  const noop = () => {};
  const existing = qsa<HTMLElement>(PLAYER.qualityItem);
  if (existing.length > 0) return { items: existing, close: noop };

  const settingButton = await retry(() => qsVisible<HTMLElement>(PLAYER.settingButton));
  if (!settingButton) return { items: [], close: noop };

  settingButton.click();
  const rendered = await retry(() => {
    const items = qsa<HTMLElement>(PLAYER.qualityItem);
    return items.length > 0 ? items : undefined;
  });
  // 메뉴를 열어 둔 채로 두면 슬롯 영상을 가린다 — 목표 항목을 누른 뒤 호출자가 닫는다.
  return { items: rendered ?? [], close: () => settingButton.click() };
}
