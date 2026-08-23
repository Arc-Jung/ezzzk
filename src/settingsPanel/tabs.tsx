/**
 * 화면 ⑦ 설정 패널의 탭 정의 + 재생 · 소리 · 레이아웃 · 기타 탭 본문 (FR-09.2).
 *
 * 공통 규칙 (목업 "공통 UI 규칙")
 * - 변경은 즉시 저장된다. "저장" 버튼은 어디에도 두지 않는다.
 * - 값이 있는 항목은 현재 값을 항상 숫자로 보여준다 (`14 px`, `3줄`, `30%`).
 * - 호버로만 드러나는 요소를 두지 않고, 모든 컨트롤에 `aria-label` 을 준다.
 * - 고정값(채팅 353px)만 상수로 두고 가변값(뷰포트·슬롯·스크롤러)은 매번 계산한다.
 */

import type { ReactNode } from 'react';
import { DEVICE_CLASSES } from '../constants/device';
import {
  CHAT_WIDTH_RANGE,
  DEFAULT_SETTINGS,
  type QualityTarget,
  type Settings,
} from '../constants/storage';
import type { DeviceDecision } from '../device';
import { MAX_BOOST_PERCENT } from '../features/audioPipeline';
import { VOLUME_STEPS } from '../features/volume';
import { chatRatioRangeFor } from '../features/chatWidth';
import { activeClaim } from '../layoutArbiter';
import { computeSlotRects, stripMetrics } from '../features/multiView/slotLayout';
import { Stepper } from '../popup/Stepper';

export const TAB_IDS = [
  'playback',
  'sound',
  'layout',
  'multiView',
  'chat',
  'misc',
  'preset',
  'licenses',
] as const;

export type TabId = (typeof TAB_IDS)[number];

/**
 * 좌측 탭 레일 순서. 목업 화면 ⑦ 의 순서를 그대로 따르고, 고지 성격인 라이선스를 맨 뒤에 둔다.
 *
 * 라이선스는 예전에 시트 하단의 별도 진입점이었다 — 눌러야 나오는 화면 하나를 위해
 * `showLicenses` 상태와 시트 교체 로직을 따로 들고 있었다. 독립 화면일 만큼의 기능이 아니라
 * 탭으로 접었다 (요청 2026-08-21).
 */
export const TABS: readonly { id: TabId; title: string }[] = [
  { id: 'playback', title: '재생' },
  { id: 'sound', title: '소리' },
  { id: 'layout', title: '레이아웃' },
  { id: 'multiView', title: '멀티뷰' },
  { id: 'chat', title: '채팅' },
  { id: 'misc', title: '기타' },
  { id: 'preset', title: '프리셋' },
  { id: 'licenses', title: '오픈소스 라이선스' },
] as const;

/**
 * `[ 이 탭 초기화 ]` 가 되돌릴 설정 섹션. 탭에서 노출하는 값과 1:1 로 대응해야 한다 —
 * 어긋나면 "초기화했는데 값이 그대로"인 상태가 만들어진다.
 *
 * 빈 배열은 **되돌릴 설정이 없는 탭**(라이선스 고지)이다. 이때 패널은 `[ 이 탭 초기화 ]`
 * 자체를 렌더하지 않는다 — 눌러도 아무 일이 없는 버튼을 두지 않는다 (FR-15).
 */
export function sectionsForTab(tab: TabId): readonly (keyof Settings)[] {
  switch (tab) {
    case 'playback':
      return ['quality'];
    case 'sound':
      return ['volume'];
    case 'layout':
      return ['chatWidth', 'wideScreen', 'ultraWide'];
    case 'multiView':
      return ['multiView'];
    case 'chat':
      return ['chatFont', 'chatPresets', 'chatPresetBehavior', 'chatUserFilter', 'chatClutter'];
    case 'misc':
      return ['powerCollect', 'promoHide', 'adSkip', 'device', 'debug'];
    case 'preset':
      return ['optionPresets', 'activePresetId'];
    case 'licenses':
      return [];
  }
}

/** 사이드 채팅 aside 폭 (실측 고정값, 뷰포트와 무관). 점유율 안내의 분자다. */
export const SIDE_CHAT_PX = 353;

