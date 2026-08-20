/**
 * 서비스 워커.
 *
 * NFR-07: 외부 서버로 어떤 데이터도 보내지 않는다. 여기서 하는 일은
 * ① 최초 설치 시 기본값·기본 프리셋 시딩 ② 팝업 ↔ content script 브로드캐스트 중계뿐이다.
 */

import { SCHEMA_VERSION, SCHEMA_VERSION_KEY, STORAGE_KEY } from './constants/storage';
import { buildBuiltinPresets } from './features/optionPreset';
import { loadSettings, saveSettings } from './storage';
import { error, info } from './utils/log';

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    try {
      const settings = await loadSettings();

      // FR-08 기본 제공 프리셋 3종(기본 · 채팅 집중 · 영상 집중)을 초기 상태로 넣는다.
      // 목록 생성은 `optionPreset.buildBuiltinPresets` 한 곳에만 둔다 — 여기서 다시 만들면
      // 두 곳이 갈라진다(실제로 인라인 중복이 있었고 그 탓에 함수가 고아처럼 보였다).
      if (details.reason === 'install' && settings.optionPresets.length === 0) {
        await saveSettings({ optionPresets: buildBuiltinPresets(Date.now()) });
        info('seeded builtin option presets');
      }

      await chrome.storage.local.set({ [SCHEMA_VERSION_KEY]: SCHEMA_VERSION });
    } catch (e) {
      error('onInstalled setup failed', e);
    }
  })();
});

/**
 * 팝업이 storage 를 직접 쓰므로 onChanged 로 모든 탭에 전파된다.
 * 여기서는 storage 로 표현하기 어려운 명령형 요청(패널 열기 등)만 중계한다.
 */
export type BackgroundMessage =
  { kind: 'openSettingsPanel' } | { kind: 'openMultiViewSheet' } | { kind: 'ping' };

chrome.runtime.onMessage.addListener((message: BackgroundMessage, _sender, sendResponse) => {
  if (message.kind === 'ping') {
    sendResponse({ ok: true, schemaVersion: SCHEMA_VERSION, storageKey: STORAGE_KEY });
    return false;
  }

  // 활성 치지직 탭으로 그대로 넘긴다.
  void (async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (tabId === undefined) {
        sendResponse({ ok: false, reason: 'no active tab' });
        return;
      }
      await chrome.tabs.sendMessage(tabId, message);
      sendResponse({ ok: true });
    } catch (e) {
      error('failed to relay message to content script', e);
      sendResponse({ ok: false, reason: String(e) });
    }
  })();
  return true;
});
