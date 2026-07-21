"use strict";

// match-probe — Spotify 링크(또는 "제목 | 아티스트 | 길이초")를 넣으면
// 유튜브에서 무엇을 받고, 새 점수 알고리즘이 무엇을 왜 고르는지 보여주는 검사 도구.
//
// 사용법:
//   node scripts/match-probe.js "https://open.spotify.com/track/...."
//   node scripts/match-probe.js "https://open.spotify.com/track/..." --expect 2ZoIHGC-xZU
//   node scripts/match-probe.js "Shadow Shadow | Azari | 141"        (수동 입력)
//   node scripts/match-probe.js --file cases.txt                     (한 줄에 하나씩)
//
// 여러 케이스: 인자를 여러 개 주거나 --file 로 배치. 각 줄 끝에 "@@ <videoId>" 로
// 기대 정답을 적으면 일치 여부를 표시한다.

const Spotify = require("../src/Spotify");
const YouTube = require("../src/YouTube");
const { rankCandidates } = require("../src/youtubeMatch");

// 실제 재생 경로가 쓰는 검색 쿼리 사다리 (첫 결과가 나오는 쿼리에서 멈춤)
function buildQueries(title, artist) {
  return [`"${title}" "${artist}"`, `${title} ${artist}`, `${title}`];
}

function bar(n) {
  const v = Math.round(n);
  if (v === 0) return "0";
  return (v > 0 ? "+" : "") + v;
}

function fmtBreakdown(b) {
  return `rank ${bar(b.rank)} | ch ${bar(b.channel)} | dur ${bar(b.duration)} | junk ${bar(b.junk)} | title ${bar(b.title)} | artist ${bar(b.artistInTitle)} | off ${bar(b.officialTag)}`;
}

async function resolveTarget(input) {
  // 수동 입력: "제목 | 아티스트 | 길이초"
  if (input.includes("|")) {
    const [title, artist, dur] = input.split("|").map((s) => s.trim());
    return { title, artist, durationSec: Number(dur) || 0, source: "manual" };
  }
  // Spotify URL
  if (Spotify.isSpotifyURL(input)) {
    const tracks = await Spotify.getFromURL(input);
    const t = tracks && tracks[0];
    if (!t) throw new Error("Spotify 메타데이터 조회 실패 (키/네트워크 확인)");
    return { title: t.title, artist: t.artist, durationSec: t.duration, isrc: t.isrc, source: "spotify" };
  }
  throw new Error(`알 수 없는 입력: ${input}`);
}

async function probeOne(input, expectId) {
  console.log("\n" + "═".repeat(78));
  const target = await resolveTarget(input);
  console.log(`입력: ${input}`);
  console.log(`타겟: title="${target.title}"  artist="${target.artist}"  duration=${target.durationSec}s  ${target.isrc ? "isrc=" + target.isrc : ""}`);

  // 검색 사다리: 첫 결과 나오는 쿼리 채택
  let candidates = [];
  let usedQuery = null;
  for (const q of buildQueries(target.title, target.artist)) {
    const results = await YouTube.search(q, 6);
    if (results && results.length) {
      usedQuery = q;
      candidates = results.map((r) => ({ id: r.id, url: r.url, title: r.title, channel: r.artist, durationSec: r.duration }));
      break;
    }
  }
  console.log(`검색 쿼리: ${JSON.stringify(usedQuery)}  → 후보 ${candidates.length}개\n`);

  if (!candidates.length) {
    console.log("  (결과 없음)");
    return { input, pickedId: null, expectId, ok: null };
  }

  const { ranked, best, confidence } = rankCandidates(candidates, target);
  const pickedId = best ? best.id : null;

  // 점수순 출력
  ranked.forEach((r) => {
    const c = r.candidate;
    const isPick = c.id === pickedId;
    const marker = isPick ? "▶" : " ";
    const expectMark = expectId && c.id === expectId ? " ★기대정답" : "";
    console.log(`${marker} [점수 ${String(Math.round(r.score)).padStart(4)}] yt#${r.index} id=${c.id}${expectMark}`);
    console.log(`    제목: "${c.title}"`);
    console.log(`    채널: "${c.channel}"  길이: ${c.durationSec}s  ${r.flags.channelMatch ? "채널일치" + (r.flags.channelExact ? "(정확)" : "") : ""} ${r.flags.official ? "공식계열" : ""} ${r.flags.junk ? "정크x" + r.flags.junk : ""}`.trimEnd());
    console.log(`    ${fmtBreakdown(r.breakdown)}`);
  });

  console.log(`\n  → 선택: id=${pickedId}  (신뢰도: ${confidence})`);
  let ok = null;
  if (expectId) {
    ok = pickedId === expectId;
    console.log(`  → 기대: id=${expectId}  ⇒  ${ok ? "✅ 일치" : "❌ 불일치"}`);
  }
  return { input, pickedId, expectId, ok, confidence };
}

async function main() {
  const argv = process.argv.slice(2);
  const inputs = [];

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file") {
      const fs = require("fs");
      const lines = fs
        .readFileSync(argv[++i], "utf8")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"));
      for (const line of lines) {
        const [inp, exp] = line.split("@@").map((s) => s.trim());
        inputs.push({ input: inp, expectId: exp || null });
      }
    } else if (argv[i] === "--expect") {
      // 직전 입력에 기대값 부착
      if (inputs.length) inputs[inputs.length - 1].expectId = argv[++i];
    } else {
      inputs.push({ input: argv[i], expectId: null });
    }
  }

  if (!inputs.length) {
    console.log('사용법: node scripts/match-probe.js "<spotify-url 또는 제목 | 아티스트 | 길이초>" [--expect <videoId>] [--file cases.txt]');
    process.exit(1);
  }

  const summary = [];
  for (const { input, expectId } of inputs) {
    try {
      summary.push(await probeOne(input, expectId));
    } catch (e) {
      console.log(`\n❌ 오류(${input}): ${e.message}`);
      summary.push({ input, pickedId: null, expectId, ok: false });
    }
  }

  if (summary.length > 1) {
    console.log("\n" + "═".repeat(78));
    console.log("요약:");
    for (const s of summary) {
      const mark = s.ok === null ? "·" : s.ok ? "✅" : "❌";
      console.log(`  ${mark} ${s.input}  → ${s.pickedId ?? "없음"}${s.expectId ? " (기대 " + s.expectId + ")" : ""}`);
    }
    const graded = summary.filter((s) => s.ok !== null);
    if (graded.length) console.log(`\n  정답률: ${graded.filter((s) => s.ok).length}/${graded.length}`);
  }
}

main();
