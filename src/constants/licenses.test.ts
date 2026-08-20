/**
 * 오픈소스 고지 정합성. **의존성이 늘었는데 고지를 빠뜨리는 것이 가장 흔한 사고**라,
 * `package.json` 과 어긋나면 여기서 실패시켜 `yarn licenses:gen` 을 강제한다.
 *
 * 모킹하지 않는다 — 실제 `package.json` 과 실제 `LICENSE` 원문을 그대로 읽어 대조한다.
 * (`node:fs` 대신 번들러의 JSON/`?raw` 임포트를 쓴다. 이 저장소에는 `@types/node` 가 없다.)
 */

import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import selfLicenseRaw from '../../LICENSE?raw';
import reactLicenseRaw from '../../node_modules/react/LICENSE?raw';
import reactDomLicenseRaw from '../../node_modules/react-dom/LICENSE?raw';
import schedulerLicenseRaw from '../../node_modules/scheduler/LICENSE?raw';
import {
  BUNDLED_LICENSES,
  CODE_ATTRIBUTIONS,
  DEV_LICENSES,
  EXTERNAL_TOOLS,
  SELF_LICENSE_TEXT,
  SELF_NAME,
} from './licenses.generated';
import * as generated from './licenses.generated';
import generatedSource from './licenses.generated.ts?raw';
import powerCollectSource from '../features/powerCollect.ts?raw';

/** 배포 그룹의 전문을 대조할 원문. 키는 패키지 이름이다. */
const BUNDLED_ORIGINALS: Record<string, string> = {
  react: reactLicenseRaw,
  'react-dom': reactDomLicenseRaw,
  scheduler: schedulerLicenseRaw,
};

describe('오픈소스 고지 — package.json 정합성', () => {
  it('dependencies 는 전부 배포 그룹에 고지된다', () => {
    const notified = BUNDLED_LICENSES.map((entry) => entry.name);
    for (const name of Object.keys(pkg.dependencies)) {
      expect(notified, `${name} 이(가) 고지 목록에 없다 — yarn licenses:gen 을 돌려라`).toContain(
        name,
      );
    }
  });

  it('devDependencies 는 전부 개발 그룹에 고지된다', () => {
    const notified = DEV_LICENSES.map((entry) => entry.name);
    for (const name of Object.keys(pkg.devDependencies)) {
      expect(notified, `${name} 이(가) 고지 목록에 없다 — yarn licenses:gen 을 돌려라`).toContain(
        name,
      );
    }
  });

  it('개발 그룹에 package.json 에 없는 패키지가 섞이지 않는다', () => {
    const declared = Object.keys(pkg.devDependencies);
    for (const entry of DEV_LICENSES) {
      expect(declared, `${entry.name} 은(는) devDependencies 에 없다`).toContain(entry.name);
    }
  });

  it('배포 그룹은 dependencies 이거나 번들에 들어가는 전이 의존성이다', () => {
    // scheduler 는 react-dom 이 끌고 들어와 dist/assets/vendor-react-*.js 에 코드가 포함된다.
    const allowed = new Set([...Object.keys(pkg.dependencies), 'scheduler']);
    for (const entry of BUNDLED_LICENSES) expect(allowed).toContain(entry.name);
  });

  it('두 그룹이 겹치지 않는다 — 배포 여부가 뒤섞이면 고지가 부정확해진다', () => {
    const bundled = new Set(BUNDLED_LICENSES.map((entry) => entry.name));
    for (const entry of DEV_LICENSES) expect(bundled.has(entry.name)).toBe(false);
  });

  it('의존성 버전 표기가 package.json 과 같다', () => {
    expect(SELF_NAME).toBe(pkg.name);
    for (const entry of BUNDLED_LICENSES) {
      const range = (pkg.dependencies as Record<string, string>)[entry.name];
      if (!range) continue;
      // "^18.3.1" 의 메이저가 고지된 설치 버전과 맞는지 본다.
      expect(entry.version.split('.')[0]).toBe(range.replace(/^[^\d]*/, '').split('.')[0]);
    }
  });

  /**
   * 🔴 2026-08-17 릴리스 실패 회귀. 릴리스 워크플로는 머지마다 package.json·manifest.json 의
   * patch 를 올린 뒤 게이트를 다시 돌린다. 생성물에 확장 버전을 박아 두면 그 범프와 어긋나
   * (expected '0.1.10' to be '0.1.11') 릴리스 잡이 통째로 실패한다.
   * 화면 표기는 `chrome.runtime.getManifest().version` 이 준다 — 여기서는 다시 박히지 않았는지만 본다.
   */
  it('생성물에 확장 자신의 버전을 박지 않는다 — 릴리스 자동 범프와 어긋난다', () => {
    expect(generatedSource).not.toMatch(/export const SELF_VERSION/);
    const selfVersionExports = Object.entries(generated).filter(
      ([, value]) => typeof value === 'string' && value === pkg.version,
    );
    expect(selfVersionExports).toEqual([]);
  });
});

