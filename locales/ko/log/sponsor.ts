// 로그 문구: SponsorBlock(sponsor 분류). 구간 조회와 건너뛰기

const sponsor = {
  segmentSkipCheck: ({ guildId }: { guildId: string }) => `SponsorBlock 구간 건너뛰기 확인(서버=${guildId})`,
  endSegmentReached: ({ title }: { title: string }) => `${title}: 종료 구간 도달, 트랙 종료`,
  segmentSkipped: ({ title, toSeconds }: { title: string; toSeconds: number }) => `${title}: 구간 건너뜀 → ${toSeconds}s`,
  segmentSkipFailed: ({ title, toSeconds, error }: { title: string; toSeconds: number; error: string }) => `SponsorBlock 구간 건너뛰기 실패: ${title} | 이동 지점=${toSeconds}초 | ${error}`,
};

export { sponsor };
