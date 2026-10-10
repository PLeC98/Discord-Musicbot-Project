// 저장소의 설명서(docs/)로 가는 주소. 저장소는 봇이 알려 준 소스 주소(SOURCE_REPO_URL, 없으면 원본 프로젝트)이고 기본 가지(HEAD)를 본다.
// 주소 꼴을 아는 곳(GitHub · GitLab)만 잇는다. 모르면 링크를 두지 않는다(틀린 주소로 보내느니 없는 편이 낫다)

import { ref } from "vue";

const repo = ref("");

/** 봇 정보(/api/bot)를 받으면 부른다 */
export function setDocsRepo(url: unknown): void {
  repo.value = typeof url === "string" ? url.replace(/\/+$/, "").replace(/\.git$/, "") : "";
}

/** 저장소 안 파일(예: docs/favicon.md)의 주소. 저장소를 모르거나 꼴을 모르면 null */
export function docUrl(file: string): string | null {
  let host: string;
  try {
    host = new URL(repo.value).hostname;
  } catch {
    return null;
  }
  if (host === "github.com") return `${repo.value}/blob/HEAD/${file}`;
  if (host === "gitlab.com") return `${repo.value}/-/blob/HEAD/${file}`;
  return null;
}