describe('오픈소스 고지 — 본문이 비어 있지 않다', () => {
  it('이 확장의 라이선스 전문이 루트 LICENSE 원문과 같다', () => {
    expect(SELF_LICENSE_TEXT).toBe(selfLicenseRaw.trimEnd());
    expect(SELF_LICENSE_TEXT.length).toBeGreaterThan(500);
  });

  it('배포 그룹은 전문·종류·저작권자를 모두 갖는다', () => {
    expect(BUNDLED_LICENSES.length).toBeGreaterThan(0);
    for (const entry of BUNDLED_LICENSES) {
      expect(entry.version, `${entry.name} 버전 누락`).toMatch(/\d/);
      expect(entry.licenseField ?? entry.headline, `${entry.name} 라이선스 종류 누락`).toBeTruthy();
      expect(entry.copyright, `${entry.name} 저작권 표기 누락`).toBeTruthy();
      expect((entry.text ?? '').length, `${entry.name} 전문이 비었다`).toBeGreaterThan(500);
    }
  });

  it('배포 그룹 전문은 node_modules 의 LICENSE 원문 그대로다', () => {
    for (const entry of BUNDLED_LICENSES) {
      const original = BUNDLED_ORIGINALS[entry.name];
      expect(original, `${entry.name} 원문 대조가 빠졌다`).toBeTruthy();
      expect(entry.licenseFile).toBe('LICENSE');
      expect(entry.text).toBe((original as string).trimEnd());
    }
  });

  it('개발 그룹은 이름·버전·종류·근거 파일명을 갖는다', () => {
    expect(DEV_LICENSES.length).toBeGreaterThan(0);
    for (const entry of DEV_LICENSES) {
      expect(entry.version, `${entry.name} 버전 누락`).toMatch(/\d/);
      expect(entry.licenseField ?? entry.headline, `${entry.name} 라이선스 종류 누락`).toBeTruthy();
      expect(entry.licenseFile, `${entry.name} 원문 파일명 누락`).toBeTruthy();
    }
  });

  it('약관 문장이 저작권자로 둔갑하지 않는다 (Apache-2.0 오추출 방지)', () => {
    for (const entry of [...BUNDLED_LICENSES, ...DEV_LICENSES]) {
      if (!entry.copyright) continue;
      expect(entry.copyright, `${entry.name} 저작권 표기에 약관 문장이 섞였다`).not.toMatch(
        /Copyright\s+(License|Notice)|retain, in the Source/,
      );
    }
  });
});

describe('오픈소스 고지 — 근거 없는 고지를 내지 않는다', () => {
  it('chzzk-plus 참조 고지는 실제 참조 주석을 근거로 한다 (2026-08-16 확인)', () => {
    const attribution = CODE_ATTRIBUTIONS.find((entry) => entry.name.includes('chzzk-plus'));
    expect(attribution, 'chzzk-plus 참조 주석이 src 에 있는데 고지가 없다').toBeTruthy();
    expect(attribution?.licenseField).toBe('MIT');
    expect(attribution?.files).toContain('src/features/powerCollect.ts');
    expect(powerCollectSource).toContain('chzzk-plus');
  });

  it('코드 참조 고지는 근거 파일 목록이 비어 있지 않다', () => {
    for (const attribution of CODE_ATTRIBUTIONS) {
      expect(attribution.files.length).toBeGreaterThan(0);
    }
  });

  it('원문을 확인하지 못한 외부 도구는 종류를 지어내지 않는다', () => {
    expect(EXTERNAL_TOOLS.length).toBeGreaterThan(0);
    for (const entry of EXTERNAL_TOOLS) {
      if (entry.licenseFile === null) expect(entry.licenseField).toBeNull();
    }
  });
});
