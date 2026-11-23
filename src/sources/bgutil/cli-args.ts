// pnpm run install:bgutil의 인자(scripts/install-bgutil).
//   인자가 없으면 업데이트 탭의 bgutil 카드가 고정한 버전(없으면 코드의 기본값)으로 맞춘다.
//   --pin <태그>(--pin=<태그>도): 그 태그를 설치하고 고정한다. --commit <커밋>을 함께 주면 태그가 그 커밋인지 본다(없으면 저장소에서 확인한다).
//   --unpin: 고정을 풀고 코드의 기본값을 설치한다.
//   --tag <태그> --commit <커밋>: 그 짝을 설치만 하고 설정은 건드리지 않는다(봇의 설치 작업이 넘긴다).
//   --force: 이미 그 태그와 커밋이어도 새 폴더에 다시 설치한다. 어느 것과도 같이 쓴다
// pnpm이 -- 를 넘겨도 맞게 인자 어디에 있든 본다

import { isCommitSha, isPlainTag } from "../../rules/bgutil-install.ts";
import { L } from "../../infra/log/text.ts";
import type { LogText } from "../../infra/log/log-text.ts";

/** settings: 설정대로, pin: 고정(commit이 null이면 저장소에서 확인), unpin: 고정 해제, exact: 그 짝만 설치한다 */
type InstallMode = { kind: "settings" } | { kind: "pin"; tag: string; commit: string | null } | { kind: "unpin" } | { kind: "exact"; tag: string; commit: string };
type InstallArgs = { mode: InstallMode; force: boolean } | { error: LogText };

const KNOWN = ["--pin", "--unpin", "--tag", "--commit", "--force"];

/** --이름 값, --이름=값 의 값. 없으면 undefined, 이름만 있고 값이 없으면 빈 문자열 */
function valueOf(argv: string[], name: string): string | undefined {
  const at = argv.findIndex((arg) => arg === name || arg.startsWith(`${name}=`));
  if (at < 0) return undefined;
  return (argv[at].startsWith(`${name}=`) ? argv[at].slice(name.length + 1) : (argv[at + 1] ?? "")).trim();
}

function parseTag(name: string, value: string): string | { error: LogText } {
  if (!value) return { error: L.bgutil.argsTagMissing({ name }) };
  return isPlainTag(value) ? value : { error: L.bgutil.argsNotTag({ value }) };
}

function parseCommit(value: string | undefined): string | null | { error: LogText } {
  if (value === undefined) return null;
  const commit = value.toLowerCase();
  return isCommitSha(commit) ? commit : { error: L.bgutil.argsCommitInvalid({ valueSuffix: value ? `: ${value}` : "" }) };
}

// 값을 받는 이름 뒤의 값이 아닌데 아는 이름도 아닌 것
function strayArg(argv: string[]): string | undefined {
  const takesValue = new Set(["--pin", "--tag", "--commit"]);
  return argv.find((arg, at) => arg !== "--" && !KNOWN.some((name) => arg === name || arg.startsWith(`${name}=`)) && !takesValue.has(argv[at - 1] ?? ""));
}

function parseMode(argv: string[]): InstallMode | { error: LogText } {
  const pin = valueOf(argv, "--pin");
  const tag = valueOf(argv, "--tag");
  const unpin = argv.includes("--unpin");
  const commit = parseCommit(valueOf(argv, "--commit"));
  if (typeof commit === "object" && commit !== null) return commit;
  if ([pin !== undefined, tag !== undefined, unpin].filter(Boolean).length > 1) return { error: L.bgutil.argsModesExclusive() };
  if (unpin) return commit ? { error: L.bgutil.argsUnpinWithCommit() } : { kind: "unpin" };
  if (pin !== undefined) {
    const parsed = parseTag("--pin", pin);
    return typeof parsed === "string" ? { kind: "pin", tag: parsed, commit } : parsed;
  }
  if (tag !== undefined) {
    const parsed = parseTag("--tag", tag);
    if (typeof parsed !== "string") return parsed;
    return commit ? { kind: "exact", tag: parsed, commit } : { error: L.bgutil.argsTagNeedsCommit() };
  }
  return commit ? { error: L.bgutil.argsCommitAlone() } : { kind: "settings" };
}

/** argv: process.argv 그대로(앞의 node, 스크립트 경로는 건너뛴다) */
function parseInstallArgs(argv: string[]): InstallArgs {
  const args = argv.slice(2);
  const stray = strayArg(args);
  if (stray !== undefined) return { error: L.bgutil.argsUnknown({ arg: stray }) };
  const mode = parseMode(args);
  return "error" in mode ? mode : { mode, force: args.includes("--force") };
}

export { parseInstallArgs };
export type { InstallArgs, InstallMode };
