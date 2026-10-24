// 설치 스크립트가 다운로드하는 버전의 기본값. .env 의 FFMPEG_RELEASE · BGUTIL_VERSION 으로 바꿀 수 있다(설정 모듈이 읽는다).
// 주마다 도는 vendor-updates 워크플로(scripts/check-vendor-updates)가 이 파일만 읽고 고친다. 값은 한 줄에 하나, 글자 그대로 둔다
//   ffmpeg  BtbN/FFmpeg-Builds 의 월말 autobuild 태그. 그 외 autobuild 는 2주 뒤 삭제된다(월말은 2년 보관)
//   bgutil  bgutil-ytdlp-pot-provider 의 릴리스 태그. 서버와 yt-dlp 플러그인이 같은 체크아웃에서 나온다

const FFMPEG_RELEASE = "autobuild-2026-08-31-13-27";
const BGUTIL_VERSION = "2.0.2";

export { FFMPEG_RELEASE, BGUTIL_VERSION };
