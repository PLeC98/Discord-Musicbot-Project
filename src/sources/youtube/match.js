// youtubeMatch. Spotify/외부 트랙의 YouTube 동등물을 "점수제"로 고르는 순수 로직 + 쿼리 구성.
// 실제 검색(YouTube.search)은 호출측(probe · youtube/equivalent)이 하고, 결과 병합은 mergeCandidateLists로.

// ── 튜닝 가능한 가중치 ─────────────────────────────────────────────────────
const RANK_BASE = 8; // 순위 점수 = max(0, RANK_BASE - rank) * rankPerPosition
const SECONDARY_OFFSET = 8; // 보조 쿼리(제목만)에서만 나온 후보는 순위를 이만큼 뒤로 밀어 오염을 억제
const W = {
  rankPerPosition: 12, // 유튜브 순위 1칸당 (지배적 신호)
  channelMatch: 12, // 채널명이 아티스트와 일치 (타이브레이커. 흔한 이름의 우연 일치가 순위를 못 뒤집게)
  channelOfficialBonus: 4, // 일치 + "- Topic"/VEVO면 추가
  channelOfficialStandalone: 12, // 이름 불일치여도 "- Topic"/VEVO(공식 아트트랙 계열)면 가점 (스크립트/로마자 차이)
  durNear: 22, // 길이 차 ≤ 4초 (같은 마스터. 강한 신호, 정크 면제까지)
  durClose: 8, // 길이 차 ≤ 12초 (MV 인트로/아웃트로 여유)
  durLoose: 0, // 길이 차 ≤ 30초 (중립)
  durFar: -20, // 그 이상 (의심스럽지만 실격 아님)
  durFarLong: -8, // 그중 후보가 **더 긴** 경우. 공식 MV는 인트로/아웃트로로 30~50초 길다.
  //                 짧은 쪽(클립·TV size)이 훨씬 의심스러우므로 둘을 갈라 본다.
  durGross: -400, // 명백한 불일치(1시간 루프/확장본/짤) → 사실상 실격
  junkEach: -12, // 커버 등 제3자 파생 용어 1개당 (약한 타이브레이커; 길이 정확/본인채널이면 면제)
  versionEach: -30, // 다른 버전(영어판/라이브/인스트) 1개당. **면제 없음**, 아래 설명 참조
  reuploadEach: -20, // 가사·자막 재배포 영상 (공식 채널이면 면제. 공식 Lyric Video가 정답인 경우가 있다)
  titleHasTrack: 3, // 후보 제목에 곡 제목 포함
  titleHasArtist: 3, // 후보 제목에 아티스트명 포함
  titleOfficialTag: 4, // 후보 제목에 "official video/audio/mv" 등
};

// 제3자가 만든 파생물 (곡 제목 자체에 들어 있으면 감점하지 않음).
// 공식 채널이 올릴 리 없는 것들이라, 업로더가 본인이면 감점을 면제해도 안전하다.
const JUNK_TERMS = [
  "cover",
  "covered",
  "nightcore",
  "sped up",
  "sped-up",
  "slowed",
  "reverb",
  "8bit",
  "8 bit",
  "chiptune",
  "reaction",
  "mashup",
  "1 hour",
  "one hour",
  "loop",
  "tutorial",
  "lesson",
  "歌ってみた", // 우타이테 커버
  "弾いてみた", // 연주해봄
  "叩いてみた",
  "カバー",
  "作業用",
  "耳コピ",
  "커버",
];

