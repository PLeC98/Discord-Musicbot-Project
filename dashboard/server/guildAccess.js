// 대시보드 경로가 서버 하나를 여는 법. 봇 준비 · 서버 있음 · 실멤버십(운영자는 면제) · 권한 수준 오버라이드

import owner from "./owner.js";
const { isOwner } = owner;
import viewAs from "./viewAs.js";
const { shadowMember } = viewAs;

async function getPlayer(req, res, guildId) {
  const client = req.app.locals.discordClient;
  if (!client?.isReady()) {
    res.status(503).json({ error: "봇이 아직 준비되지 않았습니다" });
    return null;
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    res.status(404).json({ error: "서버를 찾을 수 없습니다" });
    return null;
  }

  // 조회 인가는 세션의 굳은 서버 목록이 아니라 실멤버십으로 판정 (추방 즉시 차단).
  // 봇 운영자(OWNER_ID)는 멤버십과 무관하게 통과. member는 후속 권한 계산에 재사용.
  let member = null;
  try {
    member = await guild.members.fetch(req.session.user.id); // 캐시 우선, 미스 시 REST 1회
  } catch {
    if (!isOwner(req)) {
      res.status(403).json({ error: "접근 권한이 없습니다" });
      return null;
    }
  }

  // 권한 수준 오버라이드가 걸려 있으면 여기서 대역 멤버로 바꾼다. 이 한 곳이면 아래의
  // checkControl/checkAdd/isModerator가 전부 그 계층으로 판정된다.
  return { client, guild, player: client.players?.get(guildId) || null, member: shadowMember(req, member) };
}

// 음성 재적 상태. 채널 단위로 본다. "봇과 같은 채널인가"가 조작 가능 여부(checkVoice)의 기준이고,
// botInVoice/userInVoice를 따로 보면 같은 서버 다른 채널을 구분하지 못한다.
function voiceFlags(guild, userId) {
  // channelId가 아니라 channel?.id로 읽는다. permissions.js의 checkVoice와 같은 경로여야
  // 채널이 캐시에 없을 때 "화면은 조작 가능이라는데 서버는 막는" 어긋남이 생기지 않는다.
  //
  // 멤버가 아니라 voiceStates에서 읽는 이유: 멤버 캐시는 비어 있을 수 있지만 음성 상태는
  // 게이트웨이가 항상 채워둔다(GUILD_CREATE + VOICE_STATE_UPDATE). member.voice도 결국 이걸 본다.
  const botChannelId = guild?.members?.me?.voice?.channel?.id ?? null;
  const userChannelId = (userId && guild?.voiceStates?.cache?.get(userId)?.channel?.id) || null;
  return { botInVoice: !!botChannelId, userInVoice: !!userChannelId, sameVoice: !!botChannelId && botChannelId === userChannelId };
}

// 유한 정수 파싱. parseInt와 달리 "50junk"·Infinity·소수를 전부 NaN으로 거부
function toInt(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

const exported = { getPlayer, voiceFlags, toInt };
export default exported;
export { exported as "module.exports" };
