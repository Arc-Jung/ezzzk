import { defineConfig } from 'vitest/config';

// crx 플러그인은 확장 빌드 전용이므로 테스트 실행에는 넣지 않는다.
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    // 빌드·배포 도구(scripts/lib)도 판정 대상이다 — 퍼블릭 트리 규칙이 여기서 고정된다.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
  },
});
