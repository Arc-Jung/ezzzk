import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, LIMITS, type Settings } from '../constants/storage';
import {
  applyPreset,
  buildBuiltinPresets,
  captureValues,
  deletePreset,
  exportPresets,
  importPresets,
  movePreset,
  overwritePreset,
  PRESET_FIELDS,
  renamePreset,
  savePreset,
  summarizePreset,
  type OptionPreset,
} from './optionPreset';

const NOW = 1_786_439_619_259;

function settings(patch: Partial<Settings> = {}): Settings {
  return JSON.parse(JSON.stringify({ ...DEFAULT_SETTINGS, ...patch })) as Settings;
}

function preset(id: string, name = id): OptionPreset {
  return { id, name, createdAt: NOW, updatedAt: NOW, values: {} };
}

describe('captureValues — 프리셋에 담는 값', () => {
  it('요구사항이 지정한 필드를 모두 담는다', () => {
    const values = captureValues(settings());
    for (const field of PRESET_FIELDS) {
      expect(values[field], field).toBeDefined();
    }
  });

  it('채팅 프리셋 목록은 선택적으로만 포함한다', () => {
    expect(captureValues(settings()).chatPresets).toBeUndefined();
    const withChat = captureValues(
      settings({ chatPresets: [{ id: 'a', label: 'ㅋ', text: 'ㅋㅋ', order: 0 }] }),
      { includeChatPresets: true },
    );
    expect(withChat.chatPresets).toHaveLength(1);
  });

  it('원본과 참조를 공유하지 않는다 (프리셋 수정이 현재 설정을 오염시키면 안 된다)', () => {
    const source = settings();
    const values = captureValues(source);
    values.volume!.defaultLevel = 99;
    expect(source.volume.defaultLevel).toBe(50);
  });

  it('debug·activePresetId 같은 세션성 값은 담지 않는다', () => {
    const values = captureValues(settings({ debug: true, activePresetId: 'x' }));
    expect(values.debug).toBeUndefined();
    expect(values.activePresetId).toBeUndefined();
  });
});

describe('summarizePreset — 목록 요약 문자열', () => {
  it('요구사항 예시 형태를 만든다', () => {
    const values = captureValues(
      settings({
        chatWidth: { ...DEFAULT_SETTINGS.chatWidth, ratio: 30 },
        wideScreen: { enabled: true },
      }),
    );
    expect(summarizePreset(values)).toBe('1080p · 50% · 채팅 30% · 와이드');
  });

  it('넓은 화면이 꺼져 있으면 와이드를 빼고 쓴다', () => {
    const values = captureValues(settings({ wideScreen: { enabled: false } }));
    expect(summarizePreset(values)).toBe('1080p · 50% · 채팅 30%');
  });

  it('자동·최고화질을 한글로 표기한다', () => {
    const auto = captureValues(
      settings({ quality: { ...DEFAULT_SETTINGS.quality, target: 'auto' } }),
    );
    expect(summarizePreset(auto)).toContain('자동 화질');
    const best = captureValues(
      settings({ quality: { ...DEFAULT_SETTINGS.quality, target: 'best' } }),
    );
    expect(summarizePreset(best)).toContain('최고화질');
  });

  it('빈 프리셋도 기본값으로 요약할 수 있다 (기본 프리셋)', () => {
    expect(summarizePreset({})).toBe('1080p · 50% · 채팅 30% · 와이드');
  });

  it('멀티뷰가 켜져 있고 슬롯이 2개 이상이면 분할 수를 붙인다', () => {
    const values = captureValues(
      settings({
        multiView: {
          ...DEFAULT_SETTINGS.multiView,
          enabled: true,
          defaultSplit: 4,
          slots: [
            { index: 1, channelId: 'a'.repeat(32), channelName: 'A' },
            { index: 2, channelId: 'b'.repeat(32), channelName: 'B' },
          ],
        },
      }),
    );
    expect(summarizePreset(values)).toContain('4분할');
  });
});

describe('savePreset — 상한 20개', () => {
  it('현재 설정으로 저장한다', () => {
    const { presets, error } = savePreset([], '내 설정', settings(), NOW);
    expect(error).toBeUndefined();
    expect(presets).toHaveLength(1);
    expect(presets[0]?.name).toBe('내 설정');
    expect(presets[0]?.createdAt).toBe(NOW);
    expect(presets[0]?.values.quality).toBeDefined();
  });

  it('이름 앞뒤 공백을 자른다', () => {
    const { presets } = savePreset([], '  이름  ', settings(), NOW);
    expect(presets[0]?.name).toBe('이름');
  });

  it('빈 이름은 거부하고 목록을 바꾸지 않는다', () => {
    const existing = [preset('a')];
    const { presets, error } = savePreset(existing, '   ', settings(), NOW);
    expect(error).toBeDefined();
    expect(presets).toBe(existing);
  });

  it('20개를 넘으면 저장하지 않고 안내한다', () => {
    const full = Array.from({ length: LIMITS.optionPresets }, (_, i) => preset(`p${i}`));
    const { presets, error } = savePreset(full, '하나 더', settings(), NOW);
    expect(error).toContain(String(LIMITS.optionPresets));
    expect(presets).toHaveLength(LIMITS.optionPresets);
  });

  it('id 가 서로 겹치지 않는다', () => {
    let list: OptionPreset[] = [];
    for (let i = 0; i < 5; i += 1) {
      list = savePreset(list, `p${i}`, settings(), NOW).presets;
    }
    expect(new Set(list.map((p) => p.id)).size).toBe(5);
  });
});

