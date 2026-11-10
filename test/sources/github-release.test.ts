// src/sources/github-release.ts: 저장소의 최신 릴리스 태그. 토큰(GITHUB_TOKEN)이 있으면 API 요청에 싣는다. 전송은 가짜다
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import config from "../../src/config/index.ts";
import { latestReleaseTag, useFetch } from "../../src/sources/github-release.ts";

const saved = config.github.token;
afterEach(() => {
  useFetch(null);
  config.github.token = saved;
});

/** 받은 헤더를 모으고 그 응답을 준다 */
function serve(res: () => Response) {
  const seen: Headers[] = [];
  useFetch((async (_input: unknown, init?: RequestInit) => {
    seen.push(new Headers(init?.headers));
    return res();
  }) as typeof fetch);
  return seen;
}

test("최신 태그를 읽는다. 토큰이 없으면 Authorization 을 싣지 않는다", async () => {
  config.github.token = null;
  const seen = serve(() => Response.json({ tag_name: "2026.11.04.232659" }));
  assert.equal(await latestReleaseTag("yt-dlp/yt-dlp-nightly-builds"), "2026.11.04.232659");
  assert.equal(seen[0].get("authorization"), null);
});

test("토큰이 있으면 Bearer 로 싣는다", async () => {
  config.github.token = "ghs_test";
  const seen = serve(() => Response.json({ tag_name: "2026.10.26" }));
  await latestReleaseTag("yt-dlp/yt-dlp");
  assert.equal(seen[0].get("authorization"), "Bearer ghs_test");
});

test("응답이 2xx 가 아니거나 태그가 없으면 던진다", async () => {
  serve(() => new Response("rate limited", { status: 403 }));
  await assert.rejects(latestReleaseTag("yt-dlp/yt-dlp"), /GitHub 릴리스 조회 403/);
  serve(() => Response.json({}));
  await assert.rejects(latestReleaseTag("yt-dlp/yt-dlp"), /태그가 없음/);
});
