// 로그 문구: 플레이어 목록(registry 분류). 플레이어를 만들고 버리기

const registry = {
  playerForgotten: ({ guild, reason }: { guild: string; reason: string }) => `해제: ${guild} | 원인=${reason}`,
  /** replaced: 같은 서버의 항목을 바꿔 넣었다 */
  playerRegistered: ({ guild, replaced }: { guild: string; replaced: boolean }) => `등록: ${guild}${replaced ? " | 기존 항목 교체" : ""}`,
};

export { registry };
