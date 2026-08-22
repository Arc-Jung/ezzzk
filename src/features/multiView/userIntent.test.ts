/**
 * FR-14 사용자 조작 판정 — **멀티뷰 진입 클릭을 "원본을 재생시켰다"로 오판**하던 회귀를 고정한다
 * (실측 2026-08-22 `etc/probe/multiview-review/console-laptop13.log`).
 *
 * 판정 계약: "일시적 사용자 활성화가 살아 있다" 만으로는 부족하고,
 * **정지 이후에 · 우리 UI 밖에서** 일어난 입력이 함께 있어야 사용자 조작으로 인정한다.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { isOurUiNode, isUserInitiated, trackHostDirectedInput } from './userIntent';

function setUserActivation(isActive: boolean): void {
  Object.defineProperty(navigator, 'userActivation', {
    configurable: true,
    value: { isActive, hasBeenActive: isActive },
  });
}

afterEach(() => {
  document.body.innerHTML = '';
  Reflect.deleteProperty(navigator, 'userActivation');
});

describe('isOurUiNode', () => {
  it('`cm-` 접두 id 를 가진 노드는 우리 UI 다', () => {
    document.body.innerHTML = '<button id="cm-multiview-button"></button>';
    expect(isOurUiNode(document.querySelector('#cm-multiview-button'))).toBe(true);
  });

  it('`cm-` 접두 클래스를 가진 조상 안쪽도 우리 UI 다', () => {
    document.body.innerHTML = '<div class="cm-stage-bar"><span><b id="deep"></b></span></div>';
    expect(isOurUiNode(document.querySelector('#deep'))).toBe(true);
  });

  it('치지직 노드는 우리 UI 가 아니다', () => {
    document.body.innerHTML = '<div id="live_player_layout"><video></video></div>';
    expect(isOurUiNode(document.querySelector('video'))).toBe(false);
  });

  it('요소가 아닌 대상(문서·null)은 우리 UI 가 아니다', () => {
    expect(isOurUiNode(null)).toBe(false);
    expect(isOurUiNode(document)).toBe(false);
  });
});

describe('trackHostDirectedInput', () => {
  it('추적 시작 직후에는(입력 없음) 활성화가 살아 있어도 거짓이다', () => {
    setUserActivation(true);
    const input = trackHostDirectedInput();
    expect(input.isActive()).toBe(false);
    input.stop();
  });

  it('우리 UI 위의 입력은 세지 않는다 — 멀티뷰 진입 클릭이 여기 해당한다', () => {
    document.body.innerHTML = '<button id="cm-multiview-button"></button>';
    const input = trackHostDirectedInput();

    setUserActivation(true);
    document
      .querySelector('#cm-multiview-button')!
      .dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(input.isActive()).toBe(false);
    input.stop();
  });

  it('우리 UI 밖의 입력은 사용자 조작으로 인정한다', () => {
    document.body.innerHTML = '<div id="live_player_layout"><video></video></div>';
    const input = trackHostDirectedInput();

    setUserActivation(true);
    document.querySelector('video')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(input.isActive()).toBe(true);
    input.stop();
  });

  it('브라우저 활성화가 없으면 입력이 있어도 인정하지 않는다 (프로그램 클릭 배제)', () => {
    document.body.innerHTML = '<div id="live_player_layout"><video></video></div>';
    const input = trackHostDirectedInput();

    setUserActivation(false);
    document.querySelector('video')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(input.isActive()).toBe(false);
    input.stop();
  });

  it('stop() 뒤에는 입력을 더 받지 않는다', () => {
    document.body.innerHTML = '<div id="live_player_layout"><video></video></div>';
    const input = trackHostDirectedInput();
    input.stop();

    setUserActivation(true);
    document.querySelector('video')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(input.isActive()).toBe(false);
  });
});

describe('isUserInitiated', () => {
  it('구현이 없는 환경에서는 거짓이다 (안전한 기본값)', () => {
    Reflect.deleteProperty(navigator, 'userActivation');
    expect(isUserInitiated()).toBe(false);
  });
});