describe('overwritePreset / renamePreset / deletePreset', () => {
  it('덮어쓰면 값과 updatedAt 만 바뀌고 createdAt·id 는 유지된다', () => {
    const list = [preset('a', '원래 이름')];
    const next = overwritePreset(list, 'a', settings({ debug: true }), NOW + 1000);
    expect(next[0]?.id).toBe('a');
    expect(next[0]?.name).toBe('원래 이름');
    expect(next[0]?.createdAt).toBe(NOW);
    expect(next[0]?.updatedAt).toBe(NOW + 1000);
    expect(next[0]?.values.quality).toBeDefined();
  });

  it('이름을 바꾼다', () => {
    const { presets } = renamePreset([preset('a', '옛 이름')], 'a', '새 이름', NOW + 1);
    expect(presets[0]?.name).toBe('새 이름');
    expect(presets[0]?.updatedAt).toBe(NOW + 1);
  });

  it('빈 이름으로는 바꾸지 않는다', () => {
    const list = [preset('a', '옛 이름')];
    const { presets, error } = renamePreset(list, 'a', '  ', NOW);
    expect(error).toBeDefined();
    expect(presets[0]?.name).toBe('옛 이름');
  });

  it('삭제는 해당 항목만 없앤다', () => {
    const list = [preset('a'), preset('b'), preset('c')];
    expect(deletePreset(list, 'b').map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('없는 id 는 아무 변화가 없다', () => {
    const list = [preset('a')];
    expect(deletePreset(list, 'zzz')).toHaveLength(1);
    expect(overwritePreset(list, 'zzz', settings(), NOW)[0]?.updatedAt).toBe(NOW);
  });
});

describe('movePreset — 순서 변경', () => {
  const list = [preset('a'), preset('b'), preset('c')];

  it('위로 올린다', () => {
    expect(movePreset(list, 'b', 'up').map((p) => p.id)).toEqual(['b', 'a', 'c']);
  });

  it('아래로 내린다', () => {
    expect(movePreset(list, 'b', 'down').map((p) => p.id)).toEqual(['a', 'c', 'b']);
  });

  it('경계를 넘으면 원본을 그대로 돌려준다', () => {
    expect(movePreset(list, 'a', 'up')).toBe(list);
    expect(movePreset(list, 'c', 'down')).toBe(list);
  });

  it('없는 id 는 원본을 그대로 돌려준다', () => {
    expect(movePreset(list, 'zzz', 'up')).toBe(list);
  });

  it('원본 배열을 변형하지 않는다', () => {
    const copy = [...list];
    movePreset(list, 'b', 'up');
    expect(list).toEqual(copy);
  });
});

describe('applyPreset', () => {
  it('프리셋 값과 activePresetId 를 함께 돌려준다', () => {
    const saved = savePreset(
      [],
      '채팅 집중',
      settings({ chatWidth: { ...DEFAULT_SETTINGS.chatWidth, ratio: 45 } }),
      NOW,
    ).presets[0];
    expect(saved).toBeDefined();
    const patch = applyPreset(saved!);
    expect(patch.chatWidth?.ratio).toBe(45);
    expect(patch.activePresetId).toBe(saved!.id);
  });

  it('프리셋에 없는 필드는 patch 에 넣지 않아 현재 값이 유지된다', () => {
    const patch = applyPreset(preset('a'));
    expect(patch.debug).toBeUndefined();
    expect(patch.chatPresets).toBeUndefined();
  });

  it('적용 결과가 프리셋 값과 참조를 공유하지 않는다', () => {
    const saved = savePreset([], 'p', settings(), NOW).presets[0]!;
    const patch = applyPreset(saved);
    patch.volume!.defaultLevel = 1;
    expect(saved.values.volume?.defaultLevel).toBe(50);
  });
});

describe('buildBuiltinPresets — 기본 제공 3종', () => {
  it('기본 · 채팅 집중(45%) · 영상 집중(15%) 을 만든다', () => {
    const builtins = buildBuiltinPresets(NOW);
    expect(builtins.map((p) => p.name)).toEqual(['기본', '채팅 집중', '영상 집중']);
    expect(builtins[1]?.values.chatWidth?.ratio).toBe(45);
    expect(builtins[2]?.values.chatWidth?.ratio).toBe(15);
  });

  it('id 가 서로 다르다', () => {
    const builtins = buildBuiltinPresets(NOW);
    expect(new Set(builtins.map((p) => p.id)).size).toBe(builtins.length);
  });
});

describe('exportPresets / importPresets (P2)', () => {
  it('내보낸 JSON 을 그대로 가져올 수 있다', () => {
    const list = savePreset([], '내 설정', settings(), NOW).presets;
    const restored = importPresets(exportPresets(list));
    expect(restored).toHaveLength(1);
    expect(restored?.[0]?.name).toBe('내 설정');
    expect(restored?.[0]?.values.quality).toBeDefined();
  });

  it('형태가 다른 JSON 은 null 이다', () => {
    expect(importPresets('not json')).toBeNull();
    expect(importPresets('null')).toBeNull();
    expect(importPresets('{"kind":"other"}')).toBeNull();
    expect(importPresets('{"kind":"ezzzk/optionPresets"}')).toBeNull();
  });

  it('항목 중 형태가 깨진 것만 버린다', () => {
    const raw = JSON.stringify({
      kind: 'ezzzk/optionPresets',
      version: 1,
      presets: [{ id: 'ok', name: '괜찮음' }, { name: 'id 없음' }, null, 'string'],
    });
    const restored = importPresets(raw);
    expect(restored).toHaveLength(1);
    expect(restored?.[0]?.id).toBe('ok');
  });

  it('가져올 때도 상한 20개를 넘기지 않는다', () => {
    const raw = JSON.stringify({
      kind: 'ezzzk/optionPresets',
      version: 1,
      presets: Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, name: `p${i}` })),
    });
    expect(importPresets(raw)).toHaveLength(LIMITS.optionPresets);
  });
});
