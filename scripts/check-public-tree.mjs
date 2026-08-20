/**
 * 공개 트리 점검 — **2차 방어선.**
 *
 * 1차는 `copy.bara.sky` 의 `origin_files` 허용 목록이다. 이 스크립트는 그 결과물이 실제로
 * 안전한지 **공개 저장소 CI 에서** 다시 확인한다. 규칙을 넓히다 실수했을 때 여기서 걸린다.
 *
 * 검사 항목 (`docs/public-repo-plan.md` §4)
 * 1. 토큰·개인 키 패턴
 * 2. 개인 경로(`/Users/...`)
 * 3. 내부 파일 유입 — 허용 목록 밖 경로가 있는가 (`isPublicPath`)
 * 4. README 가 없는 파일을 가리키는가 (공개 저장소에서 이미지가 깨진 사고가 실제로 있었다)
 *
 * 사용법: `node scripts/check-public-tree.mjs [디렉터리]` (기본값: 현재 디렉터리)
 * 하나라도 걸리면 **0 이 아닌 코드로 끝난다** — 자동 머지가 검사 결과를 무시하지 못하게.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { isPublicPath } from './lib/public-tree.mjs';

const FORBIDDEN = [
  {
    name: '토큰·개인 키',
    re: /github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  { name: '개인 경로', re: /\/Users\/[a-z0-9._-]+\//i },
];

/*
 * 공개 저장소에는 없는 디렉터리지만, 개발 저장소에서 실수로 돌렸을 때 죽지 않게 함께 건너뛴다.
 * `etc/` 안에는 깨진 심볼릭 링크(브라우저 프로필 잔재)가 있어 stat 이 던진다 — 실제로 겪었다.
 */
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'release',
  'etc',
  'docs',
  '.vendor',
  '.omc',
  '.gjc',
  '.claude',
]);
const BINARY = /\.(png|jpe?g|gif|svg|ico|woff2?|zip|crx|pem)$/i;

function walk(dir, root, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    if (entry.startsWith('.playwright')) continue;
    const full = join(dir, entry);
    // 깨진 링크·권한 오류로 점검이 죽으면 안 된다 — 읽을 수 없는 항목은 건너뛴다.
    const stat = statSync(full, { throwIfNoEntry: false });
    if (!stat) continue;
    if (stat.isDirectory()) walk(full, root, out);
    else out.push(relative(root, full));
  }
  return out;
}

function main() {
  const root = resolve(process.argv[2] ?? '.');
  const files = walk(root, root);
  const problems = [];

  for (const rel of files) {
    // `package.json` 은 공개본에서 이름이 바뀌어 들어오므로 허용 목록 검사에서 예외다.
    if (rel !== 'package.json' && !isPublicPath(rel)) {
      problems.push(`허용 목록 밖 파일 — ${rel}`);
      continue;
    }
    if (BINARY.test(rel)) continue;
    const text = readFileSync(join(root, rel), 'utf8');
    for (const { name, re } of FORBIDDEN) {
      const hit = re.exec(text);
      if (hit) problems.push(`${name} — ${rel}: ${hit[0].slice(0, 40)}`);
    }
  }

  const readmePath = join(root, 'README.md');
  if (existsSync(readmePath)) {
    const readme = readFileSync(readmePath, 'utf8');
    const links = [...readme.matchAll(/\]\((?!https?:|#|mailto:)([^)]+)\)/g)].map((m) => m[1]);
    for (const link of [...new Set(links)]) {
      const clean = link.split('#')[0].replace(/^\.\//, '');
      if (clean.length > 0 && !existsSync(join(root, clean))) {
        problems.push(`README 깨진 링크 — ${link}`);
      }
    }
  }

  console.info(`[check-public-tree] 파일 ${files.length}개 검사`);
  if (problems.length > 0) {
    console.error('[check-public-tree] 실패:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.info('[check-public-tree] 통과 — 금지 패턴 0 · 허용 목록 위반 0 · 깨진 링크 0');
}

main();
