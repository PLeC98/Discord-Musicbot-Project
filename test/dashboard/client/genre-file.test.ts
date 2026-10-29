// dashboard/src/utils/genre-file.ts: 장르 하나 내보내기 · 불러오기. 파일 형식, 다른 파일 거부, 겹치는 식별자

import { test } from "node:test";
import assert from "node:assert/strict";
import { genreFile, parseGenreFile, importedRows } from "../../../dashboard/src/utils/genre-file.ts";
import { toRows, toMap } from "../../../dashboard/src/utils/genre-rows.ts";

const KNOWN = new Set(["spotify", "keyword"]);
const GENRE = { label: "팝", emoji: "🎤", sources: [{ type: "spotify", url: "https://open.spotify.com/playlist/AAA", weight: 3 }], maxDurationSec: 600 };

test("내보낸 파일을 그대로 불러오면 같은 장르가 된다(편집 중 붙인 _key 는 빠진다)", () => {
  const [row] = toRows({ pop: GENRE });
  row.sources[0]._key = 7;
  const { name, body } = genreFile(row);
  assert.equal(name, "genre-pop.json");
  assert.deepEqual(parseGenreFile(body), { id: "pop", genre: GENRE });
});

test("파일 이름에 못 쓰는 글자 · 빈 식별자", () => {
  assert.equal(genreFile(toRows({ "a/b c": GENRE })[0]).name, "genre-a-b-c.json");
  assert.equal(genreFile(toRows({ "": GENRE })[0]).name, "genre-unnamed.json");
});

test("장르 파일이 아니면 null", () => {
  for (const text of ["not json", "null", "[]", '{"id":"x","genre":{}}', '{"musicbotGenre":2,"id":"x","genre":{}}', '{"musicbotGenre":1,"genre":{}}', '{"musicbotGenre":1,"id":"x","genre":[]}', '{"musicbotGenre":1,"id":"x"}']) {
    assert.equal(parseGenreFile(text), null, text);
  }
});

test("겹치는 식별자는 뒤에 숫자를 붙이고, 함께 불러온 것끼리도 겹치지 않는다", () => {
  const { rows, renamed } = importedRows(
    [
      { id: "pop", genre: GENRE },
      { id: "pop", genre: GENRE },
      { id: "rock", genre: GENRE },
    ],
    ["pop", "pop-2"],
    KNOWN,
  );
  assert.deepEqual(
    rows.map((r) => r.name),
    ["pop-3", "pop-4", "rock"],
  );
  assert.equal(renamed, 2);
  assert.deepEqual(toMap(rows)["rock"], GENRE);
});

test("이 봇이 모르는 종류의 출처는 빼고, 무엇을 뺐는지 알린다(아는 종류는 값이 틀려도 남긴다)", () => {
  const genre = { label: "팝", sources: [{ type: "spotify", url: "x" }, { type: "removed-source", tags: ["a"] }, { type: "keyword" }, null, "junk"] };
  const { rows, dropped } = importedRows([{ id: "pop", genre: genre as never }], [], KNOWN);
  assert.deepEqual(
    rows[0].sources.map((one) => one.type),
    ["spotify", "keyword"],
  );
  assert.deepEqual(dropped, [{ name: "pop", types: ["removed-source", "?", "?"] }]);
  assert.deepEqual(importedRows([{ id: "rock", genre: GENRE }], [], KNOWN).dropped, [], "모두 아는 종류면 빼지 않는다");
});
