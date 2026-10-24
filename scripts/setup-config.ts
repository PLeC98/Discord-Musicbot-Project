/**
 * 설정 준비. .env 가 없으면 .env.example 을 복사하고 무작위로 만들 수 있는 비밀(SECRETS_KEY · SESSION_SECRET)을 채운다(config/env-file).
 * 이미 있으면 손대지 않는다. 기동도 같은 것을 부른다(pnpm 은 의존성이 그대로면 이 단계를 건너뛴다).
 *
 * 장르 · 상태 문구 · AI 설정은 파일이 아니라 settings.db 의 문서다. 처음에는 기본값(src/config/defaults)으로 돌고 대시보드에서 고친다.
 */
import { messageOf } from "../src/rules/error-kind.ts";
import { setupEnv, madeLine } from "../src/config/env-file.ts";

function setup() {
  if (setupEnv()) console.log(`✅ [config] ${madeLine()}`);
}

if (import.meta.main) {
  try {
    setup();
  } catch (error) {
    // 설치 전체를 깨지 않는다. 기동이 다시 만들어 본다
    console.warn(`⚠️  [config] .env 준비 실패: ${messageOf(error)}`);
  }
}

export { setup };
