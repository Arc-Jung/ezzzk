/**
 * 아이콘 글리프 회귀 (계획: `docs/chzzk-tone-ui-plan.md` P3).
 *
 * 문자·이모지를 아이콘으로 쓰면 폰트에 따라 크기·정렬·색이 제각각이라 치지직 톤이 깨진다.
 * P3 에서 전부 인라인 SVG 로 치환했고, 이 테스트가 되돌아오는 것을 막는다.
 *
 * 🔴 **왜 grep 이 아니라 테스트인가** — 2026-08-21 에 "치환 완료"로 오판한 실제 원인 두 가지가
 * 전부 grep 의 한계였다.
 * 1. JSX 텍스트 노드는 `>` 와 `<` 가 다른 줄에 있다. `>✕<` 같은 한 줄 패턴으로는 안 잡힌다
 *    (`Popup.tsx` 의 삭제 버튼이 이렇게 살아남았다).
 * 2. `chatUserFilter.ts` 는 소스에 **생 NUL 바이트**가 들어 있어 grep 이 바이너리로 보고
 *    파일을 통째로 건너뛰었다 (지금은 `\u0000` 이스케이프로 고쳤다).
 *
 * 소스는 `node:fs` 가 아니라 Vite 의 `?raw` 로 읽는다 — 이 저장소에는 `@types/node` 가 없고,
 * 라이선스·CSS 대조 테스트가 이미 같은 방식을 쓴다.
 */
import { describe, expect, it } from 'vitest';

/** `src` 전체의 원문. 키는 이 파일 기준 상대 경로(`../features/chatWidth.ts`). */
const RAW_SOURCES = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * 아이콘으로만 쓰이는 글리프. 어디에 나오든 위반이다.
 * `−`·`+`·`×` 는 뺐다 — `−12%`·`1920×1080` 처럼 **문구·수식**으로 정당하게 쓰인다.
 */
const ICON_ONLY_GLYPHS = /[＋✕✖↔⟩⟨▦▤⚙🔴⚫🎯⛶💬➕➖]/u;

/**
 * 줄 전체가 이 글자 하나뿐이면 아이콘이다. JSX 텍스트 노드(`>` 다음 줄에 홀로 놓인 글자)와
 * `textContent = '−'` 형태를 잡는다. 문장 속 `−`·`×` 는 앞뒤에 다른 글자가 있어 걸리지 않는다.
 */
const SOLO_GLYPHS = new Set(['−', '+', '×', "'−'", "'+'", '"−"', '"+"']);

/** 테스트 파일 자신은 제외한다 — 회귀 근거로 글리프를 문자열에 적어 두기 때문이다. */
const PRODUCT_SOURCES = Object.entries(RAW_SOURCES).filter(([path]) => !path.includes('.test.'));

/** 주석(`//`, 블록 주석, JSDoc `*`)을 지운 줄 목록. 줄 번호는 보존한다. */
function strippedLines(source: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of source.split('\n')) {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end === -1) {
        out.push('');
        continue;
      }
      line = line.slice(end + 2);
      inBlock = false;
    }
    const start = line.indexOf('/*');
    if (start !== -1) {
      const end = line.indexOf('*/', start);
      inBlock = end === -1;
      line = line.slice(0, start) + (inBlock ? '' : line.slice(end + 2));
    }
    if (/^\s*(\/\/|\*)/.test(line)) {
      out.push('');
      continue;
    }
    out.push(line.replace(/\/\/.*$/, ''));
  }
  return out;
}

/** 규칙에 걸린 `경로:줄: 내용` 목록. */
function scan(match: (line: string) => boolean): string[] {
  const hits: string[] = [];
  for (const [path, source] of PRODUCT_SOURCES) {
    strippedLines(source).forEach((line, index) => {
      if (match(line)) hits.push(`${path}:${index + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

describe('아이콘 글리프 — 문자·이모지 아이콘은 0건이어야 한다', () => {
  it('제품 소스를 스캔할 파일이 실제로 있다 (스캐너가 조용히 0개를 보는 것 방지)', () => {
    expect(PRODUCT_SOURCES.length).toBeGreaterThan(30);
  });

  it('아이콘 전용 글리프가 코드에 남아 있지 않다', () => {
    expect(scan((line) => ICON_ONLY_GLYPHS.test(line))).toEqual([]);
  });

  it('줄 전체가 `−`·`+`·`×` 하나뿐인 JSX 텍스트 노드·문자열이 없다', () => {
    expect(scan((line) => SOLO_GLYPHS.has(line.trim()))).toEqual([]);
  });

  /**
   * 🔴 생 NUL 바이트가 들어가면 grep·에디터·diff 가 그 파일을 바이너리로 취급해 리뷰에서
   * 통째로 사라진다. 실제로 `chatUserFilter.ts` 가 그래서 아이콘 감사를 빠져나갔다.
   */
  it('소스에 제어 문자(NUL 등)가 섞여 있지 않다', () => {
    const hits = PRODUCT_SOURCES.filter(([, source]) =>
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(source),
    ).map(([path]) => path);
    expect(hits).toEqual([]);
  });
});
