// Last.fm 소스.

import config from "../../config/index.ts";
import { pick, rand, query, getJson, probe } from "./http.ts";
import type { KeyCheck } from "../../rules/service-keys.ts";
import type { GenreSource } from "../../config/genres.ts";
import type { Candidate } from "./candidate.ts";

// 여기서 읽는 필드만
type TopTracks = { tracks?: { track?: Array<{ name?: string; url?: string; artist?: { name?: string } }> } };

// ── lastfm ────────────────────────────────────────────────────────────────
// 길이를 안 준다(정 유형). 깊은 쪽이 오히려 알차므로 무작위 쪽을 퍼 올린다.
async function lastfm(source: GenreSource): Promise<Candidate[]> {
  const key = config.sources?.lastfmKey;
  if (!key) throw new Error("Last.fm 키가 없습니다");
  const tag = pick(source.tags || []);
  if (!tag) return [];

  const page = 1 + rand(Math.max(1, Number(source.pages) || 5));
  const url = `https://ws.audioscrobbler.com/2.0/?${query({ method: "tag.getTopTracks", tag, limit: 1000, page, api_key: key, format: "json" })}`;
  const list = (await getJson<TopTracks | null>("lastfm", url))?.tracks?.track || [];
  return list
    .map((t) => {
      const [artist, title] = [t.artist?.name || "", t.name || ""];
      // Last.fm 곡 페이지가 곧 출처 주소다. 없으면 아티스트와 제목으로 가른다(빈 것은 아래에서 빠진다)
      return { artist, title, sourceUrl: t.url || undefined, platform: "lastfm", sourceKey: t.url || `${artist}|${title}` };
    })
    .filter((t) => t.artist && t.title);
}

/** 저장된 키로 Last.fm 에 한 번 묻는다(운영자 패널의 연결 테스트). 10: 틀린 키, 26: 막힌 키 */
async function checkLastfmKey(): Promise<KeyCheck> {
  const key = config.sources?.lastfmKey;
  if (!key) return { ok: false, reason: "missing" };
  const res = await probe("lastfm", `https://ws.audioscrobbler.com/2.0/?${query({ method: "tag.getInfo", tag: "rock", api_key: key, format: "json" })}`);
  if (!res) return { ok: false, reason: "unreachable" };
  const body = (await res.json().catch(() => null)) as { error?: number } | null;
  if (res.ok && body && !body.error) return { ok: true };
  return body?.error === 10 || body?.error === 26 || res.status === 403 ? { ok: false, reason: "rejected" } : { ok: false, reason: "unreachable" };
}

export { lastfm, checkLastfmKey };
