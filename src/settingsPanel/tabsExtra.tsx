/**
 * 화면 ⑦ 멀티뷰 탭 · 화면 ⑨ 채팅 탭 · 프리셋 탭 (FR-14 · FR-15/FR-04/FR-11 · FR-08).
 * 탭 정의와 공용 조각은 `tabs.tsx` 에 있다. 파일 줄 수를 1000 아래로 유지하려고 나눠 두었다.
 */

import { useState } from 'react';
import {
  CHAT_FONT_RANGE,
  LIMITS,
  type Settings,
  type SlotLines,
  type SplitCount,
} from '../constants/storage';
import { emojiSizeForFont, lineHeightForFont, visibleLines } from '../features/chatFont';
import { addPreset, removePreset, reorderPresets, updatePreset } from '../features/chatPreset';
import {
  isSplitAvailable,
  recommendedPlacement,
  slotLineHeight,
} from '../features/multiView/slotLayout';
import {
  applyPreset,
  deletePreset,
  movePreset,
  overwritePreset,
  renamePreset,
  savePreset,
  summarizePreset,
} from '../features/optionPreset';
import { Stepper } from '../popup/Stepper';
import { RevertButton, Toggle, placementTradeOff, type TabProps } from './tabs';
import { CloseIcon } from '../ui/icons';

const SPLITS: SplitCount[] = [2, 3, 4];

