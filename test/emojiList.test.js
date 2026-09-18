"use strict";

// 이모지 고르기 목록이 지켜야 할 것들.
//
// 목록은 notes/디스코드 이모지 카테고리 및 목록.md를 원본으로 scripts/build-emoji-list.js가 만든다.
// 그 스크립트는 인터넷을 쓰지만 여기서는 쓰지 않는다 — 만들어진 결과물만 본다.

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const LIST = path.join(__dirname, "..", "dashboard", "client", "src", "emojiList.js");
const list = () => import("file://" + LIST.replace(/\\/g, "/"));
const groups = () => list().then((m) => m.EMOJI_GROUPS);
const all = async () => (await groups()).flatMap((g) => g.emoji.map((e) => [g.name, e.char, e]));

test("분류는 디스코드 한국어 선택기 그대로다", async () => {
  // 고르는 사람이 디스코드에서 보던 자리에서 찾을 수 있어야 한다.
  assert.deepEqual(
    (await groups()).map((g) => g.name),
    ["사람", "자연", "음식", "활동", "여행", "사물", "기호", "국기"],
  );
});

test("고르기 목록은 이모지 한 글자씩만 담는다", async () => {
  // 선택 메뉴가 거부하는 값을 고를 수 있게 두면 안 된다 — 저장 검사와 같은 잣대를 쓴다.
  const one = /^\p{RGI_Emoji}$/v;
  const bad = (await all()).filter(([, char]) => !one.test(char)).map(([group, char]) => `${group} ${char}`);
  assert.deepEqual(bad, []);
});

test("고르기 목록에 같은 이모지가 두 번 나오지 않는다", async () => {
  const seen = new Map();
  const dupes = [];
  for (const [group, char] of await all()) {
    if (seen.has(char)) dupes.push(`${char} — ${seen.get(char)}, ${group}`);
    else seen.set(char, group);
  }
  assert.deepEqual(dupes, []);
});

test("항목마다 이름과 검색어가 있다", async () => {
  // 이름은 툴팁으로 보이고 검색어는 찾기에 쓰인다 — 비면 그 칸은 찾을 수도, 뭔지 알 수도 없다.
  const bad = (await all()).filter(([, , e]) => !e.label?.trim() || !e.search?.trim()).map(([group, char]) => `${group} ${char}`);
  assert.deepEqual(bad, []);
});

test("디스코드에서 복사한 이름으로 찾을 수 있다", async () => {
  // 디스코드에서 이모지를 복사하면 ":shushing_face:" 꼴로 붙는다 — 그대로 쳐도 찾아져야 한다.
  const flat = (await groups()).flatMap((g) => g.emoji);
  const find = (q) => flat.find((e) => e.search.includes(q))?.char;

  // 콜론째로 붙여넣는 쪽이 흔하므로 그게 먼저다. 부분 일치라 콜론 없는 꼴도 같이 걸린다.
  assert.equal(find(":shushing_face:"), "🤫");
  assert.equal(find("shushing_face"), "🤫");
  assert.equal(find(":thinking:"), "🤔");
  assert.equal(find(":flag_kr:"), "🇰🇷");
  assert.equal(find("guitar"), "🎸");
  assert.equal(find("기타"), "🎸", "한국어 이름으로도 찾아진다");
});

test("그림 파일 이름을 규칙대로 지을 수 있다", async () => {
  // 대시보드는 이모지마다 Twemoji 그림 주소를 코드포인트로 지어 만든다(TwemojiImage.vue).
  // 주소가 깨지면 그 칸만 조용히 글자로 되돌아가므로, 이름이 나올 수 있는 꼴인지 본다.
  const shape = /^[0-9a-f]+(-[0-9a-f]+)*$/;
  const bad = [];

  for (const [group, char] of await all()) {
    const id = [...(char.includes("‍") ? char : char.replace(/️/g, ""))].map((c) => c.codePointAt(0).toString(16)).join("-");
    if (!shape.test(id)) bad.push(`${group} ${char} → ${id}`);
    // ZWJ가 없는데 fe0f가 남아 있으면 규칙을 잘못 적용한 것이다
    if (!char.includes("‍") && id.includes("fe0f")) bad.push(`${group} ${char} → ${id} (VS16이 남음)`);
  }

  assert.deepEqual(bad, []);
});

test("기록된 Twemoji 버전이 설치된 것과 같다", async () => {
  // 그림은 twemoji 패키지가 가리키는 CDN에서 온다. 패키지만 올리고 목록을 다시 만들지 않으면
  // 새로 생긴 이모지가 목록에 없는 채로 남는다 — 그때 여기서 걸린다.
  const installed = require("../dashboard/client/node_modules/@twemoji/api/package.json").version;
  assert.equal((await list()).TWEMOJI_VERSION, installed, "scripts/build-emoji-list.js를 다시 실행해야 한다");
});
