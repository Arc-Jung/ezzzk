import { describe, expect, it } from 'vitest';
import { disposeAll } from './observe';

/**
 * 🔴 회귀 고정 — 정리 단계를 그냥 나열하면 앞 단계가 던질 때 뒤 단계가 실행되지 않는다.
 * 실제 위험: `chatWidth` 의 disposer 에서 `stopArbiter()` 가 4번째 문장인데 앞이 던지면
 * 폭 조정자 참조 카운트가 영구 누수되고, 마지막 해제가 오지 않아 주입 CSS 가 새로고침까지 남는다.
 */
describe('disposeAll — 정리 단계 격리', () => {
  it('모든 단계를 순서대로 실행한다', () => {
    const order: number[] = [];
    disposeAll(
      () => order.push(1),
      () => order.push(2),
      () => order.push(3),
    );
    expect(order).toEqual([1, 2, 3]);
  });

  it('앞 단계가 던져도 뒤 단계가 모두 실행된다', () => {
    const done: string[] = [];
    disposeAll(
      () => {
        throw new Error('stopViewport failed');
      },
      () => done.push('release'),
      () => done.push('stopArbiter'),
    );
    // 참조 카운트를 되돌리는 단계가 반드시 돌아야 한다.
    expect(done).toEqual(['release', 'stopArbiter']);
  });

  it('여러 단계가 던져도 나머지가 실행된다', () => {
    const done: string[] = [];
    disposeAll(
      () => {
        throw new Error('a');
      },
      () => done.push('b'),
      () => {
        throw new Error('c');
      },
      () => done.push('stopArbiter'),
    );
    expect(done).toEqual(['b', 'stopArbiter']);
  });

  it('undefined 단계는 건너뛴다 (옵셔널 disposer)', () => {
    const done: string[] = [];
    expect(() => disposeAll(undefined, () => done.push('x'), undefined)).not.toThrow();
    expect(done).toEqual(['x']);
  });

  it('스스로는 절대 던지지 않는다', () => {
    expect(() =>
      disposeAll(() => {
        throw new Error('boom');
      }),
    ).not.toThrow();
  });
});
