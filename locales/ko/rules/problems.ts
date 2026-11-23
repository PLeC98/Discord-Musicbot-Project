// 규칙 문제(rules/rule-problem)의 문장. 기동 로그, 터미널, 화면이 같은 문장을 쓴다. 설정 문서 검사의 문장은 settings. 이름, 값은 코드가 넘긴 그대로(화면은 이름 대신 라벨을 붙여 그린다)

import { josa } from "../../../src/infra/josa.ts";
import type { RuleSentences } from "../../../src/rules/rule-problem.ts";
import { ai, format, genres, prompt, status } from "./settings.ts";
import { archive } from "./archive.ts";
import { tools } from "./tools.ts";
import { assist } from "./assist.ts";

const problems = {
  "tune-value": (p, cause) => `${p.key} 값이 잘못됨(${p.value}): ${cause}`,
  "archive-item": (p, cause) => `${p.item}: ${cause}`,
  "tune-unknown-key": (p) => `${p.key}: 모르는 설정`,
  "tune-not-text": (p) => `${p.key}: 문자열이어야 함`,
  "tune-locked": (p) => `${p.lockedBy}${josa(String(p.lockedBy), "이")} 있는 동안 바꿀 수 없음`,
  "guild-id": () => "디스코드 서버 ID 형식(17 ~ 20자리 숫자)이 아님",
  bool: () => "true, false 중 하나여야 함",
  "one-of": (p) => `${p.allowed} 중 하나여야 함`,
  integer: () => "정수만 쓸 수 있음",
  "safe-integer": () => "다룰 수 있는 범위를 넘는 수",
  "at-least": (p) => `${p.min} 이상이어야 함`,
  "at-most": (p) => `${p.max} 이하여야 함`,
  url: () => "주소 형식이 아님(예: https://example.com)",
  "url-scheme": () => "http, https 주소만 쓸 수 있음",
  "origin-only": () => "경로, 사용자 정보, ?, # 없이 주소만 적으세요 (예: https://example.com, http://bot.example.com:33333)",
  address: () => "IP 주소(0.0.0.0, :: 포함)나 localhost만 쓸 수 있음",
  color: () => "#RRGGBB 형식의 색이어야 함(예: #2743D2)",
  "queue-max": (p) => `0(끔)이거나 ${p.floor} 이상이어야 함`,
  "ytdlp-tag": () => "yt-dlp 릴리스 태그(예: 2026.08.19)여야 함",
  cookies: (p) => `file 또는 브라우저 이름(${p.browsers})이어야 함`,
  "client-names": () => "클라이언트 이름은 영문 소문자, 숫자, _만 쓸 수 있음",
  "bgutil-commit-only": () => "커밋만 있고 태그가 없음",
  "bgutil-not-tag": () => "태그 이름이 아님",
  "bgutil-commit-hash": () => "커밋 해시 40자(16진수 소문자)여야 함",
  "bgutil-needs-commit": (p) => `기본값(${p.tag})과 다른 태그에는 그 태그의 커밋이 함께 있어야 함`,
  "archive-missing": () => "파일에 없어요",
  plain: (p) => String(p.text),
  "error-thrown": (p) => `던진 값: ${p.value}`,
  "error-code": (p) => `오류 코드 ${p.code}`,
  "error-no-message": (p) => `메시지 없는 ${p.name || "오류"}${p.at ? ` (${p.at})` : ""}`,
  "doc-revision-conflict": (p) => `${p.name} 문서가 그사이 바뀜(읽은 번호 ${p.read}, 지금 ${p.now})`,
  "link-off": () => "꺼 둠",
  "link-no-key": () => "키 없음",
  "link-no-token": () => "토큰 없음",
  "link-genres-broken": () => "장르 설정을 읽지 못함",
  "link-unused": () => "이 출처를 쓰는 장르가 없음",
  "link-anon-token": (p) => `익명 토큰 ${p.min}분 남음`,
  "link-recent-fails": (p) => `최근 ${p.total}번 중 ${p.fails}번 실패`,
  "link-reconnects": (p) => `재연결 ${p.count}회`,
  "link-reconnecting": (p) => `재연결 중(${p.attempt}번째)`,
  "link-pot-down": () => "서버가 떠 있지 않음",
  "link-lb-hint": (p) => `LB Radio · ${p.sec}초 넘으면 실패`,
  "link-not-segment-api": () => "구간 API 응답이 아님",
  "deploy-guild-missing": (p) => `GUILD_ID 서버(${p.guildId ?? "없음"})에 봇이 없음. .env의 GUILD_ID가 맞는지, 봇이 서버에서 나가지 않았는지 확인하세요`,
  ...tools,
  ...assist,
  ...genres,
  ...status,
  ...ai,
  ...prompt,
  ...format,
  ...archive,
} satisfies RuleSentences;

export { problems };
