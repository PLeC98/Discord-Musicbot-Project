// 조사 도우미(rules/josa)가 쓰는 한자 표를 만든다. 손으로 실행한다. postinstall이나 빌드에 걸려 있지 않다.
//   node scripts/build-kanji-finals.ts
//
// 원본은 유니코드 Unihan 데이터베이스의 일본어 읽기(kJapaneseOn 음독 · kJapaneseKun 훈독, 로마자)다.
// 한자마다 읽기가 모두 ん(로마자 끝 N)으로 끝나면 "ㄴ 받침", 모두 아니면 "받침 없음"으로 나누고, 갈리면 표에 넣지 않는다
// (그 한자로 끝나는 말은 조사를 괄호 꼴로 둔다). 실행에는 인터넷이 필요하다. 결과물은 저장소에 넣는다.

import fs from "fs";
import path from "path";
import zlib from "zlib";

const SOURCE = "https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip";
const ENTRY = "Unihan_Readings.txt";
const OUT = path.join(import.meta.dirname, "..", "src", "rules", "kanjiFinals.ts");

// zip 안의 파일 하나를 꺼낸다. 중앙 디렉터리에서 크기와 위치를 읽고 deflate 를 푼다
function unzipEntry(zip: Buffer, name: string) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("zip 끝 표지가 없다");
  let at = zip.readUInt32LE(end + 16);
  const count = zip.readUInt16LE(end + 10);
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    if (zip.toString("utf8", at + 46, at + 46 + nameLength) === name) {
      const data = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const body = zip.subarray(data, data + size);
      return method === 8 ? zlib.inflateRawSync(body) : body;
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`${name} 이 zip 에 없다`);
}

const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`${SOURCE} → ${response.status}`);
const text = unzipEntry(Buffer.from(await response.arrayBuffer()), ENTRY).toString("utf8");

const header = text.split("\n").slice(0, 3).join(" ");
const version = /Unicode Version ([\d.]+)/.exec(header)?.[1];
const date = /Date: (\d{4}-\d{2}-\d{2})/.exec(header)?.[1];
if (!version || !date) throw new Error(`판 표기를 읽지 못했다: ${header}`);

const readings = new Map<number, string[]>();
for (const line of text.split("\n")) {
  if (line.startsWith("#")) continue; // 머리 설명(칸 이름도 탭으로 적혀 있다)
  const [cp, field, value] = line.split("\t");
  if (field !== "kJapaneseOn" && field !== "kJapaneseKun") continue;
  const code = Number.parseInt(cp.slice(2), 16);
  readings.set(code, [...(readings.get(code) ?? []), ...value.trim().split(/\s+/)]);
}

let endsN = "";
let endsVowel = "";
for (const [code, list] of [...readings].sort(([a], [b]) => a - b)) {
  const n = list.filter((r) => r.toUpperCase().endsWith("N")).length;
  if (n === list.length) endsN += String.fromCodePoint(code);
  else if (n === 0) endsVowel += String.fromCodePoint(code);
}

const out = `// 생성 파일. scripts/build-kanji-finals.ts 가 만든다. 손으로 고치지 않는다.
// 한자의 일본어 읽기(음독 · 훈독)가 모두 ん 으로 끝나는 것과 모두 모음으로 끝나는 것. 갈리는 한자는 어느 쪽에도 없다.
// 원본: Unicode Character Database, ${ENTRY} (Unicode ${version}, ${date}). Copyright © 1991-${date.slice(0, 4)} Unicode, Inc.
// Unicode License v3 에 따라 쓴다. 고지는 NOTICE.md

/** 읽기가 모두 ん 으로 끝나는 한자(${[...endsN].length}자) */
const ENDS_N = ${JSON.stringify(endsN)};
/** 읽기가 모두 모음으로 끝나는 한자(${[...endsVowel].length}자) */
const ENDS_VOWEL = ${JSON.stringify(endsVowel)};

export { ENDS_N, ENDS_VOWEL };
`;
fs.writeFileSync(OUT, out);
console.log(`Unicode ${version} (${date}): ん ${[...endsN].length}자 · 모음 ${[...endsVowel].length}자 → ${path.relative(process.cwd(), OUT)}`);
