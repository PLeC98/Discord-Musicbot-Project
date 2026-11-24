/**
 * 모델 프로필, 가격표 다운로드. pnpm run update:models (--force면 해시가 같아도 모델 프로필을 받는다)
 *
 * 대시보드가 받는 것과 같은 길(src/config/ai-model-info)을 쓴다. 받은 것은 database/ 에 쓴다.
 */
import "../src/app/env-bootstrap.ts"; // 설정을 읽기 전에 .env를 읽는다(없으면 만든다)
import { refreshModelInfo } from "../src/config/ai-model-info.ts";
import { L } from "../src/infra/log/text.ts";
import { asText } from "../src/infra/log/log-text.ts";

(async () => {
  const force = process.argv.includes("--force");
  console.log(asText(L.config.modelsDownloading({ force })));
  // 가격표를 받지 못한 것은 로그(warn)로 알린다. 모델 프로필을 받지 못하면 예외를 던진다
  const got = await refreshModelInfo({ force });
  console.log(asText(got.changed ? L.config.modelsRefreshed({ count: got.count }) : L.config.modelsUnchanged({ count: got.count, fetchedAt: got.fetchedAt ?? null })));
})().catch((e) => {
  console.error(asText(L.config.modelsRefreshFailed()), e.message);
  process.exit(1);
});
