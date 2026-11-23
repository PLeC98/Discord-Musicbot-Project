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
  cacheOverCapEvicting: ({ usage, targetPercent }: { usage: string; targetPercent: number }) => `오디오 캐시가 상한을 넘음(${usage}). 상한의 ${targetPercent}%까지 정리`,
  cacheEvicted: ({ count, remaining, sizeMb, shortfall, unremoved }: { count: number; remaining: number; sizeMb: number; shortfall: string; unremoved: string }) => `오디오 캐시 ${count}개 삭제(${remaining}개 남음, ${sizeMb}MB)${shortfall}${unremoved}`,
  cacheEvictionFailed: ({ error }: { error: string }) => `오디오 캐시 정기 정리 중 오류: ${error}`,
  spotifyAnonStateParseFailed: ({ error }: { error: string }) => `저장된 스포티파이 익명 상태 JSON 파싱 실패(캐시 미스로 처리): ${error}`,
};

export { cache };
