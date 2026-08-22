/**
 * 설정 패널 「오픈소스 라이선스」 탭 본문 (FR-09.2).
 *
 * 원칙
 * - **목록을 손으로 적지 않는다.** 전부 `licenses.generated.ts`(= `yarn licenses:gen`)에서 온다.
 *   의존성이 바뀌었는데 고지가 그대로인 사고를 막는다.
 * - **배포물에 포함되는 것과 개발·검증에만 쓰는 것을 나눠 보여 준다.** 섞으면 재배포 고지 의무가
 *   있는 것과 없는 것이 구분되지 않아 오히려 부정확해진다.
 * - 배포 그룹과 이 확장 자신의 라이선스는 **전문을 그대로** 싣고, 길이는 접기로 다룬다.
 * - 확인하지 못한 것은 "확인하지 못함"으로 적는다. 지어내지 않는다.
 *
 * 🔴 예전에는 시트를 통째로 갈아 끼우는 **별도 화면**이었다 (설정 패널 하단 진입점 → `showLicenses`).
 * 고지 한 장을 위해 시트 교체 상태를 따로 들고 있을 만한 기능이 아니라 탭으로 접었다
 * (요청 2026-08-21). 탭이 되면서 `onClose`·`touchTargetPx`·`Sheet` 래퍼가 전부 필요 없어졌다 —
 * 시트 껍데기는 `SettingsPanel` 것 하나뿐이다.
 *
 * 스크롤: 본문은 `Sheet` 의 `.cm-sheet__body`(flex + `min-height: 0` + `overflow-y: auto`)가
 * 담당한다. 이 파일에서 별도 스크롤 컨테이너를 만들지 않는다 — 이중 스크롤은 세로가 짧은 화면에서
 * 안쪽이 0 높이로 눌려 아래가 영영 안 보이는 사고를 만든다(구성 시트·설정 패널에서 각각 발생).
 */

import { useState } from 'react';
import {
  BUNDLED_LICENSES,
  CODE_ATTRIBUTIONS,
  DEV_LICENSES,
  EXTERNAL_TOOLS,
  SELF_LICENSE_TEXT,
  SELF_NAME,
  type BundledLicenseEntry,
  type LicenseEntry,
} from '../constants/licenses.generated';

/**
 * 화면에 쓰는 확장 버전. **생성물에 박아 두지 않는다** — 릴리스 워크플로가 머지마다
 * package.json·manifest.json 의 patch 를 올린 뒤 게이트를 다시 돌리므로, 생성 시점 버전을
 * 박으면 그 범프와 어긋나 릴리스가 통째로 실패한다 (2026-08-17 v0.1.11).
 * 설치된 확장의 manifest 가 유일한 진실이고, 확장 밖(테스트·픽스처)에서는 버전 없이 그린다.
 */
function extensionVersion(): string | undefined {
  try {
    return chrome?.runtime?.getManifest?.()?.version || undefined;
  } catch {
    return undefined;
  }
}

/** 라이선스 종류 표기 — 원문 첫 줄을 우선하고, 없으면 package.json 필드로 물러난다. */
function licenseLabel(entry: LicenseEntry): string {
  if (entry.licenseField) return entry.licenseField;
  if (entry.headline) return entry.headline;
  return '확인하지 못함';
}

function copyrightLabel(entry: LicenseEntry): string {
  return entry.copyright ?? '원문에 저작권 표기 없음';
}

/**
 * 요약 줄에 쓸 저작권 표기.
 * vite·vitest·jsdom 처럼 **전이 의존성 라이선스를 한 파일에 모아 둔** 패키지는 저작권 줄이
 * 수백 개다 (실측: vitest 원문에서 60줄 이상). 그대로 늘어놓으면 목록을 읽을 수 없으므로
 * 첫 줄만 보여 주고 나머지 수를 밝힌다 — 숨기는 것이 아니라 몇 건인지 함께 적는다.
 * (배포 그룹은 요약이 아니라 전문을 그대로 싣는다.)
 */
function briefCopyright(entry: LicenseEntry): string {
  if (!entry.copyright) return '원문에 저작권 표기 없음';
  const lines = entry.copyright.split('\n');
  const first = lines[0] ?? '';
  return lines.length > 1 ? `${first} 외 ${lines.length - 1}건` : first;
}