/**
 * 목업의 `└ 현재 353px = 18.4%`.
 * 353 은 고정값이지만 **퍼센트는 뷰포트 폭에 따라 달라진다** — 18.4 를 상수로 박지 않는다.
 */
export function chatOccupancyText(viewportWidth: number): string {
  if (viewportWidth <= 0) return `└ 현재 ${SIDE_CHAT_PX}px`;
  const percent = (SIDE_CHAT_PX / viewportWidth) * 100;
  return `└ 현재 ${SIDE_CHAT_PX}px = ${percent.toFixed(1)}%`;
}

/** 손실률 표기 — 0 은 `0%`, 그 외는 소수 첫째 자리까지. */
export function formatLoss(loss: number): string {
  return loss <= 0 ? '0' : (loss * 100).toFixed(1);
}

/** 배치 안내를 만들 때 쓰는 기준 무대 크기 (1920×1080 실측 기준선). */
export const REFERENCE_STAGE = { width: 1920, height: 1080 } as const;

/**
 * 멀티뷰 탭의 배치 트레이드오프 안내.
 * 퍼센트는 `stripMetrics` 로 계산한다 — 문서의 20.0% 를 문자열로 박지 않는다.
 * 4분할은 현재 설정 줄 수로, 2분할은 상한(5줄) 최악값으로 계산해 "그래도 손실 0%"를 보여준다.
 */
export function placementTradeOff(
  lines: number,
  slotFontPx: number,
  stage: { width: number; height: number } = REFERENCE_STAGE,
): { four: string; two: string } {
  const four = computeSlotRects(4, stage.width, stage.height)[0];
  const two = computeSlotRects(2, stage.width, stage.height)[0];
  const fourLoss = four
    ? stripMetrics(four.width, four.height, lines, 'reserve', slotFontPx).areaLoss
    : 0;
  const twoLoss = two ? stripMetrics(two.width, two.height, 5, 'reserve', slotFontPx).areaLoss : 0;
  return {
    four: `4분할: 겹침 권장 (밑 배치 시 ${lines}줄=−${formatLoss(fourLoss)}%)`,
    two: `2분할: 밑 배치 권장 (손실 ${formatLoss(twoLoss)}%)`,
  };
}

export type TabProps = {
  settings: Settings;
  device: DeviceDecision;
  update: (patch: Partial<Settings>) => void;
};

/** 켜기/끄기 토글. 체크박스가 아니라 `role="switch"` 로 현재 상태를 글자로도 보여준다. */
export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  hint?: ReactNode;
}) {
  return (
    <>
      <div className="cm-sheet__row">
        <span>{label}</span>
        <button
          type="button"
          className="cm-sp__toggle"
          role="switch"
          aria-checked={checked}
          aria-label={`${label} ${checked ? '켜짐' : '꺼짐'}`}
          onClick={() => onChange(!checked)}
        >
          {/* 색약 사용자는 트랙 색을 구분 못 하므로 켜기/끄기 글자를 스위치 옆에 그대로 둔다. */}
          <span className="cm-sp__toggle-text">{checked ? '켜기' : '끄기'}</span>
          <span className="cm-sp__toggle-track">
            <span className="cm-sp__toggle-knob" />
          </span>
        </button>
      </div>
      {hint}
    </>
  );
}

/** 개별 항목의 "기본값으로 되돌리기". 목업에서 되돌리기를 표시한 항목에만 붙인다. */
export function RevertButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="cm-sheet__btn"
      aria-label={`${label} 기본값으로 되돌리기`}
      onClick={onClick}
    >
      ↺ 기본값
    </button>
  );
}

const QUALITY_OPTIONS: { value: QualityTarget; title: string }[] = [
  { value: 'auto', title: '자동' },
  { value: '1080p', title: '1080p' },
  { value: '720p', title: '720p' },
  { value: '480p', title: '480p' },
  { value: 'best', title: '최고화질' },
];

