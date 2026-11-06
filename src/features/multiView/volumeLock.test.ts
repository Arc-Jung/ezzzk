import { describe, it, expect } from 'vitest';
import { createVolumeLock } from './volumeLock';
const memory = () => {
  const values = new Map<string, string>();
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
};
describe('자동 음량 수동 설정 복원', () => {
  it('100%로 잠갔다가 증폭·음소거까지 이전 설정을 복원한다', () => {
    const storage = memory();
    const lock = createVolumeLock(storage);
    let value = { percent: 150, muted: true };
    lock.register({
      read: () => value,
      apply: (next) => {
        value = next;
      },
    });
    lock.setEnabled(true);
    expect(value).toEqual({ percent: 100, muted: false });
    lock.setEnabled(true);
    lock.setEnabled(false);
    expect(value).toEqual({ percent: 150, muted: true });
    expect(storage.getItem('cm-auto-volume')).toBeNull();
  });
  it('프레임 재접속·볼륨 기능 재생성으로 100%가 복원값을 덮어쓰지 않는다', () => {
    const storage = memory();
    const first = createVolumeLock(storage);
    let value = { percent: 37, muted: false };
    first.register({
      read: () => value,
      apply: (next) => {
        value = next;
      },
    });
    first.setEnabled(true);
    const reloaded = createVolumeLock(storage);
    reloaded.register({
      read: () => value,
      apply: (next) => {
        value = next;
      },
    });
    reloaded.setEnabled(true);
    reloaded.register({
      read: () => value,
      apply: (next) => {
        value = next;
      },
    });
    reloaded.setEnabled(false);
    expect(value.percent).toBe(37);
  });
  it('꺼진 상태로 재접속해도 남아 있는 원래 볼륨을 복원한다', () => {
    const storage = memory();
    storage.setItem('cm-auto-volume', JSON.stringify({ percent: 0, muted: true }));
    const lock = createVolumeLock(storage);
    let value = { percent: 100, muted: false };
    lock.register({
      read: () => value,
      apply: (next) => {
        value = next;
      },
    });
    lock.setEnabled(false);
    expect(value).toEqual({ percent: 0, muted: true });
  });
});

it('볼륨 기능이 재시작하는 사이 꺼져도 복원을 보류했다가 적용한다', () => {
  const lock = createVolumeLock();
  let value = { percent: 60, muted: false };
  const adapter = {
    read: () => value,
    apply: (next: typeof value) => {
      value = next;
    },
  };
  const unregister = lock.register(adapter);
  lock.setEnabled(true);
  unregister();
  lock.setEnabled(false);
  lock.register(adapter);
  expect(value).toEqual({ percent: 60, muted: false });
});
