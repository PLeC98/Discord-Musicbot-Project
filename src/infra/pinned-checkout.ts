// 외부 도구의 git 저장소를 태그에 고정한 커밋으로 깨끗하게 체크아웃한다(설치 스크립트용).
// 태그는 옮길 수 있어 커밋을 함께 고정하고, 원본의 태그를 늘 다시 받아 맞춰 본다. 맞지 않으면 아무것도 풀지 않고 던진다.
// 막는 것은 원본 쪽(옮겨진 태그, 바뀐 저장소)이다. 이 PC 에서 체크아웃의 .git(replace 참조, 훅)이나 폴더를 고칠 수 있는 쪽은 막지 않는다: 그 쪽은 봇이 실행하는 빌드 결과를 바로 고칠 수 있다

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

/** git 을 실행해 표준 출력을 돌려준다. 실패하면 던진다 */
type Git = (args: string[], cwd: string) => string;

const realGit: Git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/**
 * dir 을 repo 의 tag 가 가리키는 commit 으로 체크아웃한다. dir 이 없으면 파일을 풀지 않고 클론한다.
 * 태그는 `+` refspec 으로 받아 원본에서 옮겨졌으면 로컬에서도 옮겨진 것이 보인다(받기가 실패하면 던진다. 옛 로컬 태그로 넘어가지 않는다).
 * 체크아웃 뒤 추적하지 않는 파일과 무시 파일(이전 설치의 node_modules, 빌드 결과)을 지우고 작업 트리가 그 커밋 그대로인지 본다.
 * tag 는 isPlainTag, commit 은 isCommitSha 를 통과한 것이어야 한다
 */
function checkoutPinned({ dir, repo, tag, commit, git = realGit, log }: { dir: string; repo: string; tag: string; commit: string; git?: Git; log?: (line: string) => void }) {
  if (!fs.existsSync(dir)) {
    log?.(`git clone --no-checkout ${repo}`);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    git(["clone", "--no-checkout", repo, dir], path.dirname(dir));
  }
  const ref = `refs/tags/${tag}`;
  log?.(`git fetch origin +${ref}:${ref}`);
  // 원본에 태그가 없거나 닿지 못하면 여기서 던진다
  git(["fetch", "--no-tags", "origin", `+${ref}:${ref}`], dir);
  const tagged = git(["rev-parse", "--verify", `${ref}^{commit}`], dir).trim();
  if (tagged !== commit) throw new Error(`태그 ${tag} 가 고정한 커밋 ${commit} 이 아니라 ${tagged} 를 가리킵니다. 태그가 옮겨졌을 수 있어 설치하지 않습니다`);

  log?.(`git checkout --force --detach ${commit}`);
  git(["-c", "advice.detachedHead=false", "checkout", "--force", "--detach", commit], dir);
  // 이전 설치가 남긴 것(스테이징된 변경은 checkout --force 가, 추적하지 않는 파일과 무시 파일은 clean 이 지운다)이 빌드에 섞이지 않게
  git(["clean", "-ffdx"], dir);
  const head = git(["rev-parse", "HEAD"], dir).trim();
  const dirty = git(["status", "--porcelain", "--ignored"], dir).trim();
  if (head !== commit || dirty) throw new Error(`체크아웃이 고정한 커밋 ${commit} 그대로가 아닙니다(HEAD ${head}${dirty ? `, 남은 파일 ${dirty.split("\n").length}개` : ""})`);
}

export { checkoutPinned };
export type { Git };
