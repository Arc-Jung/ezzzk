/**
 * FR-14 멀티뷰 BETA 뱃지 회귀 (2026-08-16).
 *
 * 멀티뷰가 아직 불안정하다는 것을 **세 지점**에서 알린다:
 *   ① 컨트롤바 멀티 버튼(`#cm-multiview-button`) ② 구성 시트 제목 ③ 스테이지 조작 바.
 *
 * 이 테스트가 지키는 것은 뱃지의 존재만이 아니다. 뱃지는 **덧붙이는** 것이지 대체가 아니므로
 * 하네스(`verify-ui-profiles`·`verify-multiview-*`·`explore-ui`·`capture-demo`)가 쓰는
 * **`id` 와 `aria-label` 이 그대로인지**를 함께 고정한다.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BETA_BADGE_TEXT, OURS, PLAYER } from '../../constants/class';
import { DEFAULT_SETTINGS } from '../../constants/storage';
import { decideDevice } from '../../device';
import { CONTROL_BAR_AUTO_HIDE_CSS, mountControlBarButton } from '../controlBar';
import { Sheet, SHEET_CSS } from '../../ui/Sheet';
import { ConfigSheet } from './ConfigSheet';
import { buildStageCss, MultiViewStage } from './stage';

const BADGE_SEL = `.${OURS.betaBadgeClass}`;

afterEach(() => {
  document.body.replaceChildren();
});

describe('① 컨트롤바 멀티 버튼', () => {
  const mount = () => {
    const group = document.createElement('div');
    group.className = 'pzp-pc__bottom-buttons-right';
    document.body.appendChild(group);
    // multiView/index.ts 가 넘기는 것과 같은 옵션.
    const stop = mountControlBarButton({
      id: OURS.multiViewButtonId,
      ariaLabel: '멀티뷰 열기',
      content: '멀티',
      betaBadge: true,
      minTargetPx: 44,
      onClick: () => {},
    });
    const button = group.querySelector<HTMLButtonElement>(`#${OURS.multiViewButtonId}`);
    return { group, button, stop };
  };

  it('BETA 뱃지가 붙는다', () => {
    const { button, stop } = mount();
    const badge = button?.querySelector(BADGE_SEL);
    expect(badge?.textContent).toBe(BETA_BADGE_TEXT);
    stop();
  });

  it('기존 id · aria-label · 본문 문구를 바꾸지 않는다 (하네스가 이 이름으로 찾는다)', () => {
    const { group, button, stop } = mount();
    expect(document.querySelector(PLAYER.bottomButtonsRight)).toBe(group);
    expect(button?.id).toBe('cm-multiview-button');
    expect(button?.getAttribute('aria-label')).toBe('멀티뷰 열기');
    // 뱃지·보조 설명 노드를 걷어 내면 원래 문구가 그대로 남는다.
    const clone = button?.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(`${BADGE_SEL}, .${OURS.srOnlyClass}`).forEach((el) => el.remove());
    expect(clone.textContent).toBe('멀티');
    stop();
  });

  it('시각 뱃지는 aria-hidden 이고, 베타 안내는 aria-describedby 로 한 번만 준다', () => {
    const { button, stop } = mount();
    expect(button?.querySelector(BADGE_SEL)?.getAttribute('aria-hidden')).toBe('true');
    const describedBy = button?.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const note = button?.querySelector(`#${describedBy}`);
    expect(note?.textContent).toBe('베타 기능');
    expect(note?.className).toBe(OURS.srOnlyClass);
    stop();
  });

  it('뱃지가 버튼 상자를 늘리지 않는다 — 터치 타겟·컨트롤바 줄바꿈 보호', () => {
    // position: absolute 라 레이아웃에 기여하지 않는다. 실측(Playwright)은 별도 프로브가 본다.
    expect(CONTROL_BAR_AUTO_HIDE_CSS).toContain(`.${OURS.betaBadgeClass}`);
    const rule = CONTROL_BAR_AUTO_HIDE_CSS.slice(
      CONTROL_BAR_AUTO_HIDE_CSS.indexOf(`.${OURS.betaBadgeClass}`),
    );
    expect(rule).toContain('position: absolute');
    expect(rule).toContain('pointer-events: none');

    const { button, stop } = mount();
    const badge = button?.querySelector(BADGE_SEL) as HTMLElement;
    const style = document.createElement('style');
    style.textContent = CONTROL_BAR_AUTO_HIDE_CSS;
    document.head.appendChild(style);
    expect(getComputedStyle(badge).position).toBe('absolute');
    // 버튼 자체 크기는 minTargetPx 그대로다.
    expect(button?.style.width).toBe('44px');
    expect(button?.style.height).toBe('44px');
    style.remove();
    stop();
  });

  it('스크린 리더 전용 노드는 화면에 보이지 않는다', () => {
    expect(CONTROL_BAR_AUTO_HIDE_CSS).toContain(`.${OURS.srOnlyClass}`);
    expect(CONTROL_BAR_AUTO_HIDE_CSS).toContain('clip-path: inset(50%)');
  });
});

describe('② 멀티뷰 구성 시트 제목', () => {
  it('제목 옆에 BETA 뱃지가 붙는다', () => {
    const html = renderToStaticMarkup(
      <ConfigSheet
        settings={DEFAULT_SETTINGS}
        device={decideDevice()}
        currentChannel={null}
        stageSize={{ width: 1920, height: 950 }}
        onClose={() => {}}
        onStart={() => {}}
      />,
    );
    document.body.innerHTML = html;
    const head = document.querySelector('.cm-sheet__head h2');
    expect(head?.textContent).toContain('멀티뷰 구성');
    expect(head?.querySelector(BADGE_SEL)?.textContent).toBe(BETA_BADGE_TEXT);
  });

  it('대화상자 aria-label 은 "멀티뷰 구성" 그대로다 (뱃지가 이름을 오염시키지 않는다)', () => {
    const html = renderToStaticMarkup(
      <Sheet title="멀티뷰 구성" beta onClose={() => {}}>
        <p>본문</p>
      </Sheet>,
    );
    document.body.innerHTML = html;
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('멀티뷰 구성');
    // 닫기 버튼 등 기존 조작 이름도 유지된다.
    expect(document.querySelector('.cm-sheet__close')?.getAttribute('aria-label')).toBe('닫기');
  });

  it('beta 를 넘기지 않은 시트에는 뱃지가 없다 (설정 패널 등에 번지지 않는다)', () => {
    const html = renderToStaticMarkup(
      <Sheet title="설정" onClose={() => {}}>
        <p>본문</p>
      </Sheet>,
    );
    expect(html).not.toContain(OURS.betaBadgeClass);
  });

  it('시트 CSS 에 뱃지 규칙이 있다', () => {
    expect(SHEET_CSS).toContain(`.cm-sheet__head h2 .${OURS.betaBadgeClass}`);
  });
});

describe('③ 스테이지 조작 바', () => {
  it('조작 바 안에 BETA 뱃지가 있고 기존 버튼 aria-label 이 그대로다', () => {
    const stage = new MultiViewStage(DEFAULT_SETTINGS, decideDevice(), {
      onRequestConfig: () => {},
      onExit: () => {},
      onActiveSlotChange: () => {},
      onChatLinesChange: () => {},
      onChatWidthChange: () => {},
    });
    stage.open([
      { index: 1, channelId: 'aaa', channelName: 'A' },
      { index: 2, channelId: 'bbb', channelName: 'B' },
    ]);

    const bar = document.querySelector(`#${OURS.multiViewStageId} .cm-stage-bar`);
    expect(bar).not.toBeNull();
    expect(bar?.querySelector(BADGE_SEL)?.textContent).toBe(BETA_BADGE_TEXT);

    // 하네스가 찾는 기존 조작 이름 — 뱃지 추가로 어느 하나도 사라지면 안 된다.
    const labels = Array.from(bar!.querySelectorAll('button')).map((b) =>
      b.getAttribute('aria-label'),
    );
    for (const expected of [
      '멀티뷰 구성 열기',
      '채팅 영역 좁히기',
      '채팅 영역 넓히기',
      '채팅 끄기',
      '전체 화면 전환 (주소창 숨김)',
      '멀티뷰 해제',
    ]) {
      expect(labels).toContain(expected);
    }
    // 슬롯 헤더의 초점·줄 수 버튼 이름도 그대로다.
    expect(document.querySelector('[aria-label="슬롯 1 초점"]')).not.toBeNull();

    stage.close();
  });

  it('뱃지는 조작 요소가 아니라 정적 텍스트다 (버튼이 아니고 aria-hidden 도 아니다)', () => {
    // 조작마다 반복 낭독되지 않는 자리이므로 숨기지 않는다 — 근거는 stage.ts 주석 참조.
    const css = buildStageCss(44, true);
    expect(css).toContain(`.cm-stage-bar .${OURS.betaBadgeClass}`);
    /*
     * 바 높이를 키우면 stageTopInset() 이 슬롯 배치 띠를 그만큼 넓힌다 → 버튼(44px)보다 작게 유지.
     * ⚠️ **그 규칙 블록만** 잘라 본다. CSS 끝까지 자르면 뒤에 오는 다른 규칙의 선언을 이 규칙의
     * 것으로 착각한다 — 실제로 사이드 채팅 목록의 `min-height: 0`(flex 스크롤 필수)이 여기 걸려
     * 정상 CSS 가 실패로 잡혔다 (2026-08-18).
     */
    const start = css.indexOf(`.cm-stage-bar .${OURS.betaBadgeClass}`);
    const rule = css.slice(start, css.indexOf('}', start) + 1);
    expect(rule).toContain('font-size: 9px');
    expect(rule).not.toContain('min-height');
  });
});
