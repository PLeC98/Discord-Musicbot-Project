// Spotify 소스. 링크 타입별 투트랙 라우팅.
//   track/album  → 공식 Web API(native fetch, client credentials)
//   artist       → 공식 API, 실패 시 익명 GraphQL 폴백(정책 축소 대비)
//   playlist     → 익명 GraphQL 전용(공식은 100곡 상한이라 사실상 불가)
//
// 익명 경로는 웹플레이어의 공개 동작(TOTP → /api/token → api-partner/pathfinder)을 재현한 것.
// 외부 코드 이식 없이 번들에서 직접 밝혀낸 원리로 구현. secret/해시/clientVersion은 DB에 캐시하고
// TTL·실패 시 번들 재추출로 갱신(자가치유). 참고 구현: LavaSrc, discord-player-spotify(원리 교차검증만).

import crypto from "crypto";
import { isSpotifyURL, parseSpotifyURL } from "../rules/links.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "spotify" });
import config from "../../config.ts";
import * as externalCaches from "../store/externalCaches.ts";
import { messageOf } from "../rules/errorKind.ts";

// 바깥으로 나가는 요청. 시험은 useFetch 로 가짜를 넘긴다(기본은 진짜 fetch)
let send: typeof fetch = fetch;
function useFetch(fake: typeof fetch | null) {
  send = fake ?? fetch;
}

// 응답의 모양. 여기서 읽는 칸만
type ApiImage = { url?: string; height?: number | null };
type ApiTrack = { id?: string; name?: string; duration_ms?: number; artists?: Array<{ name?: string }>; album?: { name?: string; images?: ApiImage[] }; external_urls?: { spotify?: string } };
type ApiAlbum = { name?: string; images?: ApiImage[]; tracks?: { items?: ApiTrack[]; next?: string | null; total?: number } };
type ApiPage = { items?: ApiTrack[]; next?: string | null };
type GqlTrack = { id?: string; uri?: string; name?: string; trackDuration?: { totalMilliseconds?: number }; duration?: { totalMilliseconds?: number }; artists?: { items?: Array<{ profile?: { name?: string } }> }; albumOfTrack?: { name?: string; coverArt?: { sources?: ApiImage[] } } };
type GqlPlaylist = { playlistV2?: { __typename?: string; content?: { totalCount?: number; items?: Array<{ itemV2?: { __typename?: string; data?: GqlTrack & { __typename?: string } } }> } } };
type GqlArtist = { artistUnion?: { discography?: { topTracks?: { items?: Array<{ track?: GqlTrack }> } } } };

/** 스포티파이 곡(두 경로 공통 출력) */
type SpotifyTrack = { title: string; artist: string; album: string | null; pageUrl: string; requestKey: string; duration: number; thumbnail: string | null; platform: "spotify"; type: "track"; id?: string };
/** 여러 곡 출처의 한 구간. total 은 모르면 null */
type Part = { tracks: SpotifyTrack[]; total: number | null; nextOffset: number | null };
type Range = { offset?: number; limit?: number };
type Token = { value: string; expiresAt: number };
/** 웹플레이어 번들에서 뽑은 익명 상태 */
type AnonState = { secrets: Array<{ secret: string; version: number }>; hashes: Record<string, string>; clientVersion: string; fetchedAt: number };

const isTrack = (t: SpotifyTrack | null): t is SpotifyTrack => t !== null;

/** 요청 함수. get 은 공식 API, query 는 익명 GraphQL. 테스트가 가짜를 넘기는 자리(넘기지 않은 것은 진짜) */
type Net = { get: (path: string) => Promise<unknown>; query: (operationName: string, hashKey: string, variables: Record<string, unknown>) => Promise<unknown> };
// 진짜 요청 함수. 아래 두 프로바이더가 가진 것을 부른다
const net = (over: Partial<Net> = {}): Net => ({ get: (p) => official._get(p), query: (op, hash, vars) => graphql._query(op, hash, vars), ...over });

const ua = () => config.userAgents.browser;
const API_BASE = "https://api.spotify.com/v1";
const PARTNER = "https://api-partner.spotify.com/pathfinder/v2/query";
const REFERER = "https://open.spotify.com/";
const htmlHeaders = () => ({ "User-Agent": ua(), "Accept-Language": "en" });

