import { describe, expect, it } from 'vitest';
import CSS from './popup.css?raw';

/**
 * 팝업 하단 스크롤 신호 회귀 테스트 (감사 보고서 심각도 보통, 2026-08-21).
 * `node:fs` 대신 번들러의 `?raw` 임포트를 쓴다 — 이 저장소에는 `@types/node` 가 없다
 * (licenses.test.ts 와 동일한 관행).
 */
describe('popup.css — 하단 스크롤 신호', () => {
  it('본문 스크롤 컨테이너(.cm-popup__body)가 overflow-y: auto 로 실제 스크롤된다', () => {
    const block = CSS.match(/\.cm-popup__body\s*\{[^}]*\}/)?.[0];
    expect(block).toBeDefined();
    expect(block).toContain('overflow-y: auto');
    // flex 자식이 줄어들지 못해 스크롤이 안 되는 전형적 실수를 막는다.
    expect(block).toContain('min-height: 0');
  });

  it('스크롤 신호(그림자 레이어)가 존재하고 pointer-events: none 로 클릭을 막지 않는다', () => {
    const block = CSS.match(/\.cm-popup__body::after\s*\{[^}]*\}/)?.[0];
    expect(block).toBeDefined();
    expect(block).toContain('pointer-events: none');
    // 그림자임을 나타내는 그라디언트 배경이 있어야 한다.
    expect(block).toMatch(/background:\s*linear-gradient\(/);
  });

  it('팝업 컨테이너가 브라우저 팝업 높이 제한 안에서 flex 로 본문을 채운다', () => {
    const block = CSS.match(/\.cm-popup\s*\{[^}]*\}/)?.[0];
    expect(block).toBeDefined();
    expect(block).toContain('display: flex');
    expect(block).toContain('flex-direction: column');
  });
});