/** 라이선스 전문 한 건. 길어서 기본은 접어 두고 눌러서 편다. */
function FullText({ entry }: { entry: BundledLicenseEntry }) {
  const [open, setOpen] = useState(false);
  const title = `${entry.name} ${entry.version}`;
  return (
    <li className="cm-lic__item">
      <div className="cm-lic__head">
        <span className="cm-lic__name">
          {title} — {licenseLabel(entry)}
        </span>
        <button
          type="button"
          className="cm-sheet__btn"
          aria-expanded={open}
          aria-label={`${title} 라이선스 전문 ${open ? '접기' : '펼치기'}`}
          onClick={() => setOpen((prev) => !prev)}
        >
          {open ? '전문 접기' : '전문 보기'}
        </button>
      </div>
      <p className="cm-sheet__note">{copyrightLabel(entry)}</p>
      {open ? (
        entry.text ? (
          <pre className="cm-lic__text">{entry.text}</pre>
        ) : (
          <p className="cm-sheet__warn">
            라이선스 원문 파일을 찾지 못했습니다 (package.json 의 license 필드만 확인됨).
          </p>
        )
      ) : null}
    </li>
  );
}

/** 이름 · 버전 · 종류 · 저작권자만 줄여 적는 한 줄. 개발 의존성은 수가 많아 전문을 싣지 않는다. */
function BriefRow({ entry }: { entry: LicenseEntry }) {
  return (
    <li className="cm-lic__brief">
      <span className="cm-lic__name">
        {entry.name} {entry.version}
      </span>
      <span className="cm-lic__kind">{licenseLabel(entry)}</span>
      <span className="cm-sheet__note">{briefCopyright(entry)}</span>
    </li>
  );
}

export function LicenseTab() {
  const [selfOpen, setSelfOpen] = useState(false);

  return (
    <div className="cm-lic">
      {/* 예전에는 시트 푸터에 있던 문구다. 탭이 되면서 푸터는 설정 패널 것 하나뿐이라
          본문 맨 위로 올렸다 — 목록의 출처를 먼저 밝혀야 아래 내용을 신뢰할 수 있다. */}
      <p className="cm-sheet__note">
        목록은 package.json 과 각 패키지의 LICENSE 원문에서 자동 생성됩니다.
      </p>
      <h3>이 확장</h3>
      <ul className="cm-lic__list">
        <li className="cm-lic__item">
          <div className="cm-lic__head">
            <span className="cm-lic__name">
              {[SELF_NAME, extensionVersion(), '— MIT'].filter(Boolean).join(' ')}
            </span>
            <button
              type="button"
              className="cm-sheet__btn"
              aria-expanded={selfOpen}
              aria-label={`이 확장 라이선스 전문 ${selfOpen ? '접기' : '펼치기'}`}
              onClick={() => setSelfOpen((prev) => !prev)}
            >
              {selfOpen ? '전문 접기' : '전문 보기'}
            </button>
          </div>
          {selfOpen ? <pre className="cm-lic__text">{SELF_LICENSE_TEXT}</pre> : null}
        </li>
      </ul>

      <h3>배포물에 포함 — 재배포 고지 대상</h3>
      <p className="cm-sheet__note">
        아래 항목은 확장 번들(dist)에 코드가 함께 들어가므로 라이선스 전문을 싣습니다.
      </p>
      <ul className="cm-lic__list">
        {BUNDLED_LICENSES.map((entry) => (
          <FullText key={entry.name} entry={entry} />
        ))}
      </ul>

      {CODE_ATTRIBUTIONS.length > 0 ? (
        <>
          <h3>코드 참조 고지</h3>
          <p className="cm-sheet__note">
            아래 프로젝트의 구현을 참조했습니다. 해당 파일에 참조 주석을 남겨 두었습니다.
          </p>
          <ul className="cm-lic__list">
            {CODE_ATTRIBUTIONS.map((entry) => (
              <li key={entry.name} className="cm-lic__brief">
                <span className="cm-lic__name">{entry.name}</span>
                <span className="cm-lic__kind">{entry.licenseField}</span>
                <span className="cm-sheet__note">
                  {entry.url} · 참조 파일: {entry.files.join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h3>개발·검증에만 사용 — 배포물 미포함</h3>
      <p className="cm-sheet__note">
        아래 항목은 개발·빌드·검증에만 쓰이며 배포되는 확장에는 포함되지 않습니다. 수가 많아
        이름·버전·라이선스 종류·저작권자만 적습니다.
      </p>
      <ul className="cm-lic__list">
        {DEV_LICENSES.map((entry) => (
          <BriefRow key={entry.name} entry={entry} />
        ))}
        {EXTERNAL_TOOLS.map((entry) => (
          <li key={entry.name} className="cm-lic__brief">
            <span className="cm-lic__name">
              {entry.name} {entry.version}
            </span>
            <span className="cm-lic__kind">{licenseLabel(entry)}</span>
            <span className="cm-sheet__note">
              {copyrightLabel(entry)} · npm 의존성이 아니라 검증용으로 내려받아 쓰며, 배포된 zip
              안에 라이선스 원문 파일이 없어 종류를 확인하지 못했습니다.
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
