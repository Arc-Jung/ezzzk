/**
 * `package.json` + `node_modules/<pkg>/LICENSE` 원문에서 오픈소스 고지 데이터를 생성한다.
 *
 * 왜 자동 생성인가: 의존성이 바뀌었는데 고지를 손으로 고치지 않는 것이 가장 흔한 사고다.
 * 라이선스는 법적 고지라 **추측하거나 기억으로 적으면 안 된다** — 종류·저작권 문구는 전부
 * `node_modules` 의 원문 파일에서 읽고, 원문이 없으면 없다고 표시한다.
 *
 * 실행: `yarn licenses:gen` → `src/constants/licenses.generated.ts` 를 덮어쓴다(커밋 대상).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/constants/licenses.generated.ts');

/**
 * `dependencies` 에는 없지만 **번들에 실제로 들어가는** 전이 의존성.
 * react-dom 이 내부에서 쓰는 스케줄러라 `dist/assets/vendor-react-*.js` 에 코드가 포함된다
 * (근거: 번들에서 `unstable_scheduleCallback` 마커 검출, 2026-08-16).
 * 번들에 들어가면 재배포 고지 의무가 생기므로 `dependencies` 가 아니어도 배포 그룹에 넣는다.
 */
const EXTRA_BUNDLED = ['scheduler'];

const LICENSE_FILE_RE = /^(licen[cs]e|copying)(\.|$)/i;

/**
 * 저작권 표기 줄 판별.
 * ⚠️ 단순히 `/copyright/i` 로 잡으면 Apache-2.0 본문의 "…retain all copyright, patent…",
 * "Grant of Copyright License" 같은 **약관 문장**이 저작권자로 둔갑한다 (playwright 에서 실제 발생).
 * 대문자 `Copyright` 뒤에 (c)·©·연도·고유명사가 오는 줄만 취하고 약관 표제는 제외한다.
 * Apache 계열은 "Portions Copyright (c) …" 처럼 줄 앞에 수식어가 붙으므로 줄 시작을 강제하지 않는다.
 */
function isCopyrightLine(line) {
  if (/Copyright\s+(License|Notice)/.test(line)) return false;
  return /Copyright\s+(\((c|C)\)|©|\d{4}|[A-Z])/.test(line);
}

function readPackageMeta(name) {
  const dir = resolve(ROOT, 'node_modules', name);
  const manifest = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'));
  const fileName = readdirSync(dir).find((entry) => LICENSE_FILE_RE.test(entry)) ?? null;
  const text = fileName ? readFileSync(resolve(dir, fileName), 'utf8').trimEnd() : null;
  return {
    name,
    version: manifest.version,
    /** `package.json` 의 `license` 필드. 원문과 어긋날 수 있어 원문과 함께 보여 준다. */
    licenseField:
      typeof manifest.license === 'string' ? manifest.license : (manifest.license?.type ?? null),
    licenseFile: fileName,
    /** 원문 첫 줄 — "MIT License", "Apache License" 처럼 종류의 1차 근거다. */
    headline: text
      ? (text
          .split('\n')
          .find((line) => line.trim().length > 0)
          ?.trim() ?? null)
      : null,
    /** 원문에서 읽은 저작권 문구. 여러 줄이면 전부 모은다. */
    copyright: text
      ? text
          .split('\n')
          .filter((line) => isCopyrightLine(line))
          .map((line) => line.trim())
          .join('\n') || null
      : null,
    text,
  };
}

function serialize(value) {
  return JSON.stringify(value);
}

/**
 * 코드를 차용한 오픈소스 고지는 **근거가 있을 때만** 낸다.
 * `src/` 를 실제로 훑어 참조 주석이 남아 있는 파일을 모으고, 하나도 없으면 빈 목록을 낸다 —
 * 근거 없는 고지도 잘못된 고지다.
 */
const ATTRIBUTION_SOURCES = [
  {
    marker: /chzzk-plus/,
    name: 'chzzk-plus (kyechan99/chzzk-plus)',
    licenseField: 'MIT',
    url: 'https://github.com/kyechan99/chzzk-plus',
  },
];

function scanAttributions() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
    }
  };
  walk(resolve(ROOT, 'src'));

  return ATTRIBUTION_SOURCES.map((source) => ({
    ...source,
    files: files
      .filter((file) => source.marker.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(ROOT.length + 1))
      .sort(),
  })).filter((entry) => entry.files.length > 0);
}

function entryLiteral(meta, { withText }) {
  const fields = [
    `    name: ${serialize(meta.name)},`,
    `    version: ${serialize(meta.version)},`,
    `    licenseField: ${serialize(meta.licenseField)},`,
    `    licenseFile: ${serialize(meta.licenseFile)},`,
    `    headline: ${serialize(meta.headline)},`,
    `    copyright: ${serialize(meta.copyright)},`,
  ];
  if (withText) fields.push(`    text: ${serialize(meta.text)},`);
  return `  {\n${fields.join('\n')}\n  },`;
}

