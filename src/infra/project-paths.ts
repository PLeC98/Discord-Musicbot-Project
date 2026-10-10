// 저장소 안의 자리. 실행 중에 쓰는 경로는 모두 여기서 나온다(파일마다 ".." 를 세지 않아 파일을 옮겨도 깨지지 않는다).
// 이 파일이 src/infra 에 있다는 것만 기댄다. 저장소 루트를 맞게 가리키는지는 구조 시험이 본다

import path from "path";

const ROOT = path.join(import.meta.dirname, "..", "..");
/** 설치 스크립트가 받아 두는 외부 도구. git 은 추적하지 않는다 */
const VENDOR = path.join(ROOT, "vendor");

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
  /** 대시보드가 쓰는 실행 상태(운영자 패널에서 올린 그림 등). 사람이 건드리지 않는다 */
  dashboardData: path.join(ROOT, "database", "dashboard"),
  /** 받아 둔 오디오 */
  audioCache: path.join(ROOT, "audio_cache"),
  /** 설치 스크립트가 받는 실행 파일(ffmpeg · yt-dlp) */
  bin: path.join(VENDOR, "bin"),
  /** POToken 공급자 체크아웃 */
  bgutil: path.join(VENDOR, "bgutil-ytdlp-pot-provider"),
  /** 대시보드 화면 빌드 결과 */
  dashboardDist: path.join(ROOT, "dashboard", "dist"),
} as const;

export { PROJECT };
