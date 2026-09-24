// 옮기기 커밋이 정말 옮기기만 했는지 본다.
//
//   node scripts/verify-move.js            마지막 커밋
//   node scripts/verify-move.js <커밋>     그 커밋
//   node scripts/verify-move.js --staged   커밋 전, 스테이지에 올린 것
//
// 지운 줄이 전부 더한 줄 어딘가에 다시 나타나야 한다(앞뒤 공백 무시). 불러오는 경로는 옮기면 바뀌는 것이 당연하므로
// require · require.resolve · import 의 경로 글자, path.join/resolve(__dirname, …) 의 인자, 저장소 기준 경로 글자("src/…")는
// 지우고 비교한다.
// 짝이 없는 더한 줄(함수 머리 · 내보내기 · 부르는 한 줄 같은 감싸는 줄)은 목록으로 보여 주기만 한다. 사람이 본다.
// 지운 줄이 하나라도 사라졌으면 실패한다. 그것은 옮기기가 아니라 고치기다.

import { execFileSync } from "child_process";

const arg = process.argv[2];
const range = arg === "--staged" ? ["--staged"] : [`${arg || "HEAD"}^`, arg || "HEAD"];
const diff = execFileSync("git", ["diff", "-M", "--no-color", "--unified=0", ...range], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

// 경로 글자를 지운 모양. 옮기면 달라지는 곳만 가린다
const normalize = (line: string) =>
  line
    .trim()
    .replace(/require(\.resolve)?\(\s*(["'`])[^"'`]*\2\s*\)/g, "require$1(<경로>)")
    .replace(/\bimport\(\s*(["'`])[^"'`]*\1\s*\)/g, "import(<경로>)")
    .replace(/\bfrom\s+(["'])[^"']*\1/g, "from <경로>")
    .replace(/path\.(join|resolve)\(\s*__dirname[^)]*\)/g, "path.$1(<경로>)")
    .replace(/path\.join\(\s*(["'])(?:src|test|commands|events|dashboard|scripts)\1[^)]*\)/g, "path.join(<경로>)")
    .replace(/(["'])(?:\.{1,2}\/)*(?:src|test|commands|events|dashboard|scripts)\/[\w./-]*\1/g, "<경로>");

// 기준선 파일은 옮긴 파일 이름을 따라 키와 수가 바뀐다. 코드가 아니므로 보지 않는다
const SKIP = new Set(["eslint-suppressions.json", "test/architecture/baseline.json"]);

const removed = new Map(); // 모양 → 남은 수
const removedAt = new Map(); // 모양 → 처음 본 자리
const added = [];
let file = "";
let oldFile = "";

// 파일 머리줄(--- · +++)은 diff 와 첫 @@ 사이에만 있다. 본문의 "-- SQL 주석"을 지운 줄도 "--- "로 시작한다
let inHeader = false;
for (const raw of diff.split("\n")) {
  if (raw.startsWith("diff ")) {
    inHeader = true;
    continue;
  }
  if (raw.startsWith("@@")) {
    inHeader = false;
    continue;
  }
  if (inHeader) {
    if (raw.startsWith("--- ")) oldFile = raw.slice(6);
    if (raw.startsWith("+++ ")) file = raw.slice(6);
    continue;
  }
  if (SKIP.has(file) || SKIP.has(oldFile)) continue;
  if (raw.startsWith("-")) {
    const key = normalize(raw.slice(1));
    if (!key) continue;
    removed.set(key, (removed.get(key) || 0) + 1);
    if (!removedAt.has(key)) removedAt.set(key, file === "ev/null" ? oldFile : file);
  } else if (raw.startsWith("+")) {
    const key = normalize(raw.slice(1));
    if (key) added.push({ key, file, text: raw.slice(1).trim() });
  }
}

const extra = [];
for (const a of added) {
  const left = removed.get(a.key) || 0;
  if (left > 0) removed.set(a.key, left - 1);
  else extra.push(a);
}
const lost = [...removed].filter(([, n]) => n > 0);

if (extra.length) {
  console.log(`짝이 없는 더한 줄 ${extra.length}개 (감싸는 줄인지 사람이 본다):`);
  for (const e of extra) console.log(`  + ${e.file}: ${e.text}`);
}
if (lost.length) {
  console.log(`\n사라진 지운 줄 ${lost.reduce((s, [, n]) => s + n, 0)}개. 옮기기가 아니다:`);
  for (const [key, n] of lost) console.log(`  - ${removedAt.get(key) ?? "?"}: ${key}${n > 1 ? ` (×${n})` : ""}`);
  process.exit(1);
}
console.log(`옮기기 확인: 지운 줄이 전부 다시 나타났다${extra.length ? "" : ". 더한 줄도 전부 짝이 있다"}`);
