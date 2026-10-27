/** 자막형 채팅을 설정창 없이 켜고 끄는 공용 토글. 멀티뷰에서는 모든 슬롯에 적용한다. */
import { OURS } from '../constants/class';
import { hasSideChat } from '../pageType';
import { getCachedSettings, onSettingsChanged, saveSettings } from '../storage';
import { createIconElement } from '../ui/icons';
import { guardAsync } from '../utils/log';
import { keepMounted } from '../utils/observe';
import { mountControlBarButton } from './controlBar';
import type { Feature } from './types';

export const CHAT_SUBTITLE_BUTTON_ID = 'cm-chat-subtitle-button';
export const CHAT_SUBTITLE_STAGE_BUTTON_ID = 'cm-chat-subtitle-stage-button';

export const chatSubtitleButtonFeature: Feature = {
  id: 'chatSubtitleButton',
  watches: [],
  supports: (ctx) => hasSideChat(ctx.page.type) && !ctx.page.isSlotFrame,
  start: (ctx) => {
    let enabled = ctx.settings.chatSubtitle.enabled;
    let nativeButton: HTMLButtonElement | null = null;
    let stageButton: HTMLButtonElement | null = null;
    let alive = true;
    const render = () => {
      const label = `자막형 채팅 ${enabled ? '끄기' : '켜기'}`;
      for (const button of [nativeButton, stageButton]) {
        if (!button) continue;
        button.setAttribute('aria-label', label);
        button.setAttribute('aria-pressed', String(enabled));
        button.title = label;
        button.style.color = enabled ? '#00ffa3' : '#ffffff';
      }
    };
    const toggle = () => {
      void guardAsync('chatSubtitleButton.toggle', async () => {
        const current = getCachedSettings();
        await saveSettings({
          chatSubtitle: { ...current.chatSubtitle, enabled: !current.chatSubtitle.enabled },
        });
      });
    };
    const stopNative = mountControlBarButton({
      id: CHAT_SUBTITLE_BUTTON_ID,
      ariaLabel: '자막형 채팅 켜기',
      icon: 'captions',
      minTargetPx: ctx.device.profile.touchTargetPx,
      onClick: toggle,
      onMount: (button) => {
        nativeButton = button;
        render();
      },
    });
    const stageBar = () => document.querySelector(`#${OURS.multiViewStageId} .cm-stage-bar`);
    const stopStage = keepMounted(
      document.documentElement,
      () => !stageBar() || stageButton?.parentElement === stageBar(),
      () => {
        const bar = stageBar();
        if (!bar) return;
        if (!stageButton) {
          stageButton = document.createElement('button');
          stageButton.id = CHAT_SUBTITLE_STAGE_BUTTON_ID;
          stageButton.type = 'button';
          stageButton.appendChild(createIconElement('captions'));
          stageButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggle();
          });
        }
        const settings = bar.querySelector('[aria-label="이지직 설정 열기"]');
        bar.insertBefore(stageButton, settings?.nextSibling ?? null);
        render();
      },
    );
    const unsubscribe = onSettingsChanged((settings) => {
      if (!alive) return;
      enabled = settings.chatSubtitle.enabled;
      render();
    });
    return () => {
      alive = false;
      unsubscribe();
      stopStage();
      stageButton?.remove();
      stopNative();
    };
  },
};
