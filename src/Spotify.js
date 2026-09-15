"use strict";

// Spotify 소스 — 링크 타입별 투트랙 라우팅.
//   track/album  → 공식 Web API(native fetch, client credentials)
//   artist       → 공식 API, 실패 시 익명 GraphQL 폴백(정책 축소 대비)
//   playlist     → 익명 GraphQL 전용(공식은 100곡 상한이라 사실상 불가)
//
// 익명 경로는 웹플레이어의 공개 동작(TOTP → /api/token → api-partner/pathfinder)을 재현한 것.
// 외부 코드 이식 없이 번들에서 직접 밝혀낸 원리로 구현. secret/해시/clientVersion은 DB에 캐시하고
// TTL·실패 시 번들 재추출로 갱신(자가치유). 참고 구현: LavaSrc, discord-player-spotify(원리 교차검증만).

const crypto = require("crypto");
const log = require("./logger").child({ category: "spotify" });
const config = require("../config");
const CacheManager = require("./CacheManager");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const API_BASE = "https://api.spotify.com/v1";
const PARTNER = "https://api-partner.spotify.com/pathfinder/v2/query";
const REFERER = "https://open.spotify.com/";
const HDR_HTML = { "User-Agent": UA, "Accept-Language": "en" };

// 응답이 없으면 끊는다. 웹플레이어 번들은 수 MB라 따로 둔다.
const TIMEOUT_MS = 10000;
const BUNDLE_TIMEOUT_MS = 30000;

// 씨앗값 — 최초 추출 실패 시 폴백. 자가치유가 최신값으로 덮어씀.
const SEED = {
  secrets: [{ secret: ',7/*F("rLJ2oxaKL^f+E1xvP@N', version: 61 }],
  hashes: {
    fetchPlaylist: "86dde7b9d9356e2369414647cf6950cfed96e778e129cfdfc99aea6c1613b3b0",
    queryArtistOverview: "ae0e2958a4ab645b35ca19ac04d0495ae12d9c5d7b7286217674801a9aab281a",
  },
  clientVersion: "1.2.80.289.gd6b01cc3",
};
const STATE_TTL_MS = 12 * 60 * 60 * 1000;

// ── URL 파싱 (외부 계약: isSpotifyURL / parseSpotifyURL) ──
function isSpotifyURL(url) {
  const patterns = [/^https?:\/\/open\.spotify\.com\/(track|album|playlist|artist)\/[a-zA-Z0-9]+/, /^spotify:(track|album|playlist|artist):[a-zA-Z0-9]+/];
  return patterns.some((p) => p.test(url));
}

function parseSpotifyURL(url) {
  let m = String(url).match(/^https?:\/\/open\.spotify\.com\/(track|album|playlist|artist)\/([a-zA-Z0-9]+)/);
  if (m) return { type: m[1], id: m[2] };
  m = String(url).match(/^spotify:(track|album|playlist|artist):([a-zA-Z0-9]+)/);
  if (m) return { type: m[1], id: m[2] };
  return { type: null, id: null };
}

// ── 정규화 (양 경로 공통 출력 계약) ──
function pickImageUrl(sources) {
  if (!Array.isArray(sources) || !sources.length) return null;
  const withUrl = sources.filter((s) => s && s.url);
  if (!withUrl.length) return null;
  const sized = withUrl.filter((s) => typeof s.height === "number" && s.height > 0);
  if (sized.length) return sized.sort((a, b) => b.height - a.height)[0].url;
  return (withUrl.find((s) => s.url.includes("0000b273")) || withUrl[withUrl.length - 1]).url; // 640px(0000b273) 우선
}