export function PlaybackTab({ settings, update }: TabProps) {
  const quality = settings.quality;
  return (
    <>
      <Toggle
        label="화질 자동 적용"
        checked={quality.enabled}
        onChange={(next) => update({ quality: { ...quality, enabled: next } })}
      />
      <div className="cm-sheet__row">
        <span>목표 화질</span>
        <span className="cm-sp__controls">
          <select
            aria-label="목표 화질"
            value={quality.target}
            onChange={(event) =>
              update({ quality: { ...quality, target: event.target.value as QualityTarget } })
            }
          >
            {QUALITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.title}
              </option>
            ))}
          </select>
          <RevertButton
            label="목표 화질"
            onClick={() =>
              update({ quality: { ...quality, target: DEFAULT_SETTINGS.quality.target } })
            }
          />
        </span>
      </div>
      <p className="cm-sheet__note">└ 목록에 없으면 최고 화질로 대체</p>
      <p className="cm-sheet__note">
        └ VOD 의 &apos;자동 (1080p)&apos; 은 이미 달성으로 간주해 건드리지 않음
      </p>
      <Toggle
        label="VOD에도 적용"
        checked={quality.applyToVod}
        onChange={(next) => update({ quality: { ...quality, applyToVod: next } })}
      />
    </>
  );
}

export function SoundTab({ settings, update }: TabProps) {
  const volume = settings.volume;
  const compressor = settings.audio.compressor;
  return (
    <>
      <Toggle
        label="자동 음소거 해제"
        checked={volume.autoUnmute}
        onChange={(next) => update({ volume: { ...volume, autoUnmute: next } })}
      />
      <div className="cm-sheet__row">
        <span>기본 볼륨</span>
        <span className="cm-sp__controls">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            aria-label="기본 볼륨"
            value={volume.defaultLevel}
            onChange={(event) =>
              update({ volume: { ...volume, defaultLevel: Number(event.target.value) } })
            }
          />
          <output aria-label="기본 볼륨 현재 값">{volume.defaultLevel}%</output>
          <RevertButton
            label="기본 볼륨"
            onClick={() =>
              update({
                volume: { ...volume, defaultLevel: DEFAULT_SETTINGS.volume.defaultLevel },
              })
            }
          />
        </span>
      </div>
      <div className="cm-sheet__row">
        <span>볼륨 증감 폭</span>
        <span className="cm-sp__controls" role="radiogroup" aria-label="볼륨 증감 폭">
          {VOLUME_STEPS.map((step) => (
            <label key={step}>
              <input
                type="radio"
                name="cm-volume-step"
                checked={volume.step === step}
                aria-label={`볼륨 증감 폭 ${step}%`}
                onChange={() => update({ volume: { ...volume, step } })}
              />
              {step}%
            </label>
          ))}
        </span>
      </div>
      <Toggle
        label="이전 볼륨 유지"
        checked={volume.restoreLast}
        onChange={(next) => update({ volume: { ...volume, restoreLast: next } })}
      />
      <p className="cm-sheet__warn">
        ⚠ 브라우저 정책상 최초 클릭 전까지 음소거 해제가 미뤄질 수 있습니다.
      </p>

      {/*
        FR-03.2 증폭 · FR-19 컴프레서 (2026-08-20).
        `video.volume` 은 0~1 이라 100% 를 넘길 수 없어 Web Audio 로 증폭한다 — 실측으로
        200% 까지 정확히 곱해지는 것을 확인했다(`scripts/probe-volume-boost.mjs`).
      */}
      <h3>소리 키우기 · 다듬기</h3>
      <p className="cm-sheet__note">
        볼륨은 컨트롤바 `+` 로 최대 {MAX_BOOST_PERCENT}% 까지 올릴 수 있습니다. 100% 를 넘으면
        표시가 주황색으로 바뀝니다 — 원본보다 크게 트는 상태라 방송에 따라 소리가 찢어질 수
        있습니다.
      </p>
      <Toggle
        label="음량 평탄화(컴프레서)"
        checked={compressor.enabled}
        onChange={(next) =>
          update({ audio: { ...settings.audio, compressor: { ...compressor, enabled: next } } })
        }
      />
      <p className="cm-sheet__note">
        방송마다 들쭉날쭉한 음량을 눌러 균일하게 만듭니다. 작은 소리는 잘 들리고 큰 소리는 덜
        튑니다.
      </p>
      <div className="cm-sheet__row">
        <span>누르기 시작하는 세기</span>
        <span className="cm-sp__controls">
          <input
            type="range"
            min={-100}
            max={0}
            step={1}
            aria-label="컴프레서 threshold"
            value={compressor.threshold}
            disabled={!compressor.enabled}
            onChange={(event) =>
              update({
                audio: {
                  ...settings.audio,
                  compressor: { ...compressor, threshold: Number(event.target.value) },
                },
              })
            }
          />
          <output aria-label="컴프레서 threshold 현재 값">{compressor.threshold}dB</output>
          <RevertButton
            label="컴프레서 threshold"
            onClick={() =>
              update({
                audio: {
                  ...settings.audio,
                  compressor: {
                    ...compressor,
                    threshold: DEFAULT_SETTINGS.audio.compressor.threshold,
                  },
                },
              })
            }
          />
        </span>
      </div>
      <div className="cm-sheet__row">
        <span>누르는 비율</span>
        <span className="cm-sp__controls">
          <input
            type="range"
            min={1}
            max={20}
            step={1}
            aria-label="컴프레서 ratio"
            value={compressor.ratio}
            disabled={!compressor.enabled}
            onChange={(event) =>
              update({
                audio: {
                  ...settings.audio,
                  compressor: { ...compressor, ratio: Number(event.target.value) },
                },
              })
            }
          />
          <output aria-label="컴프레서 ratio 현재 값">{compressor.ratio}:1</output>
          <RevertButton
            label="컴프레서 ratio"
            onClick={() =>
              update({
                audio: {
                  ...settings.audio,
                  compressor: { ...compressor, ratio: DEFAULT_SETTINGS.audio.compressor.ratio },
                },
              })
            }
          />
        </span>
      </div>
      <p className="cm-sheet__note">
        구현은 오픈소스 chzzk-plus(MIT)의 오디오 컴프레서를 참고했습니다 — 설정 → 오픈소스
        라이선스에 고지되어 있습니다.
      </p>
    </>
  );
}

