// 기동 때 한 번. 서버마다 봇 역할에 초대 링크(rules/invite-url)가 청하는 권한이 다 있는지 보고, 모자라면 운영자에게 한 줄.
// 봇 역할의 권한은 초대할 때 받은 그대로라, 초대 링크가 청하는 권한이 늘면 이미 들어가 있는 서버에는 없다(다시 초대하거나 역할에 더한다)

import { PermissionFlagsBits, type Client } from "discord.js";
import logger from "../infra/log/logger.ts";
import { FLAGS } from "../rules/invite-url.ts";

const log = logger.child({ category: "core" });

// 권한 이름(디스코드 서버 설정의 이름)
const LABEL: Record<keyof typeof FLAGS, string> = {
  ManageChannels: "채널 관리",
  ViewChannel: "채널 보기",
  SendMessages: "메시지 보내기",
  ManageMessages: "메시지 관리",
  EmbedLinks: "링크 첨부",
  AttachFiles: "파일 첨부",
  ReadMessageHistory: "메시지 기록 보기",
  Connect: "연결",
  Speak: "말하기",
  MuteMembers: "멤버 음소거",
  MoveMembers: "멤버 이동",
  ManageWebhooks: "웹후크 관리",
  SendMessagesInThreads: "스레드에서 메시지 보내기",
  SetVoiceChannelStatus: "음성 채널 상태 설정",
};

/** 봇 역할에 없는 권한의 이름. 관리자면 없음 */
function missingPermissions(has: (bit: bigint) => boolean) {
  if (has(PermissionFlagsBits.Administrator)) return [];
  return (Object.keys(FLAGS) as Array<keyof typeof FLAGS>).filter((name) => !has(FLAGS[name])).map((name) => LABEL[name]);
}

function logMissingPermissions(client: Client<true>) {
  for (const guild of client.guilds.cache.values()) {
    const me = guild.members.me;
    if (!me) continue;
    const missing = missingPermissions((bit) => me.permissions.has(bit, false));
    if (missing.length) log.info(`서버 ${guild.name} 의 봇 역할에 없는 권한: ${missing.join(" · ")} (다시 초대하거나 봇 역할에 더하면 그 기능이 돈다)`);
  }
}

export { logMissingPermissions, missingPermissions };
