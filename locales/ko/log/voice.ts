// 로그 문구: 음성 연결(voice 분류). 음성 채널 참가 요청

const voice = {
  joinDropped: ({ channel }: { channel: string }) => `음성 채널 ${channel} 참가 요청을 버림(종료 중)`,
  joinSendFailed: ({ channel }: { channel: string }) => `음성 채널 ${channel} 참가 요청 전송 실패(샤드 미준비)`,
  stayNoticeChannelFailed: ({ guild, error, codeSuffix }: { guild: string; error: string; codeSuffix: string }) => `봇 채널 찾기 실패(상주 모드 해제 알림 전송 건너뜀): 서버=${guild} | ${error}${codeSuffix}`,
  stayRejoinAttempt: ({ guildId }: { guildId: string }) => `상주 채널 재접속(서버 ${guildId})`,
  stayReleased: ({ guild, why }: { guild: string; why: string }) => `상주 모드 자동 해제: ${guild} | 원인=${why}`,
  stayRejoined: ({ channel, guild }: { channel: string; guild: string }) => `상주 채널 재접속: "${channel}" (${guild})`,
  stayRejoinSkippedCrashes: ({ count }: { count: number }) => `단시간 내 비정상 종료가 반복되어 상주 채널 ${count}곳의 자동 재접속을 건너뜀(상주 설정은 유지)`,
  stayRejoinSkippedBlocked: ({ guild }: { guild: string }) => `동일 오류 반복으로 차단된 서버라 상주 채널 재접속을 건너뜀(봇 재시작 또는 곡 재생 시 해제): ${guild}`,
  stayWhyKicked: () => `강제 퇴장`,
  stayWhyChannelGone: () => `채널 삭제`,
  stayWhyNoPermission: () => `채널 권한 없음`,
  stayNoticeSend: () => `상주 모드 해제 알림 전송`,
  stayChannelFetchFailed: ({ error }: { error: string }) => `채널 조회 실패: ${error}`,
  stayRestoreError: () => `세션 복원 오류`,
};

export { voice };
