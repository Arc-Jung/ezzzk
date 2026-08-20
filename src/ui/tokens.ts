/**
 * 치지직 디자인 토큰 매핑 (계획: `docs/chzzk-tone-ui-plan.md` P1).
 *
 * 우리 UI 는 색·라운드를 전부 하드코딩해 왔다. 전부 "눈대중 근사값"이라 치지직 화면 위에 얹히면
 * 미묘하게 어긋나고, 치지직이 테마를 바꾸면 그대로 깨진다.
 *
 * 여기서는 **치지직 CSS 커스텀 프로퍼티를 참조하되 폴백을 반드시 둔다.**
 *
 * 🔴 폴백은 선택이 아니라 필수다. 우리 UI 가 사는 문맥은 두 가지인데 한쪽에는 치지직 변수가 없다.
 *   - 콘텐츠 스크립트(설정 패널·멀티뷰 시트) → 치지직 페이지 안 → 변수 **있음**
 *   - 팝업(`index.html`) → 확장 오리진 → 변수 **없음**
 * 폴백 없이 `var(--color-bg-layer-01)` 만 쓰면 팝업이 무색으로 렌더된다.
 *
 * 폴백 값의 출처는 실측이다 — `etc/probe/chzzk-tokens.json` (2026-08-20, 1440×900 @2x,
 * 치지직 홈·라이브 페이지에서 `:root` 커스텀 프로퍼티 1,909개를 떴다).
 */

/** `var(--name, fallback)` 문자열을 만든다. **순수 함수.** */
export function token(name: string, fallback: string): string {
  return `var(${name}, ${fallback})`;
}

/**
 * 배경 레이어. 실측에서 실제로 많이 쓰인 값 순이다
 * (`#2e3033` 13회 · `#141517` 8회 · `rgba(0,0,0,.6)` 11회).
 */
export const BG = {
  /** 가장 어두운 바닥 — 시트 본문 배경 */
  base: token('--color-bg-layer-01', '#141517'),
  /** 한 단 올라온 면 — 카드·입력 */
  raised: token('--color-bg-layer-03', '#24272b'),
  /** 떠 있는 면 — 시트 자체 */
  floating: token('--color-bg-layer-04', '#2e3033'),
  /** 모달 뒤 어둡게 깔리는 막. 치지직은 0.6 을 쓴다 (우리는 0.55 였다) */
  scrim: token('--color-bg-overlay-dim', 'rgba(0, 0, 0, 0.6)'),
} as const;

/** 전경(텍스트) 계층. 실측 `--color-content-*`. */
export const FG = {
  /** 최상위 — 제목 */
  primary: token('--color-content-01', '#ffffff'),
  /** 본문 */
  body: token('--color-content-02', '#dfe2ea'),
  /** 보조 설명 */
  muted: token('--color-content-04', '#9da5b6'),
  /** 비활성 */
  disabled: token('--color-content-05', '#808080'),
} as const;

/** 테두리. */
export const BORDER = {
  subtle: token('--color-bg-layer-05', '#24272b'),
  strong: token('--color-border-03', '#000000'),
} as const;

/**
 * 라운드 — **치지직 스케일 위의 값만 쓴다.**
 * 스케일에 없는 값(우리가 쓰던 `10px`)을 쓰면 나란히 놓였을 때 어긋난 것이 눈에 띈다.
 * 라이브 페이지 실사용 빈도: `6px` 31회 · `8px` 30회 · `4px` 9회.
 */
export const RADIUS = {
  xs: token('--sem-radius-xs', '4px'),
  sm: token('--sem-radius-sm', '6px'),
  md: token('--sem-radius-md', '8px'),
  lg: token('--sem-radius-lg', '12px'),
  circular: token('--sem-radius-circular', '9999px'),
} as const;

/**
 * 우리 UI 의 식별자. **치지직 토큰으로 대체하지 않는다.**
 * 톤은 맞추되 사용자가 우리 UI 임을 알 수 있어야 한다 — 확장 기능을 치지직 기능으로 오해하면
 * 문제가 생겼을 때 엉뚱한 곳에 문의하게 된다.
 */
export const ACCENT = '#00ffa3';

/**
 * 폰트. 치지직 실측 스택을 그대로 쓴다.
 * ⚠️ 우리는 `'Apple SD Gothic Neo'` 를 맨 앞에 두고 있었는데 치지직은 `-apple-system` 이 먼저다.
 * 우선순위가 뒤집혀 macOS 에서 **다른 글꼴로 렌더됐다.**
 */
export const FONT_FAMILY =
  '-apple-system, system-ui, "Malgun Gothic", "맑은 고딕", Helvetica, Arial, sans-serif';
