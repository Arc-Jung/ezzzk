/**
 * chrome.storage.local 접근 레이어.
 * 모든 기능은 chrome.storage.onChanged 를 구독해 팝업 변경을 재로드 없이 반영한다 (FR-08/09).
 */

import {
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  SCHEMA_VERSION_KEY,
  STORAGE_KEY,
  WRITER_KEY,
  type Settings,
} from './constants/storage';
import { buildBuiltinPresets } from './features/optionPreset';
import { setDebug, warning } from './utils/log';

type Disposer = () => void;

/**
 * 이 창(탭/프레임)의 식별자. **모듈이 처음 평가될 때 1회** 만들어지고 그 뒤 바뀌지 않는다.
 * 콘텐츠 스크립트·팝업이 각자 자기 값을 갖는다.
 */
export const WINDOW_ID = ((): string => {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
})();

/**
 * 쓰기마다 증가한다. `WRITER_KEY` 값이 **항상 달라지게** 만들어, 같은 창이 연달아 써도
 * `onChanged` 의 changes 에서 이 키가 빠지지 않게 한다.
 */
let writeSequence = 0;

function nextWriterStamp(): { windowId: string; seq: number } {
  writeSequence += 1;
  return { windowId: WINDOW_ID, seq: writeSequence };
}

/** `WRITER_KEY` 의 새 값에서 창 식별자를 읽는다. 우리 형식이 아니면 `null`. */
function readWriterWindowId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.windowId === 'string' ? value.windowId : null;
}

/** 저장된 부분 설정을 기본값 위에 깊게 병합한다. 새 키가 추가돼도 안전하다. */
export function mergeSettings(stored: unknown): Settings {
  if (!isRecord(stored)) return structuredCloneSafe(DEFAULT_SETTINGS);
  const base = structuredCloneSafe(DEFAULT_SETTINGS) as Record<string, unknown>;

  for (const key of Object.keys(base)) {
    const incoming = stored[key];
    if (incoming === undefined) continue;
    const current = base[key];
    // 배열은 통째로 교체한다 — 프리셋·슬롯 목록은 병합하면 중복이 생긴다.
    if (Array.isArray(current) || Array.isArray(incoming)) {
      base[key] = incoming;
    } else if (isRecord(current) && isRecord(incoming)) {
      base[key] = { ...current, ...incoming };
    } else {
      base[key] = incoming;
    }
  }
  return base as Settings;
}

/**
 * 스키마 마이그레이션. 버전이 올라갈 때 여기에 단계별 변환을 추가한다.
 * 알 수 없는(미래) 버전은 기본값으로 되돌리지 않고 병합만 한다 — 사용자 설정을 날리지 않는다.
 */
export function migrate(stored: unknown, fromVersion: number): Settings {
  let value = stored;
  if (fromVersion < 1) {
    // v0 (스키마 버전 없이 저장된 초기 데이터) → v1: 구조 동일, 병합만 수행.
    value = isRecord(value) ? value : {};
  }
  return mergeSettings(value);
}

let cached: Settings | null = null;

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await chrome.storage.local.get([STORAGE_KEY, SCHEMA_VERSION_KEY]);
    const version = typeof raw[SCHEMA_VERSION_KEY] === 'number' ? raw[SCHEMA_VERSION_KEY] : 0;
    const settings = migrate(raw[STORAGE_KEY], version);
    if (version !== SCHEMA_VERSION) {
      await chrome.storage.local.set({
        [STORAGE_KEY]: settings,
        [SCHEMA_VERSION_KEY]: SCHEMA_VERSION,
      });
    }
    cached = settings;
    setDebug(settings.debug);
    return settings;
  } catch (e) {
    warning('failed to read settings, falling back to defaults', e);
    cached = structuredCloneSafe(DEFAULT_SETTINGS);
    return cached;
  }
}

/** 마지막으로 읽은 설정. 아직 로드 전이면 기본값. 동기 경로에서만 쓴다. */
export function getCachedSettings(): Settings {
  return cached ?? structuredCloneSafe(DEFAULT_SETTINGS);
}

/**
 * 직전에 **우리가 직접 쓴** 내용. 자기 자신이 쓴 변경으로 자기를 재시작하는 것을 막는 데 쓴다.
 *
 * 🔴 기능이 자기가 감시하는(`watches`) 섹션을 스스로 쓰면 자기 재시작이 일어난다:
 * - `chatPreset` 이 프리셋을 저장하면 재시작되며 **편집 중이던 상태가 사라진다**
 * - `chatWidth` 는 `+`/`-` 클릭마다 재시작되며 폭 조정자 참조 카운트를 순환시킨다
 * - `volume` 은 재시작이 기본값을 다시 적용해 사용자가 올린 볼륨을 되돌린다
 * 값이 실제로 바뀌므로 "변화 없음" 가드로는 막을 수 없다 → **쓴 주체를 기록해 그 기능만 건너뛴다.**
 */
type PendingWrite = { snapshot: string; origin: string };

