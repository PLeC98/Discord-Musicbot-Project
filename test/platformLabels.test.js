const test = require("node:test");
const assert = require("node:assert");

const { PLATFORM_NAMES, labelOf } = require("../src/platforms");
const { TYPES } = require("../src/autoplaySources");

// 소스를 더하고 이름표를 안 적으면 화면에 "Lbradio" 같은 것이 뜬다.
// 실제로 자동재생 소스 여섯이 대시보드에서 이름 없이(그리고 회색 점으로) 떠 있었다.
test("자동재생 소스는 모두 이름표를 갖는다", () => {
  // keyword 는 곡을 유튜브에서 바로 집으므로 platform 이 youtube 다 — 제 이름이 없다(autoplayRoute).
  const needed = TYPES.filter((t) => t !== "keyword");
  const missing = needed.filter((t) => !PLATFORM_NAMES[t]);
  assert.deepEqual(missing, [], `이름표 없는 소스: ${missing.join(", ")}`);

  // 유튜브 재생목록이 아닌 소스들이 실제로 싣는 값(src/autoplaySources)
  assert.equal(PLATFORM_NAMES.lbradio, "ListenBrainz Radio");
});

test("모르는 값은 첫 글자만 올리고, 빈 값은 한 칸 문자로", () => {
  assert.equal(labelOf("bandcamp"), "Bandcamp");
  assert.equal(labelOf(""), "-");
  assert.equal(labelOf(null), "-");
  assert.equal(labelOf("touhoudb"), "TouhouDB");
});
