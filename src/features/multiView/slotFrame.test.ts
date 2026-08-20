/**
 * FR-14 슬롯 오디오 상태기 테스트.
 *
 * 🔴 회귀 고정 — 사용자 보고 (2026-08-15): "멀티뷰일 때 자동 음소거가 되고, 수동으로 볼륨을
 * 켜도 다시 음소거로 돌아간다." 실브라우저 하네스(`scripts/verify-multiview-audio.mjs`)로
 * 재현했다: 비활성 슬롯의 음소거를 풀면 스타일 가드(500ms)가 다시 음소거했다.
 * 이제는 다시 걸지 않고 **부모에 활성 슬롯 승격을 요청**한다.
 *
 * ⚠️ jsdom 은 `video.muted` 를 바꿔도 `volumechange` 를 쏘지 않는다. 실제 브라우저는
 * **값이 바뀔 때만** 쏘므로 `setMuted` 헬퍼가 그 동작을 흉내낸다. 흉내를 내지 않으면
 * "우리 조작 vs 사용자 조작" 구분 자체를 시험할 수 없다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applySlotQuality,
  buildSlotModeCss,
  createSlotAudio,
  startSlotController,
} from './slotFrame';

function mountVideo(): HTMLVideoElement {
  document.body.innerHTML = '<div id="live_player_layout"><video></video></div>';
  return document.querySelector('video') as HTMLVideoElement;
}

/** 실제 브라우저처럼 값이 바뀔 때만 `volumechange` 를 쏜다. */
function setMuted(video: HTMLVideoElement, next: boolean): void {
  if (video.muted === next) return;
  video.muted = next;
  video.dispatchEvent(new Event('volumechange'));
}

/** 우리 코드가 쓴 뒤 브라우저가 뒤늦게 쏘는 `volumechange` 를 흉내낸다. */
function flushOurWrite(video: HTMLVideoElement): void {
  video.dispatchEvent(new Event('volumechange'));
}

/** 클릭·키 입력 직후의 일시적 사용자 활성화. jsdom 에는 없으므로 심는다. */
function setUserActivation(isActive: boolean): void {
  Object.defineProperty(navigator, 'userActivation', {
    configurable: true,
    value: { isActive, hasBeenActive: isActive },
  });
}

afterEach(() => {
  document.body.innerHTML = '';
  Reflect.deleteProperty(navigator, 'userActivation');
  vi.useRealTimers();
});

/**
 * 🔴 회귀 고정 — 사용자 보고 (2026-08-16): "멀티뷰 모든 슬롯 좌상단에 도움말/라이선스/디버그
 * 상자가 계속 보인다." 원인은 `#live_player_layout * { visibility: visible !important }` 가
 * 플레이어가 `visibility` 로만 숨겨 둔 우클릭 컨텍스트 메뉴까지 되살린 것이었다
 * (실측 2026-08-16: `div.pzp-contextmenu-pane` 200×126 @ (0,0), 2·3·4분할 9슬롯 전부).
 * `visibility` 는 상속되므로 플레이어 루트 한 요소만 되살리면 충분하다.
 */
