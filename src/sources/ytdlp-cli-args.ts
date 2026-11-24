// pnpm run update:ytdlp의 인자(scripts/update-ytdlp).
//   --pin <태그>(--pin=<태그>도): 그 버전을 받고 고정한다. --unpin: 고정을 풀고 채널의 최신을 받는다. 둘 다 없으면 지금 설정대로 맞춘다.
//   --channel <채널>(--channel=<채널>도): 채널을 바꾼다(stable, nightly, master). --pin, --unpin과 함께 쓸 수 있다
//   --skip-signature: 이번 실행만 서명 확인을 건너뛴다(어느 것과도 같이 쓴다)
// pnpm이 -- 를 넘겨도 맞게 인자 어디에 있든 본다

import { isYtdlpChannel, isYtdlpTag, YTDLP_CHANNELS, type YtdlpChannelName } from "../rules/ytdlp-tag.ts";
import { L } from "../infra/log/text.ts";
import type { LogText } from "../infra/log/log-text.ts";

/** pin: undefined면 고정을 바꾸지 않는다, 문자열이면 그 태그로 고정, null이면 고정 해제. channel: undefined면 채널을 바꾸지 않는다 */
type UpdateArgs = { pin: string | null | undefined; channel: YtdlpChannelName | undefined; skipSignature: boolean } | { error: LogText };

/** --이름 값, --이름=값 의 값. 없으면 undefined, 이름만 있고 값이 없으면 빈 문자열 */
function valueOf(argv: string[], name: string): string | undefined {
  const at = argv.findIndex((arg) => arg === name || arg.startsWith(`${name}=`));
  if (at < 0) return undefined;
  return (argv[at].startsWith(`${name}=`) ? argv[at].slice(name.length + 1) : (argv[at + 1] ?? "")).trim();
}

function parseChannel(argv: string[]): { channel: YtdlpChannelName | undefined } | { error: LogText } {
  const value = valueOf(argv, "--channel");
  if (value === undefined) return { channel: undefined };
  if (!isYtdlpChannel(value)) return { error: L.ytdlp.argsChannelMissing({ channels: YTDLP_CHANNELS.join(", "), valueSuffix: value ? `: ${value}` : "" }) };
  return { channel: value };
}

function parsePin(argv: string[]): { pin: string | null | undefined } | { error: LogText } {
  const unpin = argv.includes("--unpin");
  const tag = valueOf(argv, "--pin");
  if (tag === undefined) return { pin: unpin ? null : undefined };
  if (unpin) return { error: L.ytdlp.argsPinUnpin() };
  if (!tag) return { error: L.ytdlp.argsPinMissing() };
  if (!isYtdlpTag(tag)) return { error: L.ytdlp.argsNotTag({ tag }) };
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