const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const bundledNames = [...Object.keys(pkg.dependencies ?? {}), ...EXTRA_BUNDLED];
const devNames = Object.keys(pkg.devDependencies ?? {}).sort();

const bundled = bundledNames.map(readPackageMeta);
const dev = devNames.map(readPackageMeta);
const selfText = readFileSync(resolve(ROOT, 'LICENSE'), 'utf8').trimEnd();
const attributions = scanAttributions();

for (const meta of [...bundled, ...dev]) {
  if (!meta.licenseFile) {
    console.warn(`warning: ${meta.name} has no license file in node_modules`);
  }
}

const banner = `/**
 * ⚠️ 자동 생성 파일이다. **직접 고치지 않는다** — \`yarn licenses:gen\` 으로 다시 만든다.
 * 생성기: \`scripts/generate-licenses.mjs\`
 * 근거: \`package.json\` 의 의존성 목록 + \`node_modules/<pkg>/LICENSE\` 원문.
 */

export type LicenseEntry = {
  name: string;
  version: string;
  /** package.json 의 license 필드 (원문과 대조용). */
  licenseField: string | null;
  /** 읽어 온 원문 파일 이름. null 이면 원문이 없다. */
  licenseFile: string | null;
  /** 원문 첫 줄 — 라이선스 종류의 1차 근거. */
  headline: string | null;
  /** 원문에서 뽑은 저작권 문구. */
  copyright: string | null;
};

export type BundledLicenseEntry = LicenseEntry & { text: string | null };

export type CodeAttribution = {
  name: string;
  licenseField: string;
  url: string;
  /** 참조 주석이 실제로 남아 있는 파일 — 고지의 근거다. */
  files: readonly string[];
};

/**
 * 이 확장 자신의 이름·라이선스 (package.json + 저장소 루트 LICENSE 원문).
 *
 * 🔴 **버전은 여기 담지 않는다.** 릴리스 워크플로가 머지마다 package.json·manifest.json 의
 * patch 를 올린 뒤 게이트를 다시 돌리므로, 생성 시점 버전을 박아 두면 그 범프와 어긋나
 * 릴리스가 통째로 실패한다 (2026-08-17 v0.1.11 실패: expected '0.1.10' to be '0.1.11').
 * 화면에는 \`chrome.runtime.getManifest().version\` 을 쓴다 — 설치된 확장의 실제 버전이다.
 */
export const SELF_NAME = ${serialize(pkg.name)};
export const SELF_LICENSE_TEXT = ${serialize(selfText)};

/** 코드를 차용해 고지가 필요한 오픈소스. src/ 를 훑어 근거가 있는 것만 담는다. */
export const CODE_ATTRIBUTIONS: readonly CodeAttribution[] = [
${attributions
  .map(
    (entry) =>
      `  {\n    name: ${serialize(entry.name)},\n    licenseField: ${serialize(entry.licenseField)},\n    url: ${serialize(entry.url)},\n    files: ${serialize(entry.files)},\n  },`,
  )
  .join('\n')}
];

/** 빌드 산출물(dist)에 코드가 포함되어 함께 배포되는 것 — 재배포 고지 의무 대상. */
export const BUNDLED_LICENSES: readonly BundledLicenseEntry[] = [
${bundled.map((meta) => entryLiteral(meta, { withText: true })).join('\n')}
];

/** 개발·빌드·검증에만 쓰이고 배포되는 확장에는 포함되지 않는 것. */
export const DEV_LICENSES: readonly LicenseEntry[] = [
${dev.map((meta) => entryLiteral(meta, { withText: false })).join('\n')}
];

/**
 * npm 의존성이 아니지만 검증에 내려받아 쓰는 오픈소스.
 * 애드가드는 치지직의 "광고 차단 프로그램을 사용 중이신가요?" 모달을 재현하는 데만 쓴다
 * (\`scripts/fetch-adguard.mjs\` → \`.vendor/adguard-mv3/\`). 저장소에도 배포물에도 넣지 않는다.
 * ⚠️ 배포 zip 안에 라이선스 원문 파일이 없어 종류를 원문으로 확인하지 못했다
 * (2026-08-16 확인: \`.vendor/adguard-mv3\` 전체에 licen[cs]e/COPYING 파일 없음).
 * 확인하지 못한 것을 지어내지 않는다 — 미확인으로 남긴다.
 */
export const EXTERNAL_TOOLS: readonly LicenseEntry[] = [
  {
    name: 'AdGuard AdBlocker (브라우저 확장)',
    version: '5.4.3.1',
    licenseField: null,
    licenseFile: null,
    headline: null,
    copyright: 'Adguard Software Ltd (manifest.json 의 author 필드)',
  },
];
`;

writeFileSync(OUT, banner, 'utf8');
// 생성물도 저장소 포맷 규칙(`yarn format:check`)을 통과해야 한다.
execFileSync('npx', ['prettier', '--write', OUT], { cwd: ROOT, stdio: 'inherit' });
console.log(`info: wrote ${OUT} (bundled ${bundled.length}, dev ${dev.length}, external 1)`);
