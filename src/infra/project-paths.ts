// 저장소 안의 자리. 실행 중에 쓰는 경로는 모두 여기서 나온다(파일마다 ".." 를 세지 않아 파일을 옮겨도 깨지지 않는다).
// 이 파일이 src/infra 에 있다는 것만 기댄다. 저장소 루트를 맞게 가리키는지는 구조 시험이 본다

import path from "path";

const ROOT = path.join(import.meta.dirname, "..", "..");

const PROJECT = {
  root: ROOT,
  /** 운영자 설정(.env) */
  env: path.join(ROOT, ".env"),
  /** 운영자가 고치는 YAML · 쿠키 */
  config: path.join(ROOT, "config"),
  /** 저장소에 함께 싣는 데이터 · 고지 */
  data: path.join(ROOT, "data"),
  /** DB · 실행 기록. 사람이 열어 볼 수 있게 루트에 둔다 */
  database: path.join(ROOT, "database"),
  /** 받아 둔 오디오 */
  audioCache: path.join(ROOT, "audio_cache"),
  /** 설치 스크립트가 받는 실행 파일(ffmpeg · yt-dlp) */
  bin: path.join(ROOT, "bin"),
  /** POToken 공급자 체크아웃 */
  bgutil: path.join(ROOT, "bgutil-ytdlp-pot-provider"),
  /** 대시보드 화면 빌드 결과 */
  dashboardDist: path.join(ROOT, "dashboard", "dist"),
} as const;

export { PROJECT };
