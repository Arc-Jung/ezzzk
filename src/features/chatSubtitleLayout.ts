/** 자막형 채팅의 영상 영역과 여백 배치 계산. */
import type { SubtitleSettings } from './chatSubtitleSettings';

/** object-fit: contain으로 생기는 검은 여백을 제외한 실제 영상 영역. */
export function subtitlePicture(width: number, height: number, aspect = 16 / 9) {
  const pictureWidth = Math.min(width, height * aspect);
  const pictureHeight = pictureWidth / aspect;
  return {
    width: pictureWidth,
    height: pictureHeight,
    left: (width - pictureWidth) / 2,
    bottom: (height - pictureHeight) / 2,
  };
}

/** 컨트롤 여백을 확보하고 영상 높이에 맞춰 3~6줄을 표시한다. */
export function subtitleGeometry(
  width: number,
  height: number,
  settings: SubtitleSettings,
  controlsVisible = false,
): {
  fontPx: number;
  lineHeight: number;
  lines: number;
  width: number;
  left: number;
  bottom: number;
} {
  const bottom = Math.round(
    Math.min(controlsVisible ? 80 : 20, height * (controlsVisible ? 0.25 : 0.08)),
  );
  const fontPx = Math.min(settings.fontPx, Math.max(10, Math.floor((height - bottom - 24) / 4.35)));
  const lineHeight = Math.ceil(fontPx * 1.45);
  const available = Math.max(3, Math.min(6, Math.floor((height - bottom - 24) / lineHeight)));
  const automatic = Math.max(3, Math.min(6, Math.floor((height * 0.28) / lineHeight)));
  const margin = Math.min(width / 2, Math.round(Math.min(16, Math.max(4, width * 0.025))));
  const overlayWidth = Math.min(
    720,
    Math.floor(Math.max(0, width) * (width < 600 ? 0.92 : 0.62)),
    Math.max(0, width - 2 * margin),
  );
  const left =
    settings.position === 'left'
      ? margin
      : settings.position === 'center'
        ? (width - overlayWidth) / 2
        : width - overlayWidth - margin;
  return {
    fontPx,
    lineHeight,
    lines: Math.min(settings.lines || automatic, available),
    width: overlayWidth,
    left,
    bottom,
  };
}

/** 여백 안에 최소 3줄과 조작 버튼이 들어갈 때만 영상 아래로 옮긴다. */
export function subtitlePlacement(
  width: number,
  height: number,
  aspect: number,
  settings: SubtitleSettings,
  controlsVisible = false,
  controlsHeight = 0,
) {
  const picture = subtitlePicture(width, height, aspect);
  const geometry = subtitleGeometry(picture.width, picture.height, settings, controlsVisible);
  const video = {
    ...geometry,
    left: picture.left + geometry.left,
    bottom: picture.bottom + geometry.bottom,
    placement: 'video' as const,
  };
  if (!settings.useBottomSpace) return video;
  const bottom = Math.round(
    controlsVisible
      ? Math.max(Math.min(80, height * 0.25), controlsHeight)
      : Math.min(20, height * 0.08),
  );
  const lines = Math.min(
    geometry.lines,
    Math.floor((picture.bottom - bottom - 16 - 8) / geometry.lineHeight),
  );
  if (lines < 3 || bottom + Math.max(60, lines * geometry.lineHeight + 16) + 8 > picture.bottom)
    return video;
  return { ...geometry, left: video.left, bottom, lines, placement: 'bottom-space' as const };
}
