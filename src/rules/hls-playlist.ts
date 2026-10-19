// HLS 재생목록(RFC 8216) 해석. 보는 것은 목록 글과 그 주소뿐이다(통신 없음).
// 상위 목록은 화질 · 음성 고르기를, 하위 목록은 조각(주소 · 바이트 구간 · 머리 조각 · 키 · 순번)과 끝 표시를 준다. 상대 주소는 목록 주소로 풀고 http(s) 만 남긴다

type ByteRange = { offset: number; length: number };
type Key = { method: "NONE" | "AES-128" | "OTHER"; url: string | null; iv: Uint8Array | null };
type Segment = { url: string; duration: number; sequence: number; range: ByteRange | null; init: { url: string; range: ByteRange | null } | null; key: Key | null; discontinuity: boolean };
type MediaPlaylist = { kind: "media"; targetDuration: number; mediaSequence: number; ended: boolean; segments: Segment[] };
type Variant = { url: string; bandwidth: number; audioGroup: string | null; codecs: string | null };
type Rendition = { url: string; groupId: string; isDefault: boolean; autoselect: boolean };
type MasterPlaylist = { kind: "master"; variants: Variant[]; audio: Rendition[] };
type Playlist = MasterPlaylist | MediaPlaylist;

/** 속성 목록(KEY=VALUE, 따옴표 안의 쉼표는 값) */
function attributesOf(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/([A-Z0-9-]+)=("([^"]*)"|[^,]*)/g)) out[m[1]] = m[3] ?? m[2];
  return out;
}

