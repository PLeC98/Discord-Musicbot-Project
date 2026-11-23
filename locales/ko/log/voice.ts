// 로그 문구: 음성 연결(voice 분류). 음성 채널 참가 요청

const voice = {
  joinDropped: ({ channel }: { channel: string }) => `음성 채널 ${channel} 참가 요청을 버림(종료 중)`,
  joinSendFailed: ({ channel }: { channel: string }) => `음성 채널 ${channel} 참가 요청 전송 실패(샤드 미준비)`,
};

export { voice };
