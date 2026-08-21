/**
 * FR-14 슬롯 오디오 상태기 테스트.
 *
 * 🔴 정책 변경 (요청 2026-08-20): **모든 슬롯이 소리를 낸다.** 예전에는 활성 슬롯 하나만
 * 소리를 내고 나머지를 강제 음소거했다 — 이제 `createSlotAudio` 는 **어느 슬롯의 음소거도
 * 건드리지 않는다.** 남은 역할은 마스터 볼륨 적용과, 사용자가 직접 음소거를 풀면 초점(오디오
 * 아님) 승격을 요청하는 것뿐이다.
 *
 * ⚠️ jsdom 은 `video.muted` 를 바꿔도 `volumechange` 를 쏘지 않는다. 실제 브라우저는
 * **값이 바뀔 때만** 쏘므로 `setMuted` 헬퍼가 그 동작을 흉내낸다.
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

describe('createSlotAudio — 음소거는 건드리지 않는다 (2026-08-20 정책 변경)', () => {
  it('마스터 볼륨을 0~1 로 클램프해 적용한다', () => {
    const video = mountVideo();
    const audio = createSlotAudio(() => video, vi.fn());

    audio.setVolume(40);
    expect(video.volume).toBeCloseTo(0.4);

    audio.setVolume(500);
    expect(video.volume).toBe(1);
    audio.dispose();
  });

  it('어느 슬롯도 우리가 음소거하지 않는다 — 음소거 상태였던 슬롯은 그대로 음소거로 남는다', () => {
    const video = mountVideo();
    setMuted(video, true);
    const audio = createSlotAudio(() => video, vi.fn());

    audio.setVolume(70);
    audio.reattach();
    audio.reattach();

    expect(video.muted).toBe(true);
    audio.dispose();
  });

  it('어느 슬롯도 우리가 음소거하지 않는다 — 사용자가 푼 음소거를 재확인이 다시 걸지 않는다', () => {
    const video = mountVideo();
    const audio = createSlotAudio(() => video, vi.fn());

    setUserActivation(true);
    setMuted(video, false);

    // 스타일 가드가 500ms 마다 부르는 경로. 예전 버전(활성 슬롯 개념)에서는 여기서 다시 음소거했다.
    audio.reattach();
    audio.reattach();

    expect(video.muted).toBe(false);
    audio.dispose();
  });

  it('비디오가 아직 없으면 조용히 넘어간다', () => {
    document.body.innerHTML = '';
    const audio = createSlotAudio(() => null, vi.fn());
    expect(() => {
      audio.setVolume(50);
      audio.reattach();
    }).not.toThrow();
    audio.dispose();
  });
});

describe('createSlotAudio — 사용자 조작 구분 (사용자 보고 2026-08-15)', () => {
  it('(a) 사용자가 이 슬롯의 음소거를 풀면 초점 승격을 요청한다', () => {
    const video = mountVideo();
    const promote = vi.fn();
    const audio = createSlotAudio(() => video, promote);
    setMuted(video, true);
    audio.reattach();

    setUserActivation(true);
    setMuted(video, false);

    expect(promote).toHaveBeenCalledTimes(1);
    audio.dispose();
  });

  it('(b) 우리가 볼륨만 바꾼 것은 승격 요청을 트리거하지 않는다', () => {
    const video = mountVideo();
    const promote = vi.fn();
    const audio = createSlotAudio(() => video, promote);

    // 이미 소리 나는 슬롯에서 마스터 볼륨을 바꾼 상황 — `volumechange` 는 오지만 음소거는
    // 그대로 풀린 상태다(음소거→해제 전환이 아니다).
    setUserActivation(true);
    audio.setVolume(70);

    expect(promote).not.toHaveBeenCalled();
    audio.dispose();
  });

  it('(c) 플레이어가 스스로 음소거를 풀면(사용자 활성화 없음) 승격을 요청하지 않는다', () => {
    const video = mountVideo();
    const promote = vi.fn();
    const audio = createSlotAudio(() => video, promote);
    setMuted(video, true);
    audio.reattach();

    setUserActivation(false);
    setMuted(video, false);

    expect(promote).not.toHaveBeenCalled();
    audio.dispose();
  });

  it('연타해도 승격 요청은 1초에 한 번만 나간다 (폭주·핑퐁 방지)', () => {
    const video = mountVideo();
    const promote = vi.fn();
    const audio = createSlotAudio(() => video, promote);
    setMuted(video, true);
    audio.reattach();
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
    setMuted(video, true);
    audio.reattach();
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
    setMuted(first, true);
    audio.reattach();

    // 플레이어 리렌더로 video 가 통째로 갈린 상황.
    first.remove();
    const layout = document.getElementById('live_player_layout') as HTMLElement;
    const second = document.createElement('video');
    second.muted = true;
    layout.appendChild(second);
    audio.reattach();

    const promote = vi.fn();
    const audio2 = createSlotAudio(() => second, promote);
    audio2.reattach();
    setUserActivation(true);
    setMuted(second, false);
    expect(promote).toHaveBeenCalledTimes(1);
    audio.dispose();
    audio2.dispose();
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
