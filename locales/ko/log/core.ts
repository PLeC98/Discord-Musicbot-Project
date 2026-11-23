// 로그 문구: core 분류

const core = {
  runRecordUpdate: () => `실행 기록 갱신`,
  runRecordReadFailed: ({ error }: { error: string }) => `실행 기록 읽기 실패: ${error}`,
  exitReasonWriteFailed: ({ error }: { error: string }) => `실행 기록에 종료 사유 기록 실패: ${error}`,
  startupJobSkipped: ({ job, running }: { job: string; running: string }) => `${job} 건너뜀: 다른 작업(${running})이 도는 중`,
  screenBuildStarted: ({ why }: { why: string }) => `대시보드 화면 빌드 시작: ${why}`,
  screenBuildDone: ({ seconds }: { seconds: string }) => `대시보드 화면 빌드 완료: ${seconds}초`,
  screenBuildFailed: ({ why }: { why: string }) => `대시보드 화면 빌드 실패(${why}. 기존 화면 유지`,
  ffmpegAligned: ({ result }: { result: string }) => `ffmpeg 맞추기: ${result}`,
  ffmpegAlignFailed: ({ why }: { why: string }) => `ffmpeg 맞추기 실패(${why}. 받아 둔 ffmpeg로 뜸`,
  ffmpegOldFoldersRemoved: ({ names }: { names: string }) => `ffmpeg 옛 폴더 정리: ${names}`,
  bgutilOldFoldersRemoved: ({ names }: { names: string }) => `bgutil 옛 폴더 정리: ${names}`,
  versionReadFailed: ({ file, error }: { file: string; error: string }) => `버전 정보 읽기 실패(${file}): ${error}`,
  appIdNotRead: () => `앱 ID를 아직 읽지 않음(기동이 앱 설정을 읽은 뒤에 쓴다)`,
};

export { core };
