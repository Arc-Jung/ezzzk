/**
 * 퍼블릭 저장소 트리 규칙 — **순수 함수만** 둔다 (테스트 대상).
 *
 * 계획: `docs/public-repo-plan.md`. 요구의 핵심은 하나다 —
 * **프라이빗 PR 이 머지될 때마다 퍼블릭에도 같은 변경이 PR 로 올라가고 머지된다.**
 * 그 자동화(`.github/workflows/sync-public.yml`)가 이 규칙을 그대로 쓴다.
 *
 * 🔴 제외 목록이 아니라 **허용 목록**이다. 새 파일이 생겼을 때 기본값이 "공개"면 언젠가 반드시
 * 내부 문서가 새어 나간다. 기본값은 "비공개"여야 한다.
 */

/** 공개하는 경로 (glob 아님 — 접두어·정확 일치·확장자 규칙을 명시적으로 쓴다). */
const PUBLIC_EXACT = new Set([
  'README.md',
  'LICENSE',
  'index.html',
  'manifest.json',
  'package.json',
  'yarn.lock',
  'tsconfig.json',
  'tsconfig.node.json',
  'vite.config.ts',
  'vitest.config.ts',
  '.eslintrc.cjs',
  '.prettierrc',
  '.nvmrc',
  '.gitignore',
]);

const PUBLIC_PREFIXES = ['src/', 'public/', 'screenshots/'];

/**
 * 공개하는 스크립트 — **빌드·릴리스에 필요한 것만.**
 * 검증 하네스(`verify-*`)·조사 도구(`probe-*`·`explore-*`)·픽스처는 비공개 결정(2026-08-20)이다.
 */
const PUBLIC_SCRIPTS = new Set([
  'scripts/generate-icons.mjs',
  'scripts/generate-licenses.mjs',
  'scripts/pack-crx.mjs',
  'scripts/fetch-adguard.mjs',
  // 점검기 자신과 그 규칙 모듈. 공개 CI 가 이 스크립트를 돌리므로 공개 트리에 있어야 한다
  // (허용 목록에서 빠져 있어 점검기가 스스로를 "허용 목록 밖"으로 잡던 문제 — 2026-08-20 확인).
  'scripts/check-public-tree.mjs',
  'scripts/lib/public-tree.mjs',
]);

/** 공개 워크플로 — 하네스에 의존하는 것은 뺀다 (`ci.yml` 의 smoke 잡이 대표적이다). */
const PUBLIC_WORKFLOWS = new Set([
  '.github/workflows/public-ci.yml',
  '.github/workflows/release.yml',
]);

/**
 * 절대 나가면 안 되는 경로. 허용 목록이 1차 방어선이고 이것은 2차다 —
 * 허용 규칙을 잘못 넓혔을 때 여기서 걸린다.
 */
const NEVER_PUBLIC = [
  'docs/',
  'etc/',
  '.keys/',
  '.omc/',
  '.gjc/',
  '.claude/',
  'progress.txt',
  'CLAUDE.md',
  'store.md',
  'scripts/lib/',
  'scripts/fixtures/',
];

/** 이 경로를 퍼블릭 저장소에 넣는가. **순수 함수.** */
export function isPublicPath(path) {
  if (typeof path !== 'string' || path.length === 0) return false;
  const clean = path.replace(/^\.\//, '');

  // 2차 방어선이 1차보다 먼저다 — 실수로 허용 목록을 넓혀도 여기서 막힌다.
  // 단 `PUBLIC_SCRIPTS` 에 **정확히 이름을 적어 둔 파일**은 예외다. `scripts/lib/` 는 통째로
  // 비공개지만 규칙 모듈 하나는 공개 CI 가 실행하므로 나가야 한다.
  if (
    !PUBLIC_SCRIPTS.has(clean) &&
    NEVER_PUBLIC.some((deny) => clean === deny || clean.startsWith(deny))
  ) {
    return false;
  }

  if (PUBLIC_EXACT.has(clean)) return true;
  if (PUBLIC_SCRIPTS.has(clean)) return true;
  if (PUBLIC_WORKFLOWS.has(clean)) return true;
  if (clean.startsWith('scripts/')) return false;
  if (clean.startsWith('.github/')) return false;
  return PUBLIC_PREFIXES.some((prefix) => clean.startsWith(prefix));
}

/**
 * 공개본 `package.json` 으로 가공한다.
 *
 * 🔴 하네스 스크립트를 그대로 두면 **공개 저장소에서 실행할 수 없는 명령**이 남는다
 * (`yarn smoke` 는 `scripts/lib/**`·픽스처에 의존한다 — 비공개다). 남기면 첫 CI 부터 빨간불이다.
 * 설명용 `//key` 주석 항목도 함께 지운다.
 */
export function transformPackageJson(pkg) {
  const keepScript = (name) =>
    !/^(\/\/)?(verify|smoke|demo|icons|licenses)/.test(name.replace(/^\/\//, '')) ||
    ['icons', 'licenses:gen'].includes(name);

  const scripts = Object.fromEntries(
    Object.entries(pkg.scripts ?? {}).filter(([name]) => keepScript(name)),
  );

  return { ...pkg, scripts, private: true };
}

/**
 * 퍼블릭 PR 문구. **프라이빗 커밋 본문을 그대로 옮기지 않는다** —
 * 실측·사용자 보고·내부 판단이 그대로 들어 있다(전체 커밋의 61%가 그런 본문이다).
 * 제목만 옮기고, 본문은 출처 링크 없이 "무엇이 바뀌었는지"만 남긴다.
 */
export function publicPrBody({ version, files, privateNumber }) {
  const lines = [
    '프라이빗 개발 저장소의 변경을 반영한 자동 동기화 PR 이다.',
    '',
    `- 버전: **${version}**`,
    `- 변경 파일: **${files}개**`,
    '',
    '개발 과정의 조사·검증 기록은 공개 저장소에 포함하지 않는다.',
  ];
  if (privateNumber) lines.push('', `<!-- private PR #${privateNumber} -->`);
  return lines.join('\n');
}

/** 내부 맥락이 새는 문구인지 — PR 제목에 쓰기 전에 거른다. */
export function looksInternal(text) {
  if (typeof text !== 'string') return false;
  return /실측|사용자 보고|프로브|probe-|verify-|\/Users\//.test(text);
}
