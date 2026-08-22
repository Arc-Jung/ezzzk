/**
 * 화면 ⑥ 확장 팝업 (FR-09.1).
 * 요약·토글 중심이다. 세부 값 조정은 페이지 내 설정 패널(FR-09.2)로 보낸다.
 * 모든 변경은 즉시 저장되며 별도 "저장" 버튼이 없다.
 */

import { CHAT_FONT_RANGE, LIMITS, type SlotLines, type SplitCount } from '../constants/storage';
import { lineHeightForFont, visibleLines } from '../features/chatFont';
import { Stepper } from './Stepper';
import { useSettings } from './useSettings';
import { CloseIcon } from '../ui/icons';

/** 실측: 채팅 스크롤 영역은 안정화 후 761px (1920×1080). 줄 수 안내에만 쓰는 참고값이다. */
const REFERENCE_SCROLLER_HEIGHT = 761;

export function Popup() {
  const { settings, ready, update } = useSettings();

  if (!ready) {
    return (
      <div className="cm-popup">
        <h1>이지직</h1>
        <p className="cm-hint">설정을 읽는 중…</p>
      </div>
    );
  }

  const { quality, volume, wideScreen, powerCollect, chatFont, multiView, chatClutter, adSkip } =
    settings;

  return (
    <div className="cm-popup">
      <h1>이지직</h1>

      {/* 팝업은 브라우저가 높이를 제한한다 — 여기서만 내부 스크롤을 만들고
          제목은 스크롤 밖에 고정한다 (감사 보고서 보통 #, 2026-08-21,
          docs/ui-audit/popup-laptop13.png · popup-mobile-portrait.png 에서
          `단축키`·`세부 설정 열기`·상표 고지가 스크롤 없이는 보이지 않았다). */}
      <div className="cm-popup__body">
        <section className="cm-section">
          <h2>기능</h2>
          <div className="cm-toggle-grid">
            <label className="cm-label">
              <input
                type="checkbox"
                checked={quality.enabled}
                onChange={(e) => update({ quality: { ...quality, enabled: e.target.checked } })}
              />
              1080p 자동
            </label>
            <label className="cm-label">
              <input
                type="checkbox"
                checked={wideScreen.enabled}
                onChange={(e) => update({ wideScreen: { enabled: e.target.checked } })}
              />
              자동 넓은 화면
            </label>
            <label className="cm-label">
              <input
                type="checkbox"
                checked={volume.autoUnmute}
                onChange={(e) => update({ volume: { ...volume, autoUnmute: e.target.checked } })}
              />
              음소거 해제
            </label>
            <label className="cm-label">
              <input
                type="checkbox"
                checked={adSkip.enabled}
                onChange={(e) => update({ adSkip: { enabled: e.target.checked } })}
              />
              광고 SKIP 자동
            </label>
            <label className="cm-label">
              <input
                type="checkbox"
                checked={powerCollect.enabled}
                onChange={(e) => update({ powerCollect: { enabled: e.target.checked } })}
              />
              통나무 자동 수집
            </label>
          </div>
          {powerCollect.enabled && (
            <p className="cm-warn">⚠ 자동화는 이용약관 위반 소지가 있어 주의해야합니다.</p>
          )}
        </section>

        <section className="cm-section">
          <h2>채팅창에서 숨기기</h2>
          <div className="cm-toggle-grid">
            <label className="cm-label">
              <input
                type="checkbox"
                checked={chatClutter.header}
                onChange={(e) =>
                  update({ chatClutter: { ...chatClutter, header: e.target.checked } })
                }
              />
              `채팅` 헤더
            </label>
            <label className="cm-label">
              <input
                type="checkbox"
                checked={chatClutter.ranking}
                onChange={(e) =>
                  update({ chatClutter: { ...chatClutter, ranking: e.target.checked } })
                }
              />
              주간 후원 랭킹
            </label>
            <label className="cm-label">
              <input
                type="checkbox"
                checked={chatClutter.drops}
                onChange={(e) =>
                  update({ chatClutter: { ...chatClutter, drops: e.target.checked } })
                }
              />
              드롭스 안내
            </label>
            <label className="cm-label">
              <input
                type="checkbox"
                checked={chatClutter.adBanner}
                onChange={(e) =>
                  update({ chatClutter: { ...chatClutter, adBanner: e.target.checked } })
                }
              />
              광고 배너
            </label>
            <label className="cm-label">
              <input
                type="checkbox"
                checked={chatClutter.freeCheese}
                onChange={(e) =>
                  update({ chatClutter: { ...chatClutter, freeCheese: e.target.checked } })
                }
              />
              무료 치즈 받기
            </label>
          </div>
          <p className="cm-hint">
            └ 숨긴 만큼 채팅 목록이 길어집니다 (헤더 44px · 랭킹 110px · 배너 108px)
          </p>
          <p className="cm-hint">
            └ 광고 배너는 배너 UI만 가립니다 (영상 광고 재생에는 개입하지 않음)
          </p>
        </section>

        <section className="cm-section">
          <h2>채팅 글자 크기</h2>
          <div className="cm-row">
            <span>사이드 채팅</span>
            <Stepper
              label="사이드 채팅 글자 크기"
              value={chatFont.sidePx}
              min={CHAT_FONT_RANGE.side.min}
              max={CHAT_FONT_RANGE.side.max}
              unit=" px"
              onChange={(next) => update({ chatFont: { ...chatFont, sidePx: next } })}
            />
          </div>
          <p className="cm-hint">
            한 줄 {lineHeightForFont(chatFont.sidePx)}px · 약{' '}
            {visibleLines(REFERENCE_SCROLLER_HEIGHT, chatFont.sidePx)}줄 표시
          </p>
          <div className="cm-row">
            <span>슬롯 채팅</span>
            <Stepper
              label="슬롯 채팅 글자 크기"
              value={chatFont.slotPx}
              min={CHAT_FONT_RANGE.slot.min}
              max={CHAT_FONT_RANGE.slot.max}
              unit=" px"
              onChange={(next) => update({ chatFont: { ...chatFont, slotPx: next } })}
            />
          </div>
          <button
            type="button"
            className="cm-btn"
            onClick={() =>
              update({
                chatFont: {
                  sidePx: CHAT_FONT_RANGE.side.default,
                  slotPx: CHAT_FONT_RANGE.slot.default,
                },
              })
            }
          >
            기본값({CHAT_FONT_RANGE.side.default}px)
          </button>
        </section>

        <section className="cm-section">
          <h2>멀티뷰</h2>
          <div className="cm-row">
            <span>기본 분할</span>
            <select
              aria-label="기본 분할 수"
              value={multiView.defaultSplit}
              onChange={(e) =>
                update({
                  multiView: {
                    ...multiView,
                    defaultSplit: Number(e.target.value) as SplitCount,
                  },
                })
              }
            >
              <option value={2}>2분할</option>
              <option value={3}>3분할</option>
              <option value={4}>4분할</option>
            </select>
          </div>
          <div className="cm-row">
            <span>슬롯 채팅 줄</span>
            <Stepper
              label="슬롯 채팅 줄 수"
              value={multiView.slotChatLines}
              min={0}
              max={5}
              onChange={(next) =>
                update({ multiView: { ...multiView, slotChatLines: next as SlotLines } })
              }
            />
          </div>
          <label className="cm-label">
            <input
              type="checkbox"
              checked={multiView.lowerInactiveQuality}
              onChange={(e) =>
                update({ multiView: { ...multiView, lowerInactiveQuality: e.target.checked } })
              }
            />
            비활성 슬롯 화질 낮추기 (720p)
          </label>
          <label className="cm-label">
            <input
              type="checkbox"
              checked={multiView.restoreLastLayout}
              onChange={(e) =>
                update({ multiView: { ...multiView, restoreLastLayout: e.target.checked } })
              }
            />
            마지막 슬롯 구성 복원
          </label>

          <h2 style={{ marginTop: 10 }}>저장된 조합</h2>
          {multiView.sets.length === 0 ? (
            <p className="cm-hint">저장된 조합이 없습니다.</p>
          ) : (
            <ul className="cm-list">
              {multiView.sets.map((set) => (
                <li key={set.id}>
                  <span>{set.name}</span>
                  <span>
                    <button
                      type="button"
                      className="cm-btn"
                      aria-label={`${set.name} 적용`}
                      onClick={() =>
                        update({
                          multiView: {
                            ...multiView,
                            slots: set.slots.map((slot) => ({ ...slot })),
                            activeSlot: set.slots[0]?.index ?? 1,
                          },
                        })
                      }
                    >
                      적용
                    </button>{' '}
                    <button
                      type="button"
                      className="cm-btn"
                      aria-label={`${set.name} 삭제`}
                      onClick={() =>
                        update({
                          multiView: {
                            ...multiView,
                            sets: multiView.sets.filter((s) => s.id !== set.id),
                          },
                        })
                      }
                    >
                      <CloseIcon />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="cm-btn cm-btn--wide"
            disabled={multiView.slots.length === 0 || multiView.sets.length >= LIMITS.multiViewSets}
            onClick={() =>
              update({
                multiView: {
                  ...multiView,
                  sets: [
                    ...multiView.sets,
                    {
                      id: `set-${Date.now()}`,
                      name: multiView.slots.map((s) => s.channelName).join(' + '),
                      slots: multiView.slots.map(({ index, channelId, channelName }) => ({
                        index,
                        channelId,
                        channelName,
                      })),
                    },
                  ],
                },
              })
            }
          >
            현재 구성 저장
          </button>
        </section>

        <section className="cm-section">
          <h2>단축키</h2>
          <p className="cm-shortcuts">
            멀티뷰 열기 <b>Alt+M</b> · 오디오 슬롯 <b>Alt+Shift+1~4</b>
            <br />
            설정 패널 <b>Alt+,</b> · 볼륨 <b>Shift+↑/↓</b> · 채팅 프리셋 <b>Alt+1~9</b>
          </p>
          <button
            type="button"
            className="cm-btn cm-btn--primary cm-btn--wide"
            onClick={() => void chrome.runtime.sendMessage({ kind: 'openSettingsPanel' })}
          >
            세부 설정 열기
          </button>
        </section>

        {/* 상표 고지 — 스토어 정책상 타사 상표를 쓴 확장은 비공식임을 명시해야 한다
          (docs/store-policy-risk-review.md §2). 문구를 지우지 않는다. */}
        <p className="cm-disclaimer">
          네이버·치지직이 만들거나 후원하지 않은 <b>비공식 서드파티 확장</b>입니다.
        </p>
      </div>
    </div>
  );
}