// 같은 곡의 다른 버전 (곡 제목 자체에 들어 있으면 감점하지 않음).
// "공식 업로더면 면제"를 그대로 적용하면 영어판·인스트·라이브가 원곡을 이길 수 있음
// 이쪽은 업로더가 누구든, 길이가 얼마나 맞든 면제하지 않는다.
const VERSION_TERMS = [
  // 언어 버전. 가사도 보컬도 다른 곡이다
  "english ver",
  "english version",
  "eng ver",
  "japanese ver",
  "japanese version",
  "jp ver",
  "korean ver",
  "korean version",
  "kr ver",
  "chinese ver",
  "chinese version",
  "mandarin ver",
  "spanish ver",
  "英語版",
  "英語ver",
  "日本語版",
  "日本語ver",
  "韓国語版",
  "中国語版",
  "영어버전",
  "영어판",
  "일본어버전",
  "일본어판",
  "한국어버전",
  "한국어판",
  // 편곡·연주 형태
  "remix",
  "リミックス",
  "리믹스",
  "instrumental",
  "off vocal",
  "backing track",
  "karaoke",
  "노래방",
  "acoustic",
  "extended",
  // 라이브. 스튜디오 마스터가 아니다
  "live",
  "ライブ",
  "라이브",
  // 음악방송 무대. 제목에 "live"가 없어도 라이브 공연이고, 길이가 음원과 거의 같아
  // 길이 신호만으로는 공식 MV를 이긴다(실측: TWICE "TT"에서 TVPP 무대가 1위였다).
  "tvpp",
  "music core",
  "show champion",
  "music bank",
  "inkigayo",
  "m countdown",
  "음악중심",
  "쇼챔피언",
  "뮤직뱅크",
  "인기가요",
  "엠카운트다운",
  "ミュージックステーション",
];

// 남의 영상에 가사·자막을 얹어 다시 올린 것. 원곡과 같은 음원이라 길이가 정확히 맞는 일이 잦아,
// 인트로/아웃트로로 길어진 공식 MV를 길이 신호만으로 이겨버린다(실측: TWICE "TT"에서
// 가사 영상이 JYP 공식 MV를 112 대 86으로 눌렀다).
//
// 다만 공식 채널이 직접 올린 가사 영상은 정답인 경우가 있으므로(AKASAKI "Bunny Girl"의
// 정답이 공식 Lyric Video다) 업로더가 본인이면 면제한다. 정크와 같은 취급.
const REUPLOAD_TERMS = ["lyrics", "lyric video", "color coded", "가사", "발음", "해석", "자막", "번역", "歌詞", "字幕"];

const ZERO_WIDTH = /\p{Cf}/gu; // 제로폭·서식 문자(U+200B 등)는 전부 유니코드 카테고리 Cf