/** 조절 단위 후보(%) — FR-05. */
const CHAT_WIDTH_STEPS = [1, 2, 5, 10] as const;

export function LayoutTab({
  settings,
  update,
  viewportWidth,
  viewportHeight,
}: TabProps & { viewportWidth: number; viewportHeight: number }) {
  const { chatWidth, wideScreen, ultraWide } = settings;
  /**
   * 🔴 스테퍼 범위는 **지금 적용 중인 배치**를 따른다 (실측 2026-08-16, 412×915).
   * 세로 하단 배치의 자동 점유율은 74.6% 라 저장 상한 50 을 넘는다 — 그대로 두면 `+` 가
   * 영구 비활성이고 `−` 는 50% 로 끌려 내려가며 값이 튄다.
   * 배치는 저장값(`chatWidth.placement`)이 아니라 **폭 조정자가 실제로 적용한 모드**를 읽는다.
   * 자동 하단 배치는 저장하지 않으므로(자동값을 저장하면 가로로 돌아와도 하단에 눌러앉는다)
   * 저장값만 보면 세로에서 `right` 로 오판한다.
   */
  const ratioRange = chatRatioRangeFor(
    activeClaim()?.mode === 'bottom' ? 'bottom' : 'right',
    { width: viewportWidth, height: viewportHeight },
    CHAT_WIDTH_RANGE.min,
    CHAT_WIDTH_RANGE.max,
  );
  return (
    <>
      <div className="cm-sheet__row">
        <span>채팅창 점유율</span>
        <span className="cm-sp__controls">
          <Stepper
            label="채팅창 점유율"
            value={chatWidth.ratio}
            min={ratioRange.min}
            max={ratioRange.max}
            step={chatWidth.step}
            unit=" %"
            onChange={(next) =>
              // 직접 조절하면 기기별 기본값보다 이 값이 우선한다 (FR-12 연동).
              update({ chatWidth: { ...chatWidth, ratio: next, ratioSource: 'manual' } })
            }
          />
          <span className="cm-sheet__note">
            ({ratioRange.min}~{ratioRange.max})
          </span>
          <RevertButton
            label="채팅창 점유율"
            onClick={() =>
              update({
                chatWidth: {
                  ...chatWidth,
                  ratio: DEFAULT_SETTINGS.chatWidth.ratio,
                  // auto 로 되돌리면 기기 유형별 기본 점유율을 다시 따른다.
                  ratioSource: 'auto',
                },
              })
            }
          />
        </span>
      </div>
      <p className="cm-sheet__note">{chatOccupancyText(viewportWidth)}</p>

      <div className="cm-sheet__row">
        <span>조절 단위</span>
        <select
          aria-label="채팅 폭 조절 단위"
          value={chatWidth.step}
          onChange={(event) =>
            update({ chatWidth: { ...chatWidth, step: Number(event.target.value) } })
          }
        >
          {CHAT_WIDTH_STEPS.map((step) => (
            <option key={step} value={step}>
              {step}%
            </option>
          ))}
        </select>
      </div>

      <Toggle
        label="자동 넓은 화면"
        checked={wideScreen.enabled}
        onChange={(next) => update({ wideScreen: { enabled: next } })}
      />
      <Toggle
        label="초광폭 가로 모드"
        checked={ultraWide.enabled}
        onChange={(next) => update({ ultraWide: { ...ultraWide, enabled: next } })}
      />
      <div className="cm-sheet__row">
        <span>└ 최소 채팅 폭</span>
        <span className="cm-sp__controls">
          <Stepper
            label="최소 채팅 폭"
            value={ultraWide.minChatPx}
            min={100}
            max={400}
            step={10}
            unit=" px"
            onChange={(next) => update({ ultraWide: { ...ultraWide, minChatPx: next } })}
          />
          <RevertButton
            label="최소 채팅 폭"
            onClick={() =>
              update({
                ultraWide: { ...ultraWide, minChatPx: DEFAULT_SETTINGS.ultraWide.minChatPx },
              })
            }
          />
        </span>
      </div>
      <Toggle
        label="└ 좁으면 오버레이"
        checked={ultraWide.overlayFallback}
        onChange={(next) => update({ ultraWide: { ...ultraWide, overlayFallback: next } })}
      />
      <div className="cm-sheet__row">
        <span>└ 영상 위치 (초광폭 전체)</span>
        <select
          aria-label="초광폭 영상 위치"
          value={ultraWide.videoAlign}
          onChange={(event) =>
            update({
              ultraWide: {
                ...ultraWide,
                videoAlign: event.target.value as 'left' | 'center',
              },
            })
          }
        >
          <option value="left">왼쪽</option>
          <option value="center">가운데</option>
        </select>
      </div>
    </>
  );
}

