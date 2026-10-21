/**
 * 모델 프로필 · 가격표 다운로드. pnpm run update:models
 *
 * 대시보드의 갱신 버튼과 같은 길(src/config/ai-models · ai-prices 의 refresh)을 쓴다.
 */
import "../src/app/env-bootstrap.ts"; // 설정을 읽기 전에 .env 를 읽는다(없으면 만든다)
import path from "path";
import * as models from "../src/config/ai-models.ts";
import * as prices from "../src/config/ai-prices.ts";
import { PROVIDER_SPECS } from "../src/autoplay/assist/index.ts";

(async () => {
  const registries = [...new Set(Object.values(PROVIDER_SPECS).flatMap((one) => (one.registry ? [one.registry] : [])))];
  const force = process.argv.includes("--force");
  console.log(`다운로드 중. 프로바이더 ${registries.length}곳${force ? " (강제)" : ""}`);

  const got = await models.refresh({ registries, force });
  if (!got.changed) console.log(`모델 프로필: 바뀐 것이 없습니다. 모델 ${got.count}개 (${got.fetchedAt ?? "없음"})`);
  else console.log(`모델 프로필: 모델 ${got.count}개 → ${path.relative(process.cwd(), models.FETCHED)}`);

  // 가격표를 다운로드하지 못해도 모델 프로필은 이미 다운로드했다. 실패는 알리고 끝낸다
  const priced = await prices.refresh().catch((e: unknown) => console.error(`가격표: 다운로드하지 못했습니다(${e instanceof Error ? e.message : String(e)}). 가진 가격표를 씁니다`));
  if (!priced) return;
  if (!priced.changed) console.log(`가격표: 바뀐 것이 없습니다. 모델 ${priced.count}개 (${priced.fetchedAt ?? "없음"})`);
  else console.log(`가격표: 모델 ${priced.count}개 → ${path.relative(process.cwd(), prices.FETCHED)}`);
})().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
