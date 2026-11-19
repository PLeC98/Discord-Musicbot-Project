// 웹 대시보드로 가는 링크 버튼(/help, 첫 안내, /system)

import { ButtonBuilder, ButtonStyle } from "discord.js";
import config from "../config/index.ts";
import { tracksMembers } from "../infra/gateway-intents.ts";
import { isLoopbackUrl } from "../rules/net-address.ts";
import { buttonEmoji } from "./icons.ts";

/** 대시보드 주소(path는 그 아래 경로). 이 기기에서만 열리는 주소(기본값 localhost)면 다른 기기에서는 열리지 않아 null */
function dashboardUrl(path = "") {
  const url = config.dashboard.url;
  if (!url || isLoopbackUrl(url)) return null;
  return path ? new URL(path, url.endsWith("/") ? url : `${url}/`).href : url;
}

const linkButton = (label: string, url: string) => new ButtonBuilder().setLabel(label).setEmoji(buttonEmoji("web")).setURL(url).setStyle(ButtonStyle.Link);

/** 대시보드 첫 화면. Server Members Intent가 꺼져 서버 화면을 쓸 수 없어도 null */
function dashboardButton(label: string) {
  const url = dashboardUrl();
  if (!url || !tracksMembers()) return null;
  return linkButton(label, url);
}

/** 운영자 패널의 봇 상태 탭. 운영자 패널은 Server Members Intent와 상관없이 열린다 */
function adminStatusButton(label: string) {
  const url = dashboardUrl("admin?tab=status");
  return url ? linkButton(label, url) : null;
}

export { dashboardButton, adminStatusButton, dashboardUrl };
