/**
 * 모델 프로필 받아 오기 — data/ai-models.json 을 다시 쓴다.
 *
 *   node scripts/refresh-ai-models.js
 *
 * 대시보드의 갱신 버튼과 같은 길(src/aiModels.fetchRegistry)을 쓴다.
 */
const fs = require("fs");
const path = require("path");
const { fetchRegistry, FILE, fieldsOf } = require("../src/aiModels");
const { PROVIDER_SPECS } = require("../src/autoplayAssist");

// 저쪽이 스키마를 바꾸면 칸이 통째로 빈 채로 저장될 수 있다. 아는 모델로 한 번 확인하고 쓴다.
const CANARY = [
  ["anthropic", "claude-opus-5", "effort"],
  ["vertex-gemini-native", "gemini-3.7-flash", "thinkingLevel"],
  ["openai", "gpt-5.5", "reasoning_effort"],
];

(async () => {
  const registries = [
    ...new Set(
      Object.values(PROVIDER_SPECS)
        .map((s) => s.registry)
        .filter(Boolean),
    ),
  ];
  console.log(`받는 중 — 프로바이더 ${registries.length}곳`);
  const got = await fetchRegistry(registries);

  for (const [registry, modelId, key] of CANARY) {
    const keys = fieldsOf(registry, modelId, got).map((f) => f.key);
    if (!keys.includes(key)) throw new Error(`${registry}:${modelId} 에 ${key} 가 없다 — 저쪽 모양이 바뀐 것 같다. 쓰지 않는다.`);
  }

  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(got, null, 2) + "\n");
  console.log(`모델 ${Object.keys(got.profiles).length}개 → ${path.relative(process.cwd(), FILE)} (${(fs.statSync(FILE).size / 1024).toFixed(0)}KB)`);
})().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
