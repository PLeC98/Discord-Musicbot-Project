// 로그인 화면. 잠금 화면 결이라 섬의 짧은 말(locked · online · press Enter to login · 소스 링크)은 디자인으로 영어이고 화면에 둔다

const loginWithDiscord = "Discord로 로그인";
const loginAgain = "다시 로그인";
/** 밝기 고르기(작업 공간 알약) */
const modeDark = "어두운 화면";
const modeLight = "밝은 화면";
const modeSystem = "시스템 설정 따르기";

/** 로그인 콜백(src/dashboard/routes/auth.ts)이 돌려보낸 까닭 */
const errors = {
  denied: { title: "로그인을 취소했어요.", body: "디스코드 권한 승인 과정이 취소됐어요. 대시보드 사용에는 계정의 일부 정보가 필요해요. 다시 시도해 주세요." },
  no_code: { title: "로그인하지 못했어요!", body: "디스코드에서 로그인 결과를 받지 못했어요. 다시 시도해 주세요." },
  auth_failed: { title: "로그인하지 못했어요!", body: "디스코드 인증을 마치지 못했어요. 다시 시도해 보고, 계속되면 봇 운영자에게 알려 주세요." },
};
const unknownError = { title: "로그인하지 못했어요!", body: "알 수 없는 오류가 발생했어요. 다시 시도해 보고, 계속되면 봇 운영자에게 알려 주세요." };

export { loginWithDiscord, loginAgain, modeDark, modeLight, modeSystem, errors, unknownError };
