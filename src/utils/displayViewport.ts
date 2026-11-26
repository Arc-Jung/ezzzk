import { SIZE_TIERS } from '../constants/device';
import { readViewport } from './viewport';

const MIN_DESKTOP_LAYOUT_WIDTH = 600;

/** Visible viewport bounds in the layout units used by the compensated UI. */
export function readDisplayViewport() {
  const { width, height } = readViewport();
  const visual = window.visualViewport;
  const pageScale = visual?.scale ?? 1;
  const screenWidth = width * pageScale;
  const layoutWidth = document.documentElement.clientWidth;
  const needsCompensation =
    screenWidth > 0 &&
    screenWidth < SIZE_TIERS.mobileShortSide &&
    layoutWidth > MIN_DESKTOP_LAYOUT_WIDTH &&
    navigator.maxTouchPoints > 0 &&
    !window.matchMedia?.('(hover: hover)').matches;
  // A wide layout can persist after the browser has already increased the page scale.
  // Cap UI zoom at the inverse of the current shrink to avoid double enlargement.
  const zoom =
    needsCompensation && pageScale < 1 ? Math.min(layoutWidth / screenWidth, 1 / pageScale) : 1;
  return {
    width: width / zoom,
    height: height / zoom,
    zoom,
    left: (visual?.offsetLeft ?? 0) / zoom,
    top: (visual?.offsetTop ?? 0) / zoom,
  };
}