// 공식 API 트랙 → 표준. album 트랙(SimplifiedTrack)은 album 필드가 없어 albumOverride로 앨범 메타 주입.
function normApiTrack(t, albumOverride) {
  if (!t || !t.name) return null;
  const album = albumOverride || t.album;
  const url = t.external_urls?.spotify || `https://open.spotify.com/track/${t.id}`;
  return {
    title: t.name,
    artist:
      (t.artists || [])
        .map((a) => a.name)
        .filter(Boolean)
        .join(", ") || "알 수 없는 아티스트",
    album: album?.name || null,
    url,
    duration: Math.floor((t.duration_ms || 0) / 1000),
    thumbnail: pickImageUrl(album?.images),
    platform: "spotify",
    type: "track",
    id: t.id,
  };
}

// GraphQL 트랙 data(playlist item.itemV2.data / artist topTracks item.track) → 표준.
function normGqlTrack(d) {
  if (!d || !d.name) return null;
  const id = (d.uri || "").split(":").pop() || d.id;
  if (!id) return null;
  const url = `https://open.spotify.com/track/${id}`;
  const durMs = d.trackDuration?.totalMilliseconds ?? d.duration?.totalMilliseconds ?? 0;
  return {
    title: d.name,
    artist:
      (d.artists?.items || [])
        .map((a) => a.profile?.name)
        .filter(Boolean)
        .join(", ") || "알 수 없는 아티스트",
    album: d.albumOfTrack?.name || null, // GraphQL은 앨범명이 없을 수 있음(표시용, 없으면 null)
    url,
    duration: Math.floor(durMs / 1000),
    thumbnail: pickImageUrl(d.albumOfTrack?.coverArt?.sources),
    platform: "spotify",
    type: "track",
    id,
  };
}

// ── TOTP (익명 토큰용) ──
function deriveKey(secretStr) {
  // 번들 로직: char ^ (i%33+9) → 숫자열 이어붙임 → UTF-8 바이트 = HMAC-SHA1 키
  return Buffer.from(
    secretStr
      .split("")
      .map((c, i) => c.charCodeAt(0) ^ ((i % 33) + 9))
      .join(""),
    "utf8",
  );
}
function totp(key, timestampMs) {
  let counter = Math.floor(timestampMs / 1000 / 30);
  const buf = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    buf[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }
  const h = crypto.createHmac("sha1", key).update(buf).digest();
  const o = h[19] & 0xf;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 1e6).padStart(6, "0");
}

