import { useEffect, useState } from 'react';
import { isNewerVersion, releaseFromTag, type ReleaseInfo } from '../utils/releaseVersion';

function installedVersion(): string | null {
  try {
    return chrome.runtime.getManifest().version || null;
  } catch {
    return null;
  }
}

export function ExtensionStatus() {
  const [version] = useState(installedVersion);
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  useEffect(() => {
    if (!version) return;
    let active = true;
    void (async () => {
      try {
        const reply: unknown = await chrome.runtime.sendMessage({ kind: 'checkForUpdate' });
        const candidate =
          reply && typeof reply === 'object' && 'release' in reply ? reply.release : null;
        const next =
          candidate && typeof candidate === 'object' && 'tag' in candidate
            ? releaseFromTag(candidate.tag)
            : null;
        if (active) setRelease(next);
      } catch {
        /* 설치 버전과 설정 조작은 업데이트 조회와 무관하게 유지한다. */
      }
    })();
    return () => {
      active = false;
    };
  }, [version]);
  return (
    <div className="cm-sp__footer-note cm-sheet__note">
      {version ? <span aria-label={`현재 버전 ${version}`}>v{version}</span> : null}
      <span>변경은 즉시 저장됩니다.</span>
      {version && release && isNewerVersion(release.version, version) ? (
        <a
          className="cm-sp__update-link"
          href={release.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          업데이트 v{release.version} ↗
        </a>
      ) : null}
    </div>
  );
}