export function MultiViewTab({ settings, device, update }: TabProps) {
  const multiView = settings.multiView;
  const hints = placementTradeOff(multiView.slotChatLines, settings.chatFont.slotPx);

  const patch = (next: Partial<Settings['multiView']>) =>
    update({ multiView: { ...multiView, ...next } });

  return (
    <>
      <div className="cm-sheet__row">
        <span>기본 분할</span>
        <select
          aria-label="기본 분할 수"
          value={multiView.defaultSplit}
          onChange={(event) => {
            const split = Number(event.target.value) as SplitCount;
            patch({ defaultSplit: split, slotChatPlacement: recommendedPlacement(split) });
          }}
        >
          {SPLITS.map((split) => (
            <option
              key={split}
              value={split}
              disabled={!isSplitAvailable(split, device.deviceClass)}
            >
              {split}분할
            </option>
          ))}
        </select>
      </div>
      <Toggle
        label="비활성 슬롯 720p"
        checked={multiView.lowerInactiveQuality}
        onChange={(next) => patch({ lowerInactiveQuality: next })}
      />
      <Toggle
        label="마지막 구성 복원"
        checked={multiView.restoreLastLayout}
        onChange={(next) => patch({ restoreLastLayout: next })}
      />

      <div className="cm-sheet__row">
        <span>슬롯 채팅 줄 수</span>
        <span className="cm-sp__controls">
          <Stepper
            label="슬롯 채팅 줄 수"
            value={multiView.slotChatLines}
            min={0}
            max={5}
            unit="줄"
            onChange={(next) => patch({ slotChatLines: next as SlotLines })}
          />
          <span className="cm-sheet__note">(0~5)</span>
        </span>
      </div>
      <div className="cm-sheet__row">
        <span>└ 활성 슬롯</span>
        <Stepper
          label="활성 슬롯 채팅 줄 수"
          value={multiView.slotChatLinesActive}
          min={0}
          max={5}
          unit="줄"
          onChange={(next) => patch({ slotChatLinesActive: next as SlotLines })}
        />
      </div>

      <div className="cm-sheet__row">
        <span>└ 배치</span>
        <span className="cm-sp__controls" role="radiogroup" aria-label="슬롯 채팅 배치">
          <label>
            <input
              type="radio"
              name="cm-sp-placement"
              checked={multiView.slotChatPlacement === 'overlay'}
              aria-label="영상 위에 겹쳐 표시"
              onChange={() => patch({ slotChatPlacement: 'overlay' })}
            />
            영상 위에 겹쳐 표시
          </label>
          <label>
            <input
              type="radio"
              name="cm-sp-placement"
              checked={multiView.slotChatPlacement === 'reserve'}
              aria-label="영상 밑에 따로 표시"
              onChange={() => patch({ slotChatPlacement: 'reserve' })}
            />
            영상 밑에 따로 표시
          </label>
        </span>
      </div>
      <p className="cm-sheet__note">{hints.four}</p>
      <p className="cm-sheet__note">{hints.two}</p>

      <h3>
        저장된 조합 ({multiView.sets.length}/{LIMITS.multiViewSets})
      </h3>
      {multiView.sets.length === 0 ? (
        <p className="cm-sheet__note">저장된 조합이 없습니다.</p>
      ) : (
        <ul className="cm-sp__list">
          {multiView.sets.map((set) => (
            <li key={set.id}>
              <span>· {set.name}</span>
              <span className="cm-sp__controls">
                <button
                  type="button"
                  className="cm-sheet__btn"
                  aria-label={`${set.name} 적용`}
                  onClick={() =>
                    patch({
                      slots: set.slots.map((slot) => ({ ...slot })),
                      activeSlot: set.slots[0]?.index ?? 1,
                    })
                  }
                >
                  적용
                </button>
                <button
                  type="button"
                  className="cm-sheet__btn"
                  aria-label={`${set.name} 삭제`}
                  onClick={() => patch({ sets: multiView.sets.filter((s) => s.id !== set.id) })}
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
        className="cm-sheet__btn"
        aria-label="현재 구성 저장"
        disabled={multiView.slots.length === 0 || multiView.sets.length >= LIMITS.multiViewSets}
        onClick={() =>
          patch({
            sets: [
              ...multiView.sets,
              {
                id: `set-${Date.now()}`,
                name: multiView.slots.map((slot) => slot.channelName).join(' + '),
                slots: multiView.slots.map(({ index, channelId, channelName }) => ({
                  index,
                  channelId,
                  channelName,
                })),
              },
            ],
          })
        }
      >
        현재 구성 저장
      </button>
    </>
  );
}

/**
 * ⚠️ 채팅 스크롤 영역 높이의 **안정화 이후** 실측값이다.
 * 로드 직후에는 871px 로 측정되고, 통나무 랭킹·공지 영역이 채워지면 761px 로 안정화된다.
 * 실제 스크롤러를 읽을 수 있으면 그 값을 쓰고, 없을 때만 이 기준값으로 안내한다.
 */
export const REFERENCE_SCROLLER_HEIGHT = 761;

export function ChatTab({
  settings,
  update,
  scrollerHeightPx,
}: TabProps & { scrollerHeightPx: number }) {
  const { chatFont, chatPresets, chatUserFilter, chatClutter } = settings;
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [listError, setListError] = useState<string | null>(null);

  const emoji = emojiSizeForFont(chatFont.sidePx);

  return (
    <>
      <h3>채팅 글자 크기</h3>
      <div className="cm-sheet__row">
        <span>사이드 채팅</span>
        <span className="cm-sp__controls">
          <Stepper
            label="사이드 채팅 글자 크기"
            value={chatFont.sidePx}
            min={CHAT_FONT_RANGE.side.min}
            max={CHAT_FONT_RANGE.side.max}
            unit=" px"
            onChange={(next) => update({ chatFont: { ...chatFont, sidePx: next } })}
          />
          <button
            type="button"
            className="cm-sheet__btn"
            aria-label={`사이드 채팅 글자 크기 기본값 ${CHAT_FONT_RANGE.side.default}px`}
            onClick={() =>
              update({ chatFont: { ...chatFont, sidePx: CHAT_FONT_RANGE.side.default } })
            }
          >
            기본값({CHAT_FONT_RANGE.side.default}px)
          </button>
        </span>
      </div>
      <p className="cm-sheet__note">
        └ 한 줄 {lineHeightForFont(chatFont.sidePx)}px · 스크롤 영역 {scrollerHeightPx}px · 약{' '}
        {visibleLines(scrollerHeightPx, chatFont.sidePx)}줄 표시
      </p>
      <p className="cm-sheet__note">
        └ 이모티콘 {emoji}×{emoji}px
      </p>

      <div className="cm-sheet__row">
        <span>슬롯 채팅</span>
        <span className="cm-sp__controls">
          <Stepper
            label="슬롯 채팅 글자 크기"
            value={chatFont.slotPx}
            min={CHAT_FONT_RANGE.slot.min}
            max={CHAT_FONT_RANGE.slot.max}
            unit=" px"
            onChange={(next) => update({ chatFont: { ...chatFont, slotPx: next } })}
          />
          <span className="cm-sheet__note">
            ({CHAT_FONT_RANGE.slot.min}~{CHAT_FONT_RANGE.slot.max})
          </span>
          <RevertButton
            label="슬롯 채팅 글자 크기"
            onClick={() =>
              update({ chatFont: { ...chatFont, slotPx: CHAT_FONT_RANGE.slot.default } })
            }
          />
        </span>
      </div>
      <p className="cm-sheet__note">
        └ 한 줄 {slotLineHeight(chatFont.slotPx)}px · 슬롯 채팅 줄 수와 연동
      </p>
      <p className="cm-sheet__note">└ 이모티콘도 함께 확대됩니다 (1.3em)</p>

      <h3>
        채팅 프리셋 ({chatPresets.length}/{LIMITS.chatPresets})
      </h3>
      <div className="cm-sheet__row">
        <input
          type="text"
          aria-label="추가할 채팅 문구"
          placeholder="문구를 입력"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="button"
          className="cm-sheet__btn"
          aria-label="채팅 프리셋 추가"
          onClick={() => {
            const result = addPreset(chatPresets, draft, LIMITS.chatPresets);
            setListError(result.error ?? null);
            if (result.error) return;
            setDraft('');
            update({ chatPresets: result.presets });
          }}
        >
          + 추가
        </button>
      </div>
      {listError ? <p className="cm-sheet__warn">{listError}</p> : null}

      {chatPresets.length === 0 ? (
        <p className="cm-sheet__note">저장된 문구가 없습니다.</p>
      ) : (
        <ul className="cm-sp__list">
          {chatPresets.map((preset) => (
            <li key={preset.id}>
              {editingId === preset.id ? (
                <>
                  <input
                    type="text"
                    aria-label={`${preset.label} 문구 수정`}
                    value={editText}
                    onChange={(event) => setEditText(event.target.value)}
                  />
                  <span className="cm-sp__controls">
                    <button
                      type="button"
                      className="cm-sheet__btn cm-sheet__btn--primary"
                      aria-label="문구 수정 저장"
                      onClick={() => {
                        update({
                          chatPresets: updatePreset(chatPresets, preset.id, { text: editText }),
                        });
                        setEditingId(null);
                      }}
                    >
                      확인
                    </button>
                    <button
                      type="button"
                      className="cm-sheet__btn"
                      aria-label="문구 수정 취소"
                      onClick={() => setEditingId(null)}
                    >
                      취소
                    </button>
                  </span>
                </>
              ) : (
                <>
                  <span className="cm-sp__item-name">· {preset.label}</span>
                  <span className="cm-sp__controls">
                    <button
                      type="button"
                      className="cm-sheet__btn"
                      aria-label={`${preset.label} 수정`}
                      onClick={() => {
                        setEditingId(preset.id);
                        setEditText(preset.text);
                      }}
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      className="cm-sheet__btn"
                      aria-label={`${preset.label} 삭제`}
                      onClick={() => update({ chatPresets: removePreset(chatPresets, preset.id) })}
                    >
                      <CloseIcon />
                    </button>
                    <button
                      type="button"
                      className="cm-sheet__btn"
                      aria-label={`${preset.label} 위로`}
                      disabled={preset.order <= 0}
                      onClick={() =>
                        update({ chatPresets: reorderPresets(chatPresets, preset.id, 'up') })
                      }
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="cm-sheet__btn"
                      aria-label={`${preset.label} 아래로`}
                      disabled={preset.order >= chatPresets.length - 1}
                      onClick={() =>
                        update({ chatPresets: reorderPresets(chatPresets, preset.id, 'down') })
                      }
                    >
                      ↓
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="cm-sheet__row">
        <span>클릭 동작</span>
        <span className="cm-sp__controls" role="radiogroup" aria-label="채팅 프리셋 클릭 동작">
          <label>
            <input
              type="radio"
              name="cm-sp-preset-behavior"
              checked={settings.chatPresetBehavior === 'send'}
              aria-label="즉시 전송"
              onChange={() => update({ chatPresetBehavior: 'send' })}
            />
            즉시 전송
          </label>
          <label>
            <input
              type="radio"
              name="cm-sp-preset-behavior"
              checked={settings.chatPresetBehavior === 'fill'}
              aria-label="입력창에 채우기"
              onChange={() => update({ chatPresetBehavior: 'fill' })}
            />
            입력창에 채우기
          </label>
        </span>
      </div>

      <div className="cm-sheet__row">
        <span>유저 필터</span>
        <span className="cm-sp__controls">
          <label>
            <input
              type="checkbox"
              checked={chatUserFilter.enabled}
              aria-label="유저 필터 활성"
              onChange={(event) =>
                update({ chatUserFilter: { ...chatUserFilter, enabled: event.target.checked } })
              }
            />
            활성
          </label>
          <label>
            <input
              type="checkbox"
              checked={chatUserFilter.persistPerChannel}
              aria-label="유저 필터 채널별 유지"
              onChange={(event) =>
                update({
                  chatUserFilter: {
                    ...chatUserFilter,
                    persistPerChannel: event.target.checked,
                  },
                })
              }
            />
            채널별 유지
          </label>
        </span>
      </div>

      <div className="cm-sheet__row">
        <span>채팅창에서 숨기기</span>
        <span className="cm-sp__controls">
          <label>
            <input
              type="checkbox"
              checked={chatClutter.header}
              aria-label="채팅 헤더 숨기기"
              onChange={(event) =>
                update({ chatClutter: { ...chatClutter, header: event.target.checked } })
              }
            />
            `채팅` 헤더
          </label>
          <label>
            <input
              type="checkbox"
              checked={chatClutter.ranking}
              aria-label="주간 후원 랭킹 숨기기"
              onChange={(event) =>
                update({ chatClutter: { ...chatClutter, ranking: event.target.checked } })
              }
            />
            주간 후원 랭킹
          </label>
          <label>
            <input
              type="checkbox"
              checked={chatClutter.drops}
              aria-label="드롭스 캠페인 안내 숨기기"
              onChange={(event) =>
                update({ chatClutter: { ...chatClutter, drops: event.target.checked } })
              }
            />
            드롭스 안내
          </label>
          <label>
            <input
              type="checkbox"
              checked={chatClutter.adBanner}
              aria-label="광고 배너 숨기기"
              onChange={(event) =>
                update({ chatClutter: { ...chatClutter, adBanner: event.target.checked } })
              }
            />
            광고 배너
          </label>
          <label>
            <input
              type="checkbox"
              checked={chatClutter.freeCheese}
              aria-label="무료 치즈 받기 툴팁 숨기기"
              onChange={(event) =>
                update({ chatClutter: { ...chatClutter, freeCheese: event.target.checked } })
              }
            />
            무료 치즈 받기
          </label>
          <label>
            <input
              type="checkbox"
              checked={chatClutter.cleanLive}
              aria-label="클린 라이브 필터링 안내 숨기기"
              onChange={(event) =>
                update({ chatClutter: { ...chatClutter, cleanLive: event.target.checked } })
              }
            />
            클린 라이브 안내
          </label>
          <label>
            <input
              type="checkbox"
              checked={chatClutter.shortLoginPlaceholder}
              aria-label="로그인 안내 문구 줄이기"
              onChange={(event) =>
                update({
                  chatClutter: { ...chatClutter, shortLoginPlaceholder: event.target.checked },
                })
              }
            />
            로그인 문구 줄이기
          </label>
        </span>
      </div>
      <p className="cm-sheet__note">└ 숨긴 만큼 채팅 목록이 길어집니다 (헤더 44px · 랭킹 110px).</p>
      <p className="cm-sheet__note">
        └ 공지·환영 메시지, `후원하기` 버튼, 전송 버튼은 숨기지 않습니다.
      </p>
      <p className="cm-sheet__note">
        └ 광고 배너는 <b>배너 UI만</b> 가립니다. 영상 광고 재생에는 개입하지 않습니다.
      </p>
    </>
  );
}

export function PresetTab({ settings, update }: TabProps) {
  const presets = settings.optionPresets;
  const [name, setName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const atCap = presets.length >= LIMITS.optionPresets;

  return (
    <>
      <h3>
        옵션 프리셋 ({presets.length}/{LIMITS.optionPresets})
      </h3>
      {presets.length === 0 ? (
        <p className="cm-sheet__note">저장된 프리셋이 없습니다.</p>
      ) : (
        <ul className="cm-sp__list">
          {presets.map((preset, index) => (
            <li key={preset.id} className="cm-sp__list-item--stack">
              {renamingId === preset.id ? (
                <div className="cm-sheet__row">
                  <input
                    type="text"
                    aria-label={`${preset.name} 새 이름`}
                    value={renameText}
                    onChange={(event) => setRenameText(event.target.value)}
                  />
                  <span className="cm-sp__controls">
                    <button
                      type="button"
                      className="cm-sheet__btn cm-sheet__btn--primary"
                      aria-label="이름 변경 저장"
                      onClick={() => {
                        const result = renamePreset(presets, preset.id, renameText, Date.now());
                        setError(result.error ?? null);
                        if (result.error) return;
                        update({ optionPresets: result.presets });
                        setRenamingId(null);
                      }}
                    >
                      확인
                    </button>
                    <button
                      type="button"
                      className="cm-sheet__btn"
                      aria-label="이름 변경 취소"
                      onClick={() => setRenamingId(null)}
                    >
                      취소
                    </button>
                  </span>
                </div>
              ) : (
                <>
                  <div className="cm-sheet__row">
                    <span className="cm-sp__item-name">
                      · {preset.name}
                      {settings.activePresetId === preset.id ? ' (적용 중)' : ''}
                    </span>
                    <span className="cm-sp__controls">
                      <button
                        type="button"
                        className="cm-sheet__btn cm-sheet__btn--primary"
                        aria-label={`${preset.name} 적용`}
                        onClick={() => update(applyPreset(preset))}
                      >
                        적용
                      </button>
                      <button
                        type="button"
                        className="cm-sheet__btn"
                        aria-label={`${preset.name} 이름 변경`}
                        onClick={() => {
                          setRenamingId(preset.id);
                          setRenameText(preset.name);
                        }}
                      >
                        이름 변경
                      </button>
                      <button
                        type="button"
                        className="cm-sheet__btn"
                        aria-label={`${preset.name} 를 현재 설정으로 덮어쓰기`}
                        onClick={() =>
                          update({
                            optionPresets: overwritePreset(
                              presets,
                              preset.id,
                              settings,
                              Date.now(),
                            ),
                          })
                        }
                      >
                        덮어쓰기
                      </button>
                      <button
                        type="button"
                        className="cm-sheet__btn"
                        aria-label={`${preset.name} 삭제`}
                        onClick={() =>
                          update({
                            optionPresets: deletePreset(presets, preset.id),
                            activePresetId:
                              settings.activePresetId === preset.id
                                ? null
                                : settings.activePresetId,
                          })
                        }
                      >
                        <CloseIcon />
                      </button>
                      <button
                        type="button"
                        className="cm-sheet__btn"
                        aria-label={`${preset.name} 위로`}
                        disabled={index === 0}
                        onClick={() =>
                          update({ optionPresets: movePreset(presets, preset.id, 'up') })
                        }
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="cm-sheet__btn"
                        aria-label={`${preset.name} 아래로`}
                        disabled={index === presets.length - 1}
                        onClick={() =>
                          update({ optionPresets: movePreset(presets, preset.id, 'down') })
                        }
                      >
                        ↓
                      </button>
                    </span>
                  </div>
                  <p className="cm-sheet__note">└ {summarizePreset(preset.values, settings)}</p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="cm-sheet__row">
        <input
          type="text"
          aria-label="새 프리셋 이름"
          placeholder="프리셋 이름"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          type="button"
          className="cm-sheet__btn"
          aria-label="현재 설정으로 저장"
          disabled={atCap}
          onClick={() => {
            const result = savePreset(presets, name, settings, Date.now());
            setError(result.error ?? null);
            if (result.error) return;
            setName('');
            update({ optionPresets: result.presets });
          }}
        >
          현재 설정으로 저장
        </button>
      </div>
      {error ? <p className="cm-sheet__warn">{error}</p> : null}
      {atCap ? (
        <p className="cm-sheet__note">
          프리셋 상한({LIMITS.optionPresets}개)에 도달했습니다. 기존 프리셋을 덮어쓰거나 지워
          주세요.
        </p>
      ) : null}
    </>
  );
}
