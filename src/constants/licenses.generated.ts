/**
 * ⚠️ 자동 생성 파일이다. **직접 고치지 않는다** — `yarn licenses:gen` 으로 다시 만든다.
 * 생성기: `scripts/generate-licenses.mjs`
 * 근거: `package.json` 의 의존성 목록 + `node_modules/<pkg>/LICENSE` 원문.
 */

export type LicenseEntry = {
  name: string;
  version: string;
  /** package.json 의 license 필드 (원문과 대조용). */
  licenseField: string | null;
  /** 읽어 온 원문 파일 이름. null 이면 원문이 없다. */
  licenseFile: string | null;
  /** 원문 첫 줄 — 라이선스 종류의 1차 근거. */
  headline: string | null;
  /** 원문에서 뽑은 저작권 문구. */
  copyright: string | null;
};

export type BundledLicenseEntry = LicenseEntry & { text: string | null };

export type CodeAttribution = {
  name: string;
  licenseField: string;
  url: string;
  /** 참조 주석이 실제로 남아 있는 파일 — 고지의 근거다. */
  files: readonly string[];
};

/**
 * 이 확장 자신의 이름·라이선스 (package.json + 저장소 루트 LICENSE 원문).
 *
 * 🔴 **버전은 여기 담지 않는다.** 릴리스 워크플로가 머지마다 package.json·manifest.json 의
 * patch 를 올린 뒤 게이트를 다시 돌리므로, 생성 시점 버전을 박아 두면 그 범프와 어긋나
 * 릴리스가 통째로 실패한다 (2026-08-17 v0.1.11 실패: expected '0.1.10' to be '0.1.11').
 * 화면에는 `chrome.runtime.getManifest().version` 을 쓴다 — 설치된 확장의 실제 버전이다.
 */
export const SELF_NAME = 'ezzzk';
export const SELF_LICENSE_TEXT =
  'MIT License\n\nCopyright (c) 2026 Arc-Jung\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.';

/** 코드를 차용해 고지가 필요한 오픈소스. src/ 를 훑어 근거가 있는 것만 담는다. */
export const CODE_ATTRIBUTIONS: readonly CodeAttribution[] = [
  {
    name: 'chzzk-plus (kyechan99/chzzk-plus)',
    licenseField: 'MIT',
    url: 'https://github.com/kyechan99/chzzk-plus',
    files: [
      'src/constants/licenses.generated.ts',
      'src/constants/licenses.test.ts',
      'src/constants/storage.ts',
      'src/features/audioPipeline.test.ts',
      'src/features/audioPipeline.ts',
      'src/features/powerCollect.ts',
      'src/settingsPanel/tabs.tsx',
    ],
  },
];

/** 빌드 산출물(dist)에 코드가 포함되어 함께 배포되는 것 — 재배포 고지 의무 대상. */
export const BUNDLED_LICENSES: readonly BundledLicenseEntry[] = [
  {
    name: 'react',
    version: '18.3.1',
    licenseField: 'MIT',
    licenseFile: 'LICENSE',
    headline: 'MIT License',
    copyright: 'Copyright (c) Facebook, Inc. and its affiliates.',
    text: 'MIT License\n\nCopyright (c) Facebook, Inc. and its affiliates.\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.',
  },
  {
    name: 'react-dom',
    version: '18.3.1',
    licenseField: 'MIT',
    licenseFile: 'LICENSE',
    headline: 'MIT License',
    copyright: 'Copyright (c) Facebook, Inc. and its affiliates.',
    text: 'MIT License\n\nCopyright (c) Facebook, Inc. and its affiliates.\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.',
  },
  {
    name: 'scheduler',
    version: '0.23.2',
    licenseField: 'MIT',
    licenseFile: 'LICENSE',
    headline: 'MIT License',
    copyright: 'Copyright (c) Facebook, Inc. and its affiliates.',
    text: 'MIT License\n\nCopyright (c) Facebook, Inc. and its affiliates.\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.',
  },
];

