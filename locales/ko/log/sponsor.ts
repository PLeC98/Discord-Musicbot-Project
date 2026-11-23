// 로그 문구: SponsorBlock(sponsor 분류). 구간 조회와 건너뛰기

const sponsor = {
  segmentSkipCheck: ({ guildId }: { guildId: string }) => `SponsorBlock 구간 건너뛰기 확인(서버=${guildId})`,
  endSegmentReached: ({ title }: { title: string }) => `${title}: 종료 구간 도달, 트랙 종료`,
  segmentSkipped: ({ title, toSeconds }: { title: string; toSeconds: number }) => `${title}: 구간 건너뜀 → ${toSeconds}s`,
  segmentSkipFailed: ({ title, toSeconds, error }: { title: string; toSeconds: number; error: string }) => `SponsorBlock 구간 건너뛰기 실패: ${title} | 이동 지점=${toSeconds}초 | ${error}`,
  segmentLookup: () => `SponsorBlock 구간 조회`,
  apiRequest: () => `SponsorBlock API 요청`,
  segmentRefreshWrite: () => `SponsorBlock 구간 갱신 중 캐시 DB 쓰기`,
  segmentLookupStore: () => `SponsorBlock 구간 조회 중 캐시 DB 읽기와 쓰기`,
  segmentFetchFailed: ({ videoId, reason }: { videoId: string; reason: string }) => `SponsorBlock 조회 실패: ${videoId} | ${reason}`,
  segmentRefetchFailed: ({ videoId, error }: { videoId: string; error: string }) => `SponsorBlock 구간 다시 받기 실패: ${videoId} | ${error}`,
  segmentLookupFailed: ({ videoId, error }: { videoId: string; error: string }) => `SponsorBlock 구간 조회 실패: ${videoId} | ${error}`,
};

export { sponsor };
