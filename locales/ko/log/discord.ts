// 로그 문구: 디스코드 연결과 요청(discord 분류). 거절된 요청 누적 등

const discord = {
  invalidRequestWarning: ({ count, seconds }: { count: number; seconds: number }) => `거절된 디스코드 요청 누적 ${count}회(10분 윈도우 남은 시간 ${seconds}초). 1만 회를 넘으면 디스코드에서 이 IP를 일시 차단함`,
};

export { discord };
