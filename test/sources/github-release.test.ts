// src/sources/github-release.ts: 저장소의 최신 릴리스 태그를 최신 릴리스 링크가 넘겨주는 주소에서 읽는다(REST API 한도를 쓰지 않는다). 전송은 가짜다
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { latestReleaseTag, useFetch } from "../../src/sources/github-release.ts";

afterEach(() => useFetch(null));

/** 부른 주소와 넘겨주기 설정을 모으고 그 응답을 준다 */
function serve(res: () => Response) {
  const seen: { url: string; redirect: RequestInit["redirect"] }[] = [];
  useFetch((async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), redirect: init?.redirect });
    return res();
  }) as typeof fetch);
  return seen;
}
const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

test("넘겨주는 주소의 태그를 읽는다. 따라가지 않고(manual) API 가 아닌 최신 릴리스 링크를 연다", async () => {
  const seen = serve(() => redirect("https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/tag/2026.11.04.232659"));
  assert.equal(await latestReleaseTag("yt-dlp/yt-dlp-nightly-builds"), "2026.11.04.232659");
  assert.deepEqual(seen, [{ url: "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest", redirect: "manual" }]);
});

test("태그의 퍼센트 인코딩은 푼다", async () => {
  serve(() => redirect("https://github.com/a/b/releases/tag/v1.0%2Bbuild"));
  assert.equal(await latestReleaseTag("a/b"), "v1.0+build");
});

test("저장소가 없거나(404) 릴리스가 없거나(태그 없는 주소) 넘겨주지 않으면 던진다", async () => {
  serve(() => new Response("Not Found", { status: 404 }));
  await assert.rejects(latestReleaseTag("a/없음"), /최신 릴리스 조회 404/);
  serve(() => redirect("https://github.com/a/b/releases"));
  await assert.rejects(latestReleaseTag("a/b"), /태그가 없음/);
  serve(() => new Response("<html>"));
  await assert.rejects(latestReleaseTag("a/b"), /최신 릴리스 조회 200/);
});
