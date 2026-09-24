import test from "node:test";
import assert from "node:assert";

import platforms from "../../src/ui/platforms.js";
const { PLATFORM_NAMES, PLATFORM_EMOJI, labelOf, emojiOf } = platforms;
import { TYPES } from "../../src/autoplay/sources/index.ts";

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

// 이름표와 이모지는 같이 적어야 한다. 하나만 적으면 임베드 플랫폼 칸이 음표로 뜨거나
// 이름이 "Anisongdb" 처럼 난다. 실제로 /nowplaying 이 그 꼴이었다.
test("이름표가 있는 플랫폼은 이모지도 있다", () => {
  const missing = Object.keys(PLATFORM_NAMES).filter((one) => !PLATFORM_EMOJI[one]);
  assert.deepEqual(missing, [], `이모지 없는 플랫폼: ${missing.join(", ")}`);
  assert.equal(emojiOf("anisongdb"), "🎏");
  assert.equal(emojiOf("bandcamp"), "🎵");
  assert.equal(emojiOf(""), "🎵");
});
