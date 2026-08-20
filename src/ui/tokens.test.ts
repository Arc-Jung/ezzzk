import { describe, expect, it } from 'vitest';

import { ACCENT, BG, BORDER, FG, FONT_FAMILY, RADIUS, token } from './tokens';

describe('token — var() 폴백 문자열', () => {
  it('변수명과 폴백을 함께 넣는다', () => {
    expect(token('--x', '#fff')).toBe('var(--x, #fff)');
  });

  it('폴백이 비어 있지 않다 — 팝업에는 치지직 변수가 없어 폴백만 남는다', () => {
    const all = [
      ...Object.values(BG),
      ...Object.values(FG),
      ...Object.values(BORDER),
      ...Object.values(RADIUS),
    ];
    for (const value of all) {
      const fallback = /^var\(--[a-z0-9-]+, (.+)\)$/.exec(value)?.[1];
      expect(fallback, value).toBeTruthy();
      expect(fallback?.trim().length, value).toBeGreaterThan(0);
    }
  });

  it('모든 토큰이 var() 형태다 — 하드코딩이 섞이면 테마를 따라가지 못한다', () => {
    const all = [
      ...Object.values(BG),
      ...Object.values(FG),
      ...Object.values(BORDER),
      ...Object.values(RADIUS),
    ];
    for (const value of all) expect(value, value).toMatch(/^var\(--[a-z0-9-]+, .+\)$/);
  });
});

describe('RADIUS — 치지직 스케일 위의 값만 쓴다', () => {
  /** 실측 `--sem-radius-*` 스케일 (etc/probe/chzzk-tokens.json, 2026-08-20). */
  const SCALE = ['2px', '4px', '6px', '8px', '12px', '16px', '20px', '24px', '32px', '9999px'];

  it('폴백 값이 전부 스케일에 있다', () => {
    for (const value of Object.values(RADIUS)) {
      const fallback = /, (.+)\)$/.exec(value)?.[1];
      expect(SCALE, value).toContain(fallback);
    }
  });

  it('예전에 쓰던 10px 는 스케일에 없다 — 회귀 방지', () => {
    expect(SCALE).not.toContain('10px');
    for (const value of Object.values(RADIUS)) expect(value).not.toContain('10px');
  });
});

describe('브랜드 식별', () => {
  it('강조색은 치지직 토큰을 참조하지 않는다 — 우리 UI 임을 알려야 한다', () => {
    expect(ACCENT).toBe('#00ffa3');
    expect(ACCENT).not.toContain('var(');
  });
});

describe('FONT_FAMILY — 치지직과 같은 우선순위', () => {
  it('-apple-system 이 맨 앞이다 (Apple SD Gothic Neo 가 앞서면 다른 글꼴로 렌더된다)', () => {
    expect(FONT_FAMILY.startsWith('-apple-system')).toBe(true);
    expect(FONT_FAMILY).not.toContain('Apple SD Gothic Neo');
  });

  it('한글 폴백을 포함한다', () => {
    expect(FONT_FAMILY).toContain('Malgun Gothic');
  });
});
