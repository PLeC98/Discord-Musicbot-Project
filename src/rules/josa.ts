// 조사 고르기. 앞말이 받침으로 끝나는지 보고 을/를 · 은/는 · 이/가 · 으로/로 를 고른다. 모르면 괄호 꼴(을(를))로 둔다.
// 앞말은 문장에 넣기 전의 값(곡 제목 · 장르 이름 등)을 넘긴다. 링크 · 굵은 글씨 같은 꾸밈을 씌우기 전이다.
//
// 끝소리를 읽는 법:
//   끝의 공백 · 괄호 · 따옴표 · 기호는 건너뛰고 그 앞 글자를 본다("곡 (Live)" 는 Live).
//   한글은 받침, 숫자는 읽는 소리(자릿수까지: 10 십 · 100 백 · 10000 만), 소수는 마지막 자리 숫자.
//   영어는 발음 사전(CMU)의 마지막 소리에 외래어 표기법을 따른다(짧은 모음 뒤의 p · t · k 는 받침, 그 밖의 자음은 "으" 가 붙어 받침이 없다).
//   사전에 없는 말은 철자로 어림하고, 사전에 없는 대문자 약어는 글자 이름(BTS 의 S 는 에스)으로 읽는다.
//   일본어 가나는 ん 이면 ㄴ, っ 면 ㅅ, 장음 ー · 작은 가나 · 그 밖의 가나는 받침이 없다. 반복 기호는 앞 글자를 따른다.
//   한자는 일본어 읽기가 모두 같은 쪽으로 끝나는 것만 안다(data/kanji-finals.json, 유니코드 Unihan 에서 만든 표). 갈리면 모른다.

import fs from "fs";
import path from "path";
import { createRequire } from "module";

/** 끝소리. none 받침 없음, final 받침(ㄹ 아님), rieul ㄹ 받침, null 모름 */
type Final = "none" | "final" | "rieul" | null;
/** 고를 조사. 받침이 있을 때의 꼴로 부른다 */
type Particle = "을" | "은" | "이" | "으로";

// [받침 있음, 받침 없음, 모름]. 으로는 ㄹ 받침 뒤에서도 로
const FORMS: Record<Particle, [string, string, string]> = {
  을: ["을", "를", "을(를)"],
  은: ["은", "는", "은(는)"],
  이: ["이", "가", "이(가)"],
  으로: ["으로", "로", "(으)로"],
};

/** word 뒤에 붙일 조사 */
function josa(word: string, particle: Particle) {
  const [after, plain, unknown] = FORMS[particle];
  const final = finalOf(word);
  if (final === null) return unknown;
  if (final === "none" || (final === "rieul" && particle === "으로")) return plain;
  return after;
}

// ── 끝소리 ──

// 끝에서 건너뛸 것: 공백 · 문장 부호(괄호 · 따옴표 포함) · 기호(이모지 포함) · 이모지 꾸밈(변형 선택자 · 결합 문자)
const TRAILING = /[\s\p{P}\p{S}\p{M}‍]+$/u;

/** 앞말의 끝소리 */
function finalOf(word: string): Final {
  const text = word.normalize("NFKC").replace(TRAILING, "");
  const chars = [...text];
  const last = chars.at(-1);
  if (!last) return null;
  if (/[0-9]/.test(last)) return numberFinal(text);
  if (/[A-Za-z]/.test(last)) return englishFinal(/[A-Za-z]+$/.exec(text)?.[0] ?? last);
  return charFinal(chars, chars.length - 1);
}

// 글자 하나(앞 글자를 따르는 반복 기호는 거슬러 올라간다)
function charFinal(chars: string[], at: number): Final {
  const ch = chars[at];
  if (ch === undefined) return null;
  // 앞 글자를 되풀이하는 기호: ゝ ゞ ヽ ヾ 々
  if ("ゝゞヽヾ々".includes(ch)) return charFinal(chars, at - 1);
  return hangulFinal(ch) ?? kanaFinal(ch) ?? kanjiFinal(ch);
}

// 한글 음절의 받침. 한글 음절이 아니면 null
function hangulFinal(ch: string): Final {
  const code = ch.codePointAt(0) ?? 0;
  if (code < 0xac00 || code > 0xd7a3) return null;
  const jong = (code - 0xac00) % 28;
  return jong === 0 ? "none" : jong === 8 ? "rieul" : "final";
}

// 가나. ん · っ 만 받침이 있다(장음 · 작은 가나 포함 그 밖은 없다). 가나가 아니면 null
function kanaFinal(ch: string): Final {
  const code = ch.codePointAt(0) ?? 0;
  if (code < 0x3041 || code > 0x30ff) return null;
  return "んンっッ".includes(ch) ? "final" : "none";
}

