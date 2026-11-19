// 운영 소스 코드가 본 저장소와 다른가(SOURCE_REPO_URL 로 고친 버전을 지정했나). /license 와 대시보드(라이선스 창, 로그인 화면)가 같이 쓴다.
// 브라우저도 쓴다. Node 에 기대는 것이 없다

// 저장소 주소 비교: 끝의 /, .git, 대소문자, http(s)://, www. 는 무시한다(같은 저장소를 적는 흔한 다른 형식)
const repoKey = (url: string) =>
  url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");

/** 운영자가 고친 소스를 원본과 다른 곳에 공개했나(SOURCE_REPO_URL을 원본과 다르게 지정함). 주소가 하나라도 비어 있으면 false */
const isModifiedSource = (sourceRepo?: string, projectRepo?: string) => Boolean(sourceRepo && projectRepo && repoKey(sourceRepo) !== repoKey(projectRepo));

/** 봇의 라이선스와 저작권 고지(/license). 라이선스 전문은 GNU 공식 페이지 */
const PROJECT_LICENSE = "AGPL-3.0-or-later";
const PROJECT_COPYRIGHT = "Copyright (C) 2026 PLeC";
const AGPL_URL = "https://www.gnu.org/licenses/agpl-3.0.html";

export { isModifiedSource, PROJECT_LICENSE, PROJECT_COPYRIGHT, AGPL_URL };