describe('buildSlotModeCss — 되살리기 범위', () => {
  const css = buildSlotModeCss();

  it('자손 전체(`*`)에 visibility 를 강제하지 않는다', () => {
    const visibilityRules = css
      .split('\n')
      .filter((line) => /visibility:\s*visible/.test(line))
      .map((line) => line.trim());

    expect(visibilityRules.length).toBeGreaterThan(0);
    for (const rule of visibilityRules) {
      // 선택자에 `*` 가 있으면 플레이어가 스스로 숨긴 것까지 되살아난다.
      expect(rule.slice(0, rule.indexOf('{'))).not.toContain('*');
    }
  });

  it('플레이어 루트는 되살리고 #root 는 덮는다 (원래 목적 유지)', () => {
    expect(css).toContain('#root { visibility: hidden !important; }');
    expect(css).toContain('#live_player_layout { visibility: visible !important; }');
  });

  it('슬롯 모드의 나머지 계약을 유지한다', () => {
    // 영상은 잘리지 않게 contain, body 직계 오버레이(치트키 배너 등)는 숨김.
    expect(css).toContain('#live_player_layout video { object-fit: contain !important; }');
    expect(css).toMatch(/body > div:not\(#root\):not\([^)]+\) \{ display: none !important; \}/);
  });
});

describe('createSlotAudio — 부모 지시 반영', () => {
  it('비활성 슬롯을 음소거하고 활성 슬롯의 소리를 켠다', () => {
    const video = mountVideo();
    const audio = createSlotAudio(() => video, vi.fn());

    audio.setActive(false);
    expect(video.muted).toBe(true);

    audio.setActive(true);
    expect(video.muted).toBe(false);
    audio.dispose();
  });

  it('활성 슬롯에만 볼륨을 적용하고 0~1 로 클램프한다', () => {
    const video = mountVideo();
    const audio = createSlotAudio(() => video, vi.fn());

    audio.setActive(true);
    audio.setVolume(40);
    expect(video.volume).toBeCloseTo(0.4);

    audio.setVolume(500);
    expect(video.volume).toBe(1);
    audio.dispose();
  });

  it('비디오가 아직 없으면 조용히 넘어간다', () => {
    document.body.innerHTML = '';
    const audio = createSlotAudio(() => null, vi.fn());
    expect(() => {
      audio.setActive(true);
      audio.reassert();
    }).not.toThrow();
    audio.dispose();
  });
});

describe('createSlotAudio — 사용자 조작 구분 (사용자 보고 2026-08-15)', () => {
  it('(a) 사용자가 비활성 슬롯의 음소거를 풀면 승격을 요청한다', () => {
    const video = mountVideo();
    const promote = vi.fn();
    const audio = createSlotAudio(() => video, promote);

    audio.setActive(false);
    expect(video.muted).toBe(true);

    setUserActivation(true);
    setMuted(video, false);

    expect(promote).toHaveBeenCalledTimes(1);
    audio.dispose();
  });

  it('(b) 우리가 건 음소거는 사용자 조작으로 오해되지 않는다', () => {
    const video = mountVideo();
    const promote = vi.fn();
    const audio = createSlotAudio(() => video, promote);

    // 사용자 활성화가 살아 있어도(직전에 다른 버튼을 눌렀어도) 우리 조작은 우리 조작이다.
    setUserActivation(true);
    audio.setActive(true);
    flushOurWrite(video);
    audio.setActive(false);
    flushOurWrite(video);

    expect(promote).not.toHaveBeenCalled();
    expect(video.muted).toBe(true);
    audio.dispose();
  });

  it('(c) 사용자가 푼 음소거를 재확인이 다시 걸지 않는다 — 핵심 회귀', () => {
    const video = mountVideo();
    const audio = createSlotAudio(() => video, vi.fn());

    audio.setActive(false);
    setUserActivation(true);
    setMuted(video, false);

    // 스타일 가드가 500ms 마다 부르는 경로. 예전에는 여기서 다시 음소거했다.
    audio.reassert();
    audio.reassert();

    expect(video.muted).toBe(false);
    audio.dispose();
  });

  it('사용자가 활성 슬롯을 직접 음소거하면 재확인이 되돌리지 않는다', () => {
    const video = mountVideo();
    const audio = createSlotAudio(() => video, vi.fn());

    audio.setActive(true);
    setUserActivation(true);
    setMuted(video, true);

    audio.reassert();
    expect(video.muted).toBe(true);
    audio.dispose();
  });

  it('플레이어가 스스로 음소거를 되돌리면(사용자 활성화 없음) 다시 음소거한다', () => {
    const video = mountVideo();
    const promote = vi.fn();
    const audio = createSlotAudio(() => video, promote);

    audio.setActive(false);
    setUserActivation(false);
    // 치지직 플레이어 초기화가 muted 를 되돌린 상황.
    setMuted(video, false);

    expect(promote).not.toHaveBeenCalled();
    audio.reassert();
    expect(video.muted).toBe(true);
    audio.dispose();
  });

  it('부모가 승격을 승인하면 소리가 나고, 거절하면 다시 음소거된다', () => {
    const video = mountVideo();
    const audio = createSlotAudio(() => video, vi.fn());

    audio.setActive(false);
    setUserActivation(true);
    setMuted(video, false);

    // 승인 — 사용자 조작 표시가 지워지고 활성 상태가 굳는다.
    audio.setActive(true);
    audio.reassert();
    expect(video.muted).toBe(false);

    // 다른 슬롯이 승격되면 이 슬롯은 다시 음소거된다 (오디오는 한 슬롯만).
    audio.setActive(false);
    flushOurWrite(video);
    audio.reassert();
    expect(video.muted).toBe(true);
    audio.dispose();
  });

  it('연타해도 승격 요청은 1초에 한 번만 나간다 (폭주·핑퐁 방지)', () => {
    const video = mountVideo();
    const promote = vi.fn();
    const audio = createSlotAudio(() => video, promote);

    audio.setActive(false);
    setUserActivation(true);
    for (let i = 0; i < 5; i += 1) {
      setMuted(video, false);
      setMuted(video, true);
    }

    expect(promote).toHaveBeenCalledTimes(1);
    audio.dispose();
  });

  it('해제하면 사용자 조작 감시 리스너가 남지 않는다', () => {
    const video = mountVideo();
    const promote = vi.fn();
    const audio = createSlotAudio(() => video, promote);

    audio.setActive(false);
    audio.dispose();

    setUserActivation(true);
    setMuted(video, false);
    expect(promote).not.toHaveBeenCalled();
  });

  it('비디오 요소가 교체되면 새 요소를 감시한다', () => {
    const first = mountVideo();
    const audio = createSlotAudio(
      () => document.querySelector('video') as HTMLVideoElement | null,
      vi.fn(),
    );
    audio.setActive(false);
    expect(first.muted).toBe(true);

    // 플레이어 리렌더로 video 가 통째로 갈린 상황.
    first.remove();
    const layout = document.getElementById('live_player_layout') as HTMLElement;
    const second = document.createElement('video');
    layout.appendChild(second);

    audio.reassert();
    expect(second.muted).toBe(true);
    audio.dispose();
  });
});

/**
 * 🔴 회귀 고정 — 실측 2026-08-18 (`multiview-scenario-shots/report.json` M-03).
 *
 * 부모는 `cell.addEventListener('click', …)` 로 "슬롯 클릭 = 활성 전환"을 의도했지만 슬롯 셀 위를
 * iframe 이 통째로 덮어 클릭이 부모에 도달하지 않는다(슬롯 가운데 `elementFromPoint` = `IFRAME`).
 * 5개 프로필 전부에서 탭해도 활성 슬롯이 바뀌지 않았고, 단축키가 꺼진 모바일·7인치급에서는
 * 전환 수단 자체가 없었다. → 프레임이 포인터 입력을 부모로 넘긴다.
 */
describe('startSlotController — 슬롯 탭을 부모로 넘긴다', () => {
  function mountPlayer(): void {
    document.body.innerHTML = '<div id="live_player_layout"><video></video></div>';
  }

  function captureParentMessages(): { messages: unknown[]; restore: () => void } {
    const messages: unknown[] = [];
    const original = Object.getOwnPropertyDescriptor(window, 'parent');
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage: (message: unknown) => messages.push(message) },
    });
    return {
      messages,
      restore: () => {
        if (original) Object.defineProperty(window, 'parent', original);
        else Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'parent');
      },
    };
  }

  it('프레임 안에서 누르면 부모에 requestAudio 를 보낸다', () => {
    mountPlayer();
    const parent = captureParentMessages();
    const dispose = startSlotController(2);
    try {
      document.querySelector('video')?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      const requests = parent.messages.filter(
        (m) => (m as { kind?: string }).kind === 'requestAudio',
      );
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ dir: 's2p', kind: 'requestAudio', slot: 2 });
    } finally {
      dispose();
      parent.restore();
    }
  });

  it('정리한 뒤에는 더 보내지 않는다 (누수 방지)', () => {
    mountPlayer();
    const parent = captureParentMessages();
    const dispose = startSlotController(1);
    dispose();
    document.querySelector('video')?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(
      parent.messages.filter((m) => (m as { kind?: string }).kind === 'requestAudio'),
    ).toHaveLength(0);
    parent.restore();
  });
});

