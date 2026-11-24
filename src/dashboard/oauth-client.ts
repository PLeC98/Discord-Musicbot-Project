// 대시보드 로그인의 앱 자격(클라이언트 ID, CLIENT_SECRET)을 디스코드에 보내는 곳. 로그아웃 때의 토큰 폐기와 기동 때의 시크릿 확인(client-secret-check)이 같은 요청을 쓴다.
// 자격은 로그인 콜백의 토큰 교환과 같은 본문 방식(client_secret_post)으로 보낸다. 시크릿은 요청 본문에만 싣고 로그에 남기지 않는다

import config from "../config/index.ts";
import { appIdOf } from "../infra/app-id.ts";
import { DISCORD_API, type DiscordHttp } from "./discord-api.ts";

/** 디스코드에 접근 토큰 폐기를 요청한다(RFC 7009). 로그아웃, 다른 기기 로그아웃, 시크릿 확인(가짜 토큰) */
function revokeToken(http: DiscordHttp, token: string) {
  return http.post(`${DISCORD_API}/oauth2/token/revoke`, new URLSearchParams({ client_id: appIdOf(), client_secret: config.discord.clientSecret ?? "", token, token_type_hint: "access_token" }), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
}

/** 디스코드가 봇의 앱 자격(클라이언트 ID, 시크릿)을 거절한 응답인가(RFC 6749 5.2 invalid_client) */
const isBadClient = (response: { status?: number; data?: unknown } | undefined) => (response?.data as { error?: unknown } | undefined)?.error === "invalid_client";

export { revokeToken, isBadClient };
