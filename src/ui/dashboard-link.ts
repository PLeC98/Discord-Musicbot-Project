// 웹 대시보드로 가는 링크 버튼(/help, 첫 안내)

import { ButtonBuilder, ButtonStyle } from "discord.js";
import config from "../config/index.ts";
import { tracksMembers } from "../infra/gateway-intents.ts";
import { isLoopbackUrl } from "../rules/net-address.ts";
import { buttonEmoji } from "./icons.ts";

/** 대시보드 주소가 이 기기에서만 열리면(기본값 localhost) 다른 사람에게는 열리지 않아 null. Server Members Intent가 꺼져 서버 화면을 쓸 수 없어도 null */
function dashboardButton(label: string) {
  const url = config.dashboard.url;
  if (!url || isLoopbackUrl(url) || !tracksMembers()) return null;
  return new ButtonBuilder().setLabel(label).setEmoji(buttonEmoji("web")).setURL(url).setStyle(ButtonStyle.Link);
}

export { dashboardButton };
