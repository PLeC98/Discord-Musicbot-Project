// 웹 대시보드로 가는 링크 버튼(/help, 첫 안내)

import { ButtonBuilder, ButtonStyle } from "discord.js";
import config from "../config/index.ts";
import { isLoopbackUrl } from "../rules/net-address.ts";
import { buttonEmoji } from "./icons.ts";

/** 대시보드 주소가 이 기기에서만 열리면(기본값 localhost) 다른 사람에게는 열리지 않아 null */
function dashboardButton(label: string) {
  const url = config.dashboard.url;
  if (!url || isLoopbackUrl(url)) return null;
  return new ButtonBuilder().setLabel(label).setEmoji(buttonEmoji("web")).setURL(url).setStyle(ButtonStyle.Link);
}

export { dashboardButton };
