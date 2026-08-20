import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, WINDOW_LOCAL_SECTIONS, type Settings } from './constants/storage';
import { changedSections, shouldRestartFeature } from './content';
import { FEATURES } from './features/registry';

function withPatch(patch: Partial<Settings>): Settings {
  return JSON.parse(JSON.stringify({ ...DEFAULT_SETTINGS, ...patch })) as Settings;
}

describe('changedSections', () => {
  it('같은 설정이면 변경 없음', () => {
    expect(changedSections(DEFAULT_SETTINGS, withPatch({}))).toEqual([]);
  });

  it('바뀐 최상위 섹션만 골라낸다', () => {
    const next = withPatch({ volume: { ...DEFAULT_SETTINGS.volume, defaultLevel: 80 } });
    expect(changedSections(DEFAULT_SETTINGS, next)).toEqual(['volume']);
  });

  it('여러 섹션이 동시에 바뀌면 모두 돌려준다', () => {
    const next = withPatch({
      wideScreen: { enabled: false },
      chatClutter: { ...DEFAULT_SETTINGS.chatClutter, ranking: false },
    });
    expect(changedSections(DEFAULT_SETTINGS, next).sort()).toEqual(['chatClutter', 'wideScreen']);
  });

  it('섹션 안 깊은 값 변화도 감지한다', () => {
    const next = withPatch({
      multiView: { ...DEFAULT_SETTINGS.multiView, activeSlot: 3 },
    });
    expect(changedSections(DEFAULT_SETTINGS, next)).toEqual(['multiView']);
  });

  it('배열 내용 변화도 감지한다', () => {
    const next = withPatch({ chatPresets: [{ id: 'a', label: 'ㅋ', text: 'ㅋㅋ', order: 0 }] });
    expect(changedSections(DEFAULT_SETTINGS, next)).toEqual(['chatPresets']);
  });
});

describe('shouldRestartFeature', () => {
  it('watches 를 생략하면 보수적으로 항상 재시작한다', () => {
    expect(shouldRestartFeature({}, ['volume'])).toBe(true);
    expect(shouldRestartFeature({}, [])).toBe(true);
  });

  it('watches 가 빈 배열이면 절대 재시작하지 않는다', () => {
    expect(shouldRestartFeature({ watches: [] }, ['volume'])).toBe(false);
    expect(shouldRestartFeature({ watches: [] }, ['multiView', 'chatFont'])).toBe(false);
  });

  it('교집합이 있을 때만 재시작한다', () => {
    expect(shouldRestartFeature({ watches: ['volume'] }, ['volume'])).toBe(true);
    expect(shouldRestartFeature({ watches: ['volume'] }, ['chatFont'])).toBe(false);
    expect(
      shouldRestartFeature({ watches: ['chatPresets', 'chatPresetBehavior'] }, [
        'chatPresetBehavior',
      ]),
    ).toBe(true);
  });
});

/**
 * 🔴 실측 결함 회귀 — 설정 변경에 **전 기능을 재시작하면** 다음이 전부 깨진다:
 * - 설정 패널이 사용자가 값을 바꾸는 순간 닫힌다
 * - 멀티뷰가 오디오 슬롯을 바꿀 때마다 iframe 4개를 다시 로드한다
 * 두 기능은 스스로 최신 설정을 읽으므로 재시작 대상이 아니어야 한다.
 */
