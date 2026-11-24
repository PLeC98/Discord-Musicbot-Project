// 로그 문구: 옮기기 커밋 확인(scripts/verify-move)의 터미널 출력

const move = {
  unpairedAdded: ({ count }: { count: number }) => `짝이 없는 추가된 줄 ${count}개 (감싸는 줄인지 사람이 본다):`,
  lostRemoved: ({ count }: { count: number }) => `\n사라진 삭제된 줄 ${count}개. 옮기기가 아니다:`,
  verified: ({ extra }: { extra: number }) => `옮기기 확인: 삭제된 줄이 전부 다시 나타났다${extra ? "" : ". 추가된 줄도 전부 짝이 있다"}`,
};

export { move };
