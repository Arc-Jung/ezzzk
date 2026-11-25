import { SIZE_TIERS } from '../../constants/device';
import { readViewport } from '../../utils/viewport';

const STAGE_BAR_COMPACT_MAX_PX = 600;

export function readStageViewport() {
  const { width, height } = readViewport();
  const pageScale = window.visualViewport?.scale ?? 1;
  const screenWidth = width * pageScale;
  const layoutWidth = document.documentElement.clientWidth;
  const needsCompensation =
    screenWidth > 0 &&
    screenWidth < SIZE_TIERS.mobileShortSide &&
    layoutWidth > STAGE_BAR_COMPACT_MAX_PX &&
    navigator.maxTouchPoints > 0 &&
    !window.matchMedia?.('(hover: hover)').matches;
  // A wide layout can persist after the browser has already increased the page scale.
  // Cap the stage zoom at the inverse of the current shrink to avoid double enlargement.
  const zoom =
    needsCompensation && pageScale < 1 ? Math.min(layoutWidth / screenWidth, 1 / pageScale) : 1;
  return {
    width: width / zoom,
    height: height / zoom,
    zoom,
    compact: width / zoom <= STAGE_BAR_COMPACT_MAX_PX,
  };
}
