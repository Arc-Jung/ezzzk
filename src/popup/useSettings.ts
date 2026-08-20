import { useCallback, useEffect, useState } from 'react';
import type { Settings } from '../constants/storage';
import { DEFAULT_SETTINGS } from '../constants/storage';
import { loadSettings, onSettingsChanged, saveSettings } from '../storage';

/**
 * 팝업·설정 패널 공용 훅.
 * 변경은 즉시 저장되고 (FR-09), onChanged 로 열린 모든 치지직 탭이 따라간다.
 *
 * ⚠️ 단, **창 로컬 섹션**(`WINDOW_LOCAL_SECTIONS` — 지금은 `chatWidth`)은 따라가지 않는다.
 * 설정 패널은 콘텐츠 스크립트와 **같은 프레임**에서 돌아 `saveSettings` 가 이 창의 식별자를
 * 함께 남기므로, 패널에서 바꾼 채팅 폭은 그 창에만 적용되고 다른 탭은 자기 폭을 유지한다
 * (사용자 보고 2026-08-15). `origin` 없이 저장하는 것은 그대로다 — 같은 창 안에서는
 * `chatWidth` 기능이 재시작되어 새 값을 적용해야 한다.
 */
export function useSettings(): {
  settings: Settings;
  ready: boolean;
  update: (patch: Partial<Settings>) => void;
} {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadSettings().then((loaded) => {
      if (!alive) return;
      setSettings(loaded);
      setReady(true);
    });
    const stop = onSettingsChanged((next) => {
      if (alive) setSettings(next);
    });
    return () => {
      alive = false;
      stop();
    };
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    // 낙관적 반영 — 저장 왕복을 기다리지 않는다.
    setSettings((prev) => ({ ...prev, ...patch }));
    void saveSettings(patch);
  }, []);

  return { settings, ready, update };
}
