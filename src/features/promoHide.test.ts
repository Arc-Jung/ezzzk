import { beforeEach, describe, expect, it } from 'vitest';
import { isPromoBanner } from './promoHide';

/**
 * 🔴 회귀 고정 대상: "텍스트만으로 걸러 `#root` 가 매칭돼 페이지 전체가 사라진" 실증 사고.
 * 픽스처 크기는 실측값(1920×1080 · 394×113)을 그대로 쓴다 (분석 문서 §9).
 */

function makeDiv(id: string, text: string): HTMLElement {
  const el = document.createElement('div');
  if (id) el.id = id;
  el.textContent = text;
  document.body.appendChild(el);
  return el;
}

/** 실측 배너 문구 */
const BANNER_TEXT = '광고 방해없이 영상을 시청하고 싶으신가요? 치트키 자세히보기';
/** #root 안에는 툴팁 문구가 들어 있어 텍스트 조건만으로는 통과해 버린다. */
const ROOT_TEXT = `헤더 …본문… 치트키를 구매하면 타임머신 기능을 이용할 수 있어요! 치트키 구매하기 …${'가'.repeat(
  200,
)}`;

const BANNER_RECT = { width: 394, height: 113 };
const ROOT_RECT = { width: 1920, height: 1080 };

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('isPromoBanner', () => {
  it('실측 배너(394×113 · 치트키 문구)를 받아들인다', () => {
    expect(isPromoBanner(makeDiv('', BANNER_TEXT), BANNER_RECT)).toBe(true);
  });

  it('🔴 #root(1920×1080, 치트키 텍스트 포함)를 거부한다 — 페이지 전체 소실 사고 회귀', () => {
    expect(isPromoBanner(makeDiv('root', ROOT_TEXT), ROOT_RECT)).toBe(false);
  });

  it('#root 가 우연히 배너 크기여도 id 제외 목록으로 거부한다', () => {
    expect(isPromoBanner(makeDiv('root', BANNER_TEXT), BANNER_RECT)).toBe(false);
  });

  it('명시 제외 id 를 모두 거부한다', () => {
    for (const id of ['portal', 'fb-root', 'naver-splugin-wrap', 'naver-splugin-dimmed']) {
      expect(isPromoBanner(makeDiv(id, BANNER_TEXT), BANNER_RECT)).toBe(false);
    }
  });

  it('우리 노드(cm- 접두어)는 절대 숨기지 않는다', () => {
    expect(isPromoBanner(makeDiv('cm-chat-preset-bar', BANNER_TEXT), BANNER_RECT)).toBe(false);
  });

  it('치트키 문구가 없으면 크기가 맞아도 거부한다', () => {
    expect(isPromoBanner(makeDiv('', '이벤트 안내'), BANNER_RECT)).toBe(false);
  });

  it('크기가 범위를 벗어나면 거부한다', () => {
    const el = makeDiv('', BANNER_TEXT);
    expect(isPromoBanner(el, { width: 249, height: 113 })).toBe(false);
    expect(isPromoBanner(el, { width: 601, height: 113 })).toBe(false);
    expect(isPromoBanner(el, { width: 394, height: 49 })).toBe(false);
    expect(isPromoBanner(el, { width: 394, height: 301 })).toBe(false);
    // 숨겨진(0×0) 요소도 거부 — 이미 처리된 노드를 다시 잡지 않는다.
    expect(isPromoBanner(el, { width: 0, height: 0 })).toBe(false);
  });

  it('경계값은 포함한다', () => {
    const el = makeDiv('', BANNER_TEXT);
    expect(isPromoBanner(el, { width: 250, height: 50 })).toBe(true);
    expect(isPromoBanner(el, { width: 600, height: 300 })).toBe(true);
  });
});