/**
 * 아직 `onChanged` 로 돌아오지 않은 우리 쓰기들.
 *
 * 🔴 **슬롯 하나로는 부족하다**: 연속 쓰기(예: `chatWidth` 의 `+ + +`)가 겹치면 뒤 쓰기가 앞 쓰기를
 * 덮어써 앞 쓰기는 origin 을 못 찾고 그 기능이 재시작된다. 기능 간 교차(`chatWidth` 쓰기가
 * 대기 중인 `volume` 쓰기를 밀어냄)도 같다. → 소수의 대기 쓰기를 함께 들고 있는다.
 */
const pendingWrites: PendingWrite[] = [];
const MAX_PENDING_WRITES = 8;

function rememberWrite(snapshot: string, origin: string): void {
  pendingWrites.push({ snapshot, origin });
  if (pendingWrites.length > MAX_PENDING_WRITES) pendingWrites.shift();
}

/** 쓰기가 실패해 `onChanged` 가 오지 않을 때 대기 목록에서 지운다 (죽은 상태로 남지 않게). */
function forgetWrite(snapshot: string): void {
  const index = pendingWrites.findIndex((write) => write.snapshot === snapshot);
  if (index >= 0) pendingWrites.splice(index, 1);
}

export type WriteOptions = {
  /** 쓴 기능의 `Feature.id`. 넘기면 그 기능은 이 변경으로 재시작되지 않는다. */
  origin?: string;
};

/** 부분 갱신. "저장" 버튼 없이 즉시 저장한다 (FR-09). */
export async function saveSettings(
  patch: Partial<Settings>,
  options: WriteOptions = {},
): Promise<Settings> {
  const current = cached ?? (await loadSettings());
  const next = mergeSettings({ ...current, ...patch });
  cached = next;
  setDebug(next.debug);

  const snapshot = JSON.stringify(next);
  /**
   * ⚠️ `set` **전에** 기록한다. `onChanged` 가 `set` 의 프로미스보다 먼저 도착할 수 있어
   * 나중에 기록하면 경합이 생긴다. 실패 시에는 `catch` 에서 지운다.
   */
  if (options.origin !== undefined) rememberWrite(snapshot, options.origin);

  try {
    await chrome.storage.local.set({
      [STORAGE_KEY]: next,
      [SCHEMA_VERSION_KEY]: SCHEMA_VERSION,
      // 같은 `set` 으로 써야 `onChanged` 한 이벤트에 함께 실려 다른 탭도 작성자를 알 수 있다.
      [WRITER_KEY]: nextWriterStamp(),
    });
  } catch (e) {
    // 쓰기가 실패하면 `onChanged` 가 오지 않으므로 대기 항목이 영원히 남아
    // 한참 뒤의 다른 변경을 잘못 귀속시킬 수 있다 → 즉시 지운다.
    forgetWrite(snapshot);
    warning('failed to persist settings', e);
  }
  return next;
}

/** 특정 섹션만 갱신하는 편의 함수. */
export async function updateSection<K extends keyof Settings>(
  key: K,
  patch: Settings[K] extends object ? Partial<Settings[K]> : Settings[K],
  options: WriteOptions = {},
): Promise<Settings> {
  const current = cached ?? (await loadSettings());
  const currentValue: unknown = current[key];
  const incoming: unknown = patch;
  const nextValue =
    isRecord(currentValue) && isRecord(incoming) ? { ...currentValue, ...incoming } : incoming;
  return saveSettings({ [key]: nextValue } as Partial<Settings>, options);
}

/**
 * 전체 초기화 (설정 패널의 `모두 초기화`).
 *
 * 🔴 `DEFAULT_SETTINGS.optionPresets` 는 `[]` 라서 그대로 쓰면 **기본 제공 프리셋 3종이
 * 영구히 사라진다** — 시딩은 `onInstalled` 에서만 하고 다시 호출되지 않기 때문이다.
 * 초기화는 "설치 직후 상태"로 돌아가는 것이어야 하므로 프리셋을 다시 심는다 (US-006).
 *
 * `WRITER_KEY` 를 남기지 않는다 — 전체 초기화는 "모든 창을 설치 직후로" 되돌리는 전역 조작이라
 * 창 로컬 섹션(`WINDOW_LOCAL_SECTIONS`)도 열린 모든 탭에서 함께 초기화되는 것이 맞다.
 */
export async function resetAllSettings(): Promise<Settings> {
  cached = {
    ...structuredCloneSafe(DEFAULT_SETTINGS),
    optionPresets: buildBuiltinPresets(Date.now()),
  };
  await chrome.storage.local.set({
    [STORAGE_KEY]: cached,
    [SCHEMA_VERSION_KEY]: SCHEMA_VERSION,
  });
  return cached;
}

/** 탭별 초기화 — 해당 섹션만 기본값으로 되돌린다. */
export async function resetSection<K extends keyof Settings>(key: K): Promise<Settings> {
  return saveSettings({ [key]: structuredCloneSafe(DEFAULT_SETTINGS)[key] } as Partial<Settings>);
}

