// 조사 헬퍼(rules/josa)가 쓰는 영어 끝소리 표(data/english-finals.json)를 만든다. 손으로 실행한다. postinstall이나 빌드에 걸려 있지 않다.
//   node scripts/build-english-finals.ts
//
// 원본은 CMU 발음 사전(개발 의존성 cmu-pronouncing-dictionary)이다. 조사 헬퍼는 사전에 없는 말을 철자로 어림하고 대문자 약어는 글자 이름으로 읽으므로,
// 표에는 그 어림과 사전의 답이 다른 낱말만 넣는다. 사전 전체를 들고 있을 때와 판정이 같다(test/rules/english-finals.test.ts 가 낱말마다 본다).
// 결과물은 저장소에 넣고, 출처와 라이선스는 data/NOTICE 에 적는다.

import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { PROJECT } from "../src/infra/project-paths.ts";
import { tableOf } from "../src/rules/english-final.ts";

const OUT = path.join(PROJECT.data, "english-finals.json");

const { dictionary } = await import("cmu-pronouncing-dictionary");
const { version } = createRequire(import.meta.url)("cmu-pronouncing-dictionary/package.json") as { version: string };

const table = tableOf(dictionary, `cmu-pronouncing-dictionary ${version}`);
fs.writeFileSync(OUT, `${JSON.stringify(table)}\n`);
const count = (words: string) => (words ? words.split(" ").length : 0);
console.log(`사전 ${Object.keys(dictionary).length}낱말 → 받침 ${count(table.final)} · ㄹ ${count(table.rieul)} · 받침 없음 ${count(table.none)} → ${path.relative(process.cwd(), OUT)}`);
