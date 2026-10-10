// src/autoplay/sources/http.ts — 자동재생 출처의 요청은 서비스마다 공유 HTTP 클라이언트를 지나 부른 결과가 남는다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { getJson, postJson, useFetch } from "../../src/autoplay/sources/http.ts";
import { _reset, linkStatus } from "../../src/infra/link-status.ts";

after(() => useFetch(null));

test("부른 서비스 이름으로 남고, 시험의 가짜 전송은 출처 서비스 모두에 든다", async () => {
  _reset();
  useFetch(async (input) => new Response(JSON.stringify({ url: String(input) }), { status: String(input).includes("down") ? 503 : 200 }));
  assert.deepEqual(await getJson("vocadb", "https://vocadb.net/api/songs"), { url: "https://vocadb.net/api/songs" });
  await postJson("anilist", "https://graphql.anilist.co", {});
  await assert.rejects(getJson("touhoudb", "https://touhoudb.com/down"), /HTTP 503/);

  assert.equal(linkStatus("vocadb")?.recent[0].ok, true);
  assert.equal(linkStatus("anilist")?.recent[0].ok, true);
  assert.equal(linkStatus("touhoudb")?.recent[0].error, "HTTP 503");
  assert.equal(linkStatus("lastfm"), null);
});
