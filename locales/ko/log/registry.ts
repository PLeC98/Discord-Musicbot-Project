// 로그 문구: 플레이어 목록(registry 분류). 플레이어를 만들고 버리기

const registry = {
  playerForgotten: ({ guild, reason }: { guild: string; reason: string }) => `해제: ${guild} | 원인=${reason}`,
};

export { registry };