// 응답이 없으면 끊는다. 웹플레이어 번들은 수 MB라 따로 둔다.
const TIMEOUT_MS = 10000;
const BUNDLE_TIMEOUT_MS = 30000;

// 웹플레이어 판(Spotify-App-Version 머리). 홈에서 못 읽고 저장값도 없을 때만 쓴다. 머리 값이라 기본을 둔다
const CLIENT_VERSION = "1.2.80.289.gd6b01cc3";
// secret · 해시는 코드에 두지 않는다. 늘 번들에서 뽑고 DB 에 남긴다. 낡은 값을 코드에 두면 뽑기 실패를 가린다
const STATE_TTL_MS = 12 * 60 * 60 * 1000;
// 뽑기에 실패하면 이만큼은 다시 뽑지 않고 저장값을 쓴다. 저쪽이 죽어 있을 때 요청마다 번들(수 MB)을 받지 않게
const EXTRACT_RETRY_MS = 10 * 60 * 1000;
// 번들에서 해시를 뽑는 질의
const OPERATIONS = ["fetchPlaylist", "queryArtistOverview"];

// ── 정규화 (양 경로 공통 출력 계약) ──
function pickImageUrl(sources: ApiImage[] | null | undefined): string | null {
  if (!Array.isArray(sources) || !sources.length) return null;
  const withUrl = sources.filter((s): s is ApiImage & { url: string } => !!(s && s.url));
  if (!withUrl.length) return null;
  const sized = withUrl.filter((s): s is ApiImage & { url: string; height: number } => typeof s.height === "number" && s.height > 0);
  if (sized.length) return sized.sort((a, b) => b.height - a.height)[0].url;
  return (withUrl.find((s) => s.url.includes("0000b273")) || withUrl[withUrl.length - 1]).url; // 640px(0000b273) 우선
}

// 공식 API 트랙 → 표준. album 트랙(SimplifiedTrack)은 album 필드가 없어 albumOverride로 앨범 메타 주입.
function normApiTrack(t: ApiTrack | null | undefined, albumOverride?: { name?: string; images?: ApiImage[] }): SpotifyTrack | null {
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
    pageUrl: url,
    requestKey: url,
    duration: Math.floor((t.duration_ms || 0) / 1000),
    thumbnail: pickImageUrl(album?.images),
    platform: "spotify",
    type: "track",
    id: t.id,
  };
}

// 가수 이름들. 없으면 "알 수 없는 아티스트"
function artistsOf(d: GqlTrack) {
  const names = (d.artists?.items || []).map((a) => a.profile?.name).filter(Boolean);
  return names.join(", ") || "알 수 없는 아티스트";
}

// GraphQL 트랙 data(playlist item.itemV2.data / artist topTracks item.track) → 표준.
function normGqlTrack(d: GqlTrack | null | undefined): SpotifyTrack | null {
  if (!d || !d.name) return null;
  const id = (d.uri || "").split(":").pop() || d.id;
  if (!id) return null;
  const url = `https://open.spotify.com/track/${id}`;
  const durMs = d.trackDuration?.totalMilliseconds ?? d.duration?.totalMilliseconds ?? 0;
  return {
    title: d.name,
    artist: artistsOf(d),
    album: d.albumOfTrack?.name || null, // GraphQL은 앨범명이 없을 수 있음(표시용, 없으면 null)
    pageUrl: url,
    requestKey: url,
    duration: Math.floor(durMs / 1000),
    thumbnail: pickImageUrl(d.albumOfTrack?.coverArt?.sources),
    platform: "spotify",
    type: "track",
    id,
  };
}

/** 재생목록 한 쪽의 항목들 */
type GqlItems = NonNullable<NonNullable<NonNullable<GqlPlaylist["playlistV2"]>["content"]>["items"]>;

// 재생할 수 있는 곡만(지역 제한 · 지워진 곡은 NotFound 로 온다)
function playable(items: GqlItems) {
  const out: SpotifyTrack[] = [];
  for (const it of items) {
    const track = it.itemV2?.__typename === "TrackResponseWrapper" && it.itemV2.data?.__typename !== "NotFound" ? normGqlTrack(it.itemV2.data) : null;
    if (track) out.push(track);
  }
  return out;
}

