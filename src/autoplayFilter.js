"use strict";

// 자동재생 후보를 걸러내는 규칙. 통과 여부뿐 아니라 **왜 떨어졌는지**를 돌려준다.
//
// 따로 빼 둔 이유: 실제 재생과 실측 도구가 같은 코드를 지나야 잰 것이 뜻을 갖는다.
// 도구가 로직을 베끼면 규칙을 고칠 때마다 어긋나고, 그러면 "무엇이 나아졌는지"를 말할 수 없다.
//
// 문턱은 짐작이 아니라 후보 840개를 세어 정했다. 연구 기록: notes/research-autoplay-quality.md

// 제목이 "여러 곡을 이어 붙인 것"임을 알리는 생김새. 옆의 숫자는 그 표식이 있을 때
// 실제로 한 곡이었던 비율이다(전체 평균은 82%). 낮을수록 센 표식이다.
const MIX_SHAPES = [
  ["연도 둘 이상", (t) => (t.match(/\b(19|20)\d\d\b/g) || []).length >= 2], // 0%
  ["쉼표 셋 이상", (t) => (t.match(/,/g) || []).length >= 3], // 7% — 아티스트를 나열한 컴필레이션
  ["이모지 둘 이상", (t) => (t.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length >= 2], // 15%
  ["시간 표기", (t) => /\b\d+\s*hours?\b|\d+\s*시간/i.test(t)], // 20%
  ["괄호 다섯 이상", (t) => (t.match(/[[\]【】]/g) || []).length >= 5],
];

// 이것이 제목에 있으면 위 생김새 규칙을 면제한다 — 셋 다 "한 곡"일 확률이 97~100%였다.
// (공식 뮤직비디오 제목에는 이모지도 괄호도 흔하다.)
const SONG_MARKS = /official|\bm\/?v\b|\bfe?a?t\.?\b/i;

// 낱말 경계를 쓸 수 있는 차단어인지 — 로마자·숫자·공백뿐이면 쓴다.
// 한국어·일본어에는 \b가 뜻대로 동작하지 않으므로 그때는 그냥 포함 여부를 본다.
const ASCII_WORD = /^[a-z0-9 '&.-]+$/;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 설정에서 판정에 필요한 것만 미리 꺼내 둔다 — 후보마다 다시 만들 이유가 없다.
function prepare(cfg) {
  const blocked = [];
  for (const raw of cfg?.blockedKeywords || []) {
    // 제목을 소문자로 낮춰 견주므로 차단어도 낮춰 둔다
    const word = String(raw).trim().toLowerCase();
    if (!word) continue;
    // 낱말 경계를 붙여야 "mix"가 "remix"를 죽이지 않는다. 설정에 공백을 넣어 두는 것으로는 안 된다
    // — 대시보드가 앞뒤 공백을 떼기 때문이다.
    blocked.push({ word, test: ASCII_WORD.test(word) ? new RegExp(`\\b${escape(word)}\\b`) : null });
  }

  return {
    minSec: Number(cfg?.minDurationSec ?? 0),
    maxSec: cfg?.maxDurationSec == null ? Infinity : Number(cfg.maxDurationSec),
    blocked,
  };
}

/**
 * @returns {{ok: boolean, reason?: string, detail?: string}}
 */
function judge(track, limits) {
  // 길이를 모르는 것은 대개 라이브다
  if (!track?.duration) return { ok: false, reason: "길이 없음" };
  if (track.duration < limits.minSec) return { ok: false, reason: "너무 짧음" };
  if (track.duration > limits.maxSec) return { ok: false, reason: "너무 긺" };

  const title = (track.title || "").toLowerCase();

  // 차단어는 곡 표식이 있어도 면제하지 않는다 — "공식 믹스"도 믹스다
  const blocked = limits.blocked.find((b) => (b.test ? b.test.test(title) : title.includes(b.word)));
  if (blocked) return { ok: false, reason: "차단어", detail: blocked.word };

  if (SONG_MARKS.test(title)) return { ok: true };

  const shape = MIX_SHAPES.find(([, test]) => test(title));
  if (shape) return { ok: false, reason: "믹스 생김새", detail: shape[0] };

  return { ok: true };
}

module.exports = { prepare, judge };
