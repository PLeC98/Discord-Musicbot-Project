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
  rejectInteractionTimeout: () => `상호작용에 3초 안에 응답하지 못함(봇이 바빴거나 네트워크가 느렸거나, 같은 토큰으로 다른 봇이 실행 중)`,
  rejectInteractionTwice: () => `이미 응답한 상호작용에 다시 응답함(코드가 두 번 응답했거나, 같은 토큰으로 다른 봇이 실행 중)`,
  rejectTokenExpired: () => `상호작용 토큰이 만료됨(15분)`,
  rejectNoWebhook: () => `웹훅이 없음(지워졌거나 봇이 서버를 나갔다 들어옴)`,
  rejectNoChannel: () => `채널이 없음`,
  rejectNoGuild: () => `서버가 없음(봇이 나갔거나 추방됨)`,
  rejectNoMessage: () => `메시지가 없음`,
  rejectNoAccess: () => `접근 권한이 없음(채널이나 서버를 볼 수 없음)`,
  rejectNoPermission: () => `작업 권한이 없음`,
  rejectUnknown: () => `디스코드가 요청을 거절함`,
  /** 디스코드가 거절한 요청 한 줄. what: 거절의 뜻, code: 디스코드 오류 번호, message: 디스코드가 준 글, request: 요청(모르면 null), guild: 서버(모르면 null), where: 어디서 새어 나왔나 */
  rejectionLine: ({ what, code, message, request, guild, where }: { what: string; code: number; message: string; request: string | null; guild: string | null; where: string }) => `${what} (${code}${message ? ` ${message}` : ""}) | ${request ?? "요청 모름"} | 서버 ${guild ?? "모름"} | ${where}`,
  diskSizeLookup: ({ target }: { target: string }) => `${target} 디스크 용량 statfs 조회`,
  diskFreeLookup: ({ target }: { target: string }) => `${target} 디스크 여유 공간 statfs 조회`,
  diskSizeUnknown: ({ error }: { error: string }) => `${error} (드라이브 카드에 알 수 없음으로 표시)`,
  diskFreeZero: ({ error }: { error: string }) => `${error} (여유 공간 0바이트로 처리)`,
  alreadyRunning: ({ detail }: { detail: string }) => `이 폴더에서 봇이 이미 실행 중${detail}. 같은 폴더에서는 하나만 실행할 수 있음`,
  /** 본체 모듈을 불러오다 예외가 나서 기동을 멈췄다(오류는 err로) */
  mainLoadFailed: () => `메인 모듈 불러오기 실패(기동 중단)`,
};

export { core };
