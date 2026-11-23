// 로그 문구: ffmpeg(ffmpeg 분류). 받기와 설치, 실행 파일 찾기, 기능 확인, 프로세스, 음량 측정

const ffmpeg = {
  ffmpegTargetUnsupported: ({ target }: { target: string }) => `${target}용 빌드가 제공되지 않음`,
  inputWriteFailed: ({ job, error }: { job: string; error: string }) => `ffmpeg(${job}) 입력 쓰기 실패: ${error}`,
  candidateProbeFailed: ({ path, source, error }: { path: string; source: string; error: number | string }) => `ffmpeg 후보 실행 확인(-version) 실패: ${path} | 출처=${source} | 원인=${error}`,
  stateReadFailed: ({ file, error }: { file: string; error: string }) => `ffmpeg 기록(${file}) 읽기 실패(${error}): 설치본을 건너뜀. pnpm run install:ffmpeg로 다시 맞추세요`,
  activeBuildFallback: ({ activeRelease, previousRelease }: { activeRelease: string; previousRelease: string }) => `ffmpeg 설치본(${activeRelease})이 실행되지 않아 이전 설치본(${previousRelease})을 씀`,
  configuredPathNotRunnable: ({ path }: { path: string }) => `FFMPEG_PATH로 지정한 경로를 실행할 수 없음: ${path}`,
  ffmpegNotFound: () => `ffmpeg를 찾을 수 없음. \`pnpm run install:ffmpeg\`로 다운로드하거나, ffmpeg를 설치해 PATH에 두거나, .env의 FFMPEG_PATH로 경로를 지정하세요 (macOS: brew install ffmpeg).`,
  brokenReleaseRecorded: ({ activeRelease, previousRelease }: { activeRelease: string; previousRelease: string }) => `실행되지 않는 ffmpeg(${activeRelease})를 물린 릴리스로 기록하고 이전 설치본(${previousRelease})을 가리키게 함. 다시 받으려면 pnpm run install:ffmpeg --force`,
  featureCheckFailed: ({ args, error }: { args: string; error: string }) => `ffmpeg 지원 기능 확인 실패(${args}): ${error}`,
  spawnFailed: ({ job, error, path }: { job: string; error: string; path: string }) => `ffmpeg(${job}) 실행 실패: ${error} (경로: ${path})`,
  exitedAbnormally: ({ job, exit, detailSuffix }: { job: string; exit: string; detailSuffix: string }) => `ffmpeg(${job}) 비정상 종료: ${exit}${detailSuffix}`,
  cleanupExited: ({ job, exit }: { job: string; exit: string }) => `ffmpeg(${job}) 정리 완료 (종료 코드 ${exit})`,
  probeSpawnFailed: ({ file, error }: { file: string; error: string }) => `ffmpeg(probe) 실행 실패: ${file} | ${error}`,
  releaseBuildMissing: ({ target, variant }: { target: string; variant: string }) => `이 릴리스에 ${target}용 ${variant} 빌드가 없음`,
  cacheLoudnessMeasure: () => `캐시 파일 볼륨 측정`,
  loudnessEnqueueFailed: ({ audioKey, error }: { audioKey: string; error: string }) => `캐시 파일 볼륨 측정 요청 실패: ${audioKey} | ${error}`,
  loudnessPreempted: ({ audioKey }: { audioKey: string }) => `지금 곡을 먼저 재려고 미리 받는 곡의 볼륨 측정을 뒤로 돌림: ${audioKey}`,
  loudnessMeasureError: ({ audioKey, error }: { audioKey: string; error: string }) => `캐시 파일 볼륨 측정 중 오류: ${audioKey} | ${error}`,
  loudnessFileUnmeasurable: ({ audioKey, reason }: { audioKey: string; reason: string }) => `캐시 파일 볼륨을 재지 못해 이 파일은 다시 재지 않음: ${audioKey} | ${reason}`,
  loudnessMeasured: ({ audioKey, lufs, truePeak, peakP99, seconds }: { audioKey: string; lufs: number; truePeak: number; peakP99: number; seconds: string }) => `캐시 파일 볼륨: ${audioKey} | ${lufs} LUFS, 피크 ${truePeak} dBTP, 프레임 피크 상위 1% ${peakP99} dB | ${seconds}초`,
  loudnessDisabledUnreadable: ({ reason }: { reason: string }) => `볼륨 정규화의 캐시 파일 볼륨 측정을 끔(이 ffmpeg의 ebur128 출력을 읽지 못함): ${reason}`,
  loudnessDisabledSelfTest: ({ error }: { error: string }) => `볼륨 정규화의 캐시 파일 볼륨 측정을 끔(자체 테스트 실패): ${error}`,
};

export { ffmpeg };
