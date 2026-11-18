// pnpm run install:ffmpeg의 인자(scripts/install-ffmpeg).
//   --pin <릴리스>(--pin=<릴리스>도 된다): 그 릴리스로 맞추고 성공하면 고정한다. --unpin: 고정을 풀고 코드의 기본값으로 맞춘다. 둘 다 없으면 지금 고정(없으면 기본값)으로 맞춘다.
//   --force: 그 릴리스가 이미 있어도, 실행되지 않아 물린 릴리스여도 새로 받는다(다른 인자와 함께 쓸 수 있다)
// pnpm이 --를 함께 넘겨도 되게 인자 위치와 상관없이 본다

import { isReleaseTag } from "./state.ts";

/** pin: undefined면 고정을 바꾸지 않음, 문자열이면 그 릴리스로 고정, null이면 고정 해제 */
type InstallArgs = { pin: string | null | undefined; force: boolean } | { error: string };

function parseInstallArgs(argv: string[]): InstallArgs {
  const force = argv.includes("--force");
  const unpin = argv.includes("--unpin");
  const at = argv.findIndex((arg) => arg === "--pin" || arg.startsWith("--pin="));
  if (at < 0) return { pin: unpin ? null : undefined, force };
  if (unpin) return { error: "--pin과 --unpin은 함께 쓸 수 없습니다" };
  const tag = (argv[at].startsWith("--pin=") ? argv[at].slice("--pin=".length) : (argv[at + 1] ?? "")).trim();
  if (!tag) return { error: "--pin 뒤에 고정할 릴리스를 넣으세요(예: --pin autobuild-2026-10-31-12-59)" };
  if (!isReleaseTag(tag)) return { error: `BtbN 릴리스 태그 형식이 아닙니다: ${tag}(예: autobuild-2026-10-31-12-59)` };
  return { pin: tag, force };
}

export { parseInstallArgs };
export type { InstallArgs };
