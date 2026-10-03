// 영어 낱말의 끝소리. 발음(ARPAbet)의 마지막 소리에 외래어 표기법을 따르는 법, 사전에 없는 말을 철자로 어림하는 법, 대문자 약어를 글자 이름으로 읽는 법.
// 조사 도우미(rules/josa)와 그 표를 만드는 스크립트(scripts/build-english-finals.ts)가 같이 쓴다

import type { Final } from "./josa.ts";

// 짧은 모음(외래어 표기법: 짧은 모음 뒤의 어말 무성 파열음은 받침으로 적는다)
const SHORT_VOWELS = new Set(["AE", "EH", "IH", "AH", "UH", "AA"]);
const VOWELS = new Set(["AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"]);
// 대문자 약어를 글자 이름으로 읽은 끝: L 엘 · R 알 은 ㄹ, M 엠 · N 엔 은 받침, 그 밖(에이 · 비 · 에스 · 티 …)은 받침 없음
const LETTER: Record<string, Final> = { L: "rieul", R: "rieul", M: "final", N: "final" };

/** 발음(강세 숫자를 뗀 ARPAbet 소리들)의 끝소리 */
function phonemeFinal(phones: string[]): Final {
  const last = phones.at(-1) ?? "";
  if (VOWELS.has(last)) return "none";
  if (last === "L") return "rieul";
  if (last === "M" || last === "N" || last === "NG") return "final";
  if (last === "P" || last === "T" || last === "K") return SHORT_VOWELS.has(phones.at(-2) ?? "") ? "final" : "none";
  return "none";
}

/** 사전에 없는 말(소문자). 마지막 철자로 어림한다 */
function spellingFinal(word: string): Final {
  if (word.endsWith("ng") || /[mn]$/.test(word)) return "final";
  if (word.endsWith("l")) return "rieul";
  if (word.endsWith("ck")) return "final";
  // 자음 + 모음 하나 + p · t · k (hit · pop · rock)
  if (/(^|[^aeiou])[aeiou][ptk]$/.test(word)) return "final";
  return "none";
}

/** 대문자 약어를 글자 이름으로 읽은 끝(BTS 의 S 는 에스) */
const letterFinal = (word: string): Final => LETTER[word.at(-1)?.toUpperCase() ?? ""] ?? "none";

/** 표: 끝소리마다 낱말을 띄어 쓴 줄. source 는 원본 표기(data/NOTICE 의 출처 줄과 맞춘다) */
type EnglishFinals = { source: string; final: string; rieul: string; none: string };

/**
 * 발음 사전(소문자 낱말 → ARPAbet)에서 표를 만든다. 조사 도우미가 사전에 묻는 말은 영문자로만 된 낱말이다.
 * 넣는 것: 철자 어림과 답이 다른 낱말, 그리고 다섯 글자 이하에 모음이 있는 낱말 가운데 글자 이름으로 읽은 끝과 답이 다른 것
 * (사전에 있는 대문자 약어는 낱말로 읽는다. 표에 없으면 글자 이름과 답이 같다)
 */
function tableOf(dictionary: Record<string, string>, source: string): EnglishFinals {
  const words: Record<"final" | "rieul" | "none", string[]> = { final: [], rieul: [], none: [] };
  for (const word of Object.keys(dictionary).sort()) {
    if (!/^[a-z]+$/.test(word)) continue;
    const said = phonemeFinal(dictionary[word].split(" ").map((p) => p.replace(/\d/, "")));
    const asAcronym = word.length <= 5 && /[aeiouy]/.test(word) && said !== letterFinal(word);
    if (said && (said !== spellingFinal(word) || asAcronym)) words[said].push(word);
  }
  return { source, final: words.final.join(" "), rieul: words.rieul.join(" "), none: words.none.join(" ") };
}

export { phonemeFinal, spellingFinal, letterFinal, tableOf };
export type { EnglishFinals };