// 느슨한 정규화. 소문자화, 제로폭·괄호·구두점을 공백으로, 유니코드 글자/숫자는 보존(일본어/한국어).
function normLoose(s) {
  return String(s || "")
    .toLowerCase()
    .replace(ZERO_WIDTH, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// 채널명 정규화. 매칭 방해 접미사 제거(topic/vevo/official/music/records/channel/tv).
function normChannel(s) {
  return normLoose(s)
    .replace(/\b(?:topic|vevo|official|officialchannel|channel|music|records?|tv)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 다중 아티스트 분해: "A, B & C feat. D" → [a, b, c, d]
function splitArtists(artist) {
  return String(artist || "")
    .split(/\s*(?:,|&|×|＋|\+|;|\/|feat\.?|ft\.?|with)\s*/i)
    .map(normLoose)
    .filter((a) => a.length >= 2);
}

const despace = (s) => s.replace(/\s+/g, "");

// 부분 포함 최소 길이. "찾는 문자열(needle)"이 이보다 짧으면 부분일치로 인정하지 않는다.
// ('a'·'the' 같은 짧은 조각이 긴 아티스트명에 우연히 들어가 매칭되는 오탐 방지. 예: 채널 "a." → "a")
const CH_SUBSTR_MIN = 3;

// 채널이 아티스트를 나타내는가 + 공식 계열(topic/vevo) 여부.
function analyzeChannel(channel, artist) {
  const raw = normLoose(channel);
  const isTopic = /(?:^|\s)topic$/.test(raw) || raw.endsWith(" topic");
  const isVevo = raw.endsWith("vevo");

  const nc = normChannel(channel);
  const ncTight = despace(nc);
  let match = false;
  let exact = false;
  if (nc) {
    // 아티스트 전체(분해 전) 붙여쓰기 정확 일치. 등 구분자로 쪼개지는 이름 대응
    const fullTight = despace(normLoose(artist));
    if (fullTight.length >= 2 && ncTight === fullTight) {
      match = true;
      exact = true;
    }
    for (const part of splitArtists(artist)) {
      if (match && exact) break;
      const pTight = despace(part);
      if (nc === part || ncTight === pTight) {
        match = true;
        exact = true;
        break;
      }
      // 부분 포함(양방향, 공백 유무 모두). 단, "찾는 문자열"이 3자 이상일 때만 (짧은 조각 우연일치 방지)
      if (part.length >= CH_SUBSTR_MIN && nc.includes(part)) match = true;
      if (nc.length >= CH_SUBSTR_MIN && part.includes(nc)) match = true;
      if (pTight.length >= CH_SUBSTR_MIN && ncTight.includes(pTight)) match = true;
      if (ncTight.length >= CH_SUBSTR_MIN && pTight.includes(ncTight)) match = true;
    }
  }
  return { match, exact, isTopic, isVevo };
}

// 라틴 문자로만 된 용어인가. 단어 경계를 요구할지 정한다.
const LATIN_TERM = /^[a-z0-9 ]+$/;

/**
 * 용어 목록 중 후보 제목에 나타나는 개수. 곡 제목 자체에 든 용어는 세지 않는다.
 *
 * 라틴 용어는 단어 경계로 찾는다. 부분 문자열로 찾으면 "Discovery"가 `cover`에,
 * "Loophole"이 `loop`에, "Alive"가 `live`에 걸린다(전부 실제로 걸리던 오탐).
 * normLoose가 구두점을 공백으로 바꾸므로 앞뒤에 공백을 붙이면 그게 곧 단어 경계다.
 * 일본어·한국어 용어는 띄어쓰기가 없으므로 부분 문자열이 맞다.
 */
function countTerms(terms, candidateTitle, targetTitle) {
  const t = " " + normLoose(candidateTitle) + " ";
  const target = " " + normLoose(targetTitle) + " ";
  let n = 0;
  for (const term of terms) {
    const nt = normLoose(term);
    if (!nt) continue;
    const hit = LATIN_TERM.test(nt) ? (s) => s.includes(" " + nt + " ") : (s) => s.includes(nt);
    if (hit(target)) continue; // 곡 제목 자체에 있으면 감점 대상이 아니다
    if (hit(t)) n++;
  }
  return n;
}

const countJunk = (candidateTitle, targetTitle) => countTerms(JUNK_TERMS, candidateTitle, targetTitle);
const countVersion = (candidateTitle, targetTitle) => countTerms(VERSION_TERMS, candidateTitle, targetTitle);
// 재배포는 "몇 개나 걸렸나"가 아니라 "재배포인가"라는 한 가지 사실이다. 여러 개 걸려도 1회만 센다.
const isReupload = (candidateTitle, targetTitle) => countTerms(REUPLOAD_TERMS, candidateTitle, targetTitle) > 0;

function durationScore(candSec, targetSec) {
  const c = Number(candSec) || 0;
  const t = Number(targetSec) || 0;
  if (c <= 0 || t <= 0) return { score: 0, label: "unknown" };

  const diff = Math.abs(c - t);
  const gross = c > t * 2.5 || c < t * 0.4 || (diff > 45 && (c > t * 1.6 || c < t * 0.5));
  if (gross) return { score: W.durGross, label: `gross(${c}s vs ${t}s)` };
  if (diff <= 4) return { score: W.durNear, label: `near(${diff}s)` };
  if (diff <= 12) return { score: W.durClose, label: `close(${diff}s)` };
  if (diff <= 30) return { score: W.durLoose, label: `loose(${diff}s)` };
  // 더 긴 쪽은 덜 의심한다. 공식 MV의 인트로/아웃트로가 정확히 이 모양이다.
  // 짧은 쪽은 클립·TV size일 가능성이 높아 원래 감점을 유지한다.
  if (c > t) return { score: W.durFarLong, label: `farLong(${diff}s)` };
  return { score: W.durFar, label: `far(${diff}s)` };
}

const OFFICIAL_TAG = /official\s*(?:video|audio|music\s*video|mv|m\/v|hd)|\bm\/v\b/i;

// 스포티파이 제목의 "버전 태그" 감지. 괄호/대시로 감쌌거나 size/ver가 붙은 형태만(오탐 방지).
// 애니송 TV size/short는 공식이 유튜브에 다른 표기로 올리는 일이 많아, 스포티파이 제목 그대로 검색하면 못 찾는다 → 동의어 확장 대상.
function detectVersionKind(title) {
  const t = String(title || "");
  if (/[-–—([（【\s]\s*tv\s*(?:size|ver\.?|version|anime|edit)?\s*[-–—)\]）】]/i.test(t) || /tvサイズ|テレビサイズ|tvバージョン/i.test(t)) return "tv";
  if (/[-–—([（【\s]\s*short\s*(?:size|ver\.?|version|edit)?\s*[-–—)\]）】]/i.test(t) || /ショート(?:サイズ|バージョン|ver)?/.test(t)) return "short";
  return null;
}

// 버전 태그를 제거한 기본 제목 (동의어 확장 쿼리의 베이스).
function stripVersionTag(title) {
  return String(title || "")
    .replace(/[([（【]\s*(?:tv|short|テレビ|ショート)[^)\]）】]*[)\]）】]/gi, " ") // (TV size), 【TVサイズ】
    .replace(/[-–—]\s*(?:tv|short|テレビ|ショート)[^-–—]*[-–—]?/gi, " ") // -TV ver.-, - Short version -
    .replace(/\btvサイズ\b|テレビサイズ|ショート(?:サイズ|バージョン)?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const dedupe = (arr) => [...new Set(arr.filter(Boolean))];

/**
 * 사람이 검색하듯 따옴표 없는 쿼리들. { primary, secondary }로 반환한다.
 *  - primary: `제목 아티스트` + (버전 태그면) 동의어 확장 쿼리. 병합 시 뒤로 밀지 않음
 *  - secondary: `제목`만. 동명 다른 곡·우연 채널 오염을 막으려 병합 시 뒤로 밈
 * 따옴표 쿼리는 유튜브에서 과도하게 좁아져 정답을 누락시키므로 쓰지 않는다.
 */
function buildSearchQueries(target) {
  const title = String(target.title || "").trim();
  const artist = String(target.artist || "").trim();
  const primary = [];
  const secondary = [];

  if (title && artist) primary.push(`${title} ${artist}`);

  // 버전 태그 동의어 확장 (TV/Short 한정). 공식이 다른 표기로 올린 경우를 잡는다
  const vkind = detectVersionKind(title);
  if (vkind === "tv") {
    const base = stripVersionTag(title) || title;
    if (artist) primary.push(`${base} ${artist} tv size`);
    primary.push(`${base} tv size`);
    if (artist) primary.push(`${base} ${artist} tvサイズ`);
  } else if (vkind === "short") {
    const base = stripVersionTag(title) || title;
    if (artist) primary.push(`${base} ${artist} short ver`);
    primary.push(`${base} short version`);
  }

  if (title) secondary.push(title);
  return { primary: dedupe(primary), secondary: dedupe(secondary) };
}

/**
 * 검색 결과 리스트들을 병합(id로 중복 제거). rank = 어느 쿼리에서든 가장 높았던 순위.
 * primaryLists(주 쿼리들): 그대로. secondaryLists(제목만 쿼리): 오프셋만큼 뒤로 밀어 오염 억제.
 */
function mergeCandidateLists(primaryLists, secondaryLists = []) {
  const byId = new Map();
  const absorb = (lists, isSecondary) => {
    (lists || []).forEach((list) => {
      (list || []).forEach((c, i) => {
        if (!c || !c.id) return;
        const rank = i + (isSecondary ? SECONDARY_OFFSET : 0);
        const listOrder = isSecondary ? 1 : 0;
        const ex = byId.get(c.id);
        if (!ex) byId.set(c.id, { ...c, rank, listOrder });
        else if (rank < ex.rank) {
          ex.rank = rank;
          ex.listOrder = listOrder;
        }
      });
    });
  };
  absorb(primaryLists, false);
  absorb(secondaryLists, true);
  return [...byId.values()];
}

/**
 * 후보 하나 채점.
 * candidate: { id, url, title, channel, durationSec, rank? }  (rank 없으면 0)
 * target:    { title, artist, durationSec }
 */
function scoreCandidate(candidate, target) {
  const rank = Number.isInteger(candidate.rank) ? candidate.rank : 0;
  const b = {};
  b.rank = Math.max(0, RANK_BASE - rank) * W.rankPerPosition;

  const ch = analyzeChannel(candidate.channel, target.artist);
  const officialUploader = ch.match || ch.isTopic || ch.isVevo;
  if (ch.match) b.channel = W.channelMatch + (ch.isTopic || ch.isVevo ? W.channelOfficialBonus : 0);
  else if (ch.isTopic || ch.isVevo) b.channel = W.channelOfficialStandalone;
  else b.channel = 0;

  const d = durationScore(candidate.durationSec, target.durationSec);
  b.duration = d.score;
  const durNear = d.label.startsWith("near");
  const junk = countJunk(candidate.title, target.title);
  const junkWaived = (officialUploader || durNear) && junk > 0;
  b.junk = junkWaived ? 0 : junk * W.junkEach;

  // 다른 버전은 면제하지 않는다. 공식 채널이 원곡 옆에 함께 올리는 것들이라,
  // "공식 업로더면 봐준다"를 적용하면 영어판·인스트·라이브가 원곡을 이긴다.
  const version = countVersion(candidate.title, target.title);
  b.version = version * W.versionEach;

  // 가사·자막 재배포는 정크와 같은 취급. 공식 업로더면 면제한다.
  const reupload = !officialUploader && isReupload(candidate.title, target.title);
  b.reupload = reupload ? W.reuploadEach : 0;

  const nTitle = normLoose(candidate.title);
  const nTrack = normLoose(target.title);
  b.title = nTrack && nTitle.includes(nTrack) ? W.titleHasTrack : 0;
  b.artistInTitle = splitArtists(target.artist).some((a) => nTitle.includes(a)) ? W.titleHasArtist : 0;
  b.officialTag = OFFICIAL_TAG.test(candidate.title || "") ? W.titleOfficialTag : 0;

  const score = b.rank + b.channel + b.duration + b.junk + b.version + b.reupload + b.title + b.artistInTitle + b.officialTag;

  return {
    candidate,
    rank,
    score,
    breakdown: b,
    flags: { channelMatch: ch.match, channelExact: ch.exact, official: ch.isTopic || ch.isVevo, junk, junkSuppressed: junkWaived, version, reupload, duration: d.label },
  };
}

/**
 * 후보 배열을 점수순으로 정렬(각 항목에 breakdown 포함). 동점은 순위→리스트 우선순위 순.
 * candidate.rank가 있으면 그걸(병합 결과) 순위로, 없으면 배열 인덱스를 순위로 사용.
 */
function rankCandidates(candidates, target) {
  const withRank = candidates.map((c, i) => (Number.isInteger(c.rank) ? c : { ...c, rank: i }));
  const scored = withRank.map((c) => scoreCandidate(c, target));
  scored.sort((a, b) => b.score - a.score || a.rank - b.rank || (a.candidate.listOrder ?? 0) - (b.candidate.listOrder ?? 0));

  let confidence = "low";
  const top = scored[0];
  if (top) {
    // 다른 버전이 걸린 후보는 확신할 수 없다. 곡은 맞지만 우리가 찾던 녹음이 아니다.
    // (이걸 안 보면 "공식 채널 + 정크 없음"만으로 영어판에 high가 붙는다.)
    const clean = top.breakdown.junk === 0 && top.breakdown.version === 0 && top.breakdown.reupload === 0;
    if (top.flags.channelMatch && clean) confidence = "high";
    else if (top.flags.official && top.flags.duration.startsWith("near") && top.breakdown.version === 0) confidence = "high";
    else if (top.flags.duration.startsWith("near") && clean) confidence = "high";
    else if (clean && top.rank === 0) confidence = "medium";
  }
  return { ranked: scored, best: top ? top.candidate : null, confidence };
}

const exported = {
  buildSearchQueries,
  mergeCandidateLists,
  rankCandidates,
  scoreCandidate,
  W,
  JUNK_TERMS,
  VERSION_TERMS,
  REUPLOAD_TERMS,
  _internal: { normLoose, normChannel, analyzeChannel, durationScore, countJunk, countVersion, isReupload, splitArtists, detectVersionKind, stripVersionTag },
};
export default exported;
export { exported as "module.exports" };
