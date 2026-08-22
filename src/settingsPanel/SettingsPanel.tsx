/**
 * 화면 ⑦ · ⑨ 페이지 내 세부 설정 패널 (FR-09.2).
 *
 * - 좌측 탭 레일 7개(재생 · 소리 · 레이아웃 · 멀티뷰 · 채팅 · 기타 · 프리셋).
 * - **변경은 즉시 저장된다.** "저장" 버튼은 없고, `chrome.storage.onChanged` 로 열린 모든 탭이 따라간다.
 * - 탭별 `[ 이 탭 초기화 ]` 와 전체 `[ 모두 초기화 ]`(확인 1회)를 제공한다.
 * - 시트 자체(크기·Esc·Tab 순회·aria-modal)는 `Sheet` 가 담당한다.
 */

import { useEffect, useMemo, useState } from 'react';
import { CHZZK } from '../constants/class';
import type { DeviceDecision } from '../device';
import { resetAllSettings, resetSection } from '../storage';
import { Sheet } from '../ui/Sheet';
import { SHEET_LOGO_PATH, extensionAssetUrl } from '../ui/assetUrl';
import { qs } from '../utils/dom';
import { onViewportChange, readViewport } from '../utils/viewport';
import { useSettings } from '../popup/useSettings';
import {
  LayoutTab,
  MiscTab,
  PlaybackTab,
  SoundTab,
  TABS,
  sectionsForTab,
  type TabId,
  type TabProps,
} from './tabs';
import { ChatTab, MultiViewTab, PresetTab, REFERENCE_SCROLLER_HEIGHT } from './tabsExtra';
import { LicenseTab } from './LicenseTab';

type Props = {
  device: DeviceDecision;
  onClose: () => void;
  /** 열릴 때 선택할 탭. 지정하지 않으면 재생 탭으로 시작한다. */
  initialTab?: TabId;
};

/**
 * 채팅 스크롤 영역 높이. 실제 스크롤러가 있으면 그 값을 읽는다.
 * ⚠️ 로드 직후에는 871px 로 측정되고 통나무 랭킹·공지가 채워지면 761px 로 안정화된다 —
 * 스크롤러를 못 찾을 때만 안정화 기준값으로 안내한다.
 */
function readScrollerHeight(): number {
  const scroller = qs<HTMLElement>(CHZZK.chatScroller);
  const measured = scroller?.getBoundingClientRect().height ?? 0;
  return measured > 0 ? Math.round(measured) : REFERENCE_SCROLLER_HEIGHT;
}

export function SettingsPanel({ device, onClose, initialTab = 'playback' }: Props) {
  const { settings, ready, update } = useSettings();
  const [tab, setTab] = useState<TabId>(initialTab);
  const [confirmingResetAll, setConfirmingResetAll] = useState(false);
  const [metrics, setMetrics] = useState(() => ({
    viewportWidth: readViewport().width,
    // 하단 배치의 유효 점유율 범위는 **높이**에서 나온다 (`chatRatioRangeFor`).
    viewportHeight: readViewport().height,
    scrollerHeightPx: readScrollerHeight(),
  }));

  // 창 크기가 바뀌면 다시 재계산한다. 레이아웃 값은 캐시하지 않는다 (FR-12.1).
  useEffect(() => {
    const stop = onViewportChange(
      () => {
        const viewport = readViewport();
        setMetrics({
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
          scrollerHeightPx: readScrollerHeight(),
        });
      },
      { relaxed: device.profile.relaxObservers },
    );
    return stop;
  }, [device.profile.relaxObservers]);

  const sections = useMemo(() => sectionsForTab(tab), [tab]);

  const resetThisTab = () => {
    for (const section of sections) void resetSection(section);
  };

  const tabProps: TabProps = { settings, device, update };

  return (
    <Sheet
      title="이지직 설정"
      onClose={onClose}
      logoSrc={extensionAssetUrl(SHEET_LOGO_PATH)}
      touchTargetPx={device.profile.touchTargetPx}
      footer={
        <>
          <span className="cm-sheet__note" style={{ marginRight: 'auto' }}>
            변경은 즉시 저장됩니다.
          </span>
          {/* 되돌릴 설정이 없는 탭(라이선스 고지)에서는 아예 렌더하지 않는다 —
              눌러도 아무 일이 없는 버튼을 남기지 않는다 (FR-15). */}
          {sections.length > 0 ? (
            <button
              type="button"
              className="cm-sheet__btn"
              aria-label="이 탭 초기화"
              onClick={resetThisTab}
            >
              이 탭 초기화
            </button>
          ) : null}
          {confirmingResetAll ? (
            <>
              <span className="cm-sheet__warn">모든 설정을 기본값으로 되돌립니다.</span>
              <button
                type="button"
                className="cm-sheet__btn cm-sheet__btn--primary"
                aria-label="모두 초기화 확인"
                onClick={() => {
                  void resetAllSettings();
                  setConfirmingResetAll(false);
                }}
              >
                확인
              </button>
              <button
                type="button"
                className="cm-sheet__btn"
                aria-label="모두 초기화 취소"
                onClick={() => setConfirmingResetAll(false)}
              >
                취소
              </button>
            </>
          ) : (
            <button
              type="button"
              className="cm-sheet__btn"
              aria-label="모두 초기화"
              onClick={() => setConfirmingResetAll(true)}
            >
              모두 초기화
            </button>
          )}
        </>
      }
    >
      <div className="cm-sp">
        <div
          className="cm-sp__rail"
          role="tablist"
          aria-label="설정 탭"
          aria-orientation="vertical"
        >
          {TABS.map(({ id, title }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`cm-sp-tab-${id}`}
              className="cm-sp__tab"
              aria-selected={tab === id}
              aria-controls="cm-sp-panel"
              aria-label={`${title} 탭`}
              onClick={() => setTab(id)}
              onKeyDown={(event) => {
                const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
                if (step === 0) return;
                event.preventDefault();
                const index = TABS.findIndex((entry) => entry.id === tab);
                const next = TABS[(index + step + TABS.length) % TABS.length];
                if (next) setTab(next.id);
              }}
            >
              {tab === id ? '▶ ' : ''}
              {title}
            </button>
          ))}
        </div>

        <div
          className="cm-sp__panel"
          id="cm-sp-panel"
          role="tabpanel"
          aria-labelledby={`cm-sp-tab-${tab}`}
        >
          {!ready ? (
            <p className="cm-sheet__note">설정을 읽는 중…</p>
          ) : tab === 'playback' ? (
            <PlaybackTab {...tabProps} />
          ) : tab === 'sound' ? (
            <SoundTab {...tabProps} />
          ) : tab === 'layout' ? (
            <LayoutTab
              {...tabProps}
              viewportWidth={metrics.viewportWidth}
              viewportHeight={metrics.viewportHeight}
            />
          ) : tab === 'multiView' ? (
            <MultiViewTab {...tabProps} />
          ) : tab === 'chat' ? (
            <ChatTab {...tabProps} scrollerHeightPx={metrics.scrollerHeightPx} />
          ) : tab === 'misc' ? (
            <MiscTab {...tabProps} />
          ) : tab === 'preset' ? (
            <PresetTab {...tabProps} />
          ) : (
            <LicenseTab />
          )}
        </div>
      </div>
    </Sheet>
  );
}
