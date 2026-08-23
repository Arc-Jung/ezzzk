/**
 * 화면 ② 멀티뷰 구성 시트 + 화면 ⑤ 폴백 (FR-14).
 *
 * UX 규칙 (요구사항 FR-14.1)
 * - 우측 목록의 `[①②③④]` 는 **슬롯 직접 지정 버튼**이다. 한 번 클릭으로 배치된다.
 * - 이미 배치된 채널은 `· 배치됨 ①` 로 표시하고 중복 배치를 막는다.
 * - 라이브 중(🔴)을 상단, 오프라인(⚫)은 하단에 흐리게. 오프라인도 배치는 허용한다.
 * - 상한을 넘는 분할은 **선택 자체를 비활성화**한다 (에러 대신 사전 차단).
 * - 비로그인·팔로우 조회 실패 시 화면 ⑤ 폴백으로 대체한다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  MultiViewSlot,
  Settings,
  SlotIndex,
  SlotLines,
  SplitCount,
} from '../../constants/storage';
import { Sheet } from '../../ui/Sheet';
import { CloseIcon, LiveDotIcon, MinusIcon, PlusIcon } from '../../ui/icons';
import { OURS } from '../../constants/class';
import { MULTIVIEW_CHAT_ENABLED } from './chatFeature';
import { CONFIG_SHEET_CSS } from './configSheetCss';
import { upsertStyle } from '../../utils/dom';
import {
  computeSlotRects,
  fitListScrollHeight,
  isSplitAvailable,
  recommendedPlacement,
  resolveSlotChatLines,
  stripMetrics,
} from './slotLayout';
import {
  LIVES_PAGE_SIZE,
  fetchCurrentLives,
  fetchFollowings,
  fetchLivePage,
  parseChannelInput,
  type FollowChannel,
  type LiveCursor,
} from './followList';
import type { DeviceDecision } from '../../device';

const ALL_SLOTS: SlotIndex[] = [1, 2, 3, 4];
/** 스크롤로 자동 로드할 최대 페이지 수. 이후는 `더 보기` 를 눌러야 한다. */
const AUTO_LOAD_PAGE_LIMIT = 4;
/** 팔로우 채널을 한 번에 보여 주는 수 (요청 2026-08-20). */
const FOLLOW_PAGE_SIZE = 10;
const CIRCLED = ['①', '②', '③', '④'] as const;

type Props = {
  settings: Settings;
  device: DeviceDecision;
  /** 멀티 버튼을 누른 시점의 채널 — 1번 슬롯에 자동으로 채워진다. */
  currentChannel: { channelId: string; channelName: string } | null;
  stageSize: { width: number; height: number };
  onClose: () => void;
  onStart: (patch: Settings['multiView']) => void;
};

type ListState =
  | { kind: 'loading' }
  | { kind: 'ready'; channels: FollowChannel[] }
  /** 화면 ⑤ 폴백 */
  | { kind: 'fallback'; message: string; recent: FollowChannel[] };

