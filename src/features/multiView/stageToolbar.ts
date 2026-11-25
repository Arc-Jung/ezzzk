import { createIconElement, type IconName } from '../../ui/icons';

type ToolbarActions = {
  configure: () => void;
  settings: () => void;
  autoVolume: () => void;
  reload: () => void;
  resizeChat: (steps: number) => void;
  toggleChat: () => void;
  fullscreen: () => void;
  exit: () => void;
};

function label(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'cm-stage-bar__label';
  span.textContent = text;
  return span;
}

function action(accessibleName: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', accessibleName);
  button.addEventListener('click', onClick);
  return button;
}

function addIcon(button: HTMLButtonElement, icon: IconName, text: string, size?: number): void {
  button.replaceChildren(createIconElement(icon, size), label(text));
}

export function createStageToolbar(actions: ToolbarActions) {
  const element = document.createElement('div');
  element.className = 'cm-stage-bar';

  const config = action('멀티뷰 구성 열기', actions.configure);
  addIcon(config, 'slots', '구성');

  const settings = action('이지직 설정 열기', actions.settings);
  settings.title = '이지직 설정 열기';
  addIcon(settings, 'ezzzkSettings', '설정', 20);

  const volume = action('자동 음량', actions.autoVolume);
  volume.id = 'cm-multiview-auto-volume';
  addIcon(volume, 'autoVolume', '자동 음량');

  const reload = action('새로고침', actions.reload);
  addIcon(reload, 'refresh', '새로고침');

  const chatControls = document.createElement('span');
  chatControls.className = 'cm-stage-chat-controls';
  chatControls.style.display = 'none';
  const chatWidth = document.createElement('output');
  chatWidth.setAttribute('aria-live', 'polite');

  const narrow = action('채팅 영역 좁히기', () => actions.resizeChat(-1));
  narrow.appendChild(createIconElement('minus'));
  const widen = action('채팅 영역 넓히기', () => actions.resizeChat(1));
  widen.appendChild(createIconElement('plus'));
  const chat = action('채팅 끄기', actions.toggleChat);
  chatControls.append(label('채팅'), narrow, chatWidth, widen, chat);

  const fullscreen = action('전체 화면 전환 (주소창 숨김)', actions.fullscreen);
  fullscreen.dataset.cmFullscreenToggle = '';
  const exit = action('멀티뷰 해제', actions.exit);
  addIcon(exit, 'close', '해제');
  element.append(config, settings, volume, reload, chatControls, fullscreen, exit);

  return {
    element,
    setFullscreen(maximized: boolean) {
      const name = maximized ? '전체 화면 종료 (최소화)' : '전체 화면 전환 (주소창 숨김)';
      fullscreen.setAttribute('aria-label', name);
      fullscreen.setAttribute('aria-pressed', String(maximized));
      fullscreen.title = name;
      addIcon(fullscreen, maximized ? 'minimize' : 'fullscreen', maximized ? '최소화' : '최대화');
    },
    setAutoVolume(enabled: boolean, status: string) {
      volume.setAttribute('aria-pressed', String(enabled));
      volume.setAttribute(
        'aria-label',
        `자동 음량 ${enabled ? '켜짐, 누르면 끄기' : '꺼짐, 누르면 켜기'}`,
      );
      volume.title = enabled
        ? `자동 음량 켜짐 · ${status} · 누르면 끄기`
        : '자동 음량 꺼짐 · 방송별 음량을 비슷하게 맞추기';
      volume.style.color = enabled ? '#00ffa3' : '';
    },
    setSideChat(available: boolean, open: boolean, width: number) {
      chatControls.style.display = available ? 'inline-flex' : 'none';
      chatWidth.textContent = width > 0 ? `${width}px` : '꺼짐';
      chat.setAttribute('aria-label', open ? '채팅 끄기' : '채팅 켜기');
      chat.replaceChildren(createIconElement(open ? 'close' : 'chatBubble'));
    },
  };
}
