// pnpm run update:ytdlp의 인자(scripts/update-ytdlp).
//   --pin <태그>(--pin=<태그>도): 그 버전을 받고 고정한다. --unpin: 고정을 풀고 채널의 최신을 받는다. 둘 다 없으면 지금 설정대로 맞춘다.
//   --channel <채널>(--channel=<채널>도): 채널을 바꾼다(stable, nightly, master). --pin, --unpin과 함께 쓸 수 있다
//   --skip-signature: 이번 실행만 서명 확인을 건너뛴다(어느 것과도 같이 쓴다)
// pnpm이 -- 를 넘겨도 맞게 인자 어디에 있든 본다

import { isYtdlpChannel, isYtdlpTag, YTDLP_CHANNELS, type YtdlpChannelName } from "../rules/ytdlp-tag.ts";

/** pin: undefined면 고정을 바꾸지 않는다, 문자열이면 그 태그로 고정, null이면 고정 해제. channel: undefined면 채널을 바꾸지 않는다 */
type UpdateArgs = { pin: string | null | undefined; channel: YtdlpChannelName | undefined; skipSignature: boolean } | { error: string };

/** --이름 값, --이름=값 의 값. 없으면 undefined, 이름만 있고 값이 없으면 빈 문자열 */
function valueOf(argv: string[], name: string): string | undefined {
  const at = argv.findIndex((arg) => arg === name || arg.startsWith(`${name}=`));
  if (at < 0) return undefined;
  return (argv[at].startsWith(`${name}=`) ? argv[at].slice(name.length + 1) : (argv[at + 1] ?? "")).trim();
}

function parseChannel(argv: string[]): { channel: YtdlpChannelName | undefined } | { error: string } {
  const value = valueOf(argv, "--channel");
  if (value === undefined) return { channel: undefined };
  if (!isYtdlpChannel(value)) return { error: `--channel 뒤에 채널을 넣으세요(${YTDLP_CHANNELS.join(", ")} 중 하나)${value ? `: ${value}` : ""}` };
  return { channel: value };
}

function parsePin(argv: string[]): { pin: string | null | undefined } | { error: string } {
  const unpin = argv.includes("--unpin");
  const tag = valueOf(argv, "--pin");
  if (tag === undefined) return { pin: unpin ? null : undefined };
  if (unpin) return { error: "--pin과 --unpin은 함께 쓸 수 없습니다" };
  if (!tag) return { error: "--pin 뒤에 고정할 버전을 넣으세요(예: --pin 2026.11.16.232655)" };
  if (!isYtdlpTag(tag)) return { error: `yt-dlp 릴리스 태그 모양이 아닙니다: ${tag}(예: 2026.10.26, 2026.11.16.232655)` };
  return { pin: tag };
}

function parseUpdateArgs(argv: string[]): UpdateArgs {
  const channel = parseChannel(argv);
  if ("error" in channel) return channel;
  const pin = parsePin(argv);
  if ("error" in pin) return pin;
  return { ...pin, ...channel, skipSignature: argv.includes("--skip-signature") };
}

export { parseUpdateArgs };
export type { UpdateArgs };
