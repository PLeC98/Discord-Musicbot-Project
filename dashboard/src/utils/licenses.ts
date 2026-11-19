import { text } from "../text/index.ts";
const T = text.licenses.items;
// 라이선스 대화상자(LicenseDialog)의 목록: 화면이 내보내는 글꼴, 그림, 라이브러리, 봇이 함께 배포하는 데이터(data/, 고지는 data/NOTICE). 라이선스는 각 패키지의 package.json에 적힌 것.
// 빌드할 때만 쓰는 도구(Vite, TypeScript 등)는 화면에 실리지 않아 넣지 않는다. 의존성을 추가하거나 빼면 여기도 고친다

export type LicenseItem = { name: string; license: string; url: string; note?: string };

export const FONTS_AND_ART: LicenseItem[] = [
  { name: "Google Sans Flex", license: "SIL OFL 1.1", url: "https://fonts.google.com/specimen/Google+Sans+Flex" },
  { name: "Pretendard", license: "SIL OFL 1.1", url: "https://github.com/orioncactus/pretendard" },
  { name: "D2Coding", license: "SIL OFL 1.1", url: "https://github.com/naver/d2-coding-font", note: T.d2codingNote },
  { name: "Material Symbols Rounded", license: "SIL OFL 1.1", url: "https://fonts.google.com/icons" },
  { name: T.twemojiArt, license: "CC BY 4.0", url: "https://github.com/discord/twemoji", note: T.twemojiArtNote },
];

export const LIBRARIES: LicenseItem[] = [
  { name: "Vue", license: "MIT", url: "https://vuejs.org" },
  { name: "Vue Router", license: "MIT", url: "https://router.vuejs.org" },
  { name: "Pinia", license: "MIT", url: "https://pinia.vuejs.org" },
  { name: "VueUse", license: "MIT", url: "https://vueuse.org" },
  { name: "Tailwind CSS", license: "MIT", url: "https://tailwindcss.com" },
  { name: "axios", license: "MIT", url: "https://axios-http.com" },
  { name: "Material Color Utilities", license: "Apache 2.0", url: "https://github.com/material-foundation/material-color-utilities" },
];

/** 운영 소스 코드가 본 저장소와 다른가(디스코드 /license 와 같은 판정) */
export { isModifiedSource } from "../../../src/rules/project-source.ts";

/** 봇이 함께 배포하거나(data/) 받아 쓰는(DB-IP, database/geoip) 서드파티 데이터. data/NOTICE와 같은 것을 적는다 */
export const DATA_FILES: LicenseItem[] = [
  { name: T.modelRegistry, license: "CC0-1.0", url: "https://github.com/PocketRisu/pocketrisu-model-registry", note: T.modelRegistryNote },
  { name: "CMU Pronouncing Dictionary", license: "BSD-2-Clause · ISC", url: "https://github.com/cmusphinx/cmudict", note: T.cmudictNote },
  { name: T.gemmaTokenizer, license: "Apache 2.0", url: "https://huggingface.co/omote-ai/gemma-4-e2b-tokenizer", note: T.gemmaTokenizerNote },
  { name: "Unicode Unihan", license: "Unicode License v3", url: "https://www.unicode.org/charts/unihan.html", note: T.unihanNote },
  { name: "DB-IP City Lite", license: "CC BY 4.0", url: "https://db-ip.com", note: T.dbipNote },
];