export function ConfigSheet({
  settings,
  device,
  currentChannel,
  stageSize,
  onClose,
  onStart,
}: Props) {
  const maxSplit = device.profile.maxSplit;
  const [split, setSplit] = useState<SplitCount>(
    Math.min(settings.multiView.defaultSplit, maxSplit) as SplitCount,
  );
  const [slots, setSlots] = useState<MultiViewSlot[]>(() => {
    const base = settings.multiView.restoreLastLayout ? [...settings.multiView.slots] : [];
    if (currentChannel && !base.some((s) => s.index === 1)) {
      return [{ index: 1, ...currentChannel }, ...base.filter((s) => s.index !== 1)];
    }
    return base;
  });
  /**
   * 초점 슬롯(오디오 아님) — 사이드 채팅 대상·화질 우선순위용. 2026-08-20 정책 변경으로
   * 모든 슬롯이 소리를 내므로 여기서 고를 UI(오디오 라디오)는 없앴고, 배치된 첫 슬롯을 그대로 쓴다.
   */
  const activeSlot = settings.multiView.activeSlot;
  const [slotChatLines, setSlotChatLines] = useState<SlotLines>(settings.multiView.slotChatLines);
  const [placement, setPlacement] = useState(settings.multiView.slotChatPlacement);
  const [lowerQuality, setLowerQuality] = useState(settings.multiView.lowerInactiveQuality);
  const [query, setQuery] = useState('');
  const [manualInput, setManualInput] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [list, setList] = useState<ListState>({ kind: 'loading' });

  // 시트 전용 스타일. 시트가 열릴 때만 주입한다 (닫혀 있는 동안 규칙을 남기지 않는다).
  useEffect(() => {
    upsertStyle('cm-mv-sheet-style', CONFIG_SHEET_CSS);
  }, []);
  /**
   * 시청자 수 순 인기 방송. 팔로우 목록과 **독립적으로** 항상 보여 준다 —
   * 비로그인이면 팔로우 목록이 비어 고를 대상이 아예 없기 때문이다.
   * 처음 10개를 띄우고 아래로 스크롤하면 10개씩 더 불러온다 (요청 사양).
   */
  const [popular, setPopular] = useState<FollowChannel[]>([]);
  const [popularCursor, setPopularCursor] = useState<LiveCursor | null>(null);
  const [popularDone, setPopularDone] = useState(false);
  const [popularLoading, setPopularLoading] = useState(false);
  /**
   * 🔴 자동 로드에 상한을 둔다. 상한이 없으면 스크롤할수록 계속 불러와
   * 목록이 230개까지 자라고(실측) 사용자가 원하는 채널을 찾기보다 스크롤에 갇힌다.
   * 상한에 닿으면 `더 보기` 버튼으로 넘겨 **사용자가 원할 때만** 더 불러온다.
   */
  const [popularPages, setPopularPages] = useState(0);
  /**
   * 지금까지 보여 준 팔로우 채널 수 (요청 2026-08-20).
   * **팔로우를 10개씩 먼저** 보여 주고, 다 떨어지면 그때부터 인기 방송을 이어서 페이지네이션한다.
   */
  const [followVisible, setFollowVisible] = useState(FOLLOW_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const result = await fetchFollowings();
      if (!alive) return;
      if (result.ok) {
        setList({ kind: 'ready', channels: result.channels });
        return;
      }
      // 팔로우 목록을 못 읽으면 지금 방송 중 목록을 후보로 보여 준다.
      const lives = await fetchCurrentLives(8);
      if (!alive) return;
      const recent = settings.multiView.recentChannels.map((c) => ({
        channelId: c.channelId,
        channelName: c.channelName,
        live: false,
        concurrentUserCount: null,
        liveTitle: null,
        thumbnailUrl: null,
      }));
      setList({ kind: 'fallback', message: result.message, recent: [...recent, ...lives] });
    })();
    return () => {
      alive = false;
    };
  }, [settings.multiView.recentChannels]);

  const loadMorePopular = useCallback(async () => {
    // 중복 요청을 막는다. 관찰자는 스크롤 중 여러 번 발화한다.
    if (popularLoading || popularDone) return;
    setPopularPages((n) => n + 1);
    setPopularLoading(true);
    try {
      const page = await fetchLivePage(LIVES_PAGE_SIZE, popularCursor);
      setPopular((prev) => {
        // 같은 채널이 두 페이지에 걸쳐 오는 경우를 막는다 (커서 경계에서 실제로 생긴다).
        const seen = new Set(prev.map((c) => c.channelId));
        return [...prev, ...page.channels.filter((c) => !seen.has(c.channelId))];
      });
      setPopularCursor(page.next);
      // 커서가 없거나 빈 페이지면 끝이다 — 커서 형태 미확인이라 첫 페이지에서 멈출 수 있다.
      if (page.next === null || page.channels.length === 0) setPopularDone(true);
    } finally {
      setPopularLoading(false);
    }
  }, [popularCursor, popularDone, popularLoading]);

  // 첫 페이지
  useEffect(() => {
    void loadMorePopular();
    // 최초 1회만 — loadMorePopular 를 의존성에 넣으면 커서가 바뀔 때마다 다시 불린다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 센티넬이 보이면 다음 페이지를 불러온다. 상한에 닿으면 관찰을 멈춘다.
  useEffect(() => {
    setFollowVisible(FOLLOW_PAGE_SIZE);
  }, [query]);

  /**
   * 🔴 오프라인 팔로우 채널은 목록에서 아예 뺀다 (사용자 요청 2026-08-23).
   * 멀티뷰 슬롯은 지금 방송 중인 채널을 고르는 화면이라, 꺼진 채널을 골라도 빈 슬롯만
   * 남는다 — 정렬로 뒤로 미루는 것(`followList.ts` 의 `live` 우선 정렬)만으로는
   * 목록 절반이 고를 수 없는 항목으로 채워지는 문제가 그대로 남는다.
   */
  const visibleChannels = useMemo(() => {
    if (list.kind !== 'ready') return [];
    const live = list.channels.filter((c) => c.live);
    const q = query.trim().toLowerCase();
    if (q.length === 0) return live;
    return live.filter((c) => c.channelName.toLowerCase().includes(q));
  }, [list, query]);

  /** 팔로우를 끝까지 보여 줬는가 — 인기 방송을 이어 붙일지 판단한다. */
  const followExhausted = list.kind !== 'ready' || followVisible >= visibleChannels.length;

  useEffect(() => {
    const node = sentinelRef.current;
    /*
     * 🔴 순서가 바뀌었다 (요청 2026-08-20): **팔로우 먼저, 다 떨어지면 인기 방송.**
     * 센티널이 보일 때 아직 못 보여 준 팔로우가 있으면 팔로우를 10개 더 펼치고,
     * 없을 때만 인기 방송 다음 페이지를 부른다.
     */
    const followRemaining = list.kind === 'ready' && followVisible < visibleChannels.length;
    if (!node) return;
    if (!followRemaining && (popularDone || popularPages >= AUTO_LOAD_PAGE_LIMIT)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (followRemaining) {
          setFollowVisible((n) => n + FOLLOW_PAGE_SIZE);
          return;
        }
        void loadMorePopular();
      },
      { rootMargin: '120px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMorePopular, popularDone, popularPages, list, followVisible, visibleChannels.length]);

  /**
   * 🔴 목록 스크롤 영역 높이를 **본문 가시 영역 안에서** 행 배수로 맞춘다.
   * 고정값(예전 `max-height: min(48vh, 420px)`)을 쓰면 스크롤 상자 바닥이 하단 푸터 뒤로
   * 들어가 마지막 행의 배치 버튼을 누를 수 없었다 (실측 2026-08-15, configSheetCss.ts 주석 참조).
   * §FR-12.1 대로 창 크기가 바뀌면 다시 잰다 — 값을 캐시하지 않는다.
   */
  useEffect(() => {
    const scroll = scrollRef.current;
    const body = scroll?.closest('.cm-sheet__body') as HTMLElement | null;
    if (!scroll || !body) return;

    const apply = () => {
      const rows = scroll.querySelectorAll<HTMLLIElement>('.cm-mv-channels > li');
      const first = rows[0];
      const second = rows[1];
      if (!first || !second) return;
      const bodyBox = body.getBoundingClientRect();
      const padBottom = parseFloat(getComputedStyle(body).paddingBottom) || 0;
      const scrollTopY = scroll.getBoundingClientRect().top;
      const available = bodyBox.bottom - padBottom - scrollTopY;
      const firstTop = first.getBoundingClientRect().top;
      const headOffset = firstTop - scrollTopY + scroll.scrollTop;
      const rowPitch = second.getBoundingClientRect().top - firstTop;
      // 본문이 넘쳐 스크롤 영역이 이미 화면 밖이면 건드리지 않는다 (CSS 기본값에 맡긴다).
      if (available < headOffset + rowPitch) {
        scroll.style.maxHeight = '';
        return;
      }
      scroll.style.maxHeight = `${fitListScrollHeight(available, headOffset, rowPitch)}px`;
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(body);
    return () => observer.disconnect();
  }, [popular.length, list, split, device.profile.touchTargetPx]);

  const usableSlots = useMemo(() => ALL_SLOTS.slice(0, split), [split]);
  const placedSlots = useMemo(() => slots.filter((slot) => slot.index <= split), [slots, split]);

  /** 현재 분할·무대 크기에서의 슬롯·영상 크기. 목업의 "현재 선택" 요약에 쓴다. */
  const preview = useMemo(() => {
    const rects = computeSlotRects(split, stageSize.width, stageSize.height);
    const first = rects[0];
    if (!first) return null;
    const lines = resolveSlotChatLines(slotChatLines, first.width, device.deviceClass);
    const metrics = stripMetrics(
      first.width,
      first.height,
      lines,
      placement,
      settings.chatFont.slotPx,
    );
    return { rect: first, lines, metrics };
  }, [split, stageSize, slotChatLines, placement, device.deviceClass, settings.chatFont.slotPx]);

  const assign = (channel: FollowChannel, index: SlotIndex) => {
    setSlots((prev) => {
      // 같은 채널이 다른 슬롯에 있으면 옮긴다 (중복 배치 금지).
      const withoutChannel = prev.filter((s) => s.channelId !== channel.channelId);
      const withoutSlot = withoutChannel.filter((s) => s.index !== index);
      return [
        ...withoutSlot,
        { index, channelId: channel.channelId, channelName: channel.channelName },
      ].sort((a, b) => a.index - b.index);
    });
  };

  const clearSlot = (index: SlotIndex) => {
    setSlots((prev) => prev.filter((slot) => slot.index !== index));
  };

  const placedIndexOf = (channelId: string): SlotIndex | null =>
    slots.find((slot) => slot.channelId === channelId && slot.index <= split)?.index ?? null;

  /** 채널 하나를 각 슬롯에 배치하는 버튼 묶음. 팔로우·인기·최근 목록이 공유한다. */
  const slotButtons = (channel: FollowChannel) =>
    usableSlots.map((index) => (
      <button
        key={index}
        type="button"
        className="cm-sheet__btn"
        aria-label={`${channel.channelName} 을 슬롯 ${index} 에 배치`}
        onClick={() => assign(channel, index)}
      >
        {CIRCLED[index - 1]}
      </button>
    ));

  const firstEmptySlot = (): SlotIndex | null =>
    usableSlots.find((index) => !slots.some((slot) => slot.index === index)) ?? null;

  const addManual = () => {
    const channelId = parseChannelInput(manualInput);
    if (!channelId) {
      setManualError('채널 주소 또는 채널 ID 형식이 아닙니다.');
      return;
    }
    const index = firstEmptySlot();
    if (index === null) {
      setManualError('빈 슬롯이 없습니다. 슬롯을 비우고 다시 시도해 주세요.');
      return;
    }
    setManualError(null);
    setManualInput('');
    assign(
      {
        channelId,
        channelName: channelId.slice(0, 8),
        live: false,
        concurrentUserCount: null,
        liveTitle: null,
        thumbnailUrl: null,
      },
      index,
    );
  };

  const start = () => {
    onStart({
      ...settings.multiView,
      enabled: true,
      defaultSplit: split,
      slots: placedSlots,
      activeSlot: placedSlots.some((s) => s.index === activeSlot)
        ? activeSlot
        : (placedSlots[0]?.index ?? 1),
      slotChatLines,
      slotChatPlacement: placement,
      lowerInactiveQuality: lowerQuality,
    });
  };

  return (
    <Sheet
      title="멀티뷰 구성"
      beta
      onClose={onClose}
      touchTargetPx={device.profile.touchTargetPx}
      footer={
        <>
          <span className="cm-sheet__note" style={{ marginRight: 'auto' }}>
            {preview
              ? `현재 선택: ${split}분할 · 슬롯 ${preview.rect.width}×${preview.rect.height} · 영상 ${Math.round(preview.metrics.pictureW)}×${Math.round(preview.metrics.pictureH)}${preview.metrics.areaLoss > 0 ? ` (영상 −${(preview.metrics.areaLoss * 100).toFixed(1)}%)` : ' (여백 0)'}`
              : '무대 크기를 계산할 수 없습니다.'}
          </span>
          <button type="button" className="cm-sheet__btn" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="cm-sheet__btn cm-sheet__btn--primary"
            disabled={placedSlots.length < 2}
            aria-label="멀티뷰 시작"
            onClick={start}
          >
            멀티뷰 시작
          </button>
        </>
      }
    >
      <div className="cm-sheet__row">
        <fieldset className="cm-mv-splits">
          <legend>분할</legend>
          {([2, 3, 4] as SplitCount[]).map((value) => {
            const available = isSplitAvailable(value, device.deviceClass);
            return (
              <label key={value} className={available ? '' : 'cm-disabled'}>
                <input
                  type="radio"
                  name="cm-split"
                  value={value}
                  checked={split === value}
                  disabled={!available}
                  onChange={() => {
                    setSplit(value);
                    setPlacement(recommendedPlacement(value));
                  }}
                />
                {value}분할
              </label>
            );
          })}
        </fieldset>
        <button type="button" className="cm-sheet__btn" onClick={() => setSlots([])}>
          초기화
        </button>
      </div>
      {maxSplit === 2 ? (
        <p className="cm-sheet__note">
          이 기기({device.deviceClass})에서는 개별 영상이 너무 작아져 3·4분할을 제공하지 않습니다.
        </p>
      ) : null}

      {/*
        🔴 조작 요소는 **모두 상단에 모은다** (2026-08-12 요청).
        채널 목록이 길어지면 아래에 둔 설정은 스크롤에 밀려 도달하기 어려워진다 —
        실제로 목록이 230개까지 자라 아래 설정에 접근할 수 없었다.
        아래 2단 영역(슬롯 배치 · 채널 목록)은 화면을 채우며 스크롤되는 부분이라 마지막에 둔다.
      */}
      {/*
        멀티뷰 채팅은 임시로 꺼 두었다 (`chatFeature.ts`, 2026-08-22) — 줄 수·배치를 고를 수
        있게 두면 "설정했는데 아무것도 안 나온다"가 된다. 선택 UI 자체를 감춘다.
      */}
      {MULTIVIEW_CHAT_ENABLED ? (
        <>
          <div className="cm-mv-options">
            <span>슬롯 채팅 줄</span>
            <span className="cm-stepper">
              <button
                type="button"
                aria-label="슬롯 채팅 줄 줄이기"
                disabled={slotChatLines <= 0}
                onClick={() => setSlotChatLines((n) => Math.max(0, n - 1) as SlotLines)}
              >
                <MinusIcon />
              </button>
              <output>{slotChatLines}</output>
              <button
                type="button"
                aria-label="슬롯 채팅 줄 늘리기"
                disabled={slotChatLines >= 5}
                onClick={() => setSlotChatLines((n) => Math.min(5, n + 1) as SlotLines)}
              >
                <PlusIcon />
              </button>
            </span>
            <label>
              <input
                type="radio"
                name="cm-placement"
                checked={placement === 'overlay'}
                onChange={() => setPlacement('overlay')}
              />
              영상 위 겹침
            </label>
            <label>
              <input
                type="radio"
                name="cm-placement"
                checked={placement === 'reserve'}
                onChange={() => setPlacement('reserve')}
              />
              영상 밑에 따로 표시(영상이 작아집니다)
            </label>
          </div>
          {preview && preview.lines !== slotChatLines ? (
            <p className="cm-sheet__note">
              슬롯 폭 {preview.rect.width}px 에서는 최대 {preview.lines}줄까지 표시됩니다.
            </p>
          ) : null}
          <p className="cm-sheet__note">
            {split === 2
              ? '2분할은 세로에 여유가 있어 영상 밑 배치를 권장합니다 (손실 0%).'
              : '4분할 슬롯은 이미 16:9 라 영상 위 겹침을 권장합니다.'}
          </p>
        </>
      ) : null}

      <div className="cm-mv-options">
        <label>
          <input
            type="checkbox"
            checked={lowerQuality}
            onChange={(e) => setLowerQuality(e.target.checked)}
          />
          비활성 슬롯 화질 720p 로 낮추기 (데이터 절약)
        </label>
      </div>

      <div className="cm-mv-columns">
        <section>
          <h3>슬롯 배치</h3>
          <div className="cm-mv-grid" data-split={split}>
            {usableSlots.map((index) => {
              const slot = slots.find((s) => s.index === index);
              return (
                <div key={index} className="cm-mv-cell">
                  <div className="cm-mv-cell__head">
                    <span>
                      {CIRCLED[index - 1]}{' '}
                      {slot ? (
                        <>
                          {/* 배치된 슬롯의 실제 방송 여부는 저장하지 않는다 — 항상 강조색으로 표시 (미검증: 오프라인 배치와 구분 없음). */}
                          <LiveDotIcon size={10} className="cm-mv-live--on" /> {slot.channelName}
                        </>
                      ) : (
                        <>
                          <PlusIcon size={12} /> 비어 있음
                        </>
                      )}
                    </span>
                    {slot ? (
                      <button
                        type="button"
                        className="cm-sheet__btn"
                        aria-label={`슬롯 ${index} 비우기`}
                        onClick={() => clearSlot(index)}
                      >
                        <CloseIcon size={12} />
                      </button>
                    ) : null}
                  </div>
                  {slot ? (
                    index === 1 && slot.channelId === currentChannel?.channelId ? (
                      <p className="cm-sheet__note">(현재 시청)</p>
                    ) : null
                  ) : (
                    <p className="cm-sheet__note">오른쪽 목록에서 고르세요</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="cm-mv-list">
          <div className="cm-mv-scroll" ref={scrollRef}>
            {/*
              🔴 팔로우 우선 (사용자 보고 2026-08-20): 팔로우한 채널을 먼저 보여 주고,
              다 보여 준 뒤에만 인기 방송을 이어 붙인다. 비로그인·조회 실패(fallback)면
              팔로우 목록이 아예 없어 `followExhausted` 가 곧바로 true 가 되므로
              인기 방송이 바로 나온다 — 목록이 통째로 비는 일이 없다.
              이 섹션은 하나뿐이다 — `scrollRef`·`sentinelRef` 도 각각 한 번만 붙는다
              (예전에는 인기 방송 블록이 두 벌 있어 같은 ref 를 두 번 달았고, 나중에
              마운트된 쪽만 살아남아 앞쪽 높이 계산이 죽었다).
            */}
            {list.kind === 'loading' ? (
              <p className="cm-sheet__note">팔로우 목록을 읽는 중…</p>
            ) : null}

            {list.kind === 'ready' ? (
              <>
                <div className="cm-sheet__row">
                  <h3>
                    팔로우한 채널 ({Math.min(followVisible, visibleChannels.length)}/
                    {visibleChannels.length})
                  </h3>
                  <input
                    type="text"
                    aria-label="채널 검색"
                    placeholder="검색"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                {visibleChannels.length === 0 ? (
                  <p className="cm-sheet__note">
                    {list.channels.length === 0
                      ? '팔로우한 채널이 없습니다.'
                      : query.trim().length > 0
                        ? '검색 결과가 없습니다.'
                        : '지금 방송 중인 팔로우 채널이 없습니다.'}
                  </p>
                ) : null}
                <ul className="cm-mv-channels">
                  {visibleChannels.slice(0, followVisible).map((channel) => {
                    const placedAt = placedIndexOf(channel.channelId);
                    return (
                      <li key={channel.channelId}>
                        <ChannelInfo channel={channel} />
                        <span className="cm-sheet__note">
                          {formatViewers(channel.concurrentUserCount)}
                        </span>
                        {placedAt !== null ? (
                          <span className="cm-sheet__note">· 배치됨 {CIRCLED[placedAt - 1]}</span>
                        ) : (
                          <span>{slotButtons(channel)}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : null}

            {list.kind === 'fallback' ? (
              <>
                <p className="cm-sheet__warn">⚠ 팔로우한 채널 목록을 가져올 수 없습니다.</p>
                <p className="cm-sheet__note">{list.message}</p>
                <div className="cm-sheet__row">
                  <label htmlFor="cm-manual-channel">채널 주소 또는 채널 ID</label>
                  <input
                    id="cm-manual-channel"
                    type="text"
                    aria-label="채널 주소 또는 채널 ID"
                    placeholder="https://chzzk.naver.com/live/…"
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addManual();
                    }}
                  />
                  <button type="button" className="cm-sheet__btn" onClick={addManual}>
                    추가
                  </button>
                </div>
                {manualError ? <p className="cm-sheet__warn">{manualError}</p> : null}

                <h3>최근 배치한 채널</h3>
                {list.recent.length === 0 ? (
                  <p className="cm-sheet__note">기록이 없습니다.</p>
                ) : (
                  <ul className="cm-mv-channels">
                    {list.recent.map((channel) => (
                      <li key={channel.channelId}>
                        <ChannelInfo channel={channel} />
                        <span>{slotButtons(channel)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : null}

            {/*
              🔴 순서 (요청 2026-08-20): **팔로우 → 인기 방송.** 팔로우가 남아 있는 동안에는
              인기 방송을 보여 주지 않는다 — 스크롤로 팔로우를 다 본 뒤 이어서 나온다.
              비로그인·fallback 이면 `followExhausted` 가 처음부터 true 라 여기로 바로 진입한다.
            */}
            {followExhausted ? (
              <>
                <h3>시청자 수 많은 방송 ({popular.length})</h3>
                {popular.length === 0 && popularLoading ? (
                  <p className="cm-sheet__note">불러오는 중…</p>
                ) : null}
                {popular.length === 0 && !popularLoading ? (
                  <p className="cm-sheet__note">목록을 가져올 수 없습니다.</p>
                ) : null}
                <ul className="cm-mv-channels">
                  {popular.map((channel, order) => {
                    const placedAt = placedIndexOf(channel.channelId);
                    return (
                      <li key={channel.channelId}>
                        <ChannelInfo channel={channel} order={order + 1} />
                        <span className="cm-sheet__note">
                          {formatViewers(channel.concurrentUserCount)}
                        </span>
                        {placedAt !== null ? (
                          <span className="cm-sheet__note">· 배치됨 {CIRCLED[placedAt - 1]}</span>
                        ) : (
                          <span>{slotButtons(channel)}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {popularLoading && popular.length > 0 ? (
                  <p className="cm-sheet__note">더 불러오는 중…</p>
                ) : null}
                {popularDone && popular.length > 0 ? (
                  <p className="cm-sheet__note">목록의 끝입니다.</p>
                ) : null}
                {!popularDone && !popularLoading && popularPages >= AUTO_LOAD_PAGE_LIMIT ? (
                  <button
                    type="button"
                    className="cm-sheet__btn"
                    onClick={() => void loadMorePopular()}
                  >
                    더 보기 (30개)
                  </button>
                ) : null}
              </>
            ) : null}

            {/* 센티널은 섹션 전체에 하나만 둔다 — 팔로우가 남아 있으면 팔로우를, 다 보여 줬으면 인기 방송을 이어서 불러온다. */}
            <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />
          </div>
        </section>
      </div>
    </Sheet>
  );
}

/**
 * 목록 한 행의 썸네일 + 채널명 + 방송 제목 (사용자 요청 2026-08-23).
 * 팔로우 목록은 스키마가 미확인이라 `thumbnailUrl`·`liveTitle` 이 없을 수 있다 —
 * 그때는 채널명만 보여 준다(레이아웃이 깨지지 않는다).
 */
function ChannelInfo({
  channel,
  order,
}: {
  channel: FollowChannel;
  /** 인기 방송 목록의 순위. 팔로우 목록에는 없다. */
  order?: number;
}) {
  return (
    <span className="cm-mv-info">
      {channel.thumbnailUrl ? (
        <img className="cm-mv-thumb" src={channel.thumbnailUrl} alt="" aria-hidden="true" />
      ) : null}
      <span className="cm-mv-info__text">
        <span className="cm-mv-info__name">
          {order !== undefined ? <span className="cm-sheet__note">{order}</span> : null}
          {channel.live ? (
            <>
              <LiveDotIcon size={10} className="cm-mv-live--on" />
              {/* 🔴 색만으로 상태를 전달하지 않는다 — 색약 사용자를 위해 텍스트를 남긴다. */}
              <span className={OURS.srOnlyClass}>방송중</span>
            </>
          ) : null}
          {channel.channelName}
        </span>
        {channel.liveTitle ? <span className="cm-mv-info__title">{channel.liveTitle}</span> : null}
      </span>
    </span>
  );
}

function formatViewers(count: number | null): string {
  if (count === null) return '';
  if (count >= 10_000) return `${(count / 10_000).toFixed(1)}만`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}천`;
  return String(count);
}
