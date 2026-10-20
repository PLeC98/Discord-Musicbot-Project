// GitHub 의 최신 릴리스 태그(공유 HTTP 클라이언트). yt-dlp 버전 맞추기 · bgutil 버전 알림이 같이 쓴다

import config from "../config/index.ts";
import { httpFor } from "../infra/http.ts";

const API_TIMEOUT_MS = 15_000;
const github = httpFor("github");

/** repo: "소유자/이름". 릴리스가 없거나 태그가 비면 던진다 */
async function latestReleaseTag(repo: string) {
  const res = await github.fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": config.userAgents.bot },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GitHub 릴리스 조회 ${res.status} (${repo})`);
  const { tag_name: tag } = (await res.json()) as { tag_name?: unknown };
  if (typeof tag !== "string" || !tag) throw new Error(`GitHub 릴리스에 태그가 없습니다 (${repo})`);
  return tag;
}

export { latestReleaseTag };
