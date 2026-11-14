import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OURS } from '../../constants/class';
import { DEFAULT_SETTINGS } from '../../constants/storage';
import { decideDevice } from '../../device';
import { mountControlBarButton } from '../controlBar';
import { ConfigSheet } from './ConfigSheet';
import { MultiViewStage } from './stage';

afterEach(() => document.body.replaceChildren());

describe('멀티뷰 UI', () => {
  it('멀티 버튼의 이름과 터치 영역은 유지하고 베타 안내는 표시하지 않는다', () => {
    document.body.innerHTML = '<div class="pzp-pc__bottom-buttons-right"></div>';
    const stop = mountControlBarButton({
      id: OURS.multiViewButtonId,
      ariaLabel: '멀티뷰 열기',
      content: '멀티',
      minTargetPx: 44,
      onClick: () => {},
    });
    const button = document.getElementById(OURS.multiViewButtonId)!;
    expect(button.textContent).toBe('멀티');
    expect(button.getAttribute('aria-label')).toBe('멀티뷰 열기');
    expect(button.hasAttribute('aria-describedby')).toBe(false);
    expect(button.style.width).toBe('44px');
    expect(button.style.height).toBe('44px');
    stop();
  });
  it('구성 시트의 제목과 접근성 이름에 베타 문구가 없다', () => {
    document.body.innerHTML = renderToStaticMarkup(
      <ConfigSheet
        settings={DEFAULT_SETTINGS}
        device={decideDevice()}
        currentChannel={null}
        stageSize={{ width: 1920, height: 950 }}
        onClose={() => {}}
        onStart={() => {}}
      />,
    );
    expect(document.querySelector('.cm-sheet__head h2')?.textContent).toBe('멀티뷰 구성');
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(
      '멀티뷰 구성',
    );
    expect(document.querySelector('.cm-beta-badge')).toBeNull();
  });
  it('스테이지에 베타 뱃지가 없고 구성·전체화면·해제 버튼은 유지한다', () => {
    const stage = new MultiViewStage(DEFAULT_SETTINGS, decideDevice(), {
      onRequestConfig: () => {},
      onExit: () => {},
      onActiveSlotChange: () => {},
      onChatWidthChange: () => {},
    });
    try {
      stage.open([
        { index: 1, channelId: 'aaa', channelName: 'A' },
        { index: 2, channelId: 'bbb', channelName: 'B' },
      ]);
      const root = document.getElementById(OURS.multiViewStageId)!;
      expect(root.querySelector('.cm-beta-badge')).toBeNull();
      for (const name of ['멀티뷰 구성 열기', '전체 화면 전환 (주소창 숨김)', '멀티뷰 해제'])
        expect(root.querySelector(`button[aria-label="${name}"]`)).not.toBeNull();
    } finally {
      stage.close();
    }
  });
});
