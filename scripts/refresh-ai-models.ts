// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
/**
 * 모델 프로필 받아 오기. pnpm run update:models
 *
 * 대시보드의 갱신 버튼과 같은 길(src/aiModels.refresh)을 쓴다.
 */
import path from "path";
import * as models from "../src/config/schema/aiModels.ts";
import { PROVIDER_SPECS } from "../src/autoplay/assist/index.ts";

(async () => {
  const registries = [
    ...new Set(
      Object.values(PROVIDER_SPECS)
        .map((one) => one.registry)
        .filter(Boolean),
    ),
  ];
  const force = process.argv.includes("--force");
  console.log(`받는 중. 프로바이더 ${registries.length}곳${force ? " (강제)" : ""}`);

  const got = await models.refresh({ registries, force });
  if (!got.changed) return console.log(`바뀐 것이 없습니다. 모델 ${got.count}개 (${got.fetchedAt})`);
  console.log(`모델 ${got.count}개 → ${path.relative(process.cwd(), models.FILE)}`);
})().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