/** 개발·빌드·검증에만 쓰이고 배포되는 확장에는 포함되지 않는 것. */
export const DEV_LICENSES: readonly LicenseEntry[] = [
  {
    name: '@crxjs/vite-plugin',
    version: '2.0.0-beta.26',
    licenseField: 'MIT',
    licenseFile: 'LICENSE',
    headline: 'MIT License',
    copyright: 'Copyright (c) 2019 jacksteamdev',
  },
  {
    name: '@types/chrome',
    version: '0.0.268',
    licenseField: 'MIT',
    licenseFile: 'LICENSE',
    headline: 'MIT License',
    copyright: 'Copyright (c) Microsoft Corporation.',
  },
  {
    name: '@types/react',
    version: '18.3.31',
    licenseField: 'MIT',
    licenseFile: 'LICENSE',
    headline: 'MIT License',
    copyright: 'Copyright (c) Microsoft Corporation.',
  },
  {
    name: '@types/react-dom',
    version: '18.3.7',
    licenseField: 'MIT',
    licenseFile: 'LICENSE',
    headline: 'MIT License',
    copyright: 'Copyright (c) Microsoft Corporation.',
  },
  {
    name: '@typescript-eslint/eslint-plugin',
    version: '7.18.0',
    licenseField: 'MIT',
    licenseFile: 'LICENSE',
    headline: 'MIT License',
    copyright: 'Copyright (c) 2019 typescript-eslint and other contributors',
  },
  {
    name: '@typescript-eslint/parser',
    version: '7.18.0',
    licenseField: 'BSD-2-Clause',
    licenseFile: 'LICENSE',
    headline: 'TypeScript ESLint Parser',
    copyright: 'Copyright JS Foundation and other contributors, https://js.foundation',
  },
  {
    name: '@vitejs/plugin-react-swc',
    version: '3.11.0',
    licenseField: 'MIT',
    licenseFile: 'LICENSE',
    headline: 'MIT License',
    copyright: 'Copyright (c) Arnaud Barré (https://github.com/ArnaudBarre)',
  },
  {
    name: 'eslint',
    version: '8.57.1',
    licenseField: 'MIT',
    licenseFile: 'LICENSE',
    headline: 'Copyright OpenJS Foundation and other contributors, <www.openjsf.org>',
    copyright: 'Copyright OpenJS Foundation and other contributors, <www.openjsf.org>',
  },
  {
    name: 'eslint-config-prettier',
    version: '9.1.2',
    licenseField: 'MIT',
    licenseFile: 'LICENSE',
    headline: 'The MIT License (MIT)',
    copyright:
      'Copyright (c) 2017, 2018, 2019, 2020, 2021, 2022, 2023 Simon Lydell and contributors',
  },
  {
    name: 'eslint-plugin-react-hooks',
    version: '4.6.2',
    licenseField: 'MIT',
    licenseFile: 'LICENSE',
    headline: 'MIT License',
    copyright: 'Copyright (c) Facebook, Inc. and its affiliates.',
  },
  {
    name: 'eslint-plugin-react-refresh',
    version: '0.4.26',
    licenseField: 'MIT',
    licenseFile: 'LICENSE',
    headline: 'MIT License',
    copyright: 'Copyright (c) Arnaud Barré (https://github.com/ArnaudBarre)',
  },
  {
    name: 'jsdom',
    version: '25.0.1',
    licenseField: 'MIT',
    licenseFile: 'LICENSE.txt',
    headline: 'Copyright (c) 2010 Elijah Insua',
    copyright: 'Copyright (c) 2010 Elijah Insua',
  },
  {
    name: 'playwright',
    version: '1.62.1',
    licenseField: 'Apache-2.0',
    licenseFile: 'LICENSE',
    headline: 'Apache License',
    copyright: 'Portions Copyright (c) Microsoft Corporation.\nPortions Copyright 2017 Google Inc.',
  },
  {
    name: 'prettier',
    version: '3.9.6',
    licenseField: 'MIT',
    licenseFile: 'LICENSE',
    headline: 'Copyright © James Long and contributors',
    copyright: 'Copyright © James Long and contributors',
  },
  {
    name: 'typescript',
    version: '5.9.3',
    licenseField: 'Apache-2.0',
    licenseFile: 'LICENSE.txt',
    headline: 'Apache License',
    copyright: null,
  },
  {
    name: 'vite',
    version: '5.4.21',
    licenseField: 'MIT',
    licenseFile: 'LICENSE.md',
    headline: '# Vite core license',
    copyright:
      'Copyright (c) 2019-present, VoidZero Inc. and Vite contributors\n> Copyright 2022 Justin Ridgewell <jridgewell@google.com>\n> Copyright 2019 Justin Ridgewell <jridgewell@google.com>\n> Copyright 2022 Justin Ridgewell <jridgewell@google.com>\n> Copyright (c) 2015 Rich Harris\n> Copyright 2022 Justin Ridgewell <justin@ridgewell.name>\n> Copyright (c) Denis Malinochkin\n> Copyright (c) Denis Malinochkin\n> Copyright (c) Denis Malinochkin\n> Copyright (c) 2019 RollupJS Plugin Contributors (https://github.com/rollup/plugins/graphs/contributors)\n> Copyright (c) 2019 RollupJS Plugin Contributors (https://github.com/rollup/plugins/graphs/contributors)\n> Copyright (c) 2019 RollupJS Plugin Contributors (https://github.com/rollup/plugins/graphs/contributors)\n> Copyright (c) 2019 RollupJS Plugin Contributors (https://github.com/rollup/plugins/graphs/contributors)\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)\n> Copyright (c) 2019 Elan Shanker, Paul Miller (https://paulmillr.com)\n> Copyright (c) 2020-present, Yuxi (Evan) You\n> Copyright (c) 2023-present, sapphi-red\n> Copyright (c) 2015, David Bonnet <david@bonnet.cc>\n> Copyright (c) 2013 Julian Gruber &lt;julian@juliangruber.com&gt;\n> Copyright (c) 2019 Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com), Paul Miller (https://paulmillr.com)\n> Copyright (c) 2013 Julian Gruber <julian@juliangruber.com>\n> Copyright (c) 2014-present, Jon Schlinkert.\n> Copyright (c) EGOIST <0x142857@gmail.com> (https://github.com/egoist)\n> Copyright (c) 2012-2019 Paul Miller (https://paulmillr.com), Elan Shanker\n> Copyright (c) 2013 James Halliday (mail@substack.net)\n> Copyright (c) 2010 Sencha Inc.\n> Copyright (c) 2011 LearnBoost\n> Copyright (c) 2011-2014 TJ Holowaychuk\n> Copyright (c) 2015 Douglas Christopher Wilson\n> Copyright 2013 Thorsten Lorenz.\n> Copyright (c) 2013 Troy Goode <troygoode@gmail.com>\n> Copyright (c) 2018 Made With MOXY Lda <hello@moxy.studio>\n> Copyright Mathias Bynens <https://mathiasbynens.be/>\n> Copyright (c) 2014-2017 TJ Holowaychuk <tj@vision-media.ca>\n> Copyright (c) 2018-2021 Josh Junon\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)\n> Copyright (c) 2015, Scott Motte\n> Copyright (c) 2016, Scott Motte\n> Copyright (c) 2014 Jonathan Ong me@jongleberry.com\n> Copyright (c) 2016 Douglas Christopher Wilson\n> Copyright (c) Felix Böhm\n> Copyright (C) 2018-2022 Guy Bedford\n> Copyright (c) 2012-2013 TJ Holowaychuk\n> Copyright (c) 2015 Andreas Lubbe\n> Copyright (c) 2015 Tiancheng "Timothy" Gu\n> Copyright (c) 2015-20 [these people](https://github.com/Rich-Harris/estree-walker/graphs/contributors)\n> Copyright (c) 2014-2016 Douglas Christopher Wilson\n> Copyright (c) 2014 Arnout Kazemier\n> Copyright (c) Denis Malinochkin\n> Copyright (c) 2015-2020, Matteo Collina <matteo.collina@gmail.com>\n> Copyright (c) 2014-present, Jon Schlinkert.\n> Copyright (c) 2014-2017 Douglas Christopher Wilson <doug@somethingdoug.com>\n> Copyright 2014–present Olivier Lalonde <olalonde@gmail.com>, James Talmage <james@talmage.io>, Ruben Verborgh\n> Copyright (c) 2015 Alexey Litvinov\n> Copyright (c) 2009-2023 Isaac Z. Schlueter and Contributors\n> Copyright (c) 2015, 2019 Elan Shanker\n>   Copyright (c) 2010-2016 Charlie Robbins, Jarrett Cruger & the Contributors.\n> Copyright 2018 Glen Maddern\n> Copyright (c) 2019 Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com), Paul Miller (https://paulmillr.com)\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)\n> Copyright (c) 2014-2016, Jon Schlinkert\n> Copyright (c) 2014-2017, Jon Schlinkert.\n> Copyright (c) 2014-present, Jon Schlinkert.\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)\n> Copyright (c) Isaac Z. Schlueter and Contributors\n> Copyright (c) 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024 Simon Lydell\n> Copyright (c) 2017-present, Yuxi (Evan) You\n> Copyright (c) 2017-present, Yuxi (Evan) You\n> Copyright (c) 2022 Anton Kastritskiy\n> Copyright JS Foundation and other contributors\n> Copyright (c) 2010-2023 Isaac Z. Schlueter and Contributors\n> Copyright 2018 Rich Harris\n> Copyright (c) 2014-2020 Teambition\n> Copyright (c) 2014-present, Jon Schlinkert.\n> Copyright (c) 2011-2023 Isaac Z. Schlueter and Contributors\n> Copyright (c) 2017-2023 npm, Inc., Isaac Z. Schlueter, and Contributors\n> Copyright (c) Pooya Parsa <pooya@pi0.io>\n> Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (https://lukeed.com)\n> Copyright (c) 2016 Zeit, Inc.\n> Copyright (c) 2014-2018, Jon Schlinkert.\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)\n> Copyright (c) 2013 Jonathan Ong <me@jongleberry.com>\n> Copyright (c) 2014 Douglas Christopher Wilson <doug@somethingdoug.com>\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)\n> Copyright (c) 2013-2019 Ivan Nikulin (ifaaan@gmail.com, https://github.com/inikulin)\n> Copyright (c) 2014 Jonathan Ong <me@jongleberry.com>\n> Copyright (c) 2014-2017 Douglas Christopher Wilson <doug@somethingdoug.com>\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)\n> Copyright (c) 2019 Rich Harris\n> Copyright (c) 2021 Alexey Raspopov, Kostiantyn Denysov, Anton Verinov\n> Copyright (c) 2017-present, Jon Schlinkert.\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)\n> Copyright (c) 2014 Maxime Thirouin, Jason Campbell & Kevin Mårtensson\n> Copyright Michael Ciniawsky <michael.ciniawsky@gmail.com>\n> Copyright 2015-present Alexander Madyankin <alexander@madyankin.name>\n> Copyright 2015 Glen Maddern\n> Copyright 2015 Mark Dalgleish <mark.john.dalgleish@gmail.com>\n> Copyright (c) 2015, Glen Maddern\n> Copyright (c) 2015, Glen Maddern\n> Copyright (c) Ben Briggs <beneb.info@gmail.com> (http://beneb.info)\n> Copyright (c) Bogdan Chadkin <trysound@yandex.ru>\n> Copyright (c) Feross Aboukhadijeh\n> Copyright 2016 Bogdan Chadkin <trysound@yandex.ru>\n> Copyright (c) 2012-2019 Thorsten Lorenz, Paul Miller (https://paulmillr.com)\n> Copyright (c) 2015 Unshift.io, Arnout Kazemier,  the Contributors.\n> Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com)\n> Copyright (c) 2015 Matteo Collina\n> Copyright (c) Feross Aboukhadijeh\n> Copyright (c) Kevin Mårtensson <kevinmartensson@gmail.com> (github.com/kevva)\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)\n> Copyright (c) 2013 James Halliday (mail@substack.net)\n> Copyright (c) 2014 Jonathan Ong <me@jongleberry.com>\n> Copyright (c) 2016 Douglas Christopher Wilson <doug@somethingdoug.com>\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)\n> Copyright (c) 2022 Anthony Fu <https://github.com/antfu>\n> Copyright (c) 2015-present, Jon Schlinkert.\n> Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com)\n> Copyright (c) 2021-present dominikg and [contributors](https://github.com/dominikg/tsconfck/graphs/contributors)\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)\n> Copyright (c) Pooya Parsa <pooya@pi0.io>\n> Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com>\n> Copyright (c) 2014 Nathan Rajlich <nathan@tootallnate.net>\n> Copyright (c) 2013-2017 Jared Hanson\n> Copyright (c) 2014-2017 Douglas Christopher Wilson\n> Copyright (c) Isaac Z. Schlueter and Contributors\n> Copyright (c) 2011 Einar Otto Stangvik <einaros@gmail.com>\n> Copyright (c) 2013 Arnout Kazemier and contributors\n> Copyright (c) 2016 Luigi Pinca and contributors\n> Copyright Eemeli Aro <eemeli@gmail.com>',
  },
  {
    name: 'vitest',
    version: '2.1.9',
    licenseField: 'MIT',
    licenseFile: 'LICENSE.md',
    headline: '# Vitest core license',
    copyright:
      'Copyright (c) 2021-Present Vitest Team\n> Copyright (c) 2021 Anthony Fu <https://github.com/antfu>\n> Copyright (c) Denis Malinochkin\n> Copyright (c) Denis Malinochkin\n> Copyright (c) Denis Malinochkin\n> Copyright (c) 2018, Sinon.JS\n> Copyright (c) 2010-2014, Christian Johansen, christian@cjohansen.no. All rights reserved.\n> Copyright (C) 2012-2020 by various contributors (see AUTHORS)\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)\n> Copyright (c) 2021 Anthony Fu <https://github.com/antfu>\n> Copyright (c) 2014-present, Jon Schlinkert.\n> Copyright (c) EGOIST <0x142857@gmail.com> (https://github.com/egoist)\n> Copyright (c) 2014\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)\n> Copyright Mathias Bynens <https://mathiasbynens.be/>\n> Copyright (c) Denis Malinochkin\n> Copyright (c) 2015-2020, Matteo Collina <matteo.collina@gmail.com>\n> Copyright (c) 2014-present, Jon Schlinkert.\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)\n> Copyright (c) 2018-2020, Andrea Giammarchi, @WebReflection\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)\n> Copyright (c) Hiroki Osame <hiroki.osame@gmail.com>\n> Copyright (c) 2015, 2019 Elan Shanker\n> Copyright (c) 2014-2016, Jon Schlinkert\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)\n> Copyright (c) 2014-2017, Jon Schlinkert.\n> Copyright (c) 2014-present, Jon Schlinkert.\n> Copyright (c) 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024 Simon Lydell\n> Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com)\n> Copyright (c) 2021 Anthony Fu <https://github.com/antfu>\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)\n> Copyright (c) 2014-2020 Teambition\n> Copyright (c) 2014-present, Jon Schlinkert.\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)\n> Copyright (c) Pooya Parsa <pooya@pi0.io>\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)\n> Copyright (c) 2020-PRESENT Anthony Fu <https://github.com/antfu>\n> Copyright (c) 2017-present, Jon Schlinkert.\n> Copyright (c) 2018 Terkel Gjervig Nielsen\n> Copyright (c) Feross Aboukhadijeh\n> Copyright (c) Hiroki Osame <hiroki.osame@gmail.com>\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)\n> Copyright (c) 2015 Matteo Collina\n> Copyright (c) Feross Aboukhadijeh\n> Copyright (c) 2015, Contributors\n> Copyright (c) 2018 Terkel Gjervig Nielsen\n> Copyright (c) DC <threedeecee@gmail.com>\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)\n> Copyright (c) 2022 Anthony Fu <https://github.com/antfu>\n> Copyright (c) 2015-present, Jon Schlinkert.\n> Copyright (c) 2013 Jake Luer <jake@alogicalparadox.com> (http://alogicalparadox.com)\n> Copyright (c) Pooya Parsa <pooya@pi0.io>\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)\n> Copyright (c) 2011 Einar Otto Stangvik <einaros@gmail.com>\n> Copyright (c) 2013 Arnout Kazemier and contributors\n> Copyright (c) 2016 Luigi Pinca and contributors\n> Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)',
  },
];

/**
 * npm 의존성이 아니지만 검증에 내려받아 쓰는 오픈소스.
 * 애드가드는 치지직의 "광고 차단 프로그램을 사용 중이신가요?" 모달을 재현하는 데만 쓴다
 * (`scripts/fetch-adguard.mjs` → `.vendor/adguard-mv3/`). 저장소에도 배포물에도 넣지 않는다.
 * ⚠️ 배포 zip 안에 라이선스 원문 파일이 없어 종류를 원문으로 확인하지 못했다
 * (2026-08-16 확인: `.vendor/adguard-mv3` 전체에 licen[cs]e/COPYING 파일 없음).
 * 확인하지 못한 것을 지어내지 않는다 — 미확인으로 남긴다.
 */
export const EXTERNAL_TOOLS: readonly LicenseEntry[] = [
  {
    name: 'AdGuard AdBlocker (브라우저 확장)',
    version: '5.4.3.1',
    licenseField: null,
    licenseFile: null,
    headline: null,
    copyright: 'Adguard Software Ltd (manifest.json 의 author 필드)',
  },
];
