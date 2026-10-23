// 봇 초대 링크. 요청하는 권한 · 범위는 이 한 곳이다(/help 의 초대 링크 · 대시보드 초대 화면)
// 권한은 봇이 하는 일만큼(관리자 권한을 청하지 않는다. 토큰이 새면 피해를 키운다). 없으면 그 기능만 빠지는 것은 괄호에
//   채널 보기 · 메시지 보내기 · 연결 · 말하기: 재생과 안내
//   웹후크 관리(재생 패널, 없으면 일반 메시지로 올리고 제자리에서 고치지 못한다) · 메시지 관리(전용 채널에 친 요청 · 옛 패널 지우기)
//   파일 첨부(곡 그림) · 링크 첨부(대시보드 공지 임베드) · 메시지 기록 보기(전용 채널의 답장) · 스레드에서 보내기(스레드의 패널)
//   음성 채널 상태 설정(재생 중 문구) · 채널 관리(옮겨진 뒤 옛 채널의 문구 지우기. 들어가 있지 않은 채널의 상태는 이 권한이 있어야 쓴다). 앱 이모지는 외부 이모지 권한 없이 보인다(웹훅 패널 포함, 실사용으로 확인)
// 멤버 옮기기는 청하지 않는다. 음성에서 나가기는 게이트웨이로 한다

// 디스코드 권한 비트(discord.js 의 PermissionFlagsBits 와 같은 값. 규칙 층이라 라이브러리를 부르지 않는다. 시험이 견준다)
const FLAGS = {
  ManageChannels: 1n << 4n,
  ViewChannel: 1n << 10n,
  SendMessages: 1n << 11n,
  ManageMessages: 1n << 13n,
  EmbedLinks: 1n << 14n,
  AttachFiles: 1n << 15n,
  ReadMessageHistory: 1n << 16n,
  Connect: 1n << 20n,
  Speak: 1n << 21n,
  ManageWebhooks: 1n << 29n,
  SendMessagesInThreads: 1n << 38n,
  SetVoiceChannelStatus: 1n << 48n,
} as const;

const PERMISSIONS = Object.values(FLAGS).reduce((all, one) => all | one, 0n);

/** guildId: 그 서버를 미리 고르고 바꾸지 못하게 한다(디스코드 승인 화면이 그 서버에 봇을 넣을 권한을 다시 본다) */
function inviteUrl(clientId: string, guildId?: string) {
  const base = `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${PERMISSIONS}&scope=bot%20applications.commands`;
  return guildId ? `${base}&guild_id=${guildId}&disable_guild_select=true` : base;
}

export { inviteUrl, FLAGS, PERMISSIONS };
