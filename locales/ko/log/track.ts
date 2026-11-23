// 로그 문구: track 분류

const track = {
  codecUnread: () => `코덱을 읽지 못함`,
  opusOverCap: ({ kbps, cap }: { kbps: number; cap: number }) => `opus ${kbps}k, 상한 ${cap}k를 크게 넘음`,
  alreadyOpusKbps: ({ kbps }: { kbps: number }) => `이미 opus ${kbps}k`,
  alreadyOpus: () => `이미 opus`,
};

export { track };
