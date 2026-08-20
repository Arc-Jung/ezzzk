/**
 * FR-08 저장된 옵션값(프리셋) 목록.
 *
 * - 현재 설정 조합 전체를 하나의 프리셋으로 저장하고, 목록에서 골라 즉시 적용한다.
 * - 적용은 열려 있는 **모든 치지직 탭에 즉시 반영**된다 (`chrome.storage.onChanged` 기반).
 * - 상한 20개. 기본 제공 프리셋 3종(기본 · 채팅 집중 45% · 영상 집중 15%)을 초기 상태로 넣는다.
 *
 * 페이지 구조와 무관한 순수 상태 관리라 DOM 을 만지지 않는다 — Feature 가 아니다.
 */

import { BUILTIN_PRESETS, DEFAULT_SETTINGS, LIMITS, type Settings } from '../constants/storage';

export type OptionPreset = Settings['optionPresets'][number];

/** 프리셋에 담는 값 (요구사항 FR-08). 채팅 프리셋 목록은 선택적으로 포함한다. */
export const PRESET_FIELDS = [
  'quality',
  'volume',
  'chatWidth',
  'wideScreen',
  'powerCollect',
  'chatFont',
  'ultraWide',
  'multiView',
] as const satisfies readonly (keyof Settings)[];

/** 현재 설정에서 프리셋에 담을 값만 뽑는다. */
export function captureValues(
  settings: Settings,
  { includeChatPresets = false } = {},
): Partial<Settings> {
  const values: Partial<Settings> = {};
  for (const field of PRESET_FIELDS) {
    // 필드별 타입이 다르므로 한 번에 좁힐 수 없다. 얕은 복사로 참조 공유를 끊는다.
    Object.assign(values, { [field]: structuredCloneSafe(settings[field]) });
  }
  if (includeChatPresets) {
    values.chatPresets = structuredCloneSafe(settings.chatPresets);
  }
  return values;
}

/**
 * 목록 항목에 함께 표시할 주요 값 요약.
 * 예: `1080p · 50% · 채팅 30% · 와이드`
 */
export function summarizePreset(
  values: Partial<Settings>,
  base: Settings = DEFAULT_SETTINGS,
): string {
  const quality = values.quality ?? base.quality;
  const volume = values.volume ?? base.volume;
  const chatWidth = values.chatWidth ?? base.chatWidth;
  const wideScreen = values.wideScreen ?? base.wideScreen;
  const multiView = values.multiView ?? base.multiView;

  const parts: string[] = [
    quality.target === 'auto'
      ? '자동 화질'
      : quality.target === 'best'
        ? '최고화질'
        : quality.target,
    `${volume.defaultLevel}%`,
    `채팅 ${chatWidth.ratio}%`,
  ];
  if (wideScreen.enabled) parts.push('와이드');
  if (multiView.enabled && multiView.slots.length >= 2) {
    parts.push(`${multiView.defaultSplit}분할`);
  }
  return parts.join(' · ');
}

export type SaveResult = { presets: OptionPreset[]; error?: string };

/** 현재 설정으로 새 프리셋을 저장한다. 상한을 넘으면 목록을 바꾸지 않고 안내만 준다. */
export function savePreset(
  presets: OptionPreset[],
  name: string,
  settings: Settings,
  now: number,
  { includeChatPresets = false } = {},
): SaveResult {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { presets, error: '프리셋 이름을 입력해 주세요.' };
  }
  if (presets.length >= LIMITS.optionPresets) {
    return { presets, error: `프리셋은 최대 ${LIMITS.optionPresets}개까지 저장할 수 있습니다.` };
  }
  const preset: OptionPreset = {
    id: `preset-${now}-${presets.length}`,
    name: trimmed,
    createdAt: now,
    updatedAt: now,
    values: captureValues(settings, { includeChatPresets }),
  };
  return { presets: [...presets, preset] };
}

/** 기존 프리셋을 현재 설정으로 덮어쓴다. */
export function overwritePreset(
  presets: OptionPreset[],
  id: string,
  settings: Settings,
  now: number,
  { includeChatPresets = false } = {},
): OptionPreset[] {
  return presets.map((preset) =>
    preset.id === id
      ? { ...preset, updatedAt: now, values: captureValues(settings, { includeChatPresets }) }
      : preset,
  );
}

export function renamePreset(
  presets: OptionPreset[],
  id: string,
  name: string,
  now: number,
): SaveResult {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { presets, error: '프리셋 이름을 입력해 주세요.' };
  }
  return {
    presets: presets.map((preset) =>
      preset.id === id ? { ...preset, name: trimmed, updatedAt: now } : preset,
    ),
  };
}

export function deletePreset(presets: OptionPreset[], id: string): OptionPreset[] {
  return presets.filter((preset) => preset.id !== id);
}

/** 순서 변경. 경계를 넘으면 원본을 그대로 돌려준다. */
export function movePreset(
  presets: OptionPreset[],
  id: string,
  direction: 'up' | 'down',
): OptionPreset[] {
  const index = presets.findIndex((preset) => preset.id === id);
  if (index < 0) return presets;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= presets.length) return presets;

  const next = [...presets];
  const a = next[index];
  const b = next[target];
  if (!a || !b) return presets;
  next[index] = b;
  next[target] = a;
  return next;
}

/**
 * 프리셋을 적용하기 위한 부분 설정(patch)을 만든다.
 *
 * 프리셋에 없는 필드는 patch 에 넣지 않는다 → 저장하지 않은 값은 **현재 값이 유지**된다.
 * 병합은 호출부(`saveSettings`/`update`)가 하므로 현재 설정을 인자로 받을 필요가 없다.
 */
export function applyPreset(preset: OptionPreset): Partial<Settings> & { activePresetId: string } {
  return { ...structuredCloneSafe(preset.values), activePresetId: preset.id };
}

/** 기본 제공 프리셋을 초기 목록으로 만든다 (최초 설치 시 시딩). */
export function buildBuiltinPresets(now: number): OptionPreset[] {
  return BUILTIN_PRESETS.map((preset, index) => ({
    id: `builtin-${index}`,
    name: preset.name,
    createdAt: now,
    updatedAt: now,
    values: preset.values,
  }));
}

/** JSON 내보내기 (P2). 스키마 버전을 함께 넣어 가져올 때 판별할 수 있게 한다. */
export function exportPresets(presets: OptionPreset[]): string {
  return JSON.stringify({ kind: 'ezzzk/optionPresets', version: 1, presets }, null, 2);
}

/** JSON 가져오기 (P2). 형태가 다르면 null 을 돌려주고 호출부가 안내한다. */
export function importPresets(raw: string): OptionPreset[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const body = parsed as Record<string, unknown>;
  if (body.kind !== 'ezzzk/optionPresets') return null;
  if (!Array.isArray(body.presets)) return null;

  const out: OptionPreset[] = [];
  for (const row of body.presets) {
    if (typeof row !== 'object' || row === null) continue;
    const record = row as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.name !== 'string') continue;
    out.push({
      id: record.id,
      name: record.name,
      createdAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
      updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : 0,
      values:
        typeof record.values === 'object' && record.values !== null
          ? (record.values as Partial<Settings>)
          : {},
    });
  }
  return out.slice(0, LIMITS.optionPresets);
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
