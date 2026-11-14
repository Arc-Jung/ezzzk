/** 자막형 채팅 저장값 정규화와 색상. DOM에 의존하지 않는다. */
import { DEFAULT_SETTINGS, type Settings } from '../constants/storage';

export type SubtitleSettings = Settings['chatSubtitle'];

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.round(value)))
    : fallback;
}

/** 저장값을 CSS에 넣기 전에 색·수치 범위를 검증한다. 이전 설정에는 기본값을 채운다. */
export function subtitleSettings(value?: Partial<SubtitleSettings>): SubtitleSettings {
  const defaults = DEFAULT_SETTINGS.chatSubtitle;
  const color = (value: unknown, fallback: string) =>
    typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
  return {
    enabled: value?.enabled === true,
    useBottomSpace: value?.useBottomSpace === true,
    position:
      value?.position === 'right' || value?.position === 'center'
        ? value.position
        : defaults.position,
    lines: [0, 3, 4, 5, 6].includes(value?.lines ?? -1) ? value!.lines! : 0,
    fontPx: bounded(value?.fontPx, defaults.fontPx, 12, 28),
    textColor: color(value?.textColor, defaults.textColor),
    backgroundColor: color(value?.backgroundColor, defaults.backgroundColor),
    backgroundOpacity: bounded(value?.backgroundOpacity, defaults.backgroundOpacity, 0, 100),
    showNickname: value?.showNickname !== false,
    useNicknameColor: value?.useNicknameColor !== false,
  };
}

export function subtitleBackground(settings: SubtitleSettings): string {
  const hex = settings.backgroundColor.slice(1);
  const rgb = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  return `rgba(${rgb.join(', ')}, ${settings.backgroundOpacity / 100})`;
}