/** 목록 기준의 http(s) 주소. 아니면 null */
function resolve(uri: string | undefined, base: string): string | null {
  if (!uri) return null;
  try {
    const url = new URL(uri.trim(), base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** "길이[@오프셋]". 오프셋이 없으면 앞 구간 끝에서 잇는다(같은 주소일 때) */
function byteRangeOf(value: string | undefined, previousEnd: number): ByteRange | null {
  const m = /^(\d+)(?:@(\d+))?$/.exec(value?.trim() ?? "");
  return m ? { length: Number(m[1]), offset: m[2] === undefined ? previousEnd : Number(m[2]) } : null;
}

function ivOf(value: string | undefined): Uint8Array | null {
  const hex = /^0x([0-9a-f]{1,32})$/i.exec(value?.trim() ?? "")?.[1];
  if (!hex) return null;
  const bytes = new Uint8Array(16);
  const padded = hex.padStart(32, "0");
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** 상위 목록: 화질(#EXT-X-STREAM-INF 다음 줄의 주소)과 음성 따로(#EXT-X-MEDIA:TYPE=AUDIO) */
function parseMaster(lines: string[], baseUrl: string): MasterPlaylist {
  const variants: Variant[] = [];
  const audio: Rendition[] = [];
  lines.forEach((line, i) => {
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const a = attributesOf(line.slice(18));
      const url = resolve(lines[i + 1]?.startsWith("#") ? undefined : lines[i + 1], baseUrl);
      if (url) variants.push({ url, bandwidth: Number(a["BANDWIDTH"]) || 0, audioGroup: a["AUDIO"] ?? null, codecs: a["CODECS"] ?? null });
    } else if (line.startsWith("#EXT-X-MEDIA:")) {
      const a = attributesOf(line.slice(13));
      const url = resolve(a["URI"], baseUrl);
      if (a["TYPE"] === "AUDIO" && url) audio.push({ url, groupId: a["GROUP-ID"] ?? "", isDefault: a["DEFAULT"] === "YES", autoselect: a["AUTOSELECT"] === "YES" });
    }
  });
  return { kind: "master", variants, audio };
}

/** 하위 목록을 읽는 동안 다음 조각에 걸릴 것 */
type Pending = { duration: number; range: ByteRange | null; init: Segment["init"]; key: Key | null; discontinuity: boolean };

/** 조각 앞의 태그 하나를 읽어 목록 · 다음 조각에 적는다 */
const MEDIA_TAGS: Array<[string, (value: string, out: MediaPlaylist, next: Pending, baseUrl: string) => void]> = [
  ["#EXT-X-TARGETDURATION:", (v, out) => (out.targetDuration = Number(v) || 0)],
  ["#EXT-X-MEDIA-SEQUENCE:", (v, out) => (out.mediaSequence = Number(v) || 0)],
  ["#EXTINF:", (v, _out, next) => (next.duration = parseFloat(v) || 0)],
  // 오프셋이 없으면 -1(같은 주소의 앞 구간 끝에서 잇는다)
  ["#EXT-X-BYTERANGE:", (v, _out, next) => (next.range = byteRangeOf(v, -1))],
  [
    "#EXT-X-MAP:",
    (v, _out, next, baseUrl) => {
      const a = attributesOf(v);
      const url = resolve(a["URI"], baseUrl);
      next.init = url ? { url, range: byteRangeOf(a["BYTERANGE"], 0) } : null;
    },
  ],
  [
    "#EXT-X-KEY:",
    (v, _out, next, baseUrl) => {
      const a = attributesOf(v);
      const method = a["METHOD"] === "NONE" ? "NONE" : a["METHOD"] === "AES-128" ? "AES-128" : "OTHER";
      next.key = method === "NONE" ? null : { method, url: resolve(a["URI"], baseUrl), iv: ivOf(a["IV"]) };
    },
  ],
];

/** 하위 목록: 조각과 그 앞의 태그. 머리 조각 · 키는 바뀔 때까지 뒤 조각에 이어진다 */
function parseMedia(lines: string[], baseUrl: string): MediaPlaylist {
  const out: MediaPlaylist = { kind: "media", targetDuration: 0, mediaSequence: 0, ended: false, segments: [] };
  const next: Pending = { duration: 0, range: null, init: null, key: null, discontinuity: false };
  const ends = new Map<string, number>(); // 주소마다 앞 구간의 끝(오프셋 없는 BYTERANGE)
  for (const line of lines) {
    if (line === "#EXT-X-ENDLIST") out.ended = true;
    else if (line === "#EXT-X-DISCONTINUITY") next.discontinuity = true;
    else if (line.startsWith("#")) {
      const tag = MEDIA_TAGS.find(([name]) => line.startsWith(name));
      tag?.[1](line.slice(tag[0].length), out, next, baseUrl);
    } else {
      const url = resolve(line, baseUrl);
      if (url) {
        const range = next.range ? { length: next.range.length, offset: next.range.offset >= 0 ? next.range.offset : (ends.get(url) ?? 0) } : null;
        if (range) ends.set(url, range.offset + range.length);
        out.segments.push({ url, duration: next.duration, sequence: out.mediaSequence + out.segments.length, range, init: next.init, key: next.key, discontinuity: next.discontinuity });
      }
      Object.assign(next, { duration: 0, range: null, discontinuity: false });
    }
  }
  return out;
}

/** 목록 글을 해석한다. HLS 가 아니면 null */
function parsePlaylist(text: string, baseUrl: string): Playlist | null {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines[0] !== "#EXTM3U") return null;
  return lines.some((line) => line.startsWith("#EXT-X-STREAM-INF:")) ? parseMaster(lines, baseUrl) : parseMedia(lines, baseUrl);
}

/**
 * 상위 목록에서 받을 하위 목록 하나: 음성 따로가 있으면 그것(기본 · 자동 선택 먼저), 없으면 대역폭이 가장 낮은 화질(소리는 같고 받는 양이 가장 적다)
 */
function chooseMedia(master: MasterPlaylist): string | null {
  const audio = [...master.audio].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || Number(b.autoselect) - Number(a.autoselect))[0];
  if (audio) return audio.url;
  const lowest = [...master.variants].sort((a, b) => a.bandwidth - b.bandwidth)[0];
  return lowest?.url ?? null;
}

/** VOD 의 길이(초): 조각 길이의 합(1ms 단위, 더하며 생기는 부동소수점 끝자리를 버린다) */
const lengthOf = (playlist: MediaPlaylist) => Math.round(playlist.segments.reduce((sum, segment) => sum + segment.duration, 0) * 1000) / 1000;

export { parsePlaylist, chooseMedia, lengthOf };
export type { Playlist, MasterPlaylist, MediaPlaylist, Segment, ByteRange, Key };
