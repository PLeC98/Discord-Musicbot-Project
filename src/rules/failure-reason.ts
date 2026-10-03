// 재생 · 곡 찾기 실패를 로그 한 줄로. 무엇이 막았는지가 분명한 종류는 그 이름만, 나머지는 오류의 첫 줄.
// 원문 전체(yt-dlp 의 WARNING 줄 포함)는 부르는 쪽이 debug 로 남긴다.

import { errorKind, messageOf } from "./error-kind.ts";
import { operatorHint } from "./operator-hints.ts";

// 로그에 적을 이름. 문장이 넓게 걸리는 종류(stream-failed 등)는 넣지 않는다. 이름만 남기면 무엇이 깨졌는지 잃는다
const LABELS: Record<string, string> = {
  "yt-age-cookies-invalid": "연령 제한 · 쿠키가 무효. 쿠키를 다시 넣어 주세요",
  "yt-bot-check": "봇 감지",
  "unavailable-contents": "없거나 비공개 · 삭제된 곡",
  "unavailable-playlist": "없거나 비공개인 재생목록",
  "sc-preview-only": "미리듣기만 열린 곡",
  "geo-blocked": "지역 차단",
  "rate-limited": "요청 제한",
  "sp-no-youtube-match": "유튜브에서 같은 곡을 못 찾음",
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

// 감싼 오류의 까닭(원인의 첫 줄). 사용자 문장을 일반화하려 감싼 것은 사유가 원인에만 있다(직접 링크).
// 원인의 첫 줄이 오류의 첫 줄과 같으면(원인의 ERROR 줄을 그대로 글로 삼은 것) 붙이지 않는다
function causeOf(error: unknown, text: string) {
  const cause = error && typeof error === "object" && "cause" in error ? error.cause : undefined;
  if (!cause) return "";
  const line = firstLine(messageOf(cause));
  return line === firstLine(text) ? "" : ` (${line})`;
}

/** cookiesConfigured: 쿠키를 걸어 두었나. 연령 제한이 쿠키가 없어서인지 쿠키로도 안 되는지를 가른다 */
function failureReason(error: unknown, cookiesConfigured: boolean): string {
  const kind = errorKind(error);
  const text = messageOf(error);
  const why = kind === "yt-age-no-cookies" ? `연령 제한 · ${cookiesConfigured ? "쿠키로도 재생 불가" : "쿠키 없음"}` : `${LABELS[kind] ?? `${firstLine(text)}${causeOf(error, text)}`}${operatorHint(kind)}`;
  const id = VIDEO_ID.exec(text)?.[1];
  return id ? `${why} (${id})` : why;
}

export { failureReason };