// 한자 표. endsN 은 읽기가 모두 ん 으로, endsVowel 은 모두 모음으로 끝나는 한자. scripts/build-kanji-finals.ts 가 만든다
const KANJI_FILE = path.join(import.meta.dirname, "..", "..", "data", "kanji-finals.json");
let kanji: { endsN: string; endsVowel: string } | null = null;

// 한자. 일본어 읽기가 모두 같은 쪽으로 끝나는 것만 안다. 표는 한자를 처음 만났을 때 한 번 읽는다
function kanjiFinal(ch: string): Final {
  if (!/\p{Script=Han}/u.test(ch)) return null;
  kanji ??= JSON.parse(fs.readFileSync(KANJI_FILE, "utf8")) as { endsN: string; endsVowel: string };
  if (kanji.endsN.includes(ch)) return "final";
  if (kanji.endsVowel.includes(ch)) return "none";
  return null;
}

// ── 숫자 ──

// 한 자리 숫자를 읽은 소리의 끝: 영 일 이 삼 사 오 육 칠 팔 구
const DIGIT: Final[] = ["final", "rieul", "none", "final", "none", "none", "final", "rieul", "rieul", "none"];
// 끝의 0 이 네 개 이상이면 마지막 자리는 네 자리마다 만(ㄴ) · 억(ㄱ) · 조 · 경(ㅇ)이다(100000 은 십만)
const MYRIADS: Final[] = ["final", "final", "none", "final"];

function numberFinal(text: string): Final {
  const number = /[0-9][0-9,]*(?:\.[0-9]+)?$/.exec(text)?.[0].replaceAll(",", "") ?? "";
  // 소수점 아래는 한 자리씩 읽는다
  if (number.includes(".")) return DIGIT[Number(number.at(-1))];
  if (/^0+$/.test(number)) return DIGIT[0];
  const zeros = number.length - number.replace(/0+$/, "").length;
  if (zeros === 0) return DIGIT[Number(number.at(-1))];
  // 십(ㅂ) · 백(ㄱ) · 천(ㄴ)
  if (zeros <= 3) return "final";
  return MYRIADS[Math.min(Math.floor(zeros / 4), MYRIADS.length) - 1];
}

// ── 영어 ──

let dictionary: Record<string, string> | null = null;
// 발음 사전(13만여 낱말, 약 5MB). 영어로 끝나는 말을 처음 만났을 때 한 번 읽는다
function pronunciation(word: string) {
  dictionary ??= (createRequire(import.meta.url)("cmu-pronouncing-dictionary") as { dictionary: Record<string, string> }).dictionary;
  return dictionary[word.toLowerCase()] ?? null;
}

// 짧은 모음(외래어 표기법: 짧은 모음 뒤의 어말 무성 파열음은 받침으로 적는다)
const SHORT_VOWELS = new Set(["AE", "EH", "IH", "AH", "UH", "AA"]);
const VOWELS = new Set(["AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"]);
// 대문자 약어를 글자 이름으로 읽은 끝: L 엘 · R 알 은 ㄹ, M 엠 · N 엔 은 받침, 그 밖(에이 · 비 · 에스 · 티 …)은 받침 없음
const LETTER: Record<string, Final> = { L: "rieul", R: "rieul", M: "final", N: "final" };

function englishFinal(word: string): Final {
  const said = pronunciation(word);
  const acronym = /^[A-Z]{1,5}$/.test(word) && (!said || !/[AEIOUY]/.test(word));
  if (acronym) return LETTER[word.at(-1) ?? ""] ?? "none";
  if (said) return phonemeFinal(said.split(" ").map((p) => p.replace(/\d/, "")));
  return spellingFinal(word.toLowerCase());
}

function phonemeFinal(phones: string[]): Final {
  const last = phones.at(-1) ?? "";
  if (VOWELS.has(last)) return "none";
  if (last === "L") return "rieul";
  if (last === "M" || last === "N" || last === "NG") return "final";
  if (last === "P" || last === "T" || last === "K") return SHORT_VOWELS.has(phones.at(-2) ?? "") ? "final" : "none";
  return "none";
}

// 사전에 없는 말. 마지막 철자로 어림한다
function spellingFinal(word: string): Final {
  if (word.endsWith("ng") || /[mn]$/.test(word)) return "final";
  if (word.endsWith("l")) return "rieul";
  if (word.endsWith("ck")) return "final";
  // 자음 + 모음 하나 + p · t · k (hit · pop · rock)
  if (/(^|[^aeiou])[aeiou][ptk]$/.test(word)) return "final";
  return "none";
}

export { josa, finalOf };
export type { Particle, Final };
