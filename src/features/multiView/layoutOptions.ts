import type { MultiViewLayout, SplitCount } from '../../constants/storage';

export const MULTIVIEW_LAYOUT_OPTIONS = [
  { value: '2', split: 2, layout: 'grid', label: '2분할' },
  { value: '3', split: 3, layout: 'grid', label: '3분할' },
  { value: '4', split: 4, layout: 'grid', label: '4분할' },
  { value: 'main-sidebar', split: 4, layout: 'main-sidebar', label: '메인 70% + 오른쪽 3개' },
  {
    value: 'main-sidebar-five',
    split: 5,
    layout: 'main-sidebar-five',
    label: '5분할 · 메인 70% + 오른쪽 4개',
  },
] as const satisfies readonly {
  value: string;
  split: SplitCount;
  layout: MultiViewLayout;
  label: string;
}[];

export function selectedLayoutOption(split: SplitCount, layout: MultiViewLayout) {
  return (
    MULTIVIEW_LAYOUT_OPTIONS.find((option) => option.split === split && option.layout === layout) ??
    MULTIVIEW_LAYOUT_OPTIONS.find((option) => option.split === split) ??
    MULTIVIEW_LAYOUT_OPTIONS[0]
  );
}
