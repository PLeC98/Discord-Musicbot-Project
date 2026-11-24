// 운영자가 설정으로 풀 수 있는 실패의 안내. 사용자 문장(ui/error-messages)에는 무엇이 안 됐는지만 쓰고,
// 고치는 법은 운영자가 보는 로그에 이 안내를 붙인다. 곡 찾기(sources)와 재생(player)이 같이 쓴다.
// 쿠키는 권하지 않는다. 연령 제한 영상의 재시도에만 붙고, yt-dlp도 계정이 있어야 여는 콘텐츠에만 쓰라고 한다(계정 정지 위험)

import { L } from "../infra/log/text.ts";
import type { LogText } from "../infra/log/log-text.ts";

const HINTS: Readonly<Record<string, () => LogText>> = {
  "yt-bot-check": L.reason.hintBotCheck,
  "rate-limited": L.reason.hintRateLimited,
};

/** 로그 줄에 붙일 안내(로그 문구). 없으면 null */
const operatorHint = (kind: string): LogText | null => HINTS[kind]?.() ?? null;

export { operatorHint };
