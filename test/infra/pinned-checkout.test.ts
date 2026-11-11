// src/infra/pinned-checkout.ts: 실제 git 으로 임시 폴더의 원본 저장소와 클론을 만들어, 태그에 고정한 커밋으로 깨끗하게 체크아웃하는지,
// 원본의 태그가 옮겨졌거나 받지 못하면 멈추는지 본다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { checkoutPinned } from "../../src/infra/pinned-checkout.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pinned-checkout-"));
after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }));

// 사용자의 git 설정(서명, 훅)에 기대지 않는다
const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(root, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
fs.writeFileSync(env.GIT_CONFIG_GLOBAL, "");
const git = (args: string[], cwd: string) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// 원본: 커밋 셋(c1, c2, c3), 경량 태그 v1 → c1, 주석 태그 v2 → c2, 태그와 같은 이름의 브랜치 v1 → c3
const origin = path.join(root, "origin");
fs.mkdirSync(origin);
git(["init", "-q", "-b", "main"], origin);
const commits: string[] = [];
for (const n of [1, 2, 3]) {
  fs.mkdirSync(path.join(origin, "server"), { recursive: true });
  fs.writeFileSync(path.join(origin, "server", "main.ts"), `export const n = ${n};\n`);
  fs.writeFileSync(path.join(origin, ".gitignore"), "build/\nnode_modules/\n");
  git(["add", "-A"], origin);
  git(["commit", "-q", "-m", `c${n}`], origin);
  commits.push(git(["rev-parse", "HEAD"], origin).trim());
}
const [c1, c2, c3] = commits as [string, string, string];
git(["tag", "v1", c1], origin);
git(["tag", "-a", "v2", "-m", "v2", c2], origin);
git(["branch", "v1", c3], origin);

let n = 0;
const fresh = () => path.join(root, `clone-${++n}`);
const run = (dir: string, tag: string, commit: string, repo = origin) => checkoutPinned({ dir, repo, tag, commit, git });
const content = (dir: string) => fs.readFileSync(path.join(dir, "server", "main.ts"), "utf8");

test("경량 태그, 주석 태그를 받아 그 커밋에 선다. 같은 이름의 브랜치가 있어도 태그를 쓴다", () => {
  const dir = fresh();
  run(dir, "v1", c1);
  assert.equal(git(["rev-parse", "HEAD"], dir).trim(), c1);
  assert.equal(content(dir), "export const n = 1;\n");
  run(dir, "v2", c2);
  assert.equal(git(["rev-parse", "HEAD"], dir).trim(), c2);
});

test("받을 폴더의 상위 폴더가 없으면 만들어 클론한다", () => {
  const dir = path.join(root, "no-parent", "deep", "bgutil");
  run(dir, "v1", c1);
  assert.equal(git(["rev-parse", "HEAD"], dir).trim(), c1);
});

test("이전 설치가 남긴 것(스테이징된 변경, 추적하지 않는 파일, 무시 파일, 이전 빌드)을 지우고 그 커밋 그대로 선다", () => {
  const dir = fresh();
  run(dir, "v1", c1);
  fs.writeFileSync(path.join(dir, "server", "main.ts"), "export const evil = 1;\n");
  git(["add", "server/main.ts"], dir);
  fs.writeFileSync(path.join(dir, "server", "extra.ts"), "export {};\n");
  fs.writeFileSync(path.join(dir, "server", ".npmrc"), "registry=http://example.invalid\n");
  fs.mkdirSync(path.join(dir, "server", "build"), { recursive: true });
  fs.writeFileSync(path.join(dir, "server", "build", "main.js"), "evil();\n");
  fs.mkdirSync(path.join(dir, "server", "node_modules", "x"), { recursive: true });
  run(dir, "v1", c1);
  assert.equal(content(dir), "export const n = 1;\n");
  for (const left of ["extra.ts", ".npmrc", "build", "node_modules"]) assert.equal(fs.existsSync(path.join(dir, "server", left)), false, left);
  assert.equal(git(["status", "--porcelain", "--ignored"], dir), "");
});

test("원본에서 태그가 옮겨지면 두 커밋을 적고 멈춘다. 체크아웃은 그대로", () => {
  const moved = path.join(root, "moved");
  git(["clone", "-q", "--mirror", origin, moved], root);
  const dir = fresh();
  run(dir, "v1", c1, moved);
  git(["tag", "-f", "v1", c2], moved);
  assert.throws(
    () => run(dir, "v1", c1, moved),
    (error: Error) => error.message.includes(c1) && error.message.includes(c2),
  );
  assert.equal(git(["rev-parse", "HEAD"], dir).trim(), c1);
  assert.throws(() => run(fresh(), "v1", c1, moved), /태그가 옮겨졌을 수 있어/, "새로 클론해도 같다");
});

test("로컬 태그만 옮겨진 것은 원본에 맞게 고쳐 받는다", () => {
  const dir = fresh();
  run(dir, "v1", c1);
  git(["tag", "-f", "v1", c2], dir);
  run(dir, "v1", c1);
  assert.equal(git(["rev-parse", "refs/tags/v1^{commit}"], dir).trim(), c1);
});

test("원본에 닿지 못하면 로컬 태그가 맞아도 멈춘다. 원본에 태그가 없어도 멈춘다", () => {
  const dir = fresh();
  run(dir, "v1", c1);
  git(["remote", "set-url", "origin", path.join(root, "gone")], dir);
  fs.writeFileSync(path.join(dir, "server", "extra.ts"), "export {};\n");
  assert.throws(() => run(dir, "v1", c1));
  assert.equal(fs.existsSync(path.join(dir, "server", "extra.ts")), true, "확인 전에는 아무것도 지우지 않는다");
  assert.throws(() => run(fresh(), "v9", c1));
});

test("정리한 뒤에도 파일이 남으면 멈춘다(clean 이 무엇을 남긴 경우)", () => {
  const dir = fresh();
  run(dir, "v1", c1);
  fs.writeFileSync(path.join(dir, "server", "extra.ts"), "export {};\n");
  const noClean = (args: string[], cwd: string) => (args[0] === "clean" ? "" : git(args, cwd));
  assert.throws(() => checkoutPinned({ dir, repo: origin, tag: "v1", commit: c1, git: noClean }), /남은 파일 1개/);
});

test("새로 클론하면 확인 전에 파일을 풀지 않는다(태그가 맞지 않으면 작업 트리가 비어 있다)", () => {
  const dir = fresh();
  assert.throws(() => run(dir, "v1", c2));
  assert.deepEqual(
    fs.readdirSync(dir).filter((name) => name !== ".git"),
    [],
  );
});