// 번들에서 secret 목록 추출 (문자열형 `secret:'...',version:N`). JS 이스케이프 해제.
function parseSecrets(js) {
  const out = [];
  const re = /secret:(['"])((?:\\.|(?!\1).)*)\1,\s*version:(\d+)/g;
  let m;
  while ((m = re.exec(js))) out.push({ secret: m[2].replace(/\\(['"\\])/g, "$1"), version: Number(m[3]) });
  return out;
}

function partnerHeaders(tok, clientVersion) {
  return {
    Authorization: `Bearer ${tok}`,
    "Spotify-App-Version": clientVersion || SEED.clientVersion,
    "App-Platform": "WebPlayer",
    Referer: REFERER,
    Origin: "https://open.spotify.com",
    Accept: "application/json",
    "User-Agent": UA,
    "Content-Type": "application/json",
  };
}

// ── 공식 API 프로바이더 ──
const official = {
  _token: null, // { value, expiresAt }

  async _accessToken() {
    if (!config.spotify.clientId || !config.spotify.clientSecret) throw new Error("Spotify 자격증명 미설정");
    if (this._token && Date.now() < this._token.expiresAt - 60000) return this._token.value;
    const auth = Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString("base64");
    const r = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) throw new Error(`토큰 발급 실패 ${r.status}`);
    const j = await r.json();
    this._token = { value: j.access_token, expiresAt: Date.now() + (j.expires_in || 3600) * 1000 };
    return this._token.value;
  },

  async _get(path) {
    const tok = await this._accessToken();
    const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${tok}`, "User-Agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) throw new Error(`API ${r.status} (${path.slice(0, 40)})`);
    return r.json();
  },

  async track(id) {
    const n = normApiTrack(await this._get(`/tracks/${id}`));
    return n ? [n] : [];
  },

  async album(id, { offset = 0, limit = config.bot.maxPlaylistSize } = {}) {
    const a = await this._get(`/albums/${id}`); // 앨범 이름·표지는 여기에만 있다
    const albumMeta = { name: a.name, images: a.images };
    let items = offset === 0 ? a.tracks?.items || [] : [];
    let next = offset === 0 ? a.tracks?.next : `/albums/${id}/tracks?offset=${offset}&limit=50`;
    while (next && items.length < limit) {
      const p = await this._get(next);
      items = items.concat(p.items || []);
      next = p.next;
    }
    const part = items.slice(0, limit);
    return {
      tracks: part.map((t) => normApiTrack(t, albumMeta)).filter(Boolean),
      total: a.tracks?.total ?? null,
      nextOffset: offset + part.length,
    };
  },

  async artist(id) {
    const a = await this._get(`/artists/${id}/top-tracks`); // market 생략 가능(실측)
    return (a.tracks || [])
      .slice(0, 10)
      .map((t) => normApiTrack(t))
      .filter(Boolean);
  },

  async search(query, limit) {
    const r = await this._get(`/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`);
    return (r.tracks?.items || [])
      .slice(0, limit)
      .map((t) => normApiTrack(t))
      .filter(Boolean);
  },
};

// ── 익명 GraphQL 프로바이더 ──
const graphql = {
  _anonToken: null, // { value, expiresAt }
  _state: null, // { secrets, hashes, clientVersion, fetchedAt }

  async _ensureState(forceRefresh) {
    if (!forceRefresh && this._state && Date.now() - this._state.fetchedAt < STATE_TTL_MS) return this._state;
    if (!forceRefresh && !this._state) {
      const db = CacheManager.getSpotifyAnonState();
      if (db && db.secrets?.length && Date.now() - db.fetchedAt < STATE_TTL_MS) return (this._state = db);
    }
    try {
      const extracted = await this._extract();
      this._state = { ...extracted, fetchedAt: Date.now() };
      CacheManager.setSpotifyAnonState(extracted);
    } catch (e) {
      log.warn({ tags: ["fallback"] }, `익명 상태 추출 실패: ${e.message} — 저장값/시드값 사용`);
      this._state = this._state || CacheManager.getSpotifyAnonState() || { ...SEED, fetchedAt: 0 };
    }
    return this._state;
  },

  async _extract() {
    const home = await fetch("https://open.spotify.com/", { headers: HDR_HTML, signal: AbortSignal.timeout(TIMEOUT_MS) }).then((r) => r.text());
    let clientVersion = SEED.clientVersion;
    const cfg = home.match(/id="appServerConfig"[^>]*>([^<]+)</);
    if (cfg) {
      try {
        clientVersion = JSON.parse(Buffer.from(cfg[1], "base64").toString()).clientVersion || clientVersion;
      } catch {
        /* 무시 */
      }
    }
    const hashes = { ...SEED.hashes };
    let secrets = null;
    const scriptUrl = (home.match(/https:\/\/[^"']*\/web-player\.[a-f0-9]+\.js/) || [])[0];
    if (scriptUrl) {
      const js = await fetch(scriptUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(BUNDLE_TIMEOUT_MS) }).then((r) => r.text());
      const s = parseSecrets(js);
      if (s.length) secrets = s;
      const fp = js.match(/"fetchPlaylist","query","([0-9a-f]{64})"/);
      if (fp) hashes.fetchPlaylist = fp[1];
      const ao = js.match(/"queryArtistOverview","query","([0-9a-f]{64})"/);
      if (ao) hashes.queryArtistOverview = ao[1];
    }
    return { secrets: secrets || SEED.secrets, hashes, clientVersion };
  },

  async _mintToken() {
    const state = await this._ensureState(false);
    const home = await fetch("https://open.spotify.com/", { headers: HDR_HTML, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const cookies = (home.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
    const stJson = await fetch("https://open.spotify.com/api/server-time", { headers: { ...HDR_HTML, Cookie: cookies, Referer: REFERER }, signal: AbortSignal.timeout(TIMEOUT_MS) }).then((r) => r.json());
    const serverSec = Number(stJson.serverTime) || Math.floor(Date.now() / 1000);
    const { secret, version } = state.secrets[0];
    const key = deriveKey(secret);
    const qs = new URLSearchParams({ reason: "init", productType: "web-player", totp: totp(key, Date.now()), totpServer: totp(key, serverSec * 1000), totpVer: String(version) });
    const r = await fetch(`https://open.spotify.com/api/token?${qs}`, { headers: { ...HDR_HTML, Cookie: cookies, Referer: REFERER, "App-Platform": "WebPlayer" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) {
      const e = new Error(`익명 토큰 ${r.status}`);
      e.status = r.status;
      throw e;
    }
    return r.json();
  },

  async _token() {
    if (this._anonToken && Date.now() < this._anonToken.expiresAt - 60000) return this._anonToken.value;
    let j;
    try {
      j = await this._mintToken();
    } catch (e) {
      if (e.status === 400 || e.status === 403) {
        log.warn({ tags: ["retry"] }, `익명 토큰 오류 ${e.status} — secret을 다시 추출해 재시도합니다`);
        await this._ensureState(true);
        j = await this._mintToken();
      } else throw e;
    }
    this._anonToken = { value: j.accessToken, expiresAt: j.accessTokenExpirationTimestampMs || Date.now() + 3600000 };
    return this._anonToken.value;
  },

  async _query(operationName, hashKey, variables) {
    const run = async () => {
      const state = await this._ensureState(false);
      const tok = await this._token();
      const r = await fetch(PARTNER, { method: "POST", headers: partnerHeaders(tok, state.clientVersion), body: JSON.stringify({ operationName, variables, extensions: { persistedQuery: { version: 1, sha256Hash: state.hashes[hashKey] } } }), signal: AbortSignal.timeout(TIMEOUT_MS) });
      const text = await r.text();
      let j;
      try {
        j = JSON.parse(text);
      } catch {
        throw new Error(`GraphQL 응답 파싱 실패 ${r.status}`);
      }
      if (j.errors) {
        const msg = j.errors[0]?.message || "GraphQL 오류";
        const err = new Error(msg);
        err.persistedNotFound = /persistedquery/i.test(msg) && /not.?found/i.test(msg);
        throw err;
      }
      return j.data;
    };
    try {
      return await run();
    } catch (e) {
      if (e.persistedNotFound) {
        log.warn({ tags: ["retry"] }, "저장된 해시 만료 — 다시 추출해 재시도합니다");
        await this._ensureState(true);
        return run();
      }
      throw e;
    }
  },

  // offset부터 재생 가능한 곡을 limit개까지. 원본 위치는 임의 접근이라 어느 구간이든 요청 비용이 같다.
  async playlist(id, { offset = 0, limit = config.bot.maxPlaylistSize } = {}) {
    const PAGE = 100;
    const MAX_PAGES = 200; // 무한루프 가드
    const out = [];
    let cursor = offset;
    let total = null;
    for (let page = 0; page < MAX_PAGES && out.length < limit; page++) {
      const want = Math.min(PAGE, limit - out.length);
      const data = await this._query("fetchPlaylist", "fetchPlaylist", { uri: `spotify:playlist:${id}`, offset: cursor, limit: want, enableWatchFeedEntrypoint: false });
      const pl = data?.playlistV2;
      if (!pl || pl.__typename === "NotFound") throw new Error("플레이리스트 접근 불가(NotFound)");
      const items = pl.content?.items || [];
      if (total == null) total = pl.content?.totalCount ?? null;
      for (const it of items) {
        if (it.itemV2?.__typename === "TrackResponseWrapper" && it.itemV2.data?.__typename !== "NotFound") {
          const n = normGqlTrack(it.itemV2.data);
          if (n) out.push(n);
        }
      }
      // 재생할 수 없는 곡은 건너뛰므로 받은 곡 수와 원본 위치가 어긋난다 — 다음 위치는 원본 기준으로 센다
      cursor += items.length;
      if (items.length < want) break;
      if (total != null && cursor >= total) break;
    }
    return { tracks: out, total, nextOffset: cursor };
  },

  async artist(id) {
    const data = await this._query("queryArtistOverview", "queryArtistOverview", { uri: `spotify:artist:${id}`, locale: "", includePrerelease: false });
    const items = data?.artistUnion?.discography?.topTracks?.items || [];
    return items.map((it) => normGqlTrack(it.track)).filter(Boolean);
  },
};

// ── 라우팅 정책 (유일한 정책 지점) ──
// 각 타입 → 시도할 백엔드 순서. 앞이 실패/빈결과면 다음으로 폴백.
// 모든 경로는 { tracks, total(모르면 null), nextOffset(원본 목록 기준 다음 위치) }를 돌려준다.
// 인기곡처럼 통째로만 오는 목록은 받은 뒤 구간을 자른다.
function sliceWhole(tracks, { offset = 0, limit = config.bot.maxPlaylistSize } = {}) {
  const part = tracks.slice(offset, offset + limit);
  return { tracks: part, total: tracks.length, nextOffset: offset + part.length };
}

const ROUTES = {
  track: [async (id) => ({ tracks: await official.track(id), total: null, nextOffset: null })],
  album: [(id, o) => official.album(id, o)],
  artist: [async (id, o) => sliceWhole(await official.artist(id), o), async (id, o) => sliceWhole(await graphql.artist(id), o)],
  playlist: [(id, o) => graphql.playlist(id, o)],
};

async function resolveType(type, id, options) {
  const empty = { tracks: [], total: null, nextOffset: null };
  const chain = ROUTES[type];
  if (!chain) return empty;
  for (let i = 0; i < chain.length; i++) {
    const last = i === chain.length - 1;
    try {
      const result = await chain[i](id, options);
      if (result.tracks.length || last) return result;
      // 빈 결과 + 폴백 남음 → 다음 시도
    } catch (e) {
      log.warn({ sub: type }, `${i === 0 ? "주 경로" : "폴백"} 실패: ${e.message}${last ? "" : " — 폴백 전환"}`);
      if (last) return empty;
    }
  }
  return empty;
}

// ── 외부 계약 (TrackResolver가 쓰는 것) ──

// 여러 곡 출처는 필요한 구간만 받는다
async function getCollection(url, { offset = 0, limit = config.bot.maxPlaylistSize } = {}) {
  const { type, id } = parseSpotifyURL(url);
  if (!type || !id) return { tracks: [], total: null, nextOffset: null };
  const result = await resolveType(type, id, { offset, limit });
  const { tracks, total } = result;
  const head = tracks[0] ? `"${tracks[0].title}" - ${tracks[0].artist}${tracks.length > 1 ? ` 외 ${tracks.length - 1}곡` : ""}` : "결과 없음";
  const range = total != null && total > tracks.length ? ` (전체 ${total}곡 중 ${offset + 1}번째부터)` : "";
  log.info(`${type} ${id} → ${tracks.length}곡${range}: ${head}`);
  return result;
}

async function getFromURL(url) {
  return (await getCollection(url)).tracks;
}

async function search(query, limit = 1, _type = "track") {
  if (isSpotifyURL(query)) return getFromURL(query);
  try {
    return await official.search(query, limit);
  } catch (e) {
    log.warn(`검색 실패: ${e.message}`);
    return [];
  }
}

module.exports = { isSpotifyURL, parseSpotifyURL, getCollection, getFromURL, search };

// 테스트용 노출 — 프로바이더는 요청 함수(_query/_get)를 바꿔 끼워 네트워크 없이 검증한다
module.exports._internals = { deriveKey, totp, normApiTrack, normGqlTrack, pickImageUrl, parseSecrets, official, graphql };