// 재생목록 한 쪽. 접근할 수 없으면 던진다
async function playlistPage(query: Net["query"], id: string, offset: number, limit: number) {
  const data = (await query("fetchPlaylist", "fetchPlaylist", { uri: `spotify:playlist:${id}`, offset, limit, enableWatchFeedEntrypoint: false })) as GqlPlaylist | null;
  const pl = data?.playlistV2;
  if (!pl || pl.__typename === "NotFound") throw new Error("플레이리스트 접근 불가(NotFound)");
  return { items: pl.content?.items || [], total: pl.content?.totalCount ?? null };
}

// ── TOTP (익명 토큰용) ──
function deriveKey(secretStr: string): Buffer {
  // 번들 로직: char ^ (i%33+9) → 숫자열 이어붙임 → UTF-8 바이트 = HMAC-SHA1 키
  return Buffer.from(
    secretStr
      .split("")
      .map((c, i) => c.charCodeAt(0) ^ ((i % 33) + 9))
      .join(""),
    "utf8",
  );
}
function totp(key: Buffer, timestampMs: number): string {
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
function parseSecrets(js: string): Array<{ secret: string; version: number }> {
  const out: Array<{ secret: string; version: number }> = [];
  const re = /secret:(['"])((?:\\.|(?!\1).)*)\1,\s*version:(\d+)/g;
  let m;
  while ((m = re.exec(js))) out.push({ secret: m[2].replace(/\\(['"\\])/g, "$1"), version: Number(m[3]) });
  return out;
}

function partnerHeaders(tok: string, clientVersion: string | undefined) {
  return {
    Authorization: `Bearer ${tok}`,
    "Spotify-App-Version": clientVersion || CLIENT_VERSION,
    "App-Platform": "WebPlayer",
    Referer: REFERER,
    Origin: "https://open.spotify.com",
    Accept: "application/json",
    "User-Agent": ua(),
    "Content-Type": "application/json",
  };
}

// ── 공식 API 프로바이더 ──
const official = {
  _token: null as Token | null,

  async _accessToken(): Promise<string> {
    if (!config.spotify.clientId || !config.spotify.clientSecret) throw new Error("Spotify 자격증명 미설정");
    if (this._token && Date.now() < this._token.expiresAt - 60000) return this._token.value;
    const auth = Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString("base64");
    const r = await send("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": ua() },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) throw new Error(`토큰 발급 실패 ${r.status}`);
    const j = (await r.json()) as { access_token: string; expires_in?: number };
    this._token = { value: j.access_token, expiresAt: Date.now() + (j.expires_in || 3600) * 1000 };
    return this._token.value;
  },

  async _get(path: string): Promise<unknown> {
    const tok = await this._accessToken();
    const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
    const r = await send(url, { headers: { Authorization: `Bearer ${tok}`, "User-Agent": ua() }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) throw new Error(`API ${r.status} (${path.slice(0, 40)})`);
    return r.json();
  },

  async track(id: string, over: Partial<Net> = {}) {
    const n = normApiTrack((await net(over).get(`/tracks/${id}`)) as ApiTrack);
    return n ? [n] : [];
  },

  async album(id: string, { offset = 0, limit = config.bot.playlistAddDefault }: Range = {}, over: Partial<Net> = {}): Promise<Part> {
    const { get } = net(over);
    const a = (await get(`/albums/${id}`)) as ApiAlbum; // 앨범 이름·표지는 여기에만 있다
    const albumMeta = { name: a.name, images: a.images };
    let items: ApiTrack[] = offset === 0 ? a.tracks?.items || [] : [];
    let next = offset === 0 ? a.tracks?.next : `/albums/${id}/tracks?offset=${offset}&limit=50`;
    while (next && items.length < limit) {
      const p = (await get(next)) as ApiPage;
      items = items.concat(p.items || []);
      next = p.next;
    }
    const part = items.slice(0, limit);
    return {
      tracks: part.map((t) => normApiTrack(t, albumMeta)).filter(isTrack),
      total: a.tracks?.total ?? null,
      nextOffset: offset + part.length,
    };
  },

  async artist(id: string, over: Partial<Net> = {}) {
    const a = (await net(over).get(`/artists/${id}/top-tracks`)) as { tracks?: ApiTrack[] }; // market 생략 가능(실측)
    return (a.tracks || [])
      .slice(0, 10)
      .map((t) => normApiTrack(t))
      .filter(isTrack);
  },

  async search(query: string, limit: number, over: Partial<Net> = {}) {
    const r = (await net(over).get(`/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`)) as { tracks?: { items?: ApiTrack[] } };
    return (r.tracks?.items || [])
      .slice(0, limit)
      .map((t) => normApiTrack(t))
      .filter(isTrack);
  },
};

// ── 익명 GraphQL 프로바이더 ──
const graphql = {
  _anonToken: null as Token | null,
  _state: null as AnonState | null,
  _failedAt: 0,

  // 뽑지 않고 쓸 수 있는 상태. 없으면 null(뽑는다)
  _reusable(forceRefresh: boolean, usable: AnonState | null): AnonState | null {
    if (forceRefresh || !usable) return null;
    if (Date.now() - usable.fetchedAt < STATE_TTL_MS) return usable;
    // 방금 뽑기에 실패했으면 쉬는 동안은 저장값으로. 토큰 · 해시 오류로 부른 강제 뽑기는 쉬지 않는다
    return Date.now() - this._failedAt < EXTRACT_RETRY_MS ? usable : null;
  },

  async _ensureState(forceRefresh: boolean): Promise<AnonState> {
    const stored = this._state ?? (externalCaches.getSpotifyAnonState() as AnonState | null); // 우리가 적은 모양
    const usable = stored?.secrets?.length ? stored : null;
    const reused = this._reusable(forceRefresh, usable);
    if (reused) return (this._state = reused);
    try {
      const extracted = await this._extract(usable);
      this._state = { ...extracted, fetchedAt: Date.now() };
      this._failedAt = 0;
      externalCaches.setSpotifyAnonState(extracted);
    } catch (e) {
      this._failedAt = Date.now();
      if (!usable) throw new Error(`익명 상태를 얻지 못했습니다: ${messageOf(e)}`, { cause: e });
      log.warn({ tags: ["fallback"] }, `익명 상태 추출 실패: ${messageOf(e)}. 저장값 사용`);
      this._state = usable;
    }
    return this._state;
  },

  // 홈과 웹플레이어 번들에서 뽑는다. 응답이 오류이거나 secret 을 못 찾으면 던진다(부르는 쪽이 저장값으로 넘어간다).
  // 못 찾은 해시는 직전 값을 둔다. 그 질의만 해시 만료로 실패해 다시 뽑게 된다
  async _extract(previous: AnonState | null = null): Promise<Omit<AnonState, "fetchedAt">> {
    const homeRes = await send("https://open.spotify.com/", { headers: htmlHeaders(), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!homeRes.ok) throw new Error(`홈 ${homeRes.status}`);
    const home = await homeRes.text();
    let clientVersion = previous?.clientVersion || CLIENT_VERSION;
    const cfg = home.match(/id="appServerConfig"[^>]*>([^<]+)</);
    if (cfg) {
      try {
        clientVersion = JSON.parse(Buffer.from(cfg[1], "base64").toString()).clientVersion || clientVersion;
      } catch {
        /* 판을 못 읽으면 직전 값 */
      }
    }
    const scriptUrl = (home.match(/https:\/\/[^"']*\/web-player\.[a-f0-9]+\.js/) || [])[0];
    if (!scriptUrl) throw new Error("홈에 웹플레이어 번들 주소가 없습니다");
    const jsRes = await send(scriptUrl, { headers: { "User-Agent": ua() }, signal: AbortSignal.timeout(BUNDLE_TIMEOUT_MS) });
    if (!jsRes.ok) throw new Error(`번들 ${jsRes.status}`);
    const js = await jsRes.text();
    const secrets = parseSecrets(js);
    if (!secrets.length) throw new Error("번들에서 secret 을 찾지 못했습니다");
    const hashes = { ...previous?.hashes };
    for (const name of OPERATIONS) {
      const found = js.match(new RegExp(`"${name}","query","([0-9a-f]{64})"`));
      if (found) hashes[name] = found[1];
    }
    return { secrets, hashes, clientVersion };
  },

  async _mintToken(): Promise<{ accessToken: string; accessTokenExpirationTimestampMs?: number }> {
    const state = await this._ensureState(false);
    const home = await send("https://open.spotify.com/", { headers: htmlHeaders(), signal: AbortSignal.timeout(TIMEOUT_MS) });
    const cookies = (home.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
    const stJson = (await send("https://open.spotify.com/api/server-time", { headers: { ...htmlHeaders(), Cookie: cookies, Referer: REFERER }, signal: AbortSignal.timeout(TIMEOUT_MS) }).then((r) => r.json())) as { serverTime?: unknown };
    const serverSec = Number(stJson.serverTime) || Math.floor(Date.now() / 1000);
    const { secret, version } = state.secrets[0];
    const key = deriveKey(secret);
    const qs = new URLSearchParams({ reason: "init", productType: "web-player", totp: totp(key, Date.now()), totpServer: totp(key, serverSec * 1000), totpVer: String(version) });
    const r = await send(`https://open.spotify.com/api/token?${qs}`, { headers: { ...htmlHeaders(), Cookie: cookies, Referer: REFERER, "App-Platform": "WebPlayer" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) throw Object.assign(new Error(`익명 토큰 ${r.status}`), { status: r.status });
    return (await r.json()) as { accessToken: string; accessTokenExpirationTimestampMs?: number };
  },

  async _token(): Promise<string> {
    if (this._anonToken && Date.now() < this._anonToken.expiresAt - 60000) return this._anonToken.value;
    let j;
    try {
      j = await this._mintToken();
    } catch (e) {
      const status = (e as { status?: unknown } | null)?.status;
      if (status === 400 || status === 403) {
        log.warn({ tags: ["retry"] }, `익명 토큰 오류 ${status}. secret을 다시 추출해 재시도합니다`);
        await this._ensureState(true);
        j = await this._mintToken();
      } else throw e;
    }
    this._anonToken = { value: j.accessToken, expiresAt: j.accessTokenExpirationTimestampMs || Date.now() + 3600000 };
    return this._anonToken.value;
  },

  async _query(operationName: string, hashKey: string, variables: Record<string, unknown>): Promise<unknown> {
    const run = async () => {
      const state = await this._ensureState(false);
      // 번들에서 못 찾은 해시. 해시 만료와 같이 다시 뽑게 한다
      if (!state.hashes[hashKey]) throw Object.assign(new Error(`${hashKey} 해시가 없습니다(번들에서 못 찾음)`), { persistedNotFound: true });
      const tok = await this._token();
      const r = await send(PARTNER, { method: "POST", headers: partnerHeaders(tok, state.clientVersion), body: JSON.stringify({ operationName, variables, extensions: { persistedQuery: { version: 1, sha256Hash: state.hashes[hashKey] } } }), signal: AbortSignal.timeout(TIMEOUT_MS) });
      const text = await r.text();
      let j: { data?: unknown; errors?: Array<{ message?: string }> };
      try {
        j = JSON.parse(text);
      } catch {
        throw new Error(`GraphQL 응답 파싱 실패 ${r.status}`);
      }
      if (j.errors) {
        const msg = j.errors[0]?.message || "GraphQL 오류";
        throw Object.assign(new Error(msg), { persistedNotFound: /persistedquery/i.test(msg) && /not.?found/i.test(msg) });
      }
      return j.data;
    };
    try {
      return await run();
    } catch (e) {
      if ((e as { persistedNotFound?: boolean } | null)?.persistedNotFound) {
        log.warn({ tags: ["retry"] }, "저장된 해시 만료. 다시 추출해 재시도합니다");
        await this._ensureState(true);
        return run();
      }
      throw e;
    }
  },

  // offset부터 재생 가능한 곡을 limit개까지. 원본 위치는 임의 접근이라 어느 구간이든 요청 비용이 같다.
  async playlist(id: string, { offset = 0, limit = config.bot.playlistAddDefault }: Range = {}, over: Partial<Net> = {}): Promise<Part> {
    const { query } = net(over);
    const PAGE = 100;
    const MAX_PAGES = 200; // 무한루프 가드
    const out: SpotifyTrack[] = [];
    let cursor = offset;
    let total: number | null = null;
    for (let page = 0; page < MAX_PAGES && out.length < limit; page++) {
      const want = Math.min(PAGE, limit - out.length);
      const page = await playlistPage(query, id, cursor, want);
      const items = page.items;
      if (total == null) total = page.total;
      out.push(...playable(items));
      // 재생할 수 없는 곡은 건너뛰므로 받은 곡 수와 원본 위치가 어긋난다. 다음 위치는 원본 기준으로 센다
      cursor += items.length;
      if (items.length < want) break;
      if (total != null && cursor >= total) break;
    }
    return { tracks: out, total, nextOffset: cursor };
  },

  async artist(id: string, over: Partial<Net> = {}) {
    const data = (await net(over).query("queryArtistOverview", "queryArtistOverview", { uri: `spotify:artist:${id}`, locale: "", includePrerelease: false })) as GqlArtist | null;
    const items = data?.artistUnion?.discography?.topTracks?.items || [];
    return items.map((it) => normGqlTrack(it.track)).filter(isTrack);
  },
};

// ── 라우팅 정책 (유일한 정책 지점) ──
// 각 타입 → 시도할 백엔드 순서. 앞이 실패/빈결과면 다음으로 폴백.
// 모든 경로는 { tracks, total(모르면 null), nextOffset(원본 목록 기준 다음 위치) }를 돌려준다.
// 인기곡처럼 통째로만 오는 목록은 받은 뒤 구간을 자른다.
function sliceWhole(tracks: SpotifyTrack[], { offset = 0, limit = config.bot.playlistAddDefault }: Range = {}): Part {
  const part = tracks.slice(offset, offset + limit);
  return { tracks: part, total: tracks.length, nextOffset: offset + part.length };
}

type Route = (id: string, o: Range, over: Partial<Net>) => Promise<Part>;
const ROUTES: Record<string, Route[]> = {
  track: [async (id, _o, over) => ({ tracks: await official.track(id, over), total: null, nextOffset: null })],
  album: [(id, o, over) => official.album(id, o, over)],
  artist: [async (id, o, over) => sliceWhole(await official.artist(id, over), o), async (id, o, over) => sliceWhole(await graphql.artist(id, over), o)],
  playlist: [(id, o, over) => graphql.playlist(id, o, over)],
};

async function resolveType(type: string, id: string, options: Range, over: Partial<Net>): Promise<Part> {
  const empty: Part = { tracks: [], total: null, nextOffset: null };
  const chain = Object.hasOwn(ROUTES, type) ? ROUTES[type] : undefined;
  if (!chain) return empty;
  for (let i = 0; i < chain.length; i++) {
    const last = i === chain.length - 1;
    try {
      const result = await chain[i](id, options, over);
      if (result.tracks.length || last) return result;
      // 빈 결과 + 폴백 남음 → 다음 시도
    } catch (e) {
      log.warn({ sub: type }, `${i === 0 ? "주 경로" : "폴백"} 실패: ${messageOf(e)}${last ? "" : ", 폴백 전환"}`);
      if (last) return empty;
    }
  }
  return empty;
}

// ── 외부 계약 (sources/lookup 이 쓰는 것) ──

// 여러 곡 출처는 필요한 구간만 받는다
// over: 요청 함수 가짜(테스트). 생략하면 진짜
async function getCollection(url: string, { offset = 0, limit = config.bot.playlistAddDefault }: Range = {}, over: Partial<Net> = {}): Promise<Part> {
  const { type, id } = parseSpotifyURL(url);
  if (!type || !id) return { tracks: [], total: null, nextOffset: null };
  const result = await resolveType(type, id, { offset, limit }, over);
  const { tracks, total } = result;
  const head = tracks[0] ? `"${tracks[0].title}" - ${tracks[0].artist}${tracks.length > 1 ? ` 외 ${tracks.length - 1}곡` : ""}` : "결과 없음";
  const range = total != null && total > tracks.length ? ` (전체 ${total}곡 중 ${offset + 1}번째부터)` : "";
  log.info(`${type} ${id} → ${tracks.length}곡${range}: ${head}`);
  return result;
}

async function getFromURL(url: string): Promise<SpotifyTrack[]> {
  return (await getCollection(url)).tracks;
}

async function search(query: string, limit = 1): Promise<SpotifyTrack[]> {
  if (isSpotifyURL(query)) return getFromURL(query);
  try {
    return await official.search(query, limit);
  } catch (e) {
    log.warn(`검색 실패: ${messageOf(e)}`);
    return [];
  }
}

// 테스트 시임. 받아 둔 토큰과 익명 상태를 버린다(프로세스를 새로 띄운 것처럼)
function _reset() {
  official._token = null;
  graphql._anonToken = null;
  graphql._state = null;
  graphql._failedAt = 0;
}

// 테스트용 노출. 프로바이더는 요청 함수(get · query)를 인자로 받아 네트워크 없이 검증한다
const _internals = { deriveKey, totp, normApiTrack, normGqlTrack, pickImageUrl, parseSecrets, official, graphql };

export { getCollection, getFromURL, search, _reset, _internals, useFetch };
export type { SpotifyTrack, Part, Net };