export function MiscTab({ settings, device, update }: TabProps) {
  const { powerCollect, promoHide, adSkip } = settings;
  return (
    <>
      <Toggle
        label="통나무 자동 수집"
        checked={powerCollect.enabled}
        onChange={(next) => update({ powerCollect: { enabled: next } })}
        hint={
          // 되돌리기 어려운 항목이라 켜짐 여부와 무관하게 항목 옆에 항상 노출한다 (FR-09.2).
          <p className="cm-sheet__warn">⚠ 자동화는 이용약관 위반 소지가 있어 주의해야합니다.</p>
        }
      />
      <Toggle
        label="광고 SKIP 버튼 자동 누르기"
        checked={adSkip.enabled}
        onChange={(next) => update({ adSkip: { enabled: next } })}
        hint={
          <p className="cm-sheet__note">
            └ 카운트다운이 끝나 `SKIP` 버튼이 나타나면 대신 눌러 줍니다. 광고 자체를 차단하지는
            않습니다.
          </p>
        }
      />
      <Toggle
        label="치트키 배너 숨김"
        checked={promoHide.banner}
        onChange={(next) => update({ promoHide: { ...promoHide, banner: next } })}
      />
      <Toggle
        label="치트키 툴팁 숨김"
        checked={promoHide.playerTooltip}
        onChange={(next) => update({ promoHide: { ...promoHide, playerTooltip: next } })}
      />
      <div className="cm-sheet__row">
        <span>기기 유형</span>
        <select
          aria-label="기기 유형"
          value={settings.device.override}
          onChange={(event) =>
            update({ device: { override: event.target.value as Settings['device']['override'] } })
          }
        >
          <option value="auto">자동</option>
          {DEVICE_CLASSES.map((deviceClass) => (
            <option key={deviceClass} value={deviceClass}>
              {deviceClass}
            </option>
          ))}
        </select>
      </div>
      <p className="cm-sheet__note">└ 자동 판별 결과: {device.deviceClass}</p>
      <p className="cm-sheet__note">└ 판정 근거: {device.reason}</p>
      <Toggle
        label="디버그 로그"
        checked={settings.debug}
        onChange={(next) => update({ debug: next })}
      />
    </>
  );
}
