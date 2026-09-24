// 재생 실패를 로그 한 줄로. 무엇이 막았는지가 분명한 종류는 그 이름만, 나머지는 오류의 첫 줄.
// 원문 전체(yt-dlp 의 WARNING 줄 포함)는 부르는 쪽이 debug 로 남긴다.

import { errorKind, messageOf } from "../rules/errorKind.ts";

// 로그에 적을 이름. 문장이 넓게 걸리는 종류(stream-failed 등)는 넣지 않는다. 이름만 남기면 무엇이 깨졌는지 잃는다
const LABELS: Record<string, string> = {
  "age-cookies-invalid": "연령 제한 · 쿠키가 무효. 쿠키를 다시 넣어 주세요",
  "bot-check": "봇 감지",
  "video-unavailable": "비공개이거나 삭제된 영상",
  "geo-blocked": "지역 차단",
  "rate-limited": "요청 제한",
  "no-youtube-match": "유튜브에서 같은 곡을 못 찾음",
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

/** cookiesConfigured: 쿠키를 걸어 두었나. 연령 제한이 쿠키가 없어서인지 쿠키로도 안 되는지를 가른다 */
function failureReason(error: unknown, cookiesConfigured: boolean): string {
  const kind = errorKind(error);
  const text = messageOf(error);
  const why = kind === "age-restricted" ? `연령 제한 · ${cookiesConfigured ? "쿠키로도 재생 불가" : "쿠키 없음"}` : (LABELS[kind] ?? firstLine(text));
  const id = VIDEO_ID.exec(text)?.[1];
  return id ? `${why} (${id})` : why;
}

export { failureReason };
