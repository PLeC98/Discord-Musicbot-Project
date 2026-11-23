// 업데이트 탭의 bgutil 카드가 부르는 저장소 조회: 최신 릴리스 태그(확인 버튼)와 태그가 가리키는 커밋(버전 고정 전에 보이는 것).
// 둘 다 메모리에만 둔다. 커밋은 확인한 것을 기억해 두고, 고정은 그 커밋으로만 한다(화면이 보낸 커밋을 그대로 믿지 않는다).
// git은 infra/tool-run을 쓰지 않는다(스크립트용이라 처음 실행할 때 종료 신호에 process.exit를 건다). 자격 증명을 묻지 않게 하고 상한을 둔다

import childProcess from "node:child_process";
import { toolEnv } from "../../config/tool-env.ts";
import { register } from "../../infra/process-registry.ts";
import { BGUTIL_REPO, taggedCommit } from "../../rules/bgutil-install.ts";
import { latestReleaseTag } from "../github-release.ts";
import { rule } from "../../rules/rule-problem.ts";
import { ruleError } from "../../rules/text/index.ts";

/** git ls-remote의 상한(ms) */
const LS_REMOTE_MS = 30_000;
/** 확인한 커밋을 기억하는 시간(ms). 지나면 다시 확인해야 고정할 수 있다 */
const RESOLVED_MS = 10 * 60_000;

/** 테스트가 교체하는 것 */
type Io = { latest(): Promise<string>; lsRemote(args: string[]): Promise<string>; now(): number };

/** git ls-remote <저장소> ...refs. 자격 증명을 묻지 않는다(없는 저장소면 GitHub가 인증을 요구하고, Windows는 Git Credential Manager 창을 띄우고 기다린다) */
function lsRemote(refs: string[]): Promise<string> {
  const env = { ...toolEnv(), GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "", GCM_INTERACTIVE: "never" };
  const args = ["-c", "credential.helper=", "-c", "core.askPass=", "ls-remote", `https://github.com/${BGUTIL_REPO}.git`, ...refs];
  return new Promise((resolve, reject) => {
    let unregister: () => void = () => undefined;
    const child = childProcess.execFile("git", args, { env, timeout: LS_REMOTE_MS, windowsHide: true, maxBuffer: 1 << 20 }, (error, stdout) => {
      unregister();
      if (!error) return resolve(stdout);
      // 실패는 업데이트 탭의 bgutil 카드까지 간다
      reject(ruleError(error.killed ? rule("git-ls-remote-timeout", { sec: LS_REMOTE_MS / 1000 }) : rule("git-ls-remote-failed", { detail: error.message.split("\n")[0] })));
    });
    child.stdin?.end();
    unregister = register(child, "git ls-remote");
  });
}

const REAL: Io = { latest: () => latestReleaseTag(BGUTIL_REPO), lsRemote, now: () => Date.now() };

class BgutilRemote {
  io: Io;
  /** 마지막으로 확인한 최신 릴리스 태그와 그 시각 */
  latest: { tag: string; at: number } | null = null;
  resolved = new Map<string, { commit: string; at: number }>();

  constructor(io: Io = REAL) {
    this.io = io;
  }

  /** 최신 릴리스 태그를 확인해 기억한다. 실패하면 예외를 던진다 */
  async check() {
    this.latest = { tag: await this.io.latest(), at: this.io.now() };
    return this.latest;
  }

  /** 태그가 가리키는 커밋을 확인해 기억한다. 저장소에 태그가 없으면 null, 조회가 실패하면 예외를 던진다. tag는 isPlainTag를 통과한 것 */
  async resolve(tag: string): Promise<string | null> {
    const commit = taggedCommit(await this.io.lsRemote([`refs/tags/${tag}`, `refs/tags/${tag}^{}`]), tag);
    if (commit) this.resolved.set(tag, { commit, at: this.io.now() });
    return commit;
  }

  /** 최근에 확인한 그 태그의 커밋(없거나 오래됐으면 null) */
  resolvedCommit(tag: string): string | null {
    const seen = this.resolved.get(tag);
    return seen && this.io.now() - seen.at <= RESOLVED_MS ? seen.commit : null;
  }
}

const bgutilRemote = new BgutilRemote();

export { bgutilRemote, BgutilRemote, RESOLVED_MS };
export type { Io as BgutilRemoteIo };
