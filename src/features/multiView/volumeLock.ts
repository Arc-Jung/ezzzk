/** 슬롯의 자동 음량 동안 수동 설정을 보관한다. 새 프레임에서도 같은 방송 설정을 복원한다. */
import { existingGraph } from '../audioPipeline';
export type ManualVolume = { percent: number; muted: boolean };
type Adapter = { read: () => ManualVolume; apply: (value: ManualVolume) => void };
export function createVolumeLock(
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  key = 'cm-auto-volume',
) {
  let locked = false;
  let snapshot: ManualVolume | null = null;
  let adapter: Adapter | null = null;
  const read = (): ManualVolume | null => {
    try {
      const value = JSON.parse(storage?.getItem(key) ?? 'null');
      return value &&
        Number.isFinite(value.percent) &&
        value.percent >= 0 &&
        value.percent <= 200 &&
        typeof value.muted === 'boolean'
        ? value
        : null;
    } catch {
      return null;
    }
  };
  const save = () => {
    try {
      if (snapshot) storage?.setItem(key, JSON.stringify(snapshot));
      else storage?.removeItem(key);
    } catch {
      /* 저장이 막혀도 현재 프레임의 복원은 유지한다. */
    }
  };
  return {
    isLocked: () => locked,
    setEnabled(next: boolean) {
      if (next === locked && (next || !(snapshot ?? read()))) return;
      if (next) {
        snapshot = snapshot ?? read() ?? adapter?.read() ?? null;
        locked = true;
        save();
        adapter?.apply({ percent: 100, muted: false });
      } else {
        locked = false;
        const previous = snapshot ?? read();
        snapshot = previous;
        if (previous && adapter) {
          adapter.apply(previous);
          snapshot = null;
        }
        save();
      }
    },
    register(next: Adapter) {
      adapter = next;
      if (locked) {
        snapshot ??= read() ?? next.read();
        save();
        next.apply({ percent: 100, muted: false });
      } else if (snapshot) {
        next.apply(snapshot);
        snapshot = null;
        save();
      }
      return () => {
        if (adapter === next) adapter = null;
      };
    },
  };
}
let storage: Storage | undefined;
try {
  storage = sessionStorage;
} catch {
  /* 제한된 문맥에서는 메모리만 사용한다. */
}
export const autoVolumeLock = createVolumeLock(storage, `cm-auto-volume:${location.pathname}`);
/** 방송·광고 영상이 교체되거나 플레이어가 볼륨을 덮어써도 수동 배율은 100%로 유지한다. */
export function enforceAutoVolume(video: HTMLVideoElement): void {
  if (!autoVolumeLock.isLocked()) return;
  if (video.volume !== 1) video.volume = 1;
  if (video.muted) video.muted = false;
  const graph = existingGraph(video);
  if (graph && graph.gain.gain.value !== 1)
    graph.gain.gain.setValueAtTime(1, graph.context.currentTime);
}
