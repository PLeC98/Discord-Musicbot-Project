// dashboard/src: 화면 문구는 언어를 바꾸면 그 자리에서 바뀐다(text/index의 그릇). 맨 위에서 문구의 값을 꺼내 두면 그 자리는 처음 언어로 남는다.
// 스크립트 맨 위(들여쓰기 0)의 const를 본다. 객체를 가리키는 별칭(const T = text.shell, const D = text.settings.devices)은 그릇이라 된다.
// 문자열, 함수, 배열을 꺼내 두는 것과 문구로 값을 만들어 두는 것(배열, 표, withDefaults의 기본값)은 안 된다. 함수, computed 안에서 읽는 것은 된다

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { text } from "../../../dashboard/src/text/index.ts";

const ROOT = path.join(import.meta.dirname, "..", "..", "..", "dashboard", "src");

function filesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "text" ? [] : filesUnder(full);
    return /\.(ts|vue)$/.test(entry.name) ? [full] : [];
  });
}

/** 스크립트 부분(.vue는 script setup, 없으면 script) */
function scriptOf(file: string) {
  const source = fs.readFileSync(file, "utf8");
  if (!file.endsWith(".vue")) return source;
  return (/<script setup[^>]*>([\s\S]*?)<\/script>/.exec(source) ?? /<script[^>]*>([\s\S]*?)<\/script>/.exec(source))?.[1] ?? "";
}

/** 맨 위 문장들(들여쓰기 0에서 시작해 들여 쓴 줄을 잇는다)과 그 줄 번호 */
function topStatements(script: string) {
  const lines = script.split("\n");
  const out: Array<{ line: number; statement: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^(?:export )?(?:const|let) /.test(lines[i])) continue;
    let statement = lines[i];
    for (let j = i + 1; j < lines.length && /^\s/.test(lines[j]); j++) statement += `\n${lines[j]}`;
    out.push({ line: i + 1, statement });
  }
  return out;
}

// 맨 위에서 만들지만 문구는 나중에 읽는 것(확인한 것만): 실패했을 때의 알림 문구를 콜백에서 읽는 것과 스토어의 getter
const READS_LATER: ReadonlySet<string> = new Set(["views/ServerSettingsView.vue saver", "views/ServerView.vue seekBar", "stores/user.ts useUserStore"]);

const isPlain = (value: unknown) => value !== null && typeof value === "object" && !Array.isArray(value);
const valueAt = (keys: string[]) => keys.reduce<unknown>((at, key) => (at as Record<string, unknown> | undefined)?.[key], text);

test("화면 코드의 맨 위에서 문구의 값을 꺼내 두지 않는다(객체를 가리키는 별칭만)", () => {
  const wrong: string[] = [];
  for (const file of filesUnder(ROOT)) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    // 별칭 이름 → text 안의 경로
    const aliases = new Map<string, string[]>([["text", []]]);
    for (const { line, statement } of topStatements(scriptOf(file))) {
      const chain = /^(?:export )?const (\w+)(?:: [^=]+)? = (\w+)((?:\.\w+)+);$/.exec(statement.trim());
      if (chain && aliases.has(chain[2])) {
        const keys = [...aliases.get(chain[2])!, ...chain[3].slice(1).split(".")];
        if (isPlain(valueAt(keys))) aliases.set(chain[1], keys);
        else wrong.push(`${rel}:${line} ${chain[1]}(${keys.join(".")}의 값을 꺼내 둔다)`);
        continue;
      }
      const names = [...aliases.keys()].join("|");
      // 화살표 함수가 돌려주는 참조(() => text.x)는 부를 때 읽는다
      const body = statement.replace(new RegExp(String.raw`=>\s*\(?\s*(?:${names})(?:\.\w+)+(?:\([^)]*\))?`, "g"), "=> _");
      if (!new RegExp(String.raw`\b(?:${names})(?:\.\w+|\[)`).test(body)) continue;
      if (READS_LATER.has(`${rel} ${/^(?:export )?const (\w+)/.exec(statement)?.[1]}`)) continue;
      // 읽을 때 꺼내는 것: 함수 정의, computed 같은 반응형 값
      if (/^(?:export )?const \w+(?:: [^=]+)? = (?:async )?(?:\([^)]*\)|\w+)(?:: [^=]+)? =>/.test(statement)) continue;
      if (/= (?:computed|watch|watchEffect)\b/.test(statement)) continue;
      wrong.push(`${rel}:${line} ${statement.split("\n")[0].slice(0, 80)}`);
    }
  }
  assert.deepEqual(wrong, []);
});
