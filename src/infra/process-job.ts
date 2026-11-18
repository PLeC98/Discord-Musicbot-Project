// 자식 프로세스의 작업. Node를 부르지 않아 화면(대시보드 공유 타입)도 이 타입을 쓴다

/**
 * play: 재생, 지금 곡 다운로드, prefetch: 다음 곡 미리 다운로드, 자동재생 곡 미리 고르기, lookup: 곡 찾기, 정보 읽기.
 * 나머지는 서버와 상관없는 봇 헬퍼(POToken 서버, yt-dlp 업데이트, ffmpeg 설치, POToken 서버 설치, 대시보드 화면 빌드, 로그인 배경 만들기, 시스템 업로드 측정, 캐시 파일의 볼륨 측정)
 */
type Job = "play" | "prefetch" | "lookup" | "pot-server" | "ytdlp-update" | "ffmpeg-install" | "bgutil-install" | "dashboard-build" | "login-background" | "net-stats" | "loudness";

export type { Job };
