// /system 이미지의 글꼴. 대시보드와 같은 패키지(pnpm catalog 로 같은 버전)의 파일을 고치지 않고 읽는다.
// 시스템 글꼴 대체는 OS 와 설치된 글꼴마다 달라(한국어 Windows 에서도 sans-serif 의 한글이 네모로 나왔다) 등록한 이름으로만 쓴다

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** 등록 이름과 패키지 안의 파일. 글자는 이 순서로 찾는다(라틴은 Google Sans Flex, 한글은 Pretendard) */
const FONTS = [
  { family: "Card Latin", file: "@fontsource-variable/google-sans-flex/files/google-sans-flex-latin-full-normal.woff2" },
  { family: "Card Hangul", file: "pretendard/dist/public/variable/PretendardVariable.ttf" },
] as const;

/** 캔버스 font 에 넣는 글꼴 목록 */
const FAMILIES = FONTS.map((one) => `"${one.family}"`).join(", ");

/**
 * 글꼴 스타일 두 가지. 대시보드 규칙과 같다: 본문은 400 둥글기 없음, 제목과 큰 숫자는 600 둥글기 100.
 * 둘 다 가변 글꼴이라 굵기와 둥글기를 축으로 준다(Pretendard 에는 둥글기 축이 없어 굵기만 먹는다).
 * 크기 맞춤 축(opsz)은 이미지 안의 글자가 화면에서 11 ~ 30px 정도라 그 사이의 한 값으로 고정한다
 */
const FACES = {
  regular: { weight: 400, variations: `"wght" 400, "ROND" 0, "opsz" 18` },
  strong: { weight: 600, variations: `"wght" 600, "ROND" 100, "opsz" 18` },
} as const;
type Face = keyof typeof FACES;

/** 패키지 파일의 실제 경로 */
const fontPath = (file: string) => require.resolve(file);

export { FONTS, FAMILIES, FACES, fontPath };
export type { Face };
