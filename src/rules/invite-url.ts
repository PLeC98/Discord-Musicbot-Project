// 봇 초대 링크. 요청하는 권한 · 범위는 이 한 곳이다(/help 의 초대 링크 · 대시보드 초대 화면)

/** guildId: 그 서버를 미리 고르고 바꾸지 못하게 한다(디스코드 승인 화면이 그 서버에 봇을 넣을 권한을 다시 본다) */
function inviteUrl(clientId: string, guildId?: string) {
  const base = `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot%20applications.commands`;
  return guildId ? `${base}&guild_id=${guildId}&disable_guild_select=true` : base;
}

export { inviteUrl };
