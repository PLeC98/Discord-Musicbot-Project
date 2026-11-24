// 로그 문구: 디스코드 이벤트 처리(events 분류). 명령어, 버튼, 메뉴, 메시지 처리의 실패와 안내 전송 실패

const events = {
  handlingFailed: ({ what }: { what: string }) => `${what} 처리 실패:`,
  errorNoticeFailed: ({ error }: { error: string }) => `오류 안내 전송 실패: ${error}`,
  unknownCommand: ({ commandName }: { commandName: string }) => `처리할 핸들러가 없는 명령어: /${commandName}`,
  autocompleteFailed: ({ commandName }: { commandName: string }) => `/${commandName} 자동완성 처리 실패:`,
  unknownInteraction: ({ kind, customId }: { kind: string; customId: string }) => `핸들러가 없는 상호작용: ${kind} ${customId}`,
  stoppingAutocompleteFailed: ({ error }: { error: string }) => `종료 중 자동완성 응답 실패: ${error}`,
  stoppingNoticeFailed: ({ error }: { error: string }) => `종료 중 안내 전송 실패: ${error}`,
  stoppingReplyFailed: ({ channelId, error }: { channelId: string; error: string }) => `봇 채널 종료 안내 답장 실패: 채널=${channelId} | ${error}`,
  messageHandlingFailed: () => `메시지 처리 오류:`,
  systemRefreshFailed: () => `시스템 정보 새로고침 실패:`,
  refreshNoticeFailed: () => `오류 안내 전송 실패:`,
  userLanguageSaveFailed: ({ userId }: { userId: string }) => `개인 언어 저장 실패: ${userId}`,
  guildLanguageSaveFailed: ({ name, guildId }: { name: string; guildId: string }) => `서버 언어 저장 실패: ${name} (${guildId})`,
  moreProgressFailed: ({ error }: { error: string }) => `더 넣기 진행 표시 실패: ${error}`,
  playlistMoreFailed: () => `재생목록 더 넣기 실패:`,
  moreMenuSendFailed: ({ error }: { error: string }) => `더 넣기 메뉴 전송 실패: ${error}`,
  settingSaveFailed: ({ name, id, field, error }: { name: string; id: string; field: string; error: string }) => `서버 설정 저장 실패(/setting): ${name} (${id}) | ${field} | ${error}`,
  channelSendFellBack: ({ error }: { error: string }) => `채널에 보내지 못해 후속 메시지로 보냄: ${error}`,
  /** skipped: 앞선 줄 뒤 간격 안에 와서 줄을 남기지 않고 센 수 */
  autocompleteAnswerLate: ({ commandName, ms, skipped, error }: { commandName: string; ms: number; skipped: number; error: string }) => `자동완성 답 실패(늦음): /${commandName} | 생성 뒤 ${ms}ms${skipped ? ` | 앞서 ${skipped}번 더` : ""} | ${error}`,
  autocompleteFallbackFailed: ({ commandName, ms, skipped, error }: { commandName: string; ms: number; skipped: number; error: string }) => `자동완성 빈 응답 폴백 실패: /${commandName} | 경과 ${ms}ms${skipped ? ` | 앞서 ${skipped}번 더` : ""} | ${error}`,
  interactionReceivedLate: ({ name, age, skipped }: { name: string; age: number; skipped: number }) => `상호작용 늦게 받음: ${name} | 생성 뒤 ${age}ms${skipped ? ` | 앞서 ${skipped}번 더` : ""} | 늘 이러면 봇 PC의 시계를 확인하세요`,
  autocompleteName: ({ commandName }: { commandName: string }) => `/${commandName} 자동완성`,
  interactionName: () => `상호작용`,
  placeholderDelete: () => `자리표시자 삭제`,
  sourceBotChannel: () => `전용채널`,
  genreMenuClear: () => `장르 메뉴 선택 비우기`,
  moreReply: () => `더 넣기 응답`,
  emptyQueueDelete: () => `빈 대기열 화면 삭제`,
  selfReplyDelete: () => `본인 응답 삭제`,
  menuDelete: () => `메뉴 삭제`,
  replyToNoticeDelete: () => `안내로 바꿀 응답 삭제`,
};

export { events };
