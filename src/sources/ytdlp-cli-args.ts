// pnpm run update:ytdlp의 인자(scripts/update-ytdlp).
//   --pin <태그>(--pin=<태그>도): 그 버전을 받고 고정한다. --unpin: 고정을 풀고 채널의 최신을 받는다. 둘 다 없으면 지금 설정대로 맞춘다.
//   --skip-signature: 이번 실행만 서명 확인을 건너뛴다(어느 것과도 같이 쓴다)
// pnpm이 -- 를 넘겨도 맞게 인자 어디에 있든 본다

import { isYtdlpTag } from "../rules/ytdlp-tag.ts";

/** pin: undefined면 고정을 바꾸지 않는다, 문자열이면 그 태그로 고정, null이면 고정 해제 */
type UpdateArgs = { pin: string | null | undefined; skipSignature: boolean } | { error: string };

function parseUpdateArgs(argv: string[]): UpdateArgs {
  const skipSignature = argv.includes("--skip-signature");
  const unpin = argv.includes("--unpin");
  const at = argv.findIndex((arg) => arg === "--pin" || arg.startsWith("--pin="));
  if (at < 0) return { pin: unpin ? null : undefined, skipSignature };
  if (unpin) return { error: "--pin과 --unpin은 함께 쓸 수 없습니다" };
  const tag = (argv[at].startsWith("--pin=") ? argv[at].slice("--pin=".length) : (argv[at + 1] ?? "")).trim();
  if (!tag) return { error: "--pin 뒤에 고정할 버전을 넣으세요(예: --pin 2026.11.16.232655)" };
  if (!isYtdlpTag(tag)) return { error: `yt-dlp 릴리스 태그 모양이 아닙니다: ${tag}(예: 2026.10.26, 2026.11.16.232655)` };
  return { pin: tag, skipSignature };
}

export { parseUpdateArgs };
export type { UpdateArgs };
