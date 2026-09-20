"use strict";

// 자동재생 후보 풀. 소스에서 받아 온 곡 목록을 쥐고 있다가 한 곡씩 내준다.
//
// 소스를 한 번 부르면 곡이 무더기로 온다(Last.fm 1000 · AnimeThemes 100 · LB Radio 50).
// 그런데 뽑는 것은 3분에 한 곡이라, 매번 부르면 나머지를 버리는 셈이다. 받아 두고 나눠 쓴다.
//
// 열쇠는 장르가 아니라 소스 설정 그 자체다. 장르 정의는 전역이고 장르마다 설정이 다르므로,
// 설정을 열쇠로 삼으면 섞일 일이 없고 설정을 고쳤을 때 옛 풀이 저절로 버려진다.
//
// 메모리에만 둔다. 잃어도 비용이 호출 한 번이고, 저장하면 다시 채울 때 뽑는 무작위 오프셋이
// 재기동을 넘어 살아남아 뜻이 없어진다.

const log = require("./logger").child({ category: "autoplay" });

const TTL_MS = 60 * 60 * 1000; // 며칠 켜 둔 봇이 같은 풀에 갇히지 않게
const MAX_POOLS = 64; // 설정을 자주 고쳐도 무한히 늘지 않게

/** @type {Map<string, {tracks: object[], fetchedAt: number, used: Set<string>}>} */
const pools = new Map();

// 열쇠는 설정 내용으로 만든다. 키 차례가 달라도 같은 설정이면 같은 풀이어야 한다.
// weight는 뺀다 — 어느 풀을 고를지에만 쓰이지, 풀 내용과는 상관이 없다.
function keyOf(source) {
  const stable = (v) => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === "object") {
      return Object.keys(v)
        .filter((k) => k !== "weight")
        .sort()
        .reduce((acc, k) => {
          if (v[k] !== undefined) acc[k] = stable(v[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return JSON.stringify(stable(source));
}

// 곡 하나를 가리키는 값. 같은 곡이 두 번 나오지 않게 하는 데만 쓴다.
const idOf = (track) => String(track?.sourceKey ?? track?.youtubeUrl ?? track?.audioUrl ?? `${track?.artist}|${track?.title}`);

function sweep(now) {
  for (const [key, pool] of pools) if (now - pool.fetchedAt > TTL_MS) pools.delete(key);
  // 그래도 넘치면 오래된 것부터 버린다
  if (pools.size > MAX_POOLS) {
    const oldest = [...pools.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
    for (const [key] of oldest.slice(0, pools.size - MAX_POOLS)) pools.delete(key);
  }
}

/**
 * 이 소스에서 곡 하나를 낸다. 낼 것이 없으면 null.
 *
 * @param {object} source  설정에 적힌 소스 하나 ({ type, ... })
 * @param {(track: object) => Promise<object[]>} fill  풀을 채우는 함수. 곡 배열을 돌려준다
 * @param {(track: object) => boolean} [reject]  부르는 쪽이 싫다고 할 곡(최근에 튼 곡 등)
 */
async function take(source, fill, reject) {
  const now = Date.now();
  sweep(now);

  const key = keyOf(source);
  let pool = pools.get(key);

  // 비었거나, 다 썼거나, 오래됐으면 다시 채운다. 채울 때 무작위 오프셋을 새로 뽑는 것은 fill의 몫이다.
  const spent = pool && pool.used.size >= pool.tracks.length;
  if (!pool || spent || now - pool.fetchedAt > TTL_MS) {
    let tracks;
    try {
      tracks = (await fill(source)) || [];
    } catch (error) {
      // 소스 하나가 죽어도 자동재생 전체가 죽지 않는다 — 부르는 쪽이 다음 소스로 넘어간다
      log.warn(`자동재생 소스 실패 (${source?.type}): ${error.message}`);
      return null;
    }
    if (!tracks.length) return null;
    pool = { tracks, fetchedAt: now, used: new Set() };
    pools.set(key, pool);
    log.debug(`자동재생 풀을 채웠습니다 (${source?.type}): ${tracks.length}곡`);
  }

  // 아직 안 쓴 것 중에서 무작위로. 부르는 쪽이 싫다는 것은 건너뛰되 썼다고 치지 않는다
  // — 다른 서버는 그 곡을 받아도 되기 때문이다.
  const left = pool.tracks.filter((t) => !pool.used.has(idOf(t)));
  const ok = reject ? left.filter((t) => !reject(t)) : left;
  const from = ok.length ? ok : [];
  if (!from.length) return null;

  const picked = from[Math.floor(Math.random() * from.length)];
  pool.used.add(idOf(picked));
  return picked;
}

/** 지금 쥐고 있는 풀들의 형편. 로그와 테스트에서 본다. */
function stats() {
  return [...pools.entries()].map(([key, p]) => ({ key, total: p.tracks.length, used: p.used.size, age: Date.now() - p.fetchedAt }));
}

/** 테스트 시임 — 풀을 전부 버린다. */
function _reset() {
  pools.clear();
}

module.exports = { take, stats, keyOf, _reset, TTL_MS, MAX_POOLS };
