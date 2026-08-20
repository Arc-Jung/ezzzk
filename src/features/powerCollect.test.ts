import { beforeEach, describe, expect, it } from 'vitest';
import { extractClaimIds, isEligiblePowerButton } from './powerCollect';
import { normalizeText } from '../utils/dom';

/**
 * 오클릭 회귀 고정 — 픽스처는 실측 마크업(분석 문서 §4.7)을 그대로 재현한 것이다.
 * 실제 클릭 결과는 Playwright(로그인 상태)로 확인해야 한다 (§8.0).
 */

function buttonText(el: Element): string {
  return normalizeText(`${el.textContent ?? ''} ${el.getAttribute('aria-label') ?? ''}`);
}

/** 실측 랭킹 UI 마크업 (2026-08-11) */
const RANKING_MARKUP = `
<aside id="aside-chatting">
  <div class="_container_wl8bq_2">
    <button class="_ranking_button_wl8bq_10">1등 씨킹씨킹 치즈12,000 2등 …</button>
    <button class="_arrow_button_wl8bq_30" aria-label="주간 통나무 파워 랭킹으로">이전</button>
    <button class="_arrow_button_wl8bq_30" aria-label="주간 통나무 파워 랭킹으로">다음</button>
  </div>
</aside>
`;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('isEligiblePowerButton', () => {
  it('🔴 실측 랭킹 영역의 버튼을 모두 거부한다 (오클릭 회귀)', () => {
    document.body.innerHTML = RANKING_MARKUP;
    const buttons = Array.from(document.querySelectorAll('button'));
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(isEligiblePowerButton(button, buttonText(button))).toBe(false);
    }
  });

  it('aria-expanded 를 가진 버튼을 거부한다', () => {
    document.body.innerHTML = `<button aria-expanded="false">통나무 받기</button>`;
    const el = document.querySelector('button');
    expect(el && isEligiblePowerButton(el, '통나무 받기')).toBe(false);
  });

  it('클래스에 ranking 이 들어간 버튼을 거부한다', () => {
    document.body.innerHTML = `<button class="power_ranking_entry">통나무 받기</button>`;
    const el = document.querySelector('button');
    expect(el && isEligiblePowerButton(el, '통나무 받기')).toBe(false);
  });

  it('aria-label 에 랭킹이 있으면 거부한다', () => {
    document.body.innerHTML = `<button aria-label="통나무 랭킹 받기">받기</button>`;
    const el = document.querySelector('button');
    expect(el && isEligiblePowerButton(el, buttonText(el))).toBe(false);
  });

  it('⚪ 미확인이지만 그럴듯한 "통나무 받기" 버튼은 받아들인다', () => {
    document.body.innerHTML = `<aside id="aside-chatting"><button class="_button_ab12c_3">통나무 받기</button></aside>`;
    const el = document.querySelector('button');
    expect(el && isEligiblePowerButton(el, '통나무 받기')).toBe(true);
  });

  it('클래스에 power_button 이 있으면 강한 신호로 받아들인다', () => {
    document.body.innerHTML = `<button class="_power_button_ab12c_3"></button>`;
    const el = document.querySelector('button');
    expect(el && isEligiblePowerButton(el, '')).toBe(true);
  });

  it('통나무 단어만 있고 수령 단어가 없으면 거부한다', () => {
    document.body.innerHTML = `<button>주간 통나무 파워</button>`;
    const el = document.querySelector('button');
    expect(el && isEligiblePowerButton(el, '주간 통나무 파워')).toBe(false);
  });

  it('무관한 버튼을 거부한다', () => {
    document.body.innerHTML = `<button>이모티콘</button>`;
    const el = document.querySelector('button');
    expect(el && isEligiblePowerButton(el, '이모티콘')).toBe(false);
  });
});

describe('extractClaimIds', () => {
  it('정상 응답에서 claimId 를 뽑는다', () => {
    const response = {
      code: 200,
      message: null,
      content: { claims: [{ claimId: 'c-1' }, { claimId: 'c-2' }] },
    };
    expect(extractClaimIds(response)).toEqual(['c-1', 'c-2']);
  });

  it('claims 가 비어 있으면 빈 배열', () => {
    expect(extractClaimIds({ content: { claims: [] } })).toEqual([]);
  });

  it('401 권한 없음 응답을 조용히 빈 배열로 다룬다', () => {
    expect(extractClaimIds({ code: 401, message: '권한이 없습니다.' })).toEqual([]);
  });

  it('숫자 claimId 도 문자열로 받아들인다', () => {
    expect(extractClaimIds({ content: { claims: [{ claimId: 12 }] } })).toEqual(['12']);
  });

  it('형태가 어긋난 입력을 모두 빈 배열로 다룬다', () => {
    expect(extractClaimIds(null)).toEqual([]);
    expect(extractClaimIds(undefined)).toEqual([]);
    expect(extractClaimIds('오류')).toEqual([]);
    expect(extractClaimIds({ content: null })).toEqual([]);
    expect(extractClaimIds({ content: { claims: 'nope' } })).toEqual([]);
    expect(extractClaimIds({ content: { claims: [null, {}, { claimId: '' }] } })).toEqual([]);
  });
});
