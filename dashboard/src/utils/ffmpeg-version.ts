// ffmpeg 버전 표기(봇 정보 탭의 ffmpeg 줄, 업데이트 탭의 외부 프로그램 이전 버전 카드가 함께 쓴다)

/** BtbN 릴리스 태그(autobuild-2026-10-31-12-59)의 날짜 */
const releaseDay = (tag: string) => tag.slice("autobuild-".length, "autobuild-".length + 10);

// BtbN 빌드의 버전(n9.0.2-39-g7adfbe40dc-20261031)은 길어서 앞의 버전 번호만 쓴다
const shortVersion = (version: string) => /^(n?\d+(?:\.\d+)*)-\d+-g[0-9a-f]+/.exec(version)?.[1] ?? version;

/** 설치본이면 버전 번호 뒤에 릴리스 태그의 날짜를 붙인다(예: n9.0.2-2026-10-31). 고정했을 때 함께 보이는 기본 릴리스 날짜와 기준이 같아 바로 비교할 수 있다 */
const ffmpegLabel = (version: string, release: string | null) => (release ? `${shortVersion(version)}-${releaseDay(release)}` : shortVersion(version));

export { releaseDay, shortVersion, ffmpegLabel };
