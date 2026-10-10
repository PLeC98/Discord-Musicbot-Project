// 라이선스 대화상자(LicenseDialog)의 목록: 화면이 내보내는 글꼴 · 그림 · 라이브러리, 봇이 함께 배포하는 데이터(data/, 고지는 data/NOTICE). 라이선스는 각 패키지의 package.json 에 적힌 것.
// 빌드할 때만 쓰는 도구(Vite · TypeScript 등)는 화면에 실리지 않아 넣지 않는다. 의존성을 더하거나 빼면 여기도 고친다

export type LicenseItem = { name: string; license: string; url: string; note?: string };

export const FONTS_AND_ART: LicenseItem[] = [
  { name: "Google Sans Flex", license: "SIL OFL 1.1", url: "https://fonts.google.com/specimen/Google+Sans+Flex" },
  { name: "Pretendard", license: "SIL OFL 1.1", url: "https://github.com/orioncactus/pretendard" },
  { name: "Material Symbols Rounded", license: "SIL OFL 1.1", url: "https://fonts.google.com/icons" },
  { name: "Twemoji 그림", license: "CC BY 4.0", url: "https://github.com/jdecked/twemoji", note: "ⓒ Twitter, Inc 및 기여자" },
  { name: "Twemoji COLR 글꼴", license: "SIL OFL 1.1", url: "https://github.com/mrdrogdrog/twemoji-color-font" },
];

export const LIBRARIES: LicenseItem[] = [
  { name: "Vue", license: "MIT", url: "https://vuejs.org" },
  { name: "Vue Router", license: "MIT", url: "https://router.vuejs.org" },
  { name: "Pinia", license: "MIT", url: "https://pinia.vuejs.org" },
  { name: "VueUse", license: "MIT", url: "https://vueuse.org" },
  { name: "Tailwind CSS", license: "MIT", url: "https://tailwindcss.com" },
  { name: "axios", license: "MIT", url: "https://axios-http.com" },
  { name: "Twemoji API", license: "MIT", url: "https://github.com/jdecked/twemoji" },
  { name: "Material Color Utilities", license: "Apache 2.0", url: "https://github.com/material-foundation/material-color-utilities" },
];

// 저장소 주소 견주기: 끝의 / · .git, 대소문자, http(s):// · www. 는 무시한다(같은 저장소를 적는 흔한 다른 꼴)
const repoKey = (url: string) =>
  url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");

/** 운영자가 고친 소스를 원본과 다른 곳에 공개했나(SOURCE_REPO_URL 을 원본과 다르게 정함). 둘 중 하나라도 모르면 아니다 */
export const isModifiedSource = (sourceRepo?: string, projectRepo?: string) => Boolean(sourceRepo && projectRepo && repoKey(sourceRepo) !== repoKey(projectRepo));

/** 봇이 함께 배포하는 서드파티 데이터(data/). data/NOTICE 와 같은 것을 적는다 */
export const DATA_FILES: LicenseItem[] = [
  { name: "PocketRisu 모델 레지스트리", license: "CC0-1.0", url: "https://github.com/PocketRisu/pocketrisu-model-registry", note: "AI 모델 정보" },
  { name: "CMU Pronouncing Dictionary", license: "BSD-2-Clause · ISC", url: "https://github.com/cmusphinx/cmudict", note: "영어 끝소리, 조사 고르기" },
  { name: "Gemma 4 토크나이저", license: "Apache 2.0", url: "https://huggingface.co/omote-ai/gemma-4-e2b-tokenizer", note: "토큰 수 세기" },
  { name: "Unicode Unihan", license: "Unicode License v3", url: "https://www.unicode.org/charts/unihan.html", note: "한자 읽기, 조사 고르기" },
];

/** 포크해 온 원본 */
export const UPSTREAM = { name: "MusicBot (umutxyp)", license: "MIT", url: "https://github.com/umutxyp/MusicBot" };
