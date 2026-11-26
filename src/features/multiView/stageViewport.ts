import { readDisplayViewport } from '../../utils/displayViewport';

const STAGE_BAR_COMPACT_MAX_PX = 600;

export function readStageViewport() {
  const { width, height, zoom } = readDisplayViewport();
  return { width, height, zoom, compact: width <= STAGE_BAR_COMPACT_MAX_PX };
}
