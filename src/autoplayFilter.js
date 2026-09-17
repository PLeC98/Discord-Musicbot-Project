"use strict";

// 자동재생 후보를 걸러내는 규칙. 통과 여부뿐 아니라 **왜 떨어졌는지**를 돌려준다.
//
// 따로 빼 둔 이유: 실제 재생과 실측 도구가 같은 코드를 지나야 잰 것이 뜻을 갖는다.
// 도구가 로직을 베끼면 규칙을 고칠 때마다 어긋나고, 그러면 "무엇이 나아졌는지"를 말할 수 없다.
// 연구 메모: notes/research-autoplay-quality.md

// 설정에서 판정에 필요한 것만 미리 꺼내 둔다 — 후보마다 다시 만들 이유가 없다.
function prepare(cfg) {
  return {
    minSec: Number(cfg?.minDurationSec ?? 0),
    maxSec: cfg?.maxDurationSec == null ? Infinity : Number(cfg.maxDurationSec),
    // 제목을 소문자로 낮춰 견주므로 차단어도 낮춰 둔다
    blocked: (cfg?.blockedKeywords || []).map((keyword) => String(keyword).toLowerCase()),
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

  // 부분 문자열 판정이다 — "mix"가 "remix"를 잡는 성질이 여기서 나온다
  const blocked = limits.blocked.find((keyword) => title.includes(keyword));
  if (blocked) return { ok: false, reason: "차단어", detail: blocked };

  // 믹스·모음은 제목에 이모지나 괄호가 많은 경우가 잦다는 어림짐작(원류에서 내려온 값)
  const emojiCount = (title.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
  if (emojiCount > 3) return { ok: false, reason: "이모지 과다", detail: String(emojiCount) };

  const bracketCount = (title.match(/[[\]【】]/g) || []).length;
  if (bracketCount > 4) return { ok: false, reason: "괄호 과다", detail: String(bracketCount) };

  return { ok: true };
}

module.exports = { prepare, judge };
