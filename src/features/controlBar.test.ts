import { describe, expect, it } from 'vitest';
import {
  CONTROL_BAR_AUTO_HIDE_CSS,
  CONTROL_ITEM_CLASS,
  NATIVE_BUTTON_PITCH_PX,
  NATIVE_BUTTON_PX,
} from './controlBar';

/**
 * 자동 숨김 동기화 회귀 (실측 2026-08-12, `chzzk-dom-22`·`chzzk-dom-24`).
 *
 * 이전 구현은 네이티브 형제의 computed opacity 를 JS 로 읽어 반영했는데 **동기화되지 않았다**
 * (네이티브 0 / 우리 1). 실측으로 신호를 확정했다:
 *   플레이어 루트에 `pzp-pc--controls` 있음 ⇔ 네이티브 opacity 1
 *   없음 ⇔ 네이티브 opacity 0
 * 그리고 opacity 는 그룹이 아니라 **각 버튼 자신**에 걸린다(그룹은 항상 1).
 */
describe('CONTROL_BAR_AUTO_HIDE_CSS — 자동 숨김 동기화', () => {
  it('네이티브와 같은 신호(pzp-pc--controls)를 쓴다', () => {
    expect(CONTROL_BAR_AUTO_HIDE_CSS).toContain('.pzp-pc:not(.pzp-pc--controls)');
  });

  it('컨트롤이 숨겨지면 우리 노드도 opacity 0 이고 클릭이 막힌다', () => {
    expect(CONTROL_BAR_AUTO_HIDE_CSS).toContain('opacity: 0 !important');
    expect(CONTROL_BAR_AUTO_HIDE_CSS).toContain('pointer-events: none !important');
  });

  it('우리 삽입 노드 전체를 대상으로 한다 (FR-03 볼륨 · FR-09.2 설정 · FR-14 멀티 공통)', () => {
    expect(CONTROL_BAR_AUTO_HIDE_CSS).toContain(`.${CONTROL_ITEM_CLASS}`);
  });

  it('페이드 전환을 두어 네이티브와 시각적으로 이질감이 없다', () => {
    expect(CONTROL_BAR_AUTO_HIDE_CSS).toContain('transition: opacity');
  });

  it('실제 CSS 로 적용했을 때 modifier 유무에 따라 opacity 가 갈린다', () => {
    const style = document.createElement('style');
    style.textContent = CONTROL_BAR_AUTO_HIDE_CSS;
    document.head.appendChild(style);

    const player = document.createElement('div');
    player.className = 'pzp pzp-pc pzp-pc--playing';
    const ours = document.createElement('button');
    ours.className = CONTROL_ITEM_CLASS;
    player.appendChild(ours);
    document.body.appendChild(player);

    // 컨트롤 숨김 상태 (modifier 없음)
    expect(getComputedStyle(ours).opacity).toBe('0');
    expect(getComputedStyle(ours).pointerEvents).toBe('none');

    // 컨트롤 표시 상태 (modifier 있음)
    player.classList.add('pzp-pc--controls');
    expect(getComputedStyle(ours).opacity).not.toBe('0');
    expect(getComputedStyle(ours).pointerEvents).not.toBe('none');

    player.remove();
    style.remove();
  });
});

describe('컨트롤바 고정값 (뷰포트와 무관 — 상수로 두어도 되는 값)', () => {
  it('버튼 36px · 피치 44px', () => {
    expect(NATIVE_BUTTON_PX).toBe(36);
    expect(NATIVE_BUTTON_PITCH_PX).toBe(44);
  });

  it('삽입 2개는 우측 그룹을 88px(44×2) 늘린다 — 실측 220 → 308', () => {
    expect(NATIVE_BUTTON_PITCH_PX * 2).toBe(88);
    expect(220 + NATIVE_BUTTON_PITCH_PX * 2).toBe(308);
  });
});
