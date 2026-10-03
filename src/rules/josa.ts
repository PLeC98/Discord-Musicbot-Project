// 조사 고르기. 앞말이 받침으로 끝나는지 보고 을/를 · 은/는 · 이/가 · 으로/로 를 고른다. 모르면 괄호 꼴(을(를))로 둔다.
// 앞말은 문장에 넣기 전의 값(곡 제목 · 장르 이름 등)을 넘긴다. 링크 · 굵은 글씨 같은 꾸밈을 씌우기 전이다.
//
// 끝소리를 읽는 법:
//   끝의 공백 · 괄호 · 따옴표 · 기호는 건너뛰고 그 앞 글자를 본다("곡 (Live)" 는 Live).
//   한글은 받침, 숫자는 읽는 소리(자릿수까지: 10 십 · 100 백 · 10000 만), 소수는 마지막 자리 숫자.
//   영어는 발음 사전(CMU)의 마지막 소리에 외래어 표기법을 따른다(짧은 모음 뒤의 p · t · k 는 받침, 그 밖의 자음은 "으" 가 붙어 받침이 없다).
//   사전에 없는 말은 철자로 어림하고, 사전에 없는 대문자 약어는 글자 이름(BTS 의 S 는 에스)으로 읽는다(rules/english-final).
//   사전은 그 어림과 답이 다른 낱말만 뽑은 표(data/english-finals.json)로 들고 있다.
//   일본어 가나는 ん 이면 ㄴ, っ 면 ㅅ, 장음 ー · 작은 가나 · 그 밖의 가나는 받침이 없다. 반복 기호는 앞 글자를 따른다.
//   한자는 일본어 읽기가 모두 같은 쪽으로 끝나는 것만 안다(data/kanji-finals.json, 유니코드 Unihan 에서 만든 표). 갈리면 모른다.

// 브라우저(대시보드)도 쓴다. Node 에 기대는 것이 없다

import KANJI from "../../data/kanji-finals.json" with { type: "json" };
import ENGLISH from "../../data/english-finals.json" with { type: "json" };
import { letterFinal, spellingFinal } from "./english-final.ts";

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

// 한자. 일본어 읽기가 모두 같은 쪽으로 끝나는 것만 안다. 표(KANJI)의 endsN 은 읽기가 모두 ん 으로, endsVowel 은 모두 모음으로 끝나는 한자.
// 표는 scripts/build-kanji-finals.ts 가 만든다
function kanjiFinal(ch: string): Final {
  if (!/\p{Script=Han}/u.test(ch)) return null;
  if (KANJI.endsN.includes(ch)) return "final";
  if (KANJI.endsVowel.includes(ch)) return "none";
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

// 철자 어림과 답이 다른 낱말 → 사전의 끝소리
const ENGLISH_FINALS = new Map<string, Final>((["final", "rieul", "none"] as const).flatMap((final) => (ENGLISH[final] ? ENGLISH[final].split(" ") : []).map((word): [string, Final] => [word, final])));

// 영문자로만 된 낱말. 표에 있으면 사전의 답, 사전에 있는 대문자 약어(모음이 있는 것)는 낱말로 읽는다(표에 없으면 글자 이름과 같다)
function englishFinal(word: string): Final {
  const known = ENGLISH_FINALS.get(word.toLowerCase());
  if (/^[A-Z]{1,5}$/.test(word) && (known === undefined || !/[AEIOUY]/.test(word))) return letterFinal(word);
  return known ?? spellingFinal(word.toLowerCase());
}

export { josa, finalOf };
export const _internals = { englishFinal };
export type { Particle, Final };
