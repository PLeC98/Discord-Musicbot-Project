// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
/**
 * 개발 모드 실행. `pnpm run dev`.
 *
 * 평상시 실행(`pnpm start`)과 다른 점은 하나다: Vite 개발 서버(5173)에서 오는 요청을
 * 대시보드가 받아 준다. 그 허용은 같은 PC의 다른 페이지에 세션을 열어 주는 것이라
 * 기본값이면 안 되고, 개발 중일 때만 켠다.
 *
 * 환경 변수를 여기서 심는 이유: npm 스크립트의 `VAR=값 node ...` 표기는 Windows에서 동작하지 않는다.
 */
process.env.DASHBOARD_DEV_ORIGIN = "true";

// 환경 변수를 심은 뒤에 불러와야 한다(import 는 끌어올려진다)
await import("../index.ts");
