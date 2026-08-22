/**
 * 아이콘 세트 회귀 (계획: `docs/chzzk-tone-ui-plan.md` P2).
 *
 * 전수 검사 포인트: `aria-hidden="true"` 가 하나라도 빠지면 스크린리더가 의미 없는
 * 그래픽을 읽게 된다. 접근성 이름은 감싸는 버튼의 `aria-label` 이 담당하므로
 * 아이콘 자체는 항상 숨겨야 한다.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  CompressorIcon,
  createIconElement,
  GearIcon,
  ICON_PATHS,
  LayoutBottomIcon,
  LayoutRightIcon,
  LiveDotIcon,
  MinusIcon,
  PlusIcon,
  ResizeHorizontalIcon,
  type IconProps,
} from './icons';

declare global {
  // React 18 이 act 지원 환경임을 알리는 표준 플래그. 없으면 경고가 쏟아진다.
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(Icon: ComponentType<IconProps>, props: IconProps = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(<Icon {...props} />);
  });
  return host.querySelector('svg') as SVGSVGElement;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  document.body.replaceChildren();
});

const STROKE_ICONS: Array<[string, ComponentType<IconProps>]> = [
  ['PlusIcon', PlusIcon],
  ['MinusIcon', MinusIcon],
  ['CloseIcon', CloseIcon],
  ['ResizeHorizontalIcon', ResizeHorizontalIcon],
  ['ChevronRightIcon', ChevronRightIcon],
  ['ChevronLeftIcon', ChevronLeftIcon],
  ['LayoutRightIcon', LayoutRightIcon],
  ['LayoutBottomIcon', LayoutBottomIcon],
  ['GearIcon', GearIcon],
  ['CompressorIcon', CompressorIcon],
];

const ALL_ICONS: Array<[string, ComponentType<IconProps>]> = [
  ...STROKE_ICONS,
  ['LiveDotIcon', LiveDotIcon],
];

describe('아이콘 세트 — 공통 규약', () => {
  it.each(ALL_ICONS)('%s — svg 를 렌더하고 viewBox 가 0 0 16 16 이다', (_name, Icon) => {
    const svg = mount(Icon);
    expect(svg).toBeTruthy();
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
  });

  it.each(ALL_ICONS)('%s — aria-hidden="true" 가 있다 (전수 검사)', (_name, Icon) => {
    const svg = mount(Icon);
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  it.each(ALL_ICONS)('%s — focusable="false" 가 있다', (_name, Icon) => {
    const svg = mount(Icon);
    expect(svg.getAttribute('focusable')).toBe('false');
  });

  it.each(ALL_ICONS)('%s — size prop 이 width/height 에 반영된다', (_name, Icon) => {
    const defaultSvg = mount(Icon);
    expect(defaultSvg.getAttribute('width')).toBe('16');
    expect(defaultSvg.getAttribute('height')).toBe('16');

    act(() => root?.unmount());
    root = createRoot(host!);
    act(() => {
      root!.render(<Icon size={24} />);
    });
    const resizedSvg = host!.querySelector('svg') as SVGSVGElement;
    expect(resizedSvg.getAttribute('width')).toBe('24');
    expect(resizedSvg.getAttribute('height')).toBe('24');
  });

  it.each(ALL_ICONS)('%s — className 이 전달된다', (_name, Icon) => {
    const svg = mount(Icon, { className: 'test-icon-class' });
    expect(svg.getAttribute('class')).toBe('test-icon-class');
  });

  it.each(STROKE_ICONS)('%s — stroke="currentColor" 를 쓴다 (하드코딩 색 없음)', (_name, Icon) => {
    const svg = mount(Icon);
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('fill')).toBe('none');
  });

  it('LiveDotIcon — 예외로 fill="currentColor" 원 하나를 쓴다', () => {
    const svg = mount(LiveDotIcon);
    expect(svg.getAttribute('fill')).toBe('currentColor');
    expect(svg.getAttribute('stroke')).toBeNull();
    const circle = svg.querySelector('circle');
    expect(circle).toBeTruthy();
  });
  it('CompressorIcon — 스피커 + 음파 두 겹 + 상한선으로 이루어진다 (색만으로 상태를 표시하지 않는 모양 근거)', () => {
    const svg = mount(CompressorIcon);
    expect(svg.querySelectorAll('path')).toHaveLength(4);
    expect(svg.querySelectorAll('rect')).toHaveLength(0);
  });
});

/**
 * `createIconElement` (바닐라 DOM 헬퍼) 회귀 — `stage.ts`·`volume.ts` 전용.
 * React 컴포넌트와 같은 `ICON_PATHS` 를 참조하는지가 핵심이다: 복붙하면 한쪽만 고쳐져 갈라진다.
 */
describe('createIconElement — 바닐라 DOM 헬퍼', () => {
  it.each(Object.keys(ICON_PATHS) as Array<keyof typeof ICON_PATHS>)(
    '%s — svg 를 만들고 공통 규약을 지킨다',
    (name) => {
      const svg = createIconElement(name);
      expect(svg.tagName.toLowerCase()).toBe('svg');
      expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
      expect(svg.getAttribute('stroke')).toBe('currentColor');
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('focusable')).toBe('false');
      // `ICON_PATHS[name]` 은 단일 path 문자열이거나 `{ tag, ... }` 목록이다(예: rect 를 곁들이는
      // layoutRight/layoutBottom). 둘 다 같은 개수·순서의 자식 엘리먼트로 그려지는지 본다.
      const spec = ICON_PATHS[name];
      if (typeof spec === 'string') {
        expect(svg.querySelector('path')?.getAttribute('d')).toBe(spec);
        return;
      }
      expect(svg.children).toHaveLength(spec.length);
      spec.forEach((shape, index) => {
        expect(svg.children[index]?.tagName.toLowerCase()).toBe(shape.tag);
      });
    },
  );

  it('size 를 넘기면 width/height 에 반영된다', () => {
    const svg = createIconElement('plus', 24);
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('height')).toBe('24');
  });

  it('PlusIcon/MinusIcon/CloseIcon 은 createIconElement 와 같은 path 데이터를 쓴다 (복붙 방지)', () => {
    expect(mount(PlusIcon).querySelector('path')?.getAttribute('d')).toBe(ICON_PATHS.plus);
    expect(mount(MinusIcon).querySelector('path')?.getAttribute('d')).toBe(ICON_PATHS.minus);
    expect(mount(CloseIcon).querySelector('path')?.getAttribute('d')).toBe(ICON_PATHS.close);
  });
});
