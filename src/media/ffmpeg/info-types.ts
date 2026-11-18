// 봇 정보 탭의 ffmpeg 줄에 보내는 상태(대시보드 공유 타입). Node를 부르지 않는다

/**
 * version: 쓰는 ffmpeg의 버전. source: 찾은 곳(env: FFMPEG_PATH, installed: vendor/ffmpeg의 설치본, previous: 이전 설치본, path: PATH).
 * release: 설치본의 릴리스(설치본이 아니면 null). pin: 고정한 릴리스(없으면 null). defaultRelease: 코드에 정한 기본 릴리스. rejected: 이 환경에서 실행되지 않아 다시 받지 않는 릴리스 목록
 */
type FfmpegInfo = { version: string; source: "env" | "installed" | "previous" | "path"; release: string | null; pin: string | null; defaultRelease: string; rejected: string[] };

export type { FfmpegInfo };
