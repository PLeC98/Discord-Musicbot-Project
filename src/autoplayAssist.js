"use strict";

// 자동재생 AI 보조 — 유튜브에서 찾아온 후보를 모델에게 한 번 더 물어본다.
//
// **소스가 아니라 뒷거름망이다.** 곡 이름만 아는 소스(키워드·Last.fm)에서만 쓸 자리가 있다.
// 주소를 직접 주는 소스(VocaDB·AnimeThemes·재생목록)는 출처가 곧 정답이라 물을 것이 없다.
//
// 실측(notes/research-autoplay-quality.md · 140곡 정답표, gemma3n:e2b)
//   규칙만        맞춘 비율 86% · 정밀도 79% · 재현율 97%
//   규칙 + 모델   맞춘 비율 95% · 정밀도 96% · 재현율 94%
//
// **없어도 되는 기능이다.** 못 부르면 규칙이 고른 것을 그대로 쓴다. 재생이 멈추지 않는다.

const config = require("../config");
const configData = require("./configDataLoader");
const log = require("./logger").child({ category: "autoplay" });

// 판정 기준을 그대로 글로 옮긴 것. **프롬프트가 성능의 거의 전부였다** —
// 같은 모델·같은 표본에서 이 글을 고쳐 맞춘 비율이 77% → 95%로 움직였다.
//
// 1차 프롬프트는 "믹스·플레이리스트·컴필레이션·라디오·강의·리뷰·예고편·랭킹영상이면 false"처럼
// 부정 목록을 늘어놓았는데, 그러면 "Avicii - Wake Me Up (Official Video)"까지 false 가 됐다.
// **"곡 하나냐 여러 곡이냐"로 묻고 예를 붙이는** 지금 모양이 훨씬 낫다.
const DEFAULT_PROMPT = `유튜브 검색 결과가 디스코드 음악봇의 자동재생에 쓸 만한지 판정한다.

song — 이 영상이 **곡 하나**를 담고 있는가?
  true : 뮤직비디오 · 공식 오디오 · 라이브 한 곡 · 애니 오프닝 한 곡
         클래식 교향곡이나 소나타는 20~40분이어도 작품 하나이므로 true
  false: 여러 곡을 이어 붙인 것(믹스 · 플레이리스트 · 메들리 · 컴필레이션 · 앨범 전곡 · 라디오)
         음악이 아닌 것(강의 · 리뷰 · 예고편 PV · 랭킹영상 · 동요 모음)

fits — 요청한 장르가 맞는가?
  아티스트와 곡을 알고 판단한다. 제목에 장르 이름이 들어 있어도 실제 장르가 다르면 false.
  장르가 "랜덤"이면 음악이기만 하면 true.

예)
  장르=록 제목=System Of A Down - Toxicity (Official HD Video) → song=true, fits=true
  장르=록 제목=LMFAO - Party Rock Anthem → song=true, fits=false (제목에 rock이 있지만 일렉트로닉이다)
  장르=팝 제목=Pop Hits 2021 - Ariana Grande, Maroon 5, Taylor Swift → song=false (여러 곡)
  장르=클래식 제목=Beethoven: Symphony No. 7 (41분) → song=true, fits=true (작품 하나)
  장르=로파이 제목=Maroon 5 - Girls Like You → song=true, fits=false (로파이가 아니다)

JSON 배열로만 답한다. 설명하지 않는다.
[{"n":1,"song":true,"fits":false}, ...]`;

const DEFAULTS = { temperature: 0, timeoutMs: 60000, batchSize: 10, skipConfident: true };

/** 지금 쓸 수 있나 — 설정을 읽는 유일한 곳이다(파일을 고치면 곧바로 반영된다). */
function settings() {
  const one = { ...DEFAULTS, ...configData.ai() };
  return one.enabled && one.baseUrl && one.model ? one : null;
}

// 업로더 이름은 **일부러 안 넘긴다.** 도움이 될 줄 알고 넣어 봤더니 fits 가 94% → 88% 로 떨어졌다.
// 유튜브의 그 칸은 토픽 트랙에서만 진짜 아티스트고 나머지는 채널 이름이다(`Vevo`·`Radio Mix`).
// 길이 칸 이름은 후보(durationSec)와 트랙(duration)이 다르다 — 둘 다 받는다
const lineOf = (one, genre, i) => `${i + 1}. 장르=${genre || "랜덤"} 길이=${Math.floor(Number(one.durationSec ?? one.duration ?? 0) / 60)}분 제목=${one.title}`;

/**
 * 후보 묶음을 모델에게 묻는다.
 * @returns {Promise<Array<{song: boolean, fits: boolean}|null>>} 후보와 같은 길이. 못 받은 자리는 null.
 */