/**
 * 🔴 회귀 고정 — 사용자 보고 (2026-08-20): "멀티뷰 상태에서 1080p 화질 옵션이 작동하지 않는다."
 *
 * 실측(`etc/probe/slot-quality-labels.json`): 슬롯 iframe 은 일반 시청 페이지와 같은 화질
 * 목록(`li.pzp-ui-setting-quality-item`)을 쓴다. 근본 원인은 라벨 형식이 아니라 —
 * `applySlotQuality` 가 목표를 목록에서 못 찾으면 그냥 포기했다는 것이다(`quality.ts` 의
 * `pickQualityItem` 과 달리 최고 화질 폴백이 없었다). 방송이 1080p 를 제공하지 않는 순간
 * 화질 지시가 조용히 무효가 됐다.
 */
describe('applySlotQuality — 목표가 없을 때의 폴백 (사용자 보고 2026-08-20)', () => {
  function mountQualityList(labels: string[], checkedIndex: number | null = null): HTMLLIElement[] {
    document.body.innerHTML = '';
    const container = document.createElement('div');
    const items = labels.map((label, index) => {
      const li = document.createElement('li');
      li.className = 'pzp-ui-setting-quality-item';
      li.textContent = label;
      if (index === checkedIndex) li.classList.add('pzp-ui-setting-pane-item--checked');
      container.appendChild(li);
      return li;
    });
    document.body.appendChild(container);
    return items;
  }

  it('목표가 목록에 있으면 그것을 고른다', async () => {
    const items = mountQualityList(['자동', '1080p(원본)', '720p', '480p']);
    const clicks = items.map((item) => vi.spyOn(item, 'click'));
    await applySlotQuality('720p', true);
    expect(clicks[2]).toHaveBeenCalledTimes(1);
    expect(clicks[0]).not.toHaveBeenCalled();
    expect(clicks[1]).not.toHaveBeenCalled();
    expect(clicks[3]).not.toHaveBeenCalled();
  });

  it('🔴 활성 슬롯: 목표(1080p)가 없으면 최고 화질로 폴백한다', async () => {
    const items = mountQualityList(['자동', '720p', '480p']);
    const clicks = items.map((item) => vi.spyOn(item, 'click'));
    await applySlotQuality('1080p', true);
    // '자동' 은 폴백 후보에서 제외된다 — 남은 것 중 가장 높은 720p 를 고른다.
    expect(clicks[1]).toHaveBeenCalledTimes(1);
    expect(clicks[0]).not.toHaveBeenCalled();
    expect(clicks[2]).not.toHaveBeenCalled();
  });

  it('라벨에 접미사(60fps 등)가 붙어도 접두어로 매칭한다', async () => {
    const items = mountQualityList(['1080p(원본) \n\t HD \n\t60fps', '720p \n\t HD \n\t60fps']);
    const clicks = items.map((item) => vi.spyOn(item, 'click'));
    await applySlotQuality('1080p', true);
    expect(clicks[0]).toHaveBeenCalledTimes(1);
    expect(clicks[1]).not.toHaveBeenCalled();
  });

  it('이미 목표가 선택된 상태면 다시 클릭하지 않는다', async () => {
    const items = mountQualityList(['1080p(원본)', '720p', '480p'], 0);
    const clicks = items.map((item) => vi.spyOn(item, 'click'));
    await applySlotQuality('1080p', true);
    expect(clicks[0]).not.toHaveBeenCalled();
  });

  it('목록이 비어 있으면 예외 없이 넘어간다', async () => {
    document.body.innerHTML = '';
    await expect(applySlotQuality('1080p', true)).resolves.toBeUndefined();
  });

  it('🔴 비활성 슬롯 하향: 목표(720p)가 없다고 최고 화질로 올리지 않는다', async () => {
    // 목록에 720p 가 없고 1080p 만 있다 — 하향 목표를 못 찾았다고 1080p 로 "올리면"
    // 대역폭을 아끼려는 원래 의도와 정반대가 된다. 아무것도 누르지 않아야 한다.
    const items = mountQualityList(['1080p(원본)']);
    const clicks = items.map((item) => vi.spyOn(item, 'click'));
    await applySlotQuality('720p', false);
    expect(clicks[0]).not.toHaveBeenCalled();
  });

  it('비활성 슬롯 하향: 목표 이하 중 가장 높은 것으로는 대체한다', async () => {
    // 720p 가 없지만 480p·360p 는 있다 — 목표 이하에서 가장 높은 480p 로 캡을 적용한다.
    const items = mountQualityList(['1080p(원본)', '480p', '360p']);
    const clicks = items.map((item) => vi.spyOn(item, 'click'));
    await applySlotQuality('720p', false);
    expect(clicks[1]).toHaveBeenCalledTimes(1);
    expect(clicks[0]).not.toHaveBeenCalled();
    expect(clicks[2]).not.toHaveBeenCalled();
  });

  it('🔴 하위 호환: raiseIfMissing 이 undefined 면 안전한 쪽(캡)으로 떨어진다', async () => {
    // 확장 리로드 타이밍에 구버전 부모가 이 필드 없이 메시지를 보낼 수 있다 — 방향을
    // 모르는 채로 최고 화질로 올려버리면 대역폭 절약이 깨지므로, 모르면 "올리지 않는다".
    const items = mountQualityList(['1080p(원본)']);
    const clicks = items.map((item) => vi.spyOn(item, 'click'));
    await applySlotQuality('720p', undefined as unknown as boolean);
    expect(clicks[0]).not.toHaveBeenCalled();
  });
});
