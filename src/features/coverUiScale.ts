import { CHZZK, ID, OURS, PLAYER } from '../constants/class';
import { hasSideChat } from '../pageType';
import { readDisplayViewport } from '../utils/displayViewport';
import { qs, removeStyle, upsertStyle } from '../utils/dom';
import { onViewportChange } from '../utils/viewport';
import { isScrolledToBottom } from './chatFont';
import type { Feature } from './types';

const STYLE_ID = 'cm-cover-ui-scale-style';
// The full correction suits sheets. Restore 70% here to keep the player controls compact.
const CORRECTION_SHARE = 0.7;
const MAX_ZOOM = 2.1;

export const coverUiScaleFeature: Feature = {
  id: 'coverUiScale',
  preserveOnDeviceChange: true,
  watches: [],
  supports: (ctx) => hasSideChat(ctx.page.type) && !ctx.page.isSlotFrame,
  start: () => {
    let appliedZoom = 1;
    const sync = () => {
      const { zoom } = readDisplayViewport();
      const nextZoom = Math.min(MAX_ZOOM, 1 + (zoom - 1) * CORRECTION_SHARE);
      if (nextZoom === appliedZoom) return;
      appliedZoom = nextZoom;

      const scroller = qs<HTMLElement>(CHZZK.chatScroller);
      const wasAtBottom = scroller && isScrolledToBottom(scroller);
      if (nextZoom === 1) {
        removeStyle(STYLE_ID);
      } else {
        // Keep the video and the outer chat panel at their original size.
        upsertStyle(
          STYLE_ID,
          `${PLAYER.rootPc} .pzp-pc__bottom-buttons,
${PLAYER.rootPc} #${OURS.chatWidthControlId},
#${OURS.volumeRowId} > #${OURS.volumeControlId},
${ID.asideChatting} > :not([id^="cm-"]) { zoom: ${nextZoom}; }`,
        );
      }
      if (wasAtBottom) scroller.scrollTop = scroller.scrollHeight;
    };

    sync();
    const stop = onViewportChange(sync);
    return () => {
      stop();
      removeStyle(STYLE_ID);
    };
  },
};
