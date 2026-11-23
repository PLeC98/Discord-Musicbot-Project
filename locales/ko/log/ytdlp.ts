// 로그 문구: yt-dlp(ytdlp 분류). 실행 파일 업데이트와 버전 폴더 정리, 실행 대기, 다운로드 감시

const ytdlp = {
  oldFolderRemoveFailed: ({ folder, error }: { folder: string; error: string }) => `yt-dlp 옛 폴더 삭제 실패(${folder}): ${error}`,
  versionRecordReadFailed: ({ error }: { error: string }) => `yt-dlp 버전 기록 읽기 실패: ${error}`,
  stateUnreadable: () => `yt-dlp 버전 기록을 읽지 못함`,
  oldVersionFolderMoveFailed: ({ target, error }: { target: string; error: string }) => `yt-dlp 옛 버전 폴더 옮기기 실패(${target}): ${error}`,
  versionFolderMoveFailed: ({ error }: { error: string }) => `yt-dlp 버전 폴더로 옮기기 실패: ${error}`,
  stagingRemoveFailed: ({ staging, error }: { staging: string; error: number | string }) => `yt-dlp 스테이징 폴더 삭제 실패(다음 정리 시 재시도): ${staging} | ${error}`,
  cleanupSkippedInUse: ({ holder }: { holder: string }) => `yt-dlp 정리 건너뜀(${holder}가 yt-dlp 폴더를 사용 중)`,
  oldFolderMoveFailed: ({ folder, error }: { folder: string; error: string }) => `yt-dlp 옛 폴더 옮기기 실패(${folder}): ${error}`,
  binaryPrepareFailed: ({ error }: { error: string }) => `yt-dlp 바이너리 준비 실패: ${error}`,
  updateCheckFailed: ({ error }: { error: string }) => `yt-dlp 업데이트 조회 실패: ${error}`,
  updateTimerFailed: ({ error }: { error: string }) => `yt-dlp 업데이트 및 설치 타이머 작업 실패(이후 확인 예약 중단): ${error}`,
  flagKeyRejected: ({ key }: { key: string }) => `yt-dlp 플래그로 받지 않는 키: ${key}`,
  selfUpdateFlagRejected: ({ key }: { key: string }) => `yt-dlp 자체 업데이트 플래그는 넘기지 않음: ${key}`,
  processExited: ({ exitCode, signal, command }: { exitCode: string; signal: string; command: string }) => `yt-dlp 종료(코드 ${exitCode}, 신호 ${signal}): ${command}`,
  slotWaited: ({ seconds, lane, running, limit, waiting }: { seconds: string; lane: string; running: number; limit: number; waiting: number }) => `yt-dlp 실행 슬롯을 ${seconds}초 대기(${lane} ${running}/${limit}, 대기 ${waiting})`,
  shuttingDownNoSpawn: () => `봇을 끄는 중이라 yt-dlp를 실행하지 않음`,
  infoReadsPerHour: ({ count }: { count: number }) => `지난 1시간 동안 유튜브 영상 정보를 ${count}번 읽음. 로그인 없는 세션은 시간당 약 300편에서 막히기 시작함`,
  fragmentListFailed: ({ dir, error }: { dir: string; error: string }) => `임시 조각 파일 조회 실패: ${dir} | ${error}`,
  fragmentRemoveFailed: ({ file, error }: { file: string; error: string }) => `임시 조각 파일 삭제 실패: ${file} | ${error}`,
  downloadSizeRead: () => `yt-dlp 다운로드 파일 크기 읽기`,
  stallWatchReaddirFailed: ({ dir, error }: { dir: string; error: number | string }) => `yt-dlp 다운로드 정체 감시 readdir 실패(진행 확인 불가): ${dir} | ${error}`,
  binaryMissing: () => `yt-dlp가 설치되지 않음(pnpm run update:ytdlp)`,
  infoTimedOut: ({ seconds }: { seconds: number }) => `yt-dlp가 ${seconds}초 안에 끝나지 않아 내림`,
  downloadStalled: ({ minutes }: { minutes: number }) => `yt-dlp 다운로드가 ${minutes}분 동안 진행되지 않아 중단`,
};

export { ytdlp };
