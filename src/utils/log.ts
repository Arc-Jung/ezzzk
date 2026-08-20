/**
 * 로그 레벨은 info / warning / error 세 가지만 쓴다 (NFR-08).
 * 메시지는 영어로 작성한다. 기본은 조용히 동작하고 info 는 디버그 모드에서만 출력한다.
 */

const PREFIX = '[ezzzk]';

let debugEnabled = false;

export function setDebug(enabled: boolean): void {
  debugEnabled = enabled;
}

export function isDebug(): boolean {
  return debugEnabled;
}

/** 정상 흐름·요청/응답 추적. 디버그 모드에서만 출력한다. */
export function info(message: string, ...rest: unknown[]): void {
  if (!debugEnabled) return;
  console.info(`${PREFIX} ${message}`, ...rest);
}

/** 복구 가능한 이상 상황·재시도·폴백 사용. 항상 출력한다. */
export function warning(message: string, ...rest: unknown[]): void {
  console.warn(`${PREFIX} ${message}`, ...rest);
}

/** 처리 실패·예외·필수 리소스 누락. 항상 출력한다. */
export function error(message: string, ...rest: unknown[]): void {
  console.error(`${PREFIX} ${message}`, ...rest);
}

/**
 * NFR-05 실패 안전 — 어떤 기능의 예외도 페이지 동작을 깨뜨리지 않는다.
 * 모든 기능 진입점을 이걸로 감싼다.
 */
export function guard<T>(label: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (e) {
    error(`feature "${label}" threw and was isolated`, e);
    return undefined;
  }
}

export async function guardAsync<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    error(`feature "${label}" threw and was isolated`, e);
    return undefined;
  }
}