/**
 * 설정 변경 구독. 열린 모든 치지직 탭이 재로드 없이 따라간다.
 * 콜백은 즉시 1회 호출되지 않는다 — 초기값은 loadSettings 로 받는다.
 */
export type SettingsChangeMeta = {
  /**
   * 이 변경을 만든 기능의 id. **이 프레임에서 우리가 직접 쓴 경우에만** 채워진다.
   * 다른 탭에서 온 변경이면 `null` 이다 — 그때는 모든 관련 기능이 반응해야 한다.
   */
  origin: string | null;
  /**
   * **다른 창(탭)이 쓴 변경인가.** `WRITER_KEY` 에 실려 온 창 식별자가 이 창과 다를 때만 `true` 다.
   *
   * 우리 코드 밖에서 쓴 변경(검증 하네스의 직접 `set`, 마이그레이션 등)은 작성자를 알 수 없으므로
   * `false` — 즉 **기존과 같은 전역 변경**으로 취급한다. 알 수 없는 쓰기를 "다른 창"으로 보면
   * 저장소를 직접 심는 경로가 조용히 무시되어 되돌리기·프리셋 적용이 죽는다.
   */
  foreignWindow: boolean;
};

type SettingsSubscriber = (settings: Settings, meta: SettingsChangeMeta) => void;

const subscribers = new Set<SettingsSubscriber>();
let chromeListener:
  ((changes: Record<string, chrome.storage.StorageChange>, area: string) => void) | null = null;

/**
 * 🔴 **chrome 리스너는 프레임당 딱 하나만 붙인다.**
 *
 * 구독자마다 리스너를 따로 붙이면 `origin` 판정이 **먼저 실행된 리스너에게 소비되어** 나머지는
 * `origin: null` 을 받는다. 실제로 그렇게 깨졌다: `multiView` 가 자기 구독(R2 수정)을
 * `content.tsx` 보다 **먼저** 등록하기 때문에 `content.tsx` 는 항상 `null` 을 봤고,
 * 그 결과 `volume`·`chatWidth`·`chatPreset` 이 **자기 쓰기로 자기 재시작을 계속했다**(R1 무효화).
 * → 여기서 origin 을 **한 번만** 해석하고 모든 구독자에게 **같은 meta** 를 전달한다.
 * 리스너 실행 순서에 의존하지 않는다. `mergeSettings`·`JSON.stringify` 비용도 1회로 줄어든다.
 */
function ensureChromeListener(): void {
  if (chromeListener !== null) return;

  chromeListener = (changes, areaName) => {
    if (areaName !== 'local') return;
    const change = changes[STORAGE_KEY];
    if (!change) return;

    const next = mergeSettings(change.newValue);
    cached = next;
    setDebug(next.debug);

    // origin 해석은 이벤트당 1회. 대기 목록에서 일치하는 쓰기를 찾아 소비한다.
    let origin: string | null = null;
    const index = pendingWrites.findIndex((write) => write.snapshot === JSON.stringify(next));
    if (index >= 0) {
      origin = pendingWrites[index]?.origin ?? null;
      pendingWrites.splice(index, 1);
    }

    /**
     * 창 판정도 이벤트당 1회. origin 과 같은 이유로 **여기서 한 번만** 해석해 모든 구독자에게
     * 같은 meta 를 준다 — 구독자마다 `changes` 를 따로 뒤지면 리스너 실행 순서에 의존하게 된다.
     */
    const writerWindowId = readWriterWindowId(changes[WRITER_KEY]?.newValue);
    const foreignWindow = writerWindowId !== null && writerWindowId !== WINDOW_ID;

    const meta: SettingsChangeMeta = { origin, foreignWindow };
    /**
     * 사본을 순회한다 — 순회 중 추가/삭제로 인한 변형을 피하고, 팬아웃 도중 새로 등록된
     * 구독자가 자기보다 앞선 이벤트를 받지 않게 한다.
     *
     * ⚠️ 사본이므로 **팬아웃 중에 해지된 구독자도 호출될 수 있다.** 지금은 세 구독자가 각자
     * (`alive` 플래그, `stage === null` 체크) 안전하게 처리하지만, 그건 구독자 쪽 규약에
     * 의존하는 것이다. 실제로 R2 가 구독을 추가하자마자 origin 메커니즘이 깨졌던 만큼
     * **다음 구독자를 위해 여기서 불변식으로 보장한다.**
     */
    for (const subscriber of [...subscribers]) {
      if (!subscribers.has(subscriber)) continue;
      // 구독자 하나가 던져도 나머지가 알림을 받아야 한다 (NFR-05).
      try {
        subscriber(next, meta);
      } catch (e) {
        warning('a settings subscriber threw and was isolated', e);
      }
    }
  };
  chrome.storage.onChanged.addListener(chromeListener);
}

export function onSettingsChanged(callback: SettingsSubscriber): Disposer {
  subscribers.add(callback);
  ensureChromeListener();
  return () => {
    subscribers.delete(callback);
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
