/**
 * 모델 프로필 · 값표 받아 오기. pnpm run update:models
 *
 * 대시보드의 갱신 버튼과 같은 길(src/config/ai-models · ai-prices 의 refresh)을 쓴다.
 */
import path from "path";
import * as models from "../src/config/ai-models.ts";
import * as prices from "../src/config/ai-prices.ts";
import { PROVIDER_SPECS } from "../src/autoplay/assist/index.ts";

(async () => {
  const registries = [...new Set(Object.values(PROVIDER_SPECS).flatMap((one) => (one.registry ? [one.registry] : [])))];
  const force = process.argv.includes("--force");
  console.log(`받는 중. 프로바이더 ${registries.length}곳${force ? " (강제)" : ""}`);

  const got = await models.refresh({ registries, force });
  if (!got.changed) console.log(`모델 프로필: 바뀐 것이 없습니다. 모델 ${got.count}개 (${got.fetchedAt})`);
  else console.log(`모델 프로필: 모델 ${got.count}개 → ${path.relative(process.cwd(), models.FETCHED)}`);

  const priced = await prices.refresh();
  if (!priced.changed) console.log(`값표: 바뀐 것이 없습니다. 모델 ${priced.count}개 (${priced.fetchedAt})`);
  else console.log(`값표: 모델 ${priced.count}개 → ${path.relative(process.cwd(), prices.FETCHED)}`);
})().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
