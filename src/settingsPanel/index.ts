/**
 * FR-09.2 설정 패널 기능 진입점.
 *
 * - 컨트롤바에 `⚙*` 버튼을 삽입한다 (배지로 네이티브 `설정` 과 구분 — §11 미결정 8).
 * - 단축키는 `Alt + ,` 다. 네이티브 `space` `k` `m` `f` 는 절대 쓰지 않는다 (FR-03 참조).
 * - 기기 프로필이 `shortcuts: 'off'` 면 단축키를 걸지 않는다. 버튼은 그대로 동작한다.
 * - m.chzzk(`mobile-web`)은 컨트롤바 구조가 달라 삽입 지점이 없다 → 대상에서 제외한다.
 */

import { createElement } from 'react';
import { OURS } from '../constants/class';
import { mountSheet } from '../ui/mountSheet';
import { upsertStyle, removeStyle } from '../utils/dom';
import { info } from '../utils/log';
import { mountControlBarButton } from '../features/controlBar';
import type { Feature } from '../features/types';
import { SettingsPanel } from './SettingsPanel';
import { SETTINGS_PANEL_CSS } from './settingsPanelCss';

const STYLE_ID = `${OURS.settingsPanelId}-style`;

export const settingsPanelFeature: Feature = {
  id: 'settingsPanel',
  // 설정 패널은 useSettings 로 스스로 최신 값을 읽는다. 재시작하면 **사용자가 값을 바꾸는 순간 닫힌다.**
  watches: [],
  supports: (ctx) => (ctx.page.type === 'live' || ctx.page.type === 'vod') && !ctx.page.isSlotFrame,
  start: (ctx) => {
    upsertStyle(STYLE_ID, SETTINGS_PANEL_CSS);
    const sheet = mountSheet(OURS.settingsPanelId);

    const close = () => sheet.close();

    const open = () => {
      sheet.render(
        createElement(SettingsPanel, {
          device: ctx.device,
          onClose: close,
        }),
      );
    };

    const toggle = () => {
      if (sheet.isOpen()) close();
      else open();
    };

    const stopButton = mountControlBarButton({
      id: OURS.settingsButtonId,
      ariaLabel: '이지직 설정',
      icon: 'gear',
      badge: true,
      minTargetPx: ctx.device.profile.touchTargetPx,
      onClick: toggle,
    });

    const shortcutsEnabled = ctx.device.profile.shortcuts !== 'off';
    const onKeyDown = (event: KeyboardEvent) => {
      // Alt+, — 쉼표 단독은 치지직이 쓰지 않고, space/k/m/f 와도 겹치지 않는다.
      if (!event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return;
      if (event.code !== 'Comma') return;
      event.preventDefault();
      toggle();
    };
    if (shortcutsEnabled) window.addEventListener('keydown', onKeyDown);

    /**
     * 팝업의 `세부 설정 열기` 버튼이 background 를 거쳐 보내는 요청을 받는다.
     * 팝업은 자기 창에서 페이지 DOM 을 만질 수 없으므로 이 경로가 필요하다.
     */
    const onRuntimeMessage = (message: unknown) => {
      if (typeof message !== 'object' || message === null) return;
      if ((message as { kind?: unknown }).kind !== 'openSettingsPanel') return;
      open();
    };
    chrome.runtime.onMessage.addListener(onRuntimeMessage);

    info(`settings panel ready (shortcut ${shortcutsEnabled ? 'Alt+Comma' : 'disabled'})`);

    return () => {
      if (shortcutsEnabled) window.removeEventListener('keydown', onKeyDown);
      chrome.runtime.onMessage.removeListener(onRuntimeMessage);
      stopButton();
      close();
      removeStyle(STYLE_ID);
    };
  },
};
