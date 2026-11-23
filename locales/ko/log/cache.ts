// 로그 문구: 오디오 캐시와 바깥 서비스 캐시(cache 분류). 캐시 파일 정리, 용량 관리, 캐시 DB

const cache = {
  cacheFileRemoval: () => `오디오 캐시 파일 삭제`,
  cacheEviction: () => `오디오 캐시 정리`,
  cacheDiskCheck: () => `오디오 캐시 디스크 여유 공간 확인`,
  cacheFileRemoveTimedOut: ({ seconds, file }: { seconds: number; file: string }) => `캐시 파일 삭제가 ${seconds}초 안에 끝나지 않아 이번 실행에서는 건너뜀(다른 프로세스가 파일을 점유 중일 수 있음): ${file}`,
  cacheFileRemoveFailed: ({ file, error }: { file: string; error: string }) => `캐시 파일 삭제 실패: ${file} | ${error}`,
  interruptedDownloadsCleared: ({ count }: { count: number }) => `이전 실행에서 중단된 다운로드 ${count}건 정리 완료`,
  missingCacheFilesRecorded: ({ count }: { count: number }) => `오디오 캐시 파일이 누락된 항목 ${count}건 기록 완료`,
  cacheFileSizeReadFailed: ({ file, error }: { file: string; error: string }) => `캐시 파일 크기 읽기 실패: ${file} | ${error}`,
  cacheDbVacuumFailed: ({ error }: { error: string }) => `캐시 DB 파일 압축(VACUUM) 실패: ${error}`,
  orphanCacheFilesRemoved: ({ count }: { count: number }) => `고아 오디오 캐시 파일 ${count}개 삭제 완료`,
  partialCacheFilesRemoved: ({ count }: { count: number }) => `캐시 다운로드 중단으로 생성된 조각 파일 ${count}개 삭제 완료`,
  diskLowEvicting: ({ freeMb, minMb }: { freeMb: number; minMb: number }) => `디스크 여유 공간 부족 (${freeMb}MB 남음, 최소 ${minMb}MB). 오디오 캐시 정리`,
  /** 오디오 캐시가 상한을 넘어 정리를 시작한다. overSize: 용량이, overFiles: 파일 수가 넘었다 */
  cacheOverCapEvicting: ({ overSize, sizeMb, maxMb, overFiles, files, maxFiles, targetPercent }: { overSize: boolean; sizeMb: number; maxMb: number; overFiles: boolean; files: number; maxFiles: number; targetPercent: number }) => `오디오 캐시가 상한을 넘음(${[overSize ? `용량 ${sizeMb}MB / ${maxMb}MB` : "", overFiles ? `파일 ${files}개 / ${maxFiles}개` : ""].filter(Boolean).join(", ")}). 상한의 ${targetPercent}%까지 정리`,
  /** 오디오 캐시 정리 결과. reached: 목표선까지 내려갔다, guarded: 재생 중이거나 대기열 앞이라 지킨 곡 수, failed: 삭제하지 못한 수 */
  cacheEvicted: ({ count, remaining, sizeMb, reached, guarded, failed }: { count: number; remaining: number; sizeMb: number; reached: boolean; guarded: number; failed: number }) => {
    const why = [guarded > 0 ? `재생 중이거나 대기열 앞에 있는 곡 ${guarded}개는 지키고` : "", failed > 0 ? `${failed}개는 삭제하지 못해` : ""].filter(Boolean).join(", ");
    const tail = reached ? (failed > 0 ? ` - ${failed}개는 삭제하지 못함` : "") : ` - 목표선까지 내려가지 못함${why ? `(${why})` : ""}`;
    return `오디오 캐시 ${count}개 삭제(${remaining}개 남음, ${sizeMb}MB)${tail}`;
  },
  cacheEvictionFailed: ({ error }: { error: string }) => `오디오 캐시 정기 정리 중 오류: ${error}`,
  spotifyAnonStateParseFailed: ({ error }: { error: string }) => `저장된 스포티파이 익명 상태 JSON 파싱 실패(캐시 미스로 처리): ${error}`,
  cacheFilesLeftOnDisk: ({ codes }: { codes: string }) => `${codes} (파일이 디스크에 남음)`,
  startupCacheEvict: () => `기동 캐시 비우기`,
  cacheDiskCheckFailed: ({ dir, error }: { dir: string; error: number | string }) => `${dir} | statfs ${error} (디스크 부족 시 캐시 정리 비활성화)`,
  loudnessPrune: () => `오래된 볼륨 값 지우기`,
  sessionTrackRow: () => `세션 트랙`,
  linkDataRow: () => `링크 데이터`,
  /** 읽은 행의 형식이 맞지 않아 버렸다. what: 행 종류(sessionTrackRow, linkDataRow 라벨), where: 틀린 칸, key: 요청 키(없으면 null) */
  rowShapeInvalid: ({ what, where, key }: { what: string; where: string; key: string | null }) => `${what} 행의 형식이 올바르지 않아 무시(${where}): ${key ?? "없음"}`,
  sourceRecheck: ({ platform }: { platform: string }) => `${platform} 캐시 원본 재확인`,
  sourceRecheckFailed: ({ title, error }: { title: string; error: string }) => `원본 다시 확인 실패(${title}): ${error}`,
  sourceRecheckSame: ({ track }: { track: string }) => `원본 다시 확인: 같음 ${track}`,
  sourceRecheckUncompared: ({ reason, track }: { reason: string; track: string }) => `원본 다시 확인: 열림, 비교 불가(${reason}) ${track}`,
  cachedSourceGone: ({ code, track }: { code: string; track: string }) => `캐시된 곡의 원본을 더 이상 재생할 수 없음(${code}). 캐시 파일은 그대로 사용: ${track}`,
  sourceRecheckUnknown: ({ reason, track }: { reason: string; track: string }) => `원본 다시 확인: 모름(${reason}), 하루 뒤에 다시 ${track}`,
  cachedSourceChangedKept: ({ changes, track }: { changes: string; track: string }) => `캐시된 곡의 원본이 변경됨(${changes}). 캐시 파일은 유지하고 캐시 DB에 표시: ${track}`,
  cachedSourceChangedReplaced: ({ changes, track }: { changes: string; track: string }) => `캐시된 곡의 원본이 변경됨(${changes}). 캐시 파일을 삭제하고 다음 재생 시 새로 다운로드: ${track}`,
  changedSourceCacheRemoved: ({ title }: { title: string }) => `변경된 원본의 캐시 파일 삭제(다음 재생 시 새로 다운로드): "${title}"`,
};

export { cache };
