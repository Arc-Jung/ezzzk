# 갤럭시 Z 폴드8·폴드8 울트라 화면 검증

삼성 [공식 사양](https://api.samsungmobilepress.com/press-releases/galaxy-z-fold8-ultra-fold8-flip8-perfected-every-way-living)의 패널 해상도를 기준 DPR 2.625로 나눈 참조 CSS 뷰포트다. 울트라는 커버 1080×2520 / 내부 2256×2504, 폴드8은 커버 1248×1972 / 내부 1848×2448을 사용했다.

실기기에서 측정한 브라우저 크기가 아니다. 화면 배율, 주소창, 브라우저에 따라 실제 CSS 크기는 달라진다. 터치 입력과 데스크톱 사이트 모드로 에뮬레이션했으며 런타임 배치는 모델명이 아닌 현재 뷰포트로 계산한다.

- 접힘·펼침 중에도 선택한 멀티뷰 구성을 유지한다. 5분할은 가로에서 왼쪽 메인 70%와 오른쪽 4개, 세로에서 위쪽 메인과 아래 2×2로 배치한다.
- 세로 멀티뷰는 한 열과 격자의 가장 작은 영상 면적을 비교한다. 긴 커버는 한 열, 정사각형에 가까운 내부 화면은 더 큰 영상을 주는 배치를 쓴다.
- 채팅창은 가로에서 영상 오른쪽, 세로에서 영상 아래에 자동으로 배치한다. 이지직 설정의 레이아웃 탭에서 위치를 고정하거나 자동 배치로 돌아갈 수 있다.
- 좁은 설정 창은 탭을 가로 스크롤하고, 멀티뷰 분할 옵션은 줄을 바꿔 표시한다.

폴드8 울트라 커버 화면은 Chromium에서 980px 데스크톱 페이지를 411px 화면에 맞춰 재현했다. 설정과 멀티뷰 구성은 폭 395px를 쓰고 버튼 터치 영역을 약 44px로 표시한다. 설정 탭은 가로로, 멀티뷰 채널 목록은 슬롯 아래로 배치한다. 멀티뷰 재생 캡처는 두 슬롯의 광고 상태와 아이콘 한 줄을 보여 준다. 다른 프로필의 화면은 2026-10-27 치지직 라이브에서 캡처했다.

| 화면 / CSS 뷰포트 | 설정 | 멀티뷰 |
| --- | --- | --- |
| 폴드8 울트라 커버 411×960 | ![폴드8 울트라 커버 설정](demo-fold8-ultra-cover-settings.png) | ![폴드8 울트라 커버 멀티뷰에서 확대된 상단 바와 2분할](demo-fold8-ultra-cover-multiview.png) |
| 폴드8 울트라 펼침 859×954 | ![폴드8 울트라 펼침 설정](demo-fold8-ultra-open-settings.png) | ![폴드8 울트라 펼침 멀티뷰](demo-fold8-ultra-open-multiview.png) |
| 폴드8 울트라 펼침 가로 954×859 | ![폴드8 울트라 펼침 가로 설정](demo-fold8-ultra-open-landscape-settings.png) | ![폴드8 울트라 펼침 가로 멀티뷰](demo-fold8-ultra-open-landscape-multiview.png) |
| 폴드8 커버 475×751 | ![폴드8 커버 설정](demo-fold8-cover-settings.png) | ![폴드8 커버 멀티뷰](demo-fold8-cover-multiview.png) |
| 폴드8 펼침 704×933 | ![폴드8 펼침 설정](demo-fold8-open-settings.png) | ![폴드8 펼침 멀티뷰](demo-fold8-open-multiview.png) |
| 폴드8 펼침 가로 933×704 | ![폴드8 펼침 가로 설정](demo-fold8-open-landscape-settings.png) | ![폴드8 펼침 가로 멀티뷰](demo-fold8-open-landscape-multiview.png) |

재현:

```sh
yarn build
node scripts/verify-fold-cover-controls.mjs
```

커버 캡처는 `etc/tmp/fold-cover-controls/`의 `cover-settings.png`, `cover-config.png`, `cover.png`에 저장된다.

## 커버 화면 글자 크기와 채팅 배치

Chromium에서 980px 데스크톱 페이지를 411×820 커버 화면에 맞춰 재현했다. 보정 후 채팅 글자는 약 6px에서 12px로, 이지직 설정 버튼 높이는 약 18px에서 36px로 커졌다. 영상 높이와 브라우저 확대율은 그대로다.

| 세로 커버 · 보정 끔 | 세로 커버 · 보정 켬 |
| --- | --- |
| ![보정이 꺼진 커버 화면의 작은 채팅과 버튼](demo-fold-cover-ui-without-correction.png) | ![보정이 적용된 커버 화면과 영상 아래 채팅](demo-fold-cover-ui.png) |

펼친 954×859 가로 화면에서는 채팅이 영상 오른쪽으로 이동하고 커버 화면 보정이 풀린다. 회전 중에도 재현 영상과 입력 중인 채팅 내용이 유지됐다.

![폴드를 펼친 가로 화면과 영상 오른쪽 채팅](demo-fold-landscape-chat-right.png)

```sh
yarn build
node scripts/verify-fullscreen-side-chat.mjs --desktop-site
```

## 멀티뷰 구성

| 화면 | 구성 창 |
| --- | --- |
| 폴드8 울트라 커버 | ![울트라 커버 구성](demo-fold8-ultra-cover-multiview-config.png) |
| 폴드8 커버 | ![폴드8 커버 구성](demo-fold8-cover-multiview-config.png) |
| 폴드8 울트라 펼침 | ![울트라 펼침 구성](demo-fold8-ultra-open-multiview-config.png) |
| 폴드8 울트라 펼침 가로 | ![울트라 가로 구성](demo-fold8-ultra-open-landscape-multiview-config.png) |
| 폴드8 펼침 가로 | ![폴드8 가로 구성](demo-fold8-open-landscape-multiview-config.png) |

```sh
yarn demo:shots watch,config-sheet fold8-cover,fold8-ultra-open,fold8-ultra-open-landscape,fold8-open-landscape
```

## 2분할: 주소창이 보이는 일반 모드

일반 모드에서 주소창이 높이를 차지하면 펼친 폴드도 가로 뷰포트로 분류될 수 있다. 2분할은 상하·좌우 배치에서 실제 16:9 영상 면적을 비교해 더 크게 보이는 쪽을 선택한다. 첨부된 일반 모드 화면의 콘텐츠 영역 비율(1228×1142)을 859×798 CSS 뷰포트로 재현했다. 이는 실기기 CSS 크기 측정값이 아니다.

실제 두 방송의 재생을 확인하고, 같은 페이지에서 일반 → 최대화 → 일반 복귀까지 상하 배치가 유지되는지 검증한 뒤 캡처했다. 넓은 16:9·초광폭 화면은 좌우 배치를 유지한다.

| 주소창으로 높이가 줄어든 859×798 | 펼친 세로 859×954 |
| --- | --- |
| ![주소창 표시 2분할](demo-fold8-ultra-browser-multiview-two.png) | ![펼친 화면 2분할](demo-fold8-ultra-open-multiview-two.png) |

```sh
yarn demo:shots multiview-two fold8-ultra-browser,fold8-ultra-open
```

[접힘·펼침 중 설정창·재생 상태 유지와 전환 스크린샷](fold-transition.md)
