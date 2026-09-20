/**
 * 모델 프로필 받아 오기. pnpm run update:models
 *
 * 대시보드의 갱신 버튼과 같은 길(src/aiModels.refresh)을 쓴다.
 */
const path = require("path");
const models = require("../src/aiModels");
const { PROVIDER_SPECS } = require("../src/autoplayAssist");

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
