// 재생, 곡 찾기 실패를 로그 한 줄로. 무엇이 막았는지가 분명한 종류는 그 이름만, 나머지는 오류의 첫 줄.
// 원문 전체(yt-dlp의 WARNING 줄 포함)는 호출부가 debug로 남긴다.

import { errorKind, messageOf } from "./error-kind.ts";
import { operatorHint } from "./operator-hints.ts";
import { L } from "../infra/log/text.ts";
import type { LogText } from "../infra/log/log-text.ts";

// 로그에 적을 이름(로그 문구). 문장이 넓게 걸리는 종류(stream-failed 등)는 넣지 않는다. 이름만 남기면 무엇이 깨졌는지 잃는다
const LABELS: Readonly<Record<string, () => LogText>> = {
  "yt-age-cookies-invalid": L.reason.ytAgeCookiesInvalid,
  "age-content-off": L.reason.ageContentOff,
  "age-channel-only": L.reason.ageChannelOnly,
  "yt-bot-check": L.reason.ytBotCheck,
  "unavailable-contents": L.reason.unavailableContents,
  "unavailable-playlist": L.reason.unavailablePlaylist,
  "sc-preview-only": L.reason.scPreviewOnly,
  "geo-blocked": L.reason.geoBlocked,
  "rate-limited": L.reason.rateLimited,
  "sp-no-youtube-match": L.reason.spNoYoutubeMatch,
};

const VIDEO_ID = /\[youtube\] ([\w-]{11}):/;

// ERROR 줄이 있으면 그것, 없으면 처음 나오는 줄
function firstLine(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.find((line) => line.startsWith("ERROR:")) ?? lines[0] ?? text;
}

// 감싼 오류의 사유(원인의 첫 줄). 사용자 문장을 일반화하려 감싼 것은 사유가 원인에만 있다(직접 링크).
// 원인의 첫 줄이 오류의 첫 줄과 같으면(원인의 ERROR 줄을 그대로 글로 삼은 것) 붙이지 않는다
function causeOf(error: unknown, text: string) {
  const cause = error && typeof error === "object" && "cause" in error ? error.cause : undefined;
  if (!cause) return "";
  const line = firstLine(messageOf(cause));
  return line === firstLine(text) ? "" : ` (${line})`;
}

/** 실패 이유(로그 문구). cookiesConfigured: 쿠키를 설정해 두었나. 연령 제한이 쿠키가 없어서인지 쿠키로도 안 되는지를 구분한다 */
function failureReason(error: unknown, cookiesConfigured: boolean): LogText {
  const kind = errorKind(error);
  const text = messageOf(error);
  const why = kind === "yt-age-no-cookies" ? L.reason.ytAgeNoCookies({ configured: cookiesConfigured }) : (LABELS[kind]?.() ?? `${firstLine(text)}${causeOf(error, text)}`);
  return L.reason.line({ why, hint: operatorHint(kind) ?? "", id: VIDEO_ID.exec(text)?.[1] ?? "" });
}

export { failureReason };
