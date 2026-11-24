// AI 보조 연결 확인, 키 입력, 판정 테스트 후보, 구글 토큰 받기, 토큰 세기, 판정 상한의 실패 이유

import type { RuleSentences } from "../../../src/rules/rule-problem.ts";

const assist = {
  "ai-no-provider": () => "프로바이더가 설정되지 않았어요",
  "ai-unknown-provider": (p) => `모르는 프로바이더예요(${p.provider})`,
  "ai-key-not-asked": () => "키가 없어 요청하지 않았어요",
  "ai-no-endpoint": () => "엔드포인트 주소가 비어 있어요(custom이면 직접 적어야 해요)",
  "ai-no-model": () => "모델 이름이 비어 있어요",
  "ai-account-missing": () => "서비스 계정이 설정되지 않음",
  "ai-account-not-json": () => "서비스 계정은 JSON 내용이어야 함(파일 경로는 받지 않음). 파일 내용을 붙여넣으세요",
  "ai-account-broken": () => "서비스 계정 JSON 읽기 실패: 형식이 깨짐",
  "ai-account-fields": () => "서비스 계정 JSON에 client_email 또는 private_key가 없음",
  "ai-key-unused": (p) => `${p.provider}: 키를 쓰지 않는 프로바이더`,
  "ai-key-not-text": (p) => `${p.provider}: 키는 문자열이어야 함`,
  "ai-key-no-url": (p) => `${p.label}: 키를 묶을 주소가 없음. 주소를 먼저 입력하세요`,
  "ai-key-paste-json": (p) => `${p.label}: 서비스 계정 JSON 내용을 붙여넣으세요(파일 경로는 받지 않음)`,
  "ai-key-account": (p, cause) => `${p.label}: ${cause}`,
  "ai-verdict-unreadable": () => "판정을 읽지 못함",
  "ai-verdict-not-json": () => "판정을 읽지 못함(JSON이 아닌 응답)",
  "ai-cand-not-youtube": () => "유튜브 URL이 아니라 건너뛰었어요.",
  "ai-cand-timeout": (p) => `시간 초과(${p.sec}초)로 곡 정보를 불러오지 못했어요.`,
  "ai-google-sign-failed": () => "서비스 계정 키로 서명 실패. private_key를 확인하세요",
  "ai-google-token-http": (p, cause) => `토큰 발급 실패: HTTP ${p.status} ${cause}`,
  "ai-google-token-unreadable": () => "토큰 응답 읽기 실패",
  "ai-google-token-missing": () => "토큰 응답에 access_token이 없음",
  "ai-token-count-failed": () => "토큰 계산 실패",
  "ai-token-worker-exited": () => "토큰 계산 워커가 종료됨",
  "ai-token-count-timeout": (p) => `토큰 세기가 ${p.sec}초를 넘김`,
  "ai-judge-total-limit": () => "판정 상한",
} satisfies Partial<RuleSentences>;

export { assist };
