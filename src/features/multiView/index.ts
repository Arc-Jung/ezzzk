/**
 * FR-14 멀티뷰 오케스트레이션.
 *
 * 진입점은 컨트롤바의 `멀티` 버튼 하나이며 `Alt+M` 로도 열린다.
 * 슬롯 프레임(`?cmSlot=N`)에서는 UI 를 만들지 않고 슬롯 컨트롤러만 돈다.
 */

import { OURS } from '../../constants/class';
import type { Settings, SlotIndex } from '../../constants/storage';
import { supportsMultiView } from '../../pageType';
import { onSettingsChanged, updateSection } from '../../storage';
import { claimWidth, ensureLayoutArbiter, releaseWidth } from '../../layoutArbiter';
import { onViewportChange, readViewport } from '../../utils/viewport';
import { disposeAll } from '../../utils/observe';
import { info } from '../../utils/log';
import { mountControlBarButton } from '../controlBar';
import { mountSheet } from '../../ui/mountSheet';
import { ConfigSheet } from './ConfigSheet';
import { startSlotController } from './slotFrame';
import { suspendHostPlayer } from './hostPlayer';
import { MultiViewStage } from './stage';
import { clampSplit } from './slotLayout';
import type { Feature } from '../types';
import { createElement } from 'react';

/**
 * 멀티뷰가 활성인 동안 요구하는 채팅 aside 폭.
 *
 * 🔴 **0 이다 — 멀티뷰 중에는 기존 우측 채팅을 완전히 비활성화한다** (2026-08-12 결정).
 * 슬롯마다 채팅 스트립(FR-14.2)이 있어 원본 채팅은 중복이고, 353px 를 남겨 두면
 * 슬롯이 그만큼 좁아진다. 이전에는 `chatMode: 'active'` 일 때 353px 를 유지했는데
 * 스테이지가 그 위를 덮어 **채팅은 안 보이고 검은 띠만 남는 죽은 공간**이 됐다.
 */
const SIDE_CHAT_PX = 0;

