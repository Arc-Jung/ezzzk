import { SIZE_TIERS } from '../../constants/device';
import { readViewport } from '../../utils/viewport';

const STAGE_BAR_COMPACT_MAX_PX = 600;

export function readStageViewport() {
  const { width, height } = readViewport();
  const screenWidth = width * (window.visualViewport?.scale ?? 1);
  const layoutWidth = document.documentElement.clientWidth;
  // Android desktop-site mode can fit a wide layout to a narrow touch screen.
  // Base compensation on that fit so it stays constant when the user pinches.
  const zoom =
    screenWidth > 0 &&
    screenWidth < SIZE_TIERS.mobileShortSide &&
    layoutWidth > STAGE_BAR_COMPACT_MAX_PX &&
    navigator.maxTouchPoints > 0 &&
    !window.matchMedia?.('(hover: hover)').matches
      ? layoutWidth / screenWidth
      : 1;
  return {
    width: width / zoom,
    height: height / zoom,
    zoom,
    compact: (layoutWidth || width) / zoom <= STAGE_BAR_COMPACT_MAX_PX,
  };
}