async function askBatch(one, batch, genre) {
  const body = {
    model: one.model,
    temperature: Number(one.temperature),
    messages: [
      { role: "system", content: String(one.prompt || "").trim() || DEFAULT_PROMPT },
      { role: "user", content: batch.map((cand, i) => lineOf(cand, genre, i)).join("\n") },
    ],
    // 서비스마다 이름이 다른 것들(think · reasoning_effort …)은 설정에서 그대로 얹는다
    ...(one.extra && typeof one.extra === "object" ? one.extra : {}),
  };

  const res = await fetch(`${String(one.baseUrl).replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // 로컬 모델은 키를 안 받는다 — 없으면 헤더 자체를 안 붙인다
      ...(config.ai?.apiKey ? { Authorization: `Bearer ${config.ai.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Number(one.timeoutMs)),
  });

  // 본문을 오류에 싣지 않는다 — 어떤 서비스는 거절 응답에 보낸 헤더를 되비춘다
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const text = (await res.json())?.choices?.[0]?.message?.content || "";
  // 작은 모델은 ```json 울타리나 앞말을 곧잘 붙인다. 배열만 집어낸다.
  const found = text.match(/\[[\s\S]*\]/);
  if (!found) throw new Error("JSON 배열을 못 찾았습니다");

  const out = new Array(batch.length).fill(null);
  for (const verdict of JSON.parse(found[0])) {
    const at = Number(verdict?.n) - 1;
    if (at >= 0 && at < batch.length) out[at] = { song: !!verdict.song, fits: !!verdict.fits };
  }
  return out;
}

/**
 * 후보 목록에서 모델이 아니라고 한 것을 걸러낸다.
 *
 * **실패하면 받은 목록을 그대로 돌려준다.** 판정을 못 했다고 곡을 버리면, 모델이 죽었을 때
 * 자동재생이 통째로 멈춘다. 못 고르는 것보다 규칙만으로 고르는 편이 낫다.
 *
 * @param {Array<{title: string, durationSec?: number}>} candidates 순위가 매겨진 후보
 * @param {{genre?: string, confident?: boolean}} about
 */
async function filter(candidates, about = {}) {
  const one = settings();
  if (!one || !candidates?.length) return candidates || [];
  // 규칙이 이미 확신한다면 물을 이유가 없다(설정에서 끌 수 있다)
  if (one.skipConfident && about.confident) return candidates;

  const size = Math.max(1, Number(one.batchSize));
  const kept = [];
  try {
    for (let at = 0; at < candidates.length; at += size) {
      const batch = candidates.slice(at, at + size);
      const verdicts = await askBatch(one, batch, about.genre);
      // 답을 못 받은 자리는 살린다 — 모델이 빠뜨린 것을 떨어뜨릴 이유가 없다
      batch.forEach((cand, i) => {
        const verdict = verdicts[i];
        if (!verdict || (verdict.song && verdict.fits)) kept.push(cand);
      });
    }
  } catch (error) {
    log.debug(`AI 보조를 건너뜁니다(${error.message}) — 규칙만으로 고릅니다`);
    return candidates;
  }

  if (kept.length !== candidates.length) log.debug(`AI 보조: ${candidates.length}개 중 ${kept.length}개 남김${about.genre ? ` [${about.genre}]` : ""}`);
  // 전부 떨어졌다면 모델이 너무 박한 것이다. 규칙이 고른 것을 쓴다.
  return kept.length ? kept : candidates;
}

/**
 * 곡 하나를 물어본다 — 규칙이 이미 하나로 좁혀 놓은 자리(키워드 경로)용.
 *
 * `filter`와 달리 **아니라고 하면 정말로 버린다.** 목록이 아니라 한 곡이므로
 * "전부 떨어지면 되돌린다"가 성립하지 않는다. 대신 못 물어본 경우는 그대로 살린다.
 *
 * @returns {Promise<boolean>} 틀어도 되는가
 */
async function accepts(candidate, about = {}) {
  const one = settings();
  if (!one || !candidate) return true;
  if (one.skipConfident && about.confident) return true;

  try {
    const [verdict] = await askBatch(one, [candidate], about.genre);
    if (!verdict) return true; // 판정을 못 읽었다 — 버릴 근거가 없다
    if (verdict.song && verdict.fits) return true;
    log.debug(`AI 보조가 거름(${verdict.song ? "장르가 다름" : "곡 하나가 아님"})${about.genre ? ` [${about.genre}]` : ""}: ${candidate.title}`);
    return false;
  } catch (error) {
    log.debug(`AI 보조를 건너뜁니다(${error.message}) — 규칙만으로 고릅니다`);
    return true;
  }
}

/** 지금 설정으로 실제로 부를 수 있는지 한 번 재 본다. 대시보드의 "연결 확인" 버튼용. */
async function check() {
  const one = settings();
  if (!one) return { ok: false, reason: "꺼져 있거나 주소·모델이 비어 있습니다." };

  const started = Date.now();
  try {
    const verdicts = await askBatch(one, [{ title: "System Of A Down - Toxicity (Official HD Video)", durationSec: 210 }], "록");
    const took = Date.now() - started;
    if (!verdicts[0]) return { ok: false, reason: "답이 왔지만 판정을 못 읽었습니다.", tookMs: took };
    return { ok: true, tookMs: took, verdict: verdicts[0] };
  } catch (error) {
    return { ok: false, reason: error.message, tookMs: Date.now() - started };
  }
}

module.exports = { filter, accepts, check, settings, DEFAULT_PROMPT };