describe('registry — 자체 상태를 가진 UI 는 설정 변경으로 재시작되지 않는다', () => {
  const featureById = (id: string) => {
    const feature = FEATURES.find((f) => f.id === id);
    expect(feature, `feature ${id} not registered`).toBeDefined();
    return feature!;
  };

  it('settingsPanel 은 어떤 설정 변경에도 재시작되지 않는다', () => {
    const panel = featureById('settingsPanel');
    expect(panel.watches).toEqual([]);
    const everySection = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];
    expect(shouldRestartFeature(panel, everySection)).toBe(false);
  });

  it('multiView 는 activeSlot·slotChatLines 변경으로 재시작되지 않는다', () => {
    const multiView = featureById('multiView');
    expect(multiView.watches).toEqual([]);
    expect(shouldRestartFeature(multiView, ['multiView'])).toBe(false);
    expect(shouldRestartFeature(multiView, ['volume'])).toBe(false);
  });

  it('볼륨을 바꿔도 멀티뷰·설정 패널은 재시작되지 않는다', () => {
    const changed: (keyof Settings)[] = ['volume'];
    const restarted = FEATURES.filter((f) => shouldRestartFeature(f, changed)).map((f) => f.id);
    expect(restarted).toContain('volume');
    expect(restarted).not.toContain('settingsPanel');
    expect(restarted).not.toContain('multiView');
  });

  it('모든 기능이 watches 를 명시한다 (보수적 전체 재시작으로 새는 기능이 없다)', () => {
    const missing = FEATURES.filter((f) => f.watches === undefined).map((f) => f.id);
    expect(missing).toEqual([]);
  });

  it('watches 에 적은 키는 모두 Settings 의 실제 키다', () => {
    const keys = Object.keys(DEFAULT_SETTINGS);
    for (const feature of FEATURES) {
      for (const key of feature.watches ?? []) {
        expect(keys, `${feature.id} watches unknown key ${String(key)}`).toContain(key);
      }
    }
  });

  it('설정 섹션 하나만 바뀌면 소수의 기능만 재시작된다', () => {
    // chatFont 변경으로 화질·볼륨·통나무까지 재시작되면 안 된다.
    const restarted = FEATURES.filter((f) => shouldRestartFeature(f, ['chatFont'])).map(
      (f) => f.id,
    );
    expect(restarted).toEqual(['chatFont']);
  });
});

/**
 * 🔴 R1 회귀 — 기능이 **자기가 감시하는 섹션을 스스로 쓰면** 자기 재시작이 일어난다.
 * `chatPreset` 은 저장 순간 편집 상태가 날아가고, `volume` 은 사용자가 올린 볼륨을 되돌리고,
 * `chatWidth` 는 클릭마다 폭 조정자 참조 카운트를 순환시킨다.
 * 값이 실제로 바뀌므로 "변화 없음" 가드로는 막을 수 없다 → 쓴 주체(origin)로 걸러야 한다.
 */
describe('shouldRestartFeature — 자기가 쓴 변경으로는 자기를 재시작하지 않는다', () => {
  it('origin 이 자기 id 면 감시 대상이 바뀌었어도 재시작하지 않는다', () => {
    const volume = { id: 'volume', watches: ['volume'] as const };
    expect(shouldRestartFeature(volume, ['volume'], 'volume')).toBe(false);
    // 다른 기능이 쓴 변경이면 정상적으로 재시작한다.
    expect(shouldRestartFeature(volume, ['volume'], 'settingsPanel')).toBe(true);
    // 다른 탭에서 온 변경(origin 없음)도 재시작한다.
    expect(shouldRestartFeature(volume, ['volume'], null)).toBe(true);
  });

  it('자기 쓰기로 재시작되던 기능 3종을 모두 막는다', () => {
    for (const [id, section] of [
      ['volume', 'volume'],
      ['chatWidth', 'chatWidth'],
      ['chatPreset', 'chatPresets'],
    ] as const) {
      const feature = FEATURES.find((f) => f.id === id);
      expect(feature, id).toBeDefined();
      expect(shouldRestartFeature(feature!, [section], id), id).toBe(false);
    }
  });

  it('origin 이 있어도 무관한 다른 기능은 정상적으로 재시작한다', () => {
    const chatFont = FEATURES.find((f) => f.id === 'chatFont')!;
    expect(shouldRestartFeature(chatFont, ['chatFont'], 'settingsPanel')).toBe(true);
  });
});

