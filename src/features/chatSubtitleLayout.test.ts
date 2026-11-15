import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../constants/storage';
import { mergeSettings } from '../storage';
import { subtitleBackground, subtitleSettings } from './chatSubtitleSettings';
import { subtitleGeometry, subtitlePicture, subtitlePlacement } from './chatSubtitleLayout';

describe('자막형 채팅 저장값과 크기', () => {
  it('하단 빈 공간 옵션은 기존 설정에서 꺼짐이고 명시한 켜짐을 보존한다', () => {
    expect(subtitleSettings().useBottomSpace).toBe(false);
    expect(mergeSettings({ chatSubtitle: { enabled: true } }).chatSubtitle.useBottomSpace).toBe(
      false,
    );
    expect(subtitleSettings({ useBottomSpace: true }).useBottomSpace).toBe(true);
  });
  it.each(['left', 'center', 'right'] as const)(
    '%s 위치를 유지하며 하단 여백에 채팅 전체를 넣는다',
    (position) => {
      const settings = subtitleSettings({ useBottomSpace: true, position, lines: 6 });
      const picture = subtitlePicture(1280, 1158);
      const geometry = subtitlePlacement(1280, 1158, 16 / 9, settings, false);
      expect(geometry.placement).toBe('bottom-space');
      expect(geometry.lines).toBeGreaterThanOrEqual(3);
      expect(
        geometry.bottom + Math.max(60, geometry.lines * geometry.lineHeight + 16),
      ).toBeLessThan(picture.bottom);
      expect(geometry.left).toBe(subtitleGeometry(1280, 720, settings).left);
    },
  );
  it('컨트롤이 나타나면 공간에 맞춰 줄 수를 줄이고 영상과 컨트롤바를 피한다', () => {
    const settings = subtitleSettings({ useBottomSpace: true, lines: 6 });
    const geometry = subtitlePlacement(1280, 1158, 16 / 9, settings, true);
    expect(geometry.placement).toBe('bottom-space');
    expect(geometry.bottom).toBe(80);
    expect(geometry.lines).toBeLessThan(6);
    expect(geometry.bottom + geometry.lines * geometry.lineHeight + 16).toBeLessThan(219);
  });
  it('실측한 볼륨 줄까지 피하고 3줄이 들어가지 않으면 영상 안으로 돌아간다', () => {
    const settings = subtitleSettings({ useBottomSpace: true, lines: 6 });
    const geometry = subtitlePlacement(1280, 1158, 16 / 9, settings, true, 112);
    expect(geometry.placement).toBe('bottom-space');
    expect(geometry.bottom).toBe(112);
    expect(geometry.lines).toBe(3);
    expect(subtitlePlacement(1280, 1158, 16 / 9, settings, true, 160).placement).toBe('video');
  });
  it.each([
    [1280, 720],
    [1280, 820],
    [1000, 400],
  ] as const)('%d×%d의 여백이 부족하면 영상 안에 표시한다', (width, height) => {
    const settings = subtitleSettings({ useBottomSpace: true });
    expect(subtitlePlacement(width, height, 16 / 9, settings).placement).toBe('video');
  });
  it('꺼짐이면 여백이 넓어도 영상 안의 기존 위치에 표시한다', () => {
    const settings = subtitleSettings();
    const geometry = subtitlePlacement(1280, 1158, 16 / 9, settings);
    expect(geometry.placement).toBe('video');
    expect(geometry.bottom).toBeGreaterThan(219);
  });
  it('상하·좌우 검은 여백을 제외하고 실제 영상 영역을 기준으로 배치한다', () => {
    expect(subtitlePicture(1440, 1000)).toEqual({ width: 1440, height: 810, left: 0, bottom: 95 });
    expect(subtitlePicture(1000, 400)).toEqual({
      width: (400 * 16) / 9,
      height: 400,
      left: (1000 - (400 * 16) / 9) / 2,
      bottom: 0,
    });
  });
  it('기존 사용자 설정을 병합하면 기본 끄기와 자동 3~6줄이 추가된다', () => {
    expect(mergeSettings({ chatFont: { sidePx: 20 } }).chatSubtitle).toEqual(
      DEFAULT_SETTINGS.chatSubtitle,
    );
    expect(subtitleSettings().enabled).toBe(false);
  });

  it('저장값에 위치가 없으면 좌측 하단을 적용하고 세 위치 모두 영상 안에 배치한다', () => {
    expect(subtitleSettings().position).toBe('left');
    expect(mergeSettings({ chatSubtitle: { enabled: true } }).chatSubtitle.position).toBe('left');
    expect(subtitleSettings({ position: 'invalid' as 'right' }).position).toBe('left');
    for (const width of [320, 859, 1440]) {
      const left = subtitleGeometry(width, 480, subtitleSettings({ position: 'left' }));
      const center = subtitleGeometry(width, 480, subtitleSettings({ position: 'center' }));
      const right = subtitleGeometry(width, 480, subtitleSettings({ position: 'right' }));
      expect(left.left).toBeLessThan(center.left);
      expect(center.left).toBeLessThan(right.left);
      expect(center.left + center.width / 2).toBe(width / 2);
      expect(right.left + right.width).toBeCloseTo(width - left.left);
    }
  });

  it('불투명도는 글자색에 영향을 주지 않고 0~100%로 적용된다', () => {
    const settings = subtitleSettings({ backgroundColor: '#123456', backgroundOpacity: 25 });
    expect(subtitleBackground(settings)).toBe('rgba(18, 52, 86, 0.25)');
    expect(settings.textColor).toBe('#ffffff');
    expect(subtitleSettings({ backgroundOpacity: 200 }).backgroundOpacity).toBe(100);
    expect(
      subtitleSettings({ backgroundColor: 'red;display:none', fontPx: NaN }).backgroundColor,
    ).toBe('#000000');
  });

  it.each([
    [412, 232, 3],
    [859, 480, 5],
    [1440, 810, 6],
  ])('%d×%d에서 자동 표시 줄 수는 %d줄이다', (width, height, count) => {
    const geometry = subtitleGeometry(width, height, subtitleSettings());
    expect(geometry.lines).toBe(count);
    expect(geometry.left + geometry.width).toBeLessThanOrEqual(width);
    expect(geometry.lines * geometry.lineHeight + geometry.bottom + 16).toBeLessThanOrEqual(height);
  });

  it('3~6줄 직접 선택을 지원하고 큰 글자·작은 영상에서는 공간에 맞춰 줄인다', () => {
    for (const lines of [3, 4, 5, 6] as const) {
      expect(subtitleGeometry(1440, 810, subtitleSettings({ lines })).lines).toBe(lines);
    }
    const small = subtitleGeometry(320, 180, subtitleSettings({ lines: 6, fontPx: 28 }), true);
    expect(small.lines).toBeGreaterThanOrEqual(3);
    expect(small.lines * small.lineHeight + small.bottom + 16).toBeLessThanOrEqual(180);
  });
});
