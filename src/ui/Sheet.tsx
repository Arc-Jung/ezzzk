// 치지직 토큰으로 전환 (2026-08-20, docs/chzzk-tone-ui-plan.md P2)
/**
 * 페이지 내 시트 공용 컴포넌트 (화면 ② ⑤ ⑦ ⑨ 공통).
 *
 * 공통 UI 규칙 (목업 문서)
 * - `document.body` 직계 + 최상위 `z-index` 로 렌더해 페이지 리렌더에 지워지지 않게 한다.
 * - 키보드 조작 가능: `Tab` 순회, `Esc` 닫기. 모든 버튼에 `aria-label`.
 * - 터치 기기는 호버로만 드러나는 요소를 두지 않는다. 타겟 44×44px.
 * - 크기는 **반응형**이다: `min(920px, 88vw) × min(600px, 80vh)`.
 *   1920×1080 중앙 배치 시 920×600 @ x=500, y=240 (실측). 1600×900 이하에서는 vw/vh 상한이 걸린다.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { BETA_BADGE_TEXT, OURS } from '../constants/class';
import { BG, BORDER, FG, RADIUS, ACCENT, FONT_FAMILY } from './tokens';

export const SHEET_MAX_W = 920;
export const SHEET_MAX_H = 600;

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 하단 고정 영역 (버튼 줄 등) */
  footer?: ReactNode;
  /** 터치 타겟 최소 크기 — 기기 프로필의 touchTargetPx */
  touchTargetPx?: number;
  /** 제목 옆 BETA 뱃지 — 아직 불안정한 기능임을 알린다 (FR-14 멀티뷰) */
  beta?: boolean;
  /**
   * 제목 왼쪽 로고 이미지 URL. **넣는 쪽에서만 지정한다**(기본은 로고 없음) —
   * 이 컴포넌트는 멀티뷰 구성 시트도 함께 쓰므로 기본값을 바꾸면 그쪽 모양까지 바뀐다.
   * 콘텐츠 스크립트에서는 `chrome.runtime.getURL` 로 만든 절대 URL 이어야 한다
   * (상대 경로는 치지직 서버를 가리켜 404 가 된다).
   */
  logoSrc?: string;
};