/**
 * 🔴 실측 결함 회귀 (사용자 보고 2026-08-15) — 탭 두 개를 띄우고 **A 탭에서만** 채팅 폭 `+` 를
 * 세 번 눌렀는데 B 탭의 aside 폭도 360 → 576 으로 같이 변했고, 접기도 두 탭이 함께 0 이 됐다.
 *
 * `origin` 은 쓴 탭의 메모리에만 있어 다른 탭에서는 언제나 `null` 이다 → B 가 "내 조작이 아니다"로
 * 보고 `chatWidth` 를 재시작해 저장값을 다시 적용했다. 창 식별자를 저장 payload 에 함께 남겨
 * **다른 창이 쓴 창 로컬 섹션 변경은 재시작하지 않는다.**
 */
describe('shouldRestartFeature — 다른 창이 쓴 변경 (FR-05 창별 레이아웃)', () => {
  const chatWidth = FEATURES.find((f) => f.id === 'chatWidth')!;
  const quality = FEATURES.find((f) => f.id === 'quality')!;

  it('창 로컬 섹션은 WINDOW_LOCAL_SECTIONS 한 곳에 모여 있다', () => {
    expect([...WINDOW_LOCAL_SECTIONS]).toEqual(['chatWidth']);
  });

  it('(a) 다른 창이 쓴 chatWidth 변경으로는 재시작하지 않는다', () => {
    expect(shouldRestartFeature(chatWidth, ['chatWidth'], null, true)).toBe(false);
    // 접기·배치도 같은 섹션이라 함께 막힌다.
    expect(shouldRestartFeature(chatWidth, ['chatWidth'], 'chatWidth', true)).toBe(false);
    // 어떤 기능도 다른 창의 chatWidth 변경으로는 재시작되지 않는다.
    const restarted = FEATURES.filter((f) =>
      shouldRestartFeature(f, ['chatWidth'], null, true),
    ).map((f) => f.id);
    expect(restarted).toEqual([]);
  });

  it('(b) 다른 창이 쓴 quality 변경은 그대로 재시작한다 (전역 설정 유지)', () => {
    expect(shouldRestartFeature(quality, ['quality'], null, true)).toBe(true);
    // 화질·볼륨·폰트·클러터 숨김은 전역이다.
    for (const [id, section] of [
      ['volume', 'volume'],
      ['chatFont', 'chatFont'],
      ['chatClutterHide', 'chatClutter'],
    ] as const) {
      const feature = FEATURES.find((f) => f.id === id)!;
      expect(shouldRestartFeature(feature, [section], null, true), id).toBe(true);
    }
  });

  it('(b-2) 전역 섹션과 창 로컬 섹션이 함께 바뀌면 전역 쪽만 재시작한다', () => {
    const changed: (keyof Settings)[] = ['chatWidth', 'quality'];
    expect(shouldRestartFeature(quality, changed, null, true)).toBe(true);
    expect(shouldRestartFeature(chatWidth, changed, null, true)).toBe(false);
  });

  it('(c) 같은 창이 쓴 변경은 기존 origin 규칙 그대로다', () => {
    // 같은 창 + 다른 기능(설정 패널)이 썼다 → 적용해야 한다.
    expect(shouldRestartFeature(chatWidth, ['chatWidth'], 'settingsPanel', false)).toBe(true);
    // 같은 창 + 자기가 썼다 → 자기 재시작 금지 (R1 회귀).
    expect(shouldRestartFeature(chatWidth, ['chatWidth'], 'chatWidth', false)).toBe(false);
    // 같은 창인데 작성 기능을 모른다(저장소 직접 심기·마이그레이션) → 종전대로 적용한다.
    expect(shouldRestartFeature(chatWidth, ['chatWidth'], null, false)).toBe(true);
    // 인자를 생략하면 같은 창으로 본다 — 기존 호출부 의미가 바뀌지 않는다.
    expect(shouldRestartFeature(chatWidth, ['chatWidth'], null)).toBe(true);
  });

  it('watches 를 생략한 기능도 다른 창의 창 로컬 변경만으로는 재시작하지 않는다', () => {
    expect(shouldRestartFeature({}, ['chatWidth'], null, true)).toBe(false);
    expect(shouldRestartFeature({}, ['chatWidth', 'quality'], null, true)).toBe(true);
  });
});
