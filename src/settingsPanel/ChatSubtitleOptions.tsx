import { DEFAULT_SETTINGS, type Settings } from '../constants/storage';
import {
  subtitleBackground,
  subtitleSettings,
  type SubtitleSettings,
} from '../features/chatSubtitle';
import { Stepper } from '../popup/Stepper';
import { Toggle } from './tabs';

export function ChatSubtitleOptions({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}) {
  const value = subtitleSettings(settings.chatSubtitle);
  const patch = (next: Partial<SubtitleSettings>) =>
    update({ chatSubtitle: { ...value, ...next } });
  return (
    <section aria-label="자막형 채팅 설정">
      <h3>자막형 채팅</h3>
      <Toggle
        label="영상 위에 자막형 채팅 표시"
        checked={value.enabled}
        onChange={(enabled) => patch({ enabled })}
      />
      <div className="cm-sheet__row">
        <label htmlFor="cm-subtitle-position">표시 위치</label>
        <select
          id="cm-subtitle-position"
          aria-label="자막형 채팅 표시 위치"
          value={value.position}
          onChange={(event) =>
            patch({ position: event.target.value as SubtitleSettings['position'] })
          }
        >
          <option value="left">좌측 하단</option>
          <option value="center">가운데 하단</option>
          <option value="right">우측 하단</option>
        </select>
      </div>
      <Toggle
        label="하단 빈 공간에 표시"
        checked={value.useBottomSpace}
        onChange={(useBottomSpace) => patch({ useBottomSpace })}
        hint={<p className="cm-sheet__note">여백이 부족하면 영상 위에 표시합니다.</p>}
      />
      <div className="cm-sheet__row">
        <label htmlFor="cm-subtitle-count">표시 줄 수</label>
        <select
          id="cm-subtitle-count"
          aria-label="자막형 채팅 표시 줄 수"
          value={value.lines}
          onChange={(event) =>
            patch({ lines: Number(event.target.value) as SubtitleSettings['lines'] })
          }
        >
          <option value={0}>자동 (3~6줄)</option>
          {[3, 4, 5, 6].map((lines) => (
            <option key={lines} value={lines}>
              {lines}줄
            </option>
          ))}
        </select>
      </div>
      <div className="cm-sheet__row">
        <span>자막 글자 크기</span>
        <Stepper
          label="자막형 채팅 글자 크기"
          value={value.fontPx}
          min={12}
          max={28}
          unit=" px"
          onChange={(fontPx) => patch({ fontPx })}
        />
      </div>
      <div className="cm-sheet__row">
        <label htmlFor="cm-subtitle-text">글자색</label>
        <input
          id="cm-subtitle-text"
          aria-label="자막형 채팅 글자색"
          type="color"
          value={value.textColor}
          onChange={(event) => patch({ textColor: event.target.value })}
        />
      </div>
      <div className="cm-sheet__row">
        <label htmlFor="cm-subtitle-background">배경색</label>
        <input
          id="cm-subtitle-background"
          aria-label="자막형 채팅 배경색"
          type="color"
          value={value.backgroundColor}
          onChange={(event) => patch({ backgroundColor: event.target.value })}
        />
      </div>
      <div className="cm-sheet__row">
        <label htmlFor="cm-subtitle-opacity">배경 불투명도</label>
        <span className="cm-sp__controls">
          <input
            id="cm-subtitle-opacity"
            aria-label="자막형 채팅 배경 불투명도"
            type="range"
            min={0}
            max={100}
            step={5}
            value={value.backgroundOpacity}
            onChange={(event) => patch({ backgroundOpacity: Number(event.target.value) })}
          />
          <output htmlFor="cm-subtitle-opacity">{value.backgroundOpacity}%</output>
        </span>
      </div>
      <Toggle
        label="자막에 닉네임 표시"
        checked={value.showNickname}
        onChange={(showNickname) => patch({ showNickname })}
      />
      <Toggle
        label="치지직 원본 닉네임 색상 사용"
        checked={value.useNicknameColor}
        onChange={(useNicknameColor) => patch({ useNicknameColor })}
      />
      {!value.useNicknameColor ? (
        <p className="cm-sheet__note">닉네임에도 선택한 글자색을 사용합니다.</p>
      ) : null}
      <div
        className="cm-subtitle-preview"
        data-position={value.position}
        aria-label="자막형 채팅 미리보기"
      >
        <div
          style={{
            backgroundColor: subtitleBackground(value),
            color: value.textColor,
            fontSize: value.fontPx,
          }}
        >
          <div>
            {value.showNickname && (
              <strong style={{ color: value.useNicknameColor ? '#56c98d' : undefined }}>
                시청자:{' '}
              </strong>
            )}
            안녕하세요!
          </div>
          <div>
            {value.showNickname && (
              <strong style={{ color: value.useNicknameColor ? '#d69afa' : undefined }}>
                이지직:{' '}
              </strong>
            )}
            반갑습니다.
          </div>
          <div>
            {value.showNickname && (
              <strong style={{ color: value.useNicknameColor ? '#56c98d' : undefined }}>
                시청자:{' '}
              </strong>
            )}
            방송 잘 보고 있어요.
          </div>
        </div>
      </div>
      <button
        type="button"
        className="cm-sheet__btn"
        aria-label="자막형 채팅 기본값으로 되돌리기"
        onClick={() => update({ chatSubtitle: { ...DEFAULT_SETTINGS.chatSubtitle } })}
      >
        자막 설정 초기화
      </button>
    </section>
  );
}
