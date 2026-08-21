import { afterEach, describe, expect, it } from 'vitest';
import {
  FALLBACK_TEXT_LIMIT,
  addPreset,
  canSendNow,
  deriveLabel,
  removePreset,
  reorderPresets,
  resolveInputArea,
  resolveToolsSlot,
  sortByOrder,
  updatePreset,
  validatePresetText,
} from './chatPreset';
import { LIMITS, type ChatPreset } from '../constants/storage';

/** 실측 `textLimitCount` (2026-08-11) — 하드코딩 상한이 아니라 클라이언트에서 읽는 값이다. */
const MEASURED_TEXT_LIMIT = 400;

function preset(id: string, text: string, order: number): ChatPreset {
  return { id, label: text, text, order };
}

describe('deriveLabel', () => {
  it('짧은 문구는 그대로 쓴다', () => {
    expect(deriveLabel('안녕하세요')).toBe('안녕하세요');
  });

  it('긴 문구는 앞부분만 남기고 줄임표를 붙인다', () => {
    expect(deriveLabel('가나다라마바사아자차카타파하')).toBe('가나다라마바사아자차카타…');
  });

  it('공백·개행을 정규화한다', () => {
    expect(deriveLabel('  안녕\n하세요  ')).toBe('안녕 하세요');
  });

  it('이모티콘 코드도 그대로 남긴다', () => {
    expect(deriveLabel('{:dccon_1:}')).toBe('{:dccon_1:}');
  });
});

describe('validatePresetText', () => {
  it('실측 상한 400자까지 허용한다', () => {
    expect(validatePresetText('가'.repeat(400), MEASURED_TEXT_LIMIT).ok).toBe(true);
  });

  it('상한을 넘으면 거부하고 이유를 준다', () => {
    const result = validatePresetText('가'.repeat(401), MEASURED_TEXT_LIMIT);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('401/400');
  });

  it('빈 문구·공백만 있는 문구를 거부한다', () => {
    expect(validatePresetText('', MEASURED_TEXT_LIMIT).ok).toBe(false);
    expect(validatePresetText('   \n ', MEASURED_TEXT_LIMIT).ok).toBe(false);
  });

  it('상한을 못 읽었으면(0) 폴백 400 을 쓴다', () => {
    expect(validatePresetText('가'.repeat(FALLBACK_TEXT_LIMIT), 0).ok).toBe(true);
    expect(validatePresetText('가'.repeat(FALLBACK_TEXT_LIMIT + 1), 0).ok).toBe(false);
  });
});

describe('canSendNow', () => {
  it('첫 전송은 항상 허용한다', () => {
    expect(canSendNow(0, 1_000, LIMITS.chatSendIntervalMs)).toBe(true);
  });

  it('최소 간격 미만이면 막는다', () => {
    expect(canSendNow(1_000, 1_999, LIMITS.chatSendIntervalMs)).toBe(false);
  });

  it('최소 간격 경계는 허용한다', () => {
    expect(canSendNow(1_000, 2_000, LIMITS.chatSendIntervalMs)).toBe(true);
  });
});

describe('addPreset', () => {
  it('문구를 추가하고 order 를 이어 붙인다', () => {
    const first = addPreset([], '안녕하세요');
    const second = addPreset(first.presets, '감사합니다');
    expect(second.presets.map((p) => p.order)).toEqual([0, 1]);
    expect(second.presets[1]?.label).toBe('감사합니다');
    expect(second.error).toBeUndefined();
  });

  it('문구 원문을 trim 하지 않는다 (이모티콘·공백 보존)', () => {
    const { presets } = addPreset([], ' {:emoji:} 안녕 ');
    expect(presets[0]?.text).toBe(' {:emoji:} 안녕 ');
  });

  it('상한 50개를 넘기면 안내하고 목록을 유지한다', () => {
    const full = Array.from({ length: LIMITS.chatPresets }, (_, i) =>
      preset(`p${i}`, `문구${i}`, i),
    );
    const result = addPreset(full, '하나 더');
    expect(result.presets).toHaveLength(LIMITS.chatPresets);
    expect(result.error).toContain('50개');
  });

  it('빈 문구는 거부한다', () => {
    expect(addPreset([], '  ').error).toBeTruthy();
  });
});

