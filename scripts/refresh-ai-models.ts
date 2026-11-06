/**
 * 모델 프로필, 가격표 다운로드. pnpm run update:models (--force 면 해시가 같아도 모델 프로필을 받는다)
 *
 * 대시보드가 받는 것과 같은 길(src/config/ai-model-info)을 쓴다. 받은 것은 database/ 에 쓴다.
 */
import "../src/app/env-bootstrap.ts"; // 설정을 읽기 전에 .env 를 읽는다(없으면 만든다)
import { refreshModelInfo } from "../src/config/ai-model-info.ts";

(async () => {
  const force = process.argv.includes("--force");
  console.log(`다운로드 중${force ? " (강제)" : ""}`);
  // 가격표를 받지 못한 것은 로그(warn)로 알린다. 모델 프로필을 받지 못하면 던진다
  const got = await refreshModelInfo({ force });
  console.log(got.changed ? `모델 정보를 갱신했습니다. 모델 ${got.count}개` : `바뀐 것이 없습니다. 모델 ${got.count}개 (${got.fetchedAt ?? "없음"})`);
})().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
