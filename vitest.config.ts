import { defineConfig } from 'vitest/config';

// crx 플러그인은 확장 빌드 전용이므로 테스트 실행에는 넣지 않는다.
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    // popup.css 를 `?raw` 로 읽어 실제 CSS 규칙을 대조하는 회귀 테스트가 있다
    // (src/popup/popup.css.test.ts) — 기본값(false)이면 CSS import 가 빈 모듈로
    // 치환돼 테스트가 항상 통과하는 거짓 양성이 된다.
    css: true,
    // 빌드·배포 도구(scripts/lib)도 판정 대상이다 — 퍼블릭 트리 규칙이 여기서 고정된다.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
  },
});