describe('reorderPresets', () => {
  const base = [preset('a', 'A', 0), preset('b', 'B', 1), preset('c', 'C', 2)];

  it('위로 이동', () => {
    expect(reorderPresets(base, 'b', 'up').map((p) => p.id)).toEqual(['b', 'a', 'c']);
  });

  it('아래로 이동', () => {
    expect(reorderPresets(base, 'b', 'down').map((p) => p.id)).toEqual(['a', 'c', 'b']);
  });

  it('맨 끝에서 더 이동하면 그대로 둔다', () => {
    expect(reorderPresets(base, 'a', 'up').map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(reorderPresets(base, 'c', 'down').map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('없는 id 는 무시한다', () => {
    expect(reorderPresets(base, 'zzz', 'up').map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('이동 후 order 를 0부터 다시 매긴다', () => {
    const shuffled = [preset('a', 'A', 5), preset('b', 'B', 9)];
    expect(reorderPresets(shuffled, 'b', 'up').map((p) => p.order)).toEqual([0, 1]);
  });
});

describe('updatePreset / removePreset', () => {
  const base = [preset('a', 'A', 0), preset('b', 'B', 1)];

  it('본문만 바꾸면 라벨을 다시 파생한다', () => {
    const next = updatePreset(base, 'a', { text: '새 본문입니다' });
    expect(next[0]?.text).toBe('새 본문입니다');
    expect(next[0]?.label).toBe('새 본문입니다');
  });

  it('라벨을 직접 주면 그것을 쓴다', () => {
    const next = updatePreset(base, 'a', { label: '인사', text: '안녕하세요 반갑습니다' });
    expect(next[0]?.label).toBe('인사');
  });

  it('삭제 후 order 를 다시 매긴다', () => {
    const next = removePreset([...base, preset('c', 'C', 2)], 'a');
    expect(next.map((p) => p.id)).toEqual(['b', 'c']);
    expect(next.map((p) => p.order)).toEqual([0, 1]);
  });
});

/**
 * 삽입 위치 판정 (2026-08-15).
 * 마크업은 실측 픽스처 `scripts/fixtures/live-page.html` 의 입력 영역을 그대로 옮긴 것이다
 * (해시 접미사 포함 — 셀렉터가 해시에 의존하지 않는지도 함께 본다).
 *
 * 🔴 실측 정정 (2026-08-21, 실사이트 비로그인 mobile-portrait·laptop13): 이모티콘 버튼은
 * `_donation_`/`_action_` 안이 **아니라** 입력창(textarea)의 형제로 별도 입력 컨테이너에
 * 있고, `aria-label` 이 없다(blind 텍스트 `이모티콘`만 있다). `_action_` 안의 버튼 2개는
 * aria-label·텍스트가 둘 다 없는 후원 관련 버튼이다. 근거는 `etc/probe/chat-tools-row.json`.
 */
function mountChatArea(
  toolsMarkup: string,
  opts: { withEmoticonButton?: boolean } = {},
): HTMLElement {
  const emoticon = opts.withEmoticonButton
    ? '<button type="button" aria-haspopup="true"><span class="blind">이모티콘</span></button>'
    : '';
  document.body.innerHTML = `
    <aside id="aside-chatting">
      <div class="_area_b8csn_49">
        <div class="_container_1k5b6_2">
          <textarea class="_input_1k5b6_92"></textarea>
          ${emoticon}
        </div>
        ${toolsMarkup}
      </div>
    </aside>`;
  return document.body.querySelector('#aside-chatting') as HTMLElement;
}

const TOOLS_ROW = `
  <div class="_tools_1k5b6_125">
    <div class="_donation_1k5b6_132">
      <button type="button" class="_donation_text_1k5b6_137">후원하기</button>
      <div class="_action_1k5b6_140">
        <button type="button" aria-haspopup="true"></button>
        <button type="button" aria-haspopup="true"></button>
      </div>
    </div>
    <button type="button" class="_send_button_1k5b6_176">채팅</button>
  </div>`;

describe('resolveToolsSlot', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('도구 행이 있으면 후원 블록 앞을 자리로 고른다', () => {
    mountChatArea(TOOLS_ROW);
    const slot = resolveToolsSlot(document);
    expect(slot).not.toBeNull();
    expect(slot?.parent.className).toContain('_tools_');
    expect(slot?.before?.className).toBe('_donation_1k5b6_132');
  });

  it('고른 자리에 넣으면 후원하기 **왼쪽**, 채팅 버튼 왼쪽에 온다', () => {
    mountChatArea(TOOLS_ROW);
    const slot = resolveToolsSlot(document);
    const ours = document.createElement('div');
    ours.className = 'cm-tools-slot';
    slot?.parent.insertBefore(ours, slot.before);

    const order = Array.from(slot?.parent.children ?? []).map((el) => el.className);
    expect(order[0]).toBe('cm-tools-slot');
    expect(order[1]).toContain('_donation_');
    expect(order[2]).toContain('_send_button_');
  });

  it('바깥 후원 블록을 고른다 — 내부 `_donation_text_` 버튼이 아니다', () => {
    mountChatArea(TOOLS_ROW);
    expect(resolveToolsSlot(document)?.before?.tagName).toBe('DIV');
  });

  it('도구 행이 없으면 null 을 돌려 폴백하게 한다', () => {
    mountChatArea('');
    expect(resolveToolsSlot(document)).toBeNull();
  });

  it('도구 행은 있는데 후원 블록이 없으면 null 이다', () => {
    mountChatArea(
      '<div class="_tools_1k5b6_125"><button class="_send_button_x">채팅</button></div>',
    );
    expect(resolveToolsSlot(document)).toBeNull();
  });

  it('입력창이 없으면(리렌더 중) null 이다', () => {
    document.body.innerHTML = `<aside id="aside-chatting">${TOOLS_ROW}</aside>`;
    expect(resolveToolsSlot(document)).toBeNull();
  });

  /**
   * 🔴 실측 계층 (2026-08-11 `docs/frontend-dump/chzzk-dom-25-chat-clutter.json`):
   * `_area_b8csn_49 > _container_1k5b6_2 > textarea` 이고 도구 행은 그 **형제**다.
   * `input.parentElement` 만 보면 실사이트에서 도구 행을 영원히 못 찾는다.
   */
  it('입력창이 한 겹 더 들어가 있어도(실측 구조) 도구 행을 찾는다', () => {
    document.body.innerHTML = `
      <aside id="aside-chatting">
        <div class="_area_b8csn_49">
          <div class="_container_1k5b6_2"><textarea class="_input_1k5b6_92"></textarea></div>
          ${TOOLS_ROW}
        </div>
      </aside>`;
    const slot = resolveToolsSlot(document);
    expect(slot?.parent.className).toContain('_tools_');
    expect(slot?.before?.className).toBe('_donation_1k5b6_132');
  });

  it('입력 영역은 입력창의 부모가 아니라 도구 행을 품은 조상이다', () => {
    document.body.innerHTML = `
      <aside id="aside-chatting">
        <div class="_area_b8csn_49">
          <div class="_container_1k5b6_2"><textarea class="_input_1k5b6_92"></textarea></div>
          ${TOOLS_ROW}
        </div>
      </aside>`;
    const input = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(resolveInputArea(input)?.className).toBe('_area_b8csn_49');
  });

  it('채팅 aside 밖의 비슷한 마크업은 잡지 않는다', () => {
    document.body.innerHTML = `
      <div class="_area_x"><textarea class="_input_x"></textarea>${TOOLS_ROW}</div>`;
    expect(resolveToolsSlot(document)).toBeNull();
  });

  /**
   * 🔴 실측 정정 (2026-08-21): 이모티콘 버튼은 도구 행(`_tools_`) 안이 아니라 입력
   * 컨테이너(textarea 형제) 안에 있다. 여기 있어도 자리 선택은 여전히 `_donation_` 앞이어야
   * 한다 — 이모티콘을 도구 행 안에서 찾으려 들면 안 된다는 회귀 방지 테스트다.
   * (근거: `etc/probe/chat-tools-row.json`, 입력 컨테이너 여유폭 26px < 최소 터치 타겟)
   */
  it('이모티콘 버튼이 입력 컨테이너에 있어도(도구 행 밖) 자리 선택에 영향을 주지 않는다', () => {
    mountChatArea(TOOLS_ROW, { withEmoticonButton: true });
    const emoticon = document.body.querySelector('[aria-haspopup="true"] .blind');
    expect(emoticon?.textContent).toBe('이모티콘');
    expect(document.body.querySelector('.blind')?.closest('[class*="_tools_"]')).toBeNull();

    const slot = resolveToolsSlot(document);
    expect(slot?.parent.className).toContain('_tools_');
    expect(slot?.before?.className).toBe('_donation_1k5b6_132');
  });

  it('이모티콘 버튼이 없을 때도 동일하게 `_donation_` 앞으로 폴백한다', () => {
    mountChatArea(TOOLS_ROW, { withEmoticonButton: false });
    const slot = resolveToolsSlot(document);
    expect(slot?.before?.className).toBe('_donation_1k5b6_132');
  });

  it('도구 행을 못 찾으면(치지직 구조 변경 등) 폴백 대상이 없다는 신호로 null 이다', () => {
    mountChatArea('', { withEmoticonButton: true });
    expect(resolveToolsSlot(document)).toBeNull();
  });

  it('고른 자리에 aria-label 있는 버튼을 넣어도 라벨이 그대로 유지된다', () => {
    mountChatArea(TOOLS_ROW);
    const slot = resolveToolsSlot(document);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = '문구';
    toggle.setAttribute('aria-label', '채팅 문구 도구 펼치기');
    slot?.parent.insertBefore(toggle, slot.before);

    expect(toggle.getAttribute('aria-label')).toBe('채팅 문구 도구 펼치기');
    expect(toggle.nextElementSibling?.className).toBe('_donation_1k5b6_132');
  });
});

describe('sortByOrder', () => {
  it('order 오름차순으로 정렬하고 원본을 바꾸지 않는다', () => {
    const input = [preset('b', 'B', 2), preset('a', 'A', 1)];
    expect(sortByOrder(input).map((p) => p.id)).toEqual(['a', 'b']);
    expect(input[0]?.id).toBe('b');
  });
});

describe("resolveToolsSlot 'after-donation' — 문구 버튼은 후원하기 오른쪽이다", () => {
  it('후원 묶음 바로 뒤를 고른다 (요청 2026-08-21)', () => {
    mountChatArea(TOOLS_ROW);
    const slot = resolveToolsSlot(document, 'after-donation');

    expect(slot).not.toBeNull();
    expect(slot?.parent.className).toContain('_tools_');
    // 후원 묶음의 다음 형제 = 전송 버튼. 그 앞에 끼우면 후원하기 오른쪽이 된다.
    expect(slot?.before?.className).toContain('_send_button_');
  });

  it("🔴 채팅 폭 컨트롤('right')과 같은 틈을 쓰되 서로를 밀어내지 않는다", () => {
    mountChatArea(TOOLS_ROW);
    const preset = resolveToolsSlot(document, 'after-donation');
    const width = resolveToolsSlot(document, 'right');

    // 둘 다 같은 부모(도구 행)에 붙지만 기준점이 달라 순서가 정해진다.
    expect(preset?.parent).toBe(width?.parent);
    expect(preset?.before).toBe(width?.before);
  });

  it('후원 묶음이 마지막이면 맨 뒤에 붙인다 (before 가 null)', () => {
    mountChatArea('<div class="_tools_1k5b6_1"><div class="_donation_1k5b6_132"></div></div>');
    const slot = resolveToolsSlot(document, 'after-donation');

    expect(slot).not.toBeNull();
    expect(slot?.before).toBeNull();
  });

  it('후원 묶음이 없으면 null — 예외를 던지지 않는다', () => {
    mountChatArea('<div class="_tools_1k5b6_1"></div>');
    expect(resolveToolsSlot(document, 'after-donation')).toBeNull();
  });
});