export function Sheet({
  title,
  onClose,
  children,
  footer,
  touchTargetPx = 32,
  beta,
  logoSrc,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;

    const focusables = (): HTMLElement[] =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);

    // 열리면 첫 요소로 포커스를 옮긴다.
    focusables()[0]?.focus();

    /**
     * 🔴 Esc 는 **문서 전체에서** 받는다 (2026-08-16 실측 결함).
     *
     * 이전에는 시트 노드에만 걸려 있었는데, 시트 안의 **포커스 불가 요소(제목·설명 문단)를
     * 클릭하면 `document.activeElement` 가 `body` 로 떨어져** keydown 이 시트에 도달하지
     * 않았다 — 그 뒤로는 Esc 가 완전히 먹통이었다.
     * `probe-multiview-beta` 로 mobile-landscape·mobile-portrait·lowres-1024·laptop13
     * **4개 프로필 전부에서 재현**했다 (focus: "body (시트 밖)", closed: false).
     *
     * 모달이므로 문서 어디서 눌러도 닫히는 것이 옳다. 캡처 단계에서 받아 치지직 자신의
     * Esc 처리(전체 화면 해제 등)가 함께 발화하지 않게 전파를 끊는다.
     */
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onEscape, true);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      // Tab 순회를 시트 안에 가둔다 — 뒤 페이지로 포커스가 빠지면 조작이 끊긴다.
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    node.addEventListener('keydown', onKeyDown);
    return () => {
      node.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keydown', onEscape, true);
    };
  }, [onClose]);

  return (
    <div
      className="cm-sheet-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="cm-sheet"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ ['--cm-target' as string]: `${touchTargetPx}px` }}
      >
        <header className="cm-sheet__head">
          {/*
            BETA 뱃지는 제목 안의 **정적 텍스트**다.
            대화상자 이름은 위 `aria-label={title}` 이라 뱃지가 이름에 섞이지 않는다 —
            스크린 리더는 제목을 훑을 때 한 번만 읽고 조작마다 반복하지 않는다.
            그래서 여기서는 `aria-hidden` 을 쓰지 않는다 (버튼 안의 뱃지와 다른 이유다).
          */}
          <h2>
            {/*
              로고는 **장식**이다. 바로 옆 텍스트가 같은 이름을 이미 말하고 대화상자 이름은
              위 `aria-label={title}` 이 준다 — 스크린 리더가 이름을 두 번 읽지 않도록
              `alt=""` + `aria-hidden` 으로 접근성 트리에서 뺀다.
              높이는 제목 줄 높이(14px × 1.4 ≈ 20px) 안에 들어가는 18px 로 잡아
              헤더가 커져 본문 스크롤 영역을 잡아먹지 않게 한다.
            */}
            {logoSrc ? (
              <img className="cm-sheet__logo" src={logoSrc} alt="" aria-hidden="true" />
            ) : null}
            {title}
            {beta ? <span className={OURS.betaBadgeClass}>{BETA_BADGE_TEXT}</span> : null}
          </h2>
          <button type="button" className="cm-sheet__close" aria-label="닫기" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="cm-sheet__body">{children}</div>
        {footer ? <footer className="cm-sheet__foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

/** 시트 스타일. `z-index` 는 목업 실측값(2147483647)을 쓴다. */
export const SHEET_CSS = `
.cm-sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: ${OURS.topZIndex};
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${BG.scrim};
  font-family: ${FONT_FAMILY};
  font-size: 13px;
  color: ${FG.body};
}
.cm-sheet {
  width: min(${SHEET_MAX_W}px, 88vw);
  height: min(${SHEET_MAX_H}px, 80vh);
  display: flex;
  flex-direction: column;
  background: ${BG.floating};
  border: 1px solid ${BORDER.subtle};
  border-radius: ${RADIUS.md};
  box-shadow: 0 12px 40px ${BG.scrim};
  overflow: hidden;
}
.cm-sheet__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid ${BORDER.subtle};
}
.cm-sheet__head h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  display: flex;
  align-items: center;
  min-width: 0;
}
/*
  로고 크기는 제목 줄 높이 안에 들어가는 18px 로 고정한다 — 헤더가 높아지면 시트 높이가
  고정(min(600px, 80vh))이라 그만큼 본문 스크롤 영역이 줄어든다. 세로가 짧은 화면
  (모바일 가로 915x412)에서는 본문이 200px 남짓이라 몇 px 도 아깝다.
  flex-shrink 를 막아 좁은 화면에서 로고가 찌그러지지 않게 한다.
*/
.cm-sheet__logo {
  width: 18px;
  height: 18px;
  margin-right: 6px;
  flex: 0 0 auto;
  display: block;
}
.cm-sheet__head h2 .${OURS.betaBadgeClass} {
  margin-left: 6px;
  padding: 1px 5px;
  border: 1px solid ${ACCENT};
  border-radius: ${RADIUS.xs};
  font-size: 9px;
  font-weight: 700;
  line-height: 1.4;
  letter-spacing: 0.04em;
  color: ${ACCENT};
  vertical-align: middle;
}
.cm-sheet__close {
  min-width: var(--cm-target, 32px);
  min-height: var(--cm-target, 32px);
  border: 1px solid ${BORDER.subtle};
  border-radius: ${RADIUS.sm};
  background: ${BG.raised};
  color: ${FG.body};
  cursor: pointer;
}
/*
  min-height: 0 이 없으면 flex 아이템 기본값 min-height: auto (= 내용 최소 높이) 때문에
  본문이 시트 높이 아래로 줄지 못하고 푸터를 밀어내 잘린다 — 시트가 overflow: hidden 이라
  밀려난 부분은 영구히 숨는다. 멀티뷰 구성 시트에서 같은 증상을 고쳤고(2026-08-15),
  설정 패널도 세로가 짧은 화면에서 같은 경계에 있다 (모바일 가로 실측 2026-08-16: 본문
  scrollHeight 358 / clientHeight 198).
  ⚠️ 이 문자열은 템플릿 리터럴이다 — 주석에 백틱을 쓰지 않는다 (빌드가 깨진다).
*/
.cm-sheet__body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 14px; }
.cm-sheet__foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid ${BORDER.subtle};
}
.cm-sheet button, .cm-sheet select, .cm-sheet input {
  min-height: var(--cm-target, 32px);
}
.cm-sheet__btn {
  padding: 5px 12px;
  border: 1px solid ${BORDER.subtle};
  border-radius: ${RADIUS.sm};
  background: ${BG.raised};
  color: ${FG.body};
  cursor: pointer;
}
.cm-sheet__btn--primary { border-color: ${ACCENT}; color: ${ACCENT}; }
.cm-sheet__btn:disabled { opacity: 0.35; cursor: default; }
.cm-sheet__note { margin: 4px 0 0; font-size: 11px; color: ${FG.muted}; }
.cm-sheet__warn { margin: 4px 0 0; font-size: 11px; color: #ffb454; }
.cm-sheet__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 5px 0;
}
`.trim();
