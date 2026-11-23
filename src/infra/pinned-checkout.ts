// 외부 도구의 git 저장소를 태그에 고정한 커밋으로 깨끗하게 체크아웃한다(설치 스크립트용).
// 태그는 옮길 수 있어 커밋을 함께 고정하고, 원격 저장소의 태그를 늘 다시 fetch해 대조한다. 맞지 않으면 아무것도 풀지 않고 실패한다.
// 막는 것은 원격 저장소 쪽(옮겨진 태그, 바뀐 저장소)이다. 이 PC에서 체크아웃의 .git(replace 참조, 훅)이나 폴더를 고칠 수 있는 쪽은 막지 않는다: 그 쪽은 봇이 실행하는 빌드 결과를 바로 고칠 수 있다

import fs from "fs";
import path from "path";
import { runTool } from "./tool-run.ts";
import { L } from "./log/text.ts";
import { logTextError } from "./log/log-text.ts";

/** git 하위 명령(args[0])을 실행해 stdout을 반환한다. 실패하면 거부된다 */
type Git = (args: string[], cwd: string) => string | Promise<string>;

/** 시간 상한(ms): 원격 저장소에 접속하는 명령(clone, fetch), 이전 설치의 node_modules를 지우는 clean(백신이 파일마다 검사해 느릴 수 있다), 나머지 로컬 명령 */
const NETWORK_MS = 3 * 60_000;
const CLEAN_MS = 3 * 60_000;
const LOCAL_MS = 30_000;

/**
 * env로 git을 실행하는 Git. 자격 증명을 묻지 않고 바로 실패한다: 터미널 프롬프트, askpass, credential helper를 끈다.
 * 없는 저장소 URL이면 GitHub가 인증을 요구하는데, credential helper가 켜져 있으면 Windows는 Git Credential Manager 창을 띄우고 기다린다.
 * core.longPaths: Windows에서 봇 폴더가 깊으면 node_modules 안 경로가 260자를 넘어 clean이 지우지 못한다
 */
function gitWith(env: NodeJS.ProcessEnv): Git {
  const quiet = { ...env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "", GCM_INTERACTIVE: "never" };
  return (args, cwd) =>
    runTool("git", ["-c", "credential.helper=", "-c", "core.askPass=", "-c", "core.longPaths=true", "-c", "advice.detachedHead=false", ...args], {
      cwd,
      env: quiet,
      label: `git ${args[0]}`,
      capture: true,
      timeoutMs: args[0] === "clone" || args[0] === "fetch" ? NETWORK_MS : args[0] === "clean" ? CLEAN_MS : LOCAL_MS,
    });
}

/**
 * dir을 repo의 tag가 가리키는 commit으로 체크아웃한다. dir이 없으면 파일을 풀지 않고 클론한다.
 * 태그는 `+` refspec으로 fetch해 원격 저장소에서 옮겨졌으면 로컬 태그도 따라 옮겨진다(fetch가 실패하면 거부된다. 옛 로컬 태그로 넘어가지 않는다).
 * 체크아웃 뒤 추적하지 않는 파일과 무시 파일(이전 설치의 node_modules, 빌드 결과)을 지우고 작업 트리가 그 커밋 그대로인지 본다.
 * tag는 isPlainTag, commit은 isCommitSha를 통과한 것이어야 한다
 */
async function checkoutPinned({ dir, repo, tag, commit, git, log }: { dir: string; repo: string; tag: string; commit: string; git: Git; log?: (line: string) => void }) {
  // 폴더는 있는데 .git이 없으면 git이 위로 올라가 바깥 저장소(봇 저장소)를 집는다
  if (fs.existsSync(dir) && !fs.existsSync(path.join(dir, ".git"))) throw logTextError(L.bgutil.checkoutNotGit({ dir }));
  if (!fs.existsSync(dir)) {
    log?.(`git clone --no-checkout ${repo}`);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await git(["clone", "--no-checkout", repo, dir], path.dirname(dir));
  }
  const ref = `refs/tags/${tag}`;
  log?.(`git fetch origin +${ref}:${ref}`);
  // 원격 저장소에 태그가 없거나 접속하지 못하면 여기서 거부된다
  await git(["fetch", "--no-tags", "origin", `+${ref}:${ref}`], dir);
  const tagged = (await git(["rev-parse", "--verify", `${ref}^{commit}`], dir)).trim();
  if (tagged !== commit) throw logTextError(L.bgutil.tagMoved({ tag, commit, tagged }));

  log?.(`git checkout --force --detach ${commit}`);
  await git(["checkout", "--force", "--detach", commit], dir);
  // 이전 설치가 남긴 것(스테이징된 변경은 checkout --force가, 추적하지 않는 파일과 무시 파일은 clean이 지운다)이 빌드에 섞이지 않게
  await git(["clean", "-ffdx"], dir);
  const head = (await git(["rev-parse", "HEAD"], dir)).trim();
  const dirty = (await git(["status", "--porcelain", "--ignored"], dir)).trim();
  if (head !== commit || dirty) throw new Error(`체크아웃 상태가 고정된 커밋(${commit}) 그대로가 아닙니다(HEAD ${head}${dirty ? `, 바뀐 파일 ${dirty.split("\n").length}개` : ""})`);
}

export { checkoutPinned, gitWith };
export type { Git };
