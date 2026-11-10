// GitHub 의 최신 릴리스 태그(공유 HTTP 클라이언트). yt-dlp 버전 맞추기, bgutil 버전 알림이 같이 쓴다.
// REST API(releases/latest)는 인증 없이 IP 마다 시간당 60회라 IP 를 함께 쓰는 곳(CI 러너)에서 막힌다. 대신 GitHub 이 문서로 내는
// 최신 릴리스 링크(github.com/<저장소>/releases/latest)가 /releases/tag/<태그> 로 넘겨주는 주소에서 태그를 읽는다

import config from "../config/index.ts";
import { httpFor } from "../infra/http.ts";

const TIMEOUT_MS = 15_000;
const github = httpFor("github");

/** repo: "소유자/이름". 저장소나 릴리스가 없으면(넘겨주는 주소에 태그가 없으면) 던진다 */
async function latestReleaseTag(repo: string) {
  const res = await github.fetch(`https://github.com/${repo}/releases/latest`, {
    redirect: "manual",
    headers: { "User-Agent": config.userAgents.bot },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  await res.body?.cancel();
  const location = res.headers.get("location") ?? "";
  if (res.status < 300 || res.status >= 400) throw new Error(`GitHub 최신 릴리스 조회 ${res.status} (${repo})`);
  const tag = /\/releases\/tag\/([^/?#]+)$/.exec(location)?.[1];
  if (!tag) throw new Error(`GitHub 릴리스에 태그가 없음 (${repo})`);
  return decodeURIComponent(tag);
}

/** 테스트가 가짜 전송을 넣는다. null 이면 진짜 fetch */
const useFetch = (fake: typeof fetch | null) => github.useFetch(fake);

export { latestReleaseTag, useFetch };