export const multiViewFeature: Feature = {
  id: 'multiView',
  // 멀티뷰는 스테이지·시트 상태를 직접 들고 있다. 재시작하면 오디오 슬롯을 바꿀 때마다 **iframe 4개가 다시 로드된다.**
  watches: [],
  // 슬롯 프레임에서도 동작해야 한다 — 그때는 컨트롤러만 돈다.
  supports: (ctx) => supportsMultiView(ctx.page.type),
  start: (ctx) => {
    // 슬롯으로 로드된 프레임: UI 없이 제어만 담당한다.
    if (ctx.page.isSlotFrame) {
      const slot = readSlotFromUrl();
      if (slot === null) return;
      return startSlotController(slot);
    }

    /**
     * 🔴 `watches: []` 라 이 기능은 설정 변경으로 재시작되지 않는다(iframe 4개 재로드 방지).
     * 그래서 **스스로 최신 설정을 구독**해야 한다. `ctx.settings` 스냅샷을 그대로 들고 있으면
     * 설정 패널의 멀티뷰·슬롯 폰트·볼륨 증감폭 항목이 조용히 먹지 않는다.
     */
    let live = ctx.settings;

    let stage: MultiViewStage | null = null;
    /** 호스트 페이지 원본 플레이어 정지의 원복 함수. 스테이지가 열려 있는 동안에만 non-null 이다. */
    let resumeHost: (() => void) | null = null;
    const sheet = mountSheet(OURS.multiViewSheetId);
    /**
     * 폭 조정자를 붙잡아 둔다. FR-05·FR-10 이 꺼져 있어도 멀티뷰가 폭을 주장하려면
     * 옵저버가 살아 있어야 한다 (참조 카운트라 중복 호출은 안전하다).
     */
    const stopArbiter = ensureLayoutArbiter({ relaxed: ctx.device.profile.relaxObservers });

    const stageSize = () => {
      const { width, height } = readViewport();
      // 멀티뷰는 화면 전체를 쓴다 (위 SIDE_CHAT_PX 주석 참조).
      return { width: Math.max(0, width - SIDE_CHAT_PX), height };
    };

    const closeSheet = () => sheet.close();

    const openSheet = () => {
      sheet.render(
        createElement(ConfigSheet, {
          settings: live,
          device: ctx.device,
          currentChannel: ctx.page.channelId
            ? { channelId: ctx.page.channelId, channelName: document.title || ctx.page.channelId }
            : null,
          stageSize: stageSize(),
          onClose: closeSheet,
          onStart: (patch: Settings['multiView']) => {
            closeSheet();
            void updateSection('multiView', patch);
            openStage(patch);
          },
        }),
      );
    };

    const openStage = (config: Settings['multiView']) => {
      stage?.close();
      // 멀티뷰가 활성인 동안 폭 결정 1순위를 가져간다 (FR-14 > FR-10 > FR-05).
      // 폭 0 = 접힘 → arbiter 가 aside 를 width/flex/padding/border 0 + overflow hidden 으로 접는다.
      claimWidth('multiView', SIDE_CHAT_PX, 'multiview active — side chat disabled');
      // 뒤에 남은 원본 플레이어를 멈춘다. 재진입해도 중복 정지하지 않도록 기존 원복을 먼저 돌린다.
      resumeHost?.();
      resumeHost = suspendHostPlayer({
        isSlotFrame: ctx.page.isSlotFrame,
        relaxed: ctx.device.profile.relaxObservers,
      });
      stage = new MultiViewStage({ ...live, multiView: config }, ctx.device, {
        onRequestConfig: openSheet,
        onExit: (channelId) => exitStage(channelId),
        onActiveSlotChange: (slot) => void updateSection('multiView', { activeSlot: slot }),
        /**
         * 전체 화면에서만 0 이 아닌 값이 온다. 폭 적용은 여기 한 곳에서만 한다 —
         * 스테이지가 직접 스타일을 쓰면 FR-05·FR-10 과 경합한다.
         */
        onChatWidthChange: (widthPx) =>
          claimWidth(
            'multiView',
            widthPx,
            widthPx > 0
              ? `multiview fullscreen chat ${widthPx}px`
              : 'multiview active — side chat disabled',
          ),
      });
      /**
       * 🔴 기기 상한을 **런타임에도** 적용한다.
       * UI 에서 선택을 막는 것만으로는 부족하다: 노트북에서 4분할로 보다가 창을 1200px 미만으로
       * 좁히면 `deviceClass` 가 `tablet-10`(상한 2)으로 바뀌고 전체 재시작이 일어나는데,
       * 저장된 `defaultSplit: 4` 를 그대로 쓰면 태블릿 화면에 4분할이 다시 열린다.
       */
      const split = clampSplit(config.defaultSplit, ctx.device.deviceClass);
      stage.open(config.slots.filter((slot) => slot.index <= split));
    };

    /** 해제 시 활성 슬롯 채널의 단독 시청 화면으로 복귀한다. */
    const exitStage = (activeChannelId: string | null) => {
      stage?.close();
      stage = null;
      resumeHost?.();
      resumeHost = null;
      releaseWidth('multiView');
      void updateSection('multiView', { enabled: false });
      if (activeChannelId && activeChannelId !== ctx.page.channelId) {
        location.href = `https://chzzk.naver.com/live/${activeChannelId}`;
      }
    };

    /**
     * 진입점(`멀티` 버튼 · `Alt+M`) 동작 — **이어보기 우선** (요청 2026-08-18).
     *
     * 1. 스테이지가 열려 있으면 구성 시트 (배치를 바꾸려는 것이다)
     * 2. 저장된 구성이 있으면(`slots ≥ 2`) 그 구성으로 **즉시** 스테이지를 연다
     * 3. 없으면 구성 시트 (새로 세팅)
     *
     * 🔴 2번에서 `enabled: true` 를 저장한다. 해제할 때 `false` 로 꺼 두므로 저장하지 않으면
     * 다음 새로고침에서 자동 복원이 안 되어 "이어보기"가 한 번만 동작하는 것처럼 보인다.
     * 편집 경로는 스테이지 조작 바의 `구성` 이므로 이어보기가 편집을 막지 않는다.
     */
    const openEntry = () => {
      if (stage) {
        openSheet();
        return;
      }
      const saved = live.multiView;
      const usable = saved.slots.filter(
        (slot) => slot.index <= clampSplit(saved.defaultSplit, ctx.device.deviceClass),
      );
      if (usable.length >= 2) {
        info(`resuming saved multiview layout (${usable.length} slot(s))`);
        void updateSection('multiView', { enabled: true });
        openStage({ ...saved, enabled: true });
        return;
      }
      openSheet();
    };

    const stopButton = mountControlBarButton({
      id: OURS.multiViewButtonId,
      ariaLabel: '멀티뷰 열기',
      content: '멀티',
      // 멀티뷰는 아직 불안정하다 — 진입점에서 미리 알린다 (2026-08-16).
      betaBadge: true,
      minTargetPx: ctx.device.profile.touchTargetPx,
      onClick: openEntry,
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (ctx.device.profile.shortcuts === 'off') return;
      // Alt+M — 네이티브 space/k/m/f 와 충돌하지 않는다 (m 단독이 네이티브 음소거다).
      if (!event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return;
      if (event.code !== 'KeyM') return;
      event.preventDefault();
      if (sheet.isOpen()) closeSheet();
      else openEntry();
    };
    window.addEventListener('keydown', onKeyDown);

    // 크기 변화마다 슬롯 배치를 다시 계산한다. 캐시하지 않는다 (FR-12.1).
    const stopViewport = onViewportChange(
      ({ keyboardLikely }) => {
        // IME 로 높이만 줄어든 경우는 슬롯 배치를 유지한다.
        if (keyboardLikely) return;
        stage?.layout();
      },
      { relaxed: ctx.device.profile.relaxObservers },
    );

    // 마지막 구성 복원
    if (live.multiView.enabled && live.multiView.restoreLastLayout) {
      if (live.multiView.slots.length >= 2) {
        info('restoring last multiview layout');
        openStage(live.multiView);
      }
    }

    /**
     * 설정 변경을 제자리에 반영한다. 재시작하지 않으므로 스트림이 끊기지 않는다.
     * 우리 자신이 쓴 변경(`origin: 'multiView'`)도 반영해야 한다 — 슬롯 헤더의 줄 수 `±`
     * 버튼이 쓴 값이 스테이지에 보이지 않으면 버튼이 먹지 않는 것처럼 된다.
     */
    const stopSettings = onSettingsChanged((next) => {
      live = next;
      stage?.updateSettings(next);
    });

    // 각 단계를 독립 실행한다 — `stopArbiter()` 누락은 참조 카운트 영구 누수로 이어진다.
    return () =>
      disposeAll(
        () => window.removeEventListener('keydown', onKeyDown),
        stopSettings,
        stopViewport,
        stopButton,
        closeSheet,
        () => stage?.close(),
        () => {
          stage = null;
        },
        () => resumeHost?.(),
        () => {
          resumeHost = null;
        },
        () => releaseWidth('multiView'),
        stopArbiter,
      );
  },
};

function readSlotFromUrl(): SlotIndex | null {
  const raw = new URL(location.href).searchParams.get('cmSlot');
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 4) return null;
  return parsed as SlotIndex;
}
