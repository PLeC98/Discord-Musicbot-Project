// HLS 재생목록(RFC 8216) 해석. 보는 것은 목록 글과 그 주소뿐이다(통신 없음).
// 상위 목록은 화질, 음성 선택지를, 하위 목록은 세그먼트(주소, 바이트 구간, 초기화 세그먼트, 키, 순번)와 끝 표시를 준다. 상대 주소는 목록 주소로 풀고 http(s) 만 남긴다

import { codedError } from "./error-kind.ts";

type ByteRange = { offset: number; length: number };
type Key = { method: "NONE" | "AES-128" | "OTHER"; url: string | null; iv: Uint8Array | null };
type Segment = { url: string; duration: number; sequence: number; range: ByteRange | null; init: { url: string; range: ByteRange | null } | null; key: Key | null; discontinuity: boolean };
type MediaPlaylist = { kind: "media"; targetDuration: number; mediaSequence: number; ended: boolean; segments: Segment[] };
type Variant = { url: string; bandwidth: number; audioGroup: string | null; codecs: string | null };
type Rendition = { url: string; groupId: string; isDefault: boolean; autoselect: boolean };
type MasterPlaylist = { kind: "master"; variants: Variant[]; audio: Rendition[] };
type Playlist = MasterPlaylist | MediaPlaylist;

/** 목표 길이(초)의 상한. 라이브 목록을 다시 받는 간격이 이것을 따른다 */
const MAX_TARGET_DURATION_S = 60;
/** 세그먼트 하나의 길이(초)의 상한(하루) */
const MAX_SEGMENT_DURATION_S = 86_400;

/** 유한한 0 이상의 수(상한 안), 아니면 0 */
const lengthIn = (value: number, max: number) => (Number.isFinite(value) && value > 0 ? Math.min(value, max) : 0);
/** 0 이상의 안전한 정수, 아니면 null(순번, 바이트 수는 정밀도를 잃으면 엉뚱한 곳을 받는다) */
const countOf = (value: string) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};
/** 첫 순번. 숫자가 아니면 0. 안전한 정수를 넘는 숫자는 오류를 던진다(순번은 이어 받기와 복호화의 IV라 0으로 바꾸면 엉뚱한 곳을 받거나 복호화하지 못한다) */
const sequenceOf = (value: string) => {
  const n = countOf(value);
  if (n === null && /^\s*\d+\s*$/.test(value)) throw codedError("unsupported-link", `HLS 순번이 다룰 수 있는 크기를 넘습니다(${value.trim().slice(0, 30)})`);
  return n ?? 0;
};

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

/** 읽을 수 없는 바이트 구간. 그것을 쓰는 세그먼트가 나올 때 던진다(끝이 잘린 라이브 갱신의 마지막 태그는 쓰는 세그먼트가 없다) */
const BAD_RANGE = "bad";
type RangeTag = ByteRange | typeof BAD_RANGE | null;

/** "길이[@오프셋]". 오프셋이 없으면 앞 구간 끝에서 잇는다(같은 주소일 때). 값이 없으면 null, 있는데 읽을 수 없으면(길이 0, 안전한 정수를 넘음, 끝이 넘침) BAD_RANGE */
function byteRangeOf(value: string | undefined, previousEnd: number): RangeTag {
  if (value === undefined) return null;
  const m = /^(\d+)(?:@(\d+))?$/.exec(value.trim());
  const length = m ? countOf(m[1]) : null;
  const offset = m?.[2] === undefined ? previousEnd : countOf(m[2]);
  if (!length || offset === null || (offset >= 0 && !Number.isSafeInteger(offset + length))) return BAD_RANGE;
  return { length, offset };
}

/** 세그먼트가 쓰는 구간. 읽을 수 없으면 던진다(파일 전체 받기로 바꾸면 그 세그먼트에 파일이 다 들어간다) */
function usedRange(range: RangeTag): ByteRange | null {
  if (range === BAD_RANGE) throw codedError("unsupported-link", "HLS 바이트 구간(BYTERANGE)을 읽을 수 없습니다");
  return range;
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

/** 하위 목록을 읽는 동안 다음 세그먼트에 걸릴 것 */
type Pending = { duration: number; range: RangeTag; init: { url: string; range: RangeTag } | null; key: Key | null; discontinuity: boolean };

/** 세그먼트 앞의 태그 하나를 읽어 목록, 다음 세그먼트에 적는다 */
const MEDIA_TAGS: Array<[string, (value: string, out: MediaPlaylist, next: Pending, baseUrl: string) => void]> = [
  ["#EXT-X-TARGETDURATION:", (v, out) => (out.targetDuration = lengthIn(Number(v), MAX_TARGET_DURATION_S))],
  ["#EXT-X-MEDIA-SEQUENCE:", (v, out) => (out.mediaSequence = sequenceOf(v))],
  ["#EXTINF:", (v, _out, next) => (next.duration = lengthIn(parseFloat(v), MAX_SEGMENT_DURATION_S))],
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

/** 하위 목록: 세그먼트와 그 앞의 태그. 초기화 세그먼트, 키는 바뀔 때까지 뒤 세그먼트에 이어진다 */
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
        const tagged = usedRange(next.range);
        const range = tagged ? { length: tagged.length, offset: tagged.offset >= 0 ? tagged.offset : (ends.get(url) ?? 0) } : null;
        if (range && !Number.isSafeInteger(range.offset + range.length)) usedRange(BAD_RANGE);
        if (range) ends.set(url, range.offset + range.length);
        const init = next.init && { url: next.init.url, range: usedRange(next.init.range) };
        out.segments.push({ url, duration: next.duration, sequence: out.mediaSequence + out.segments.length, range, init, key: next.key, discontinuity: next.discontinuity });
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
 * 상위 목록에서 받을 하위 목록 하나: 음성 따로가 있으면 그것(기본, 자동 선택 먼저), 없으면 대역폭이 가장 낮은 화질(소리는 같고 받는 양이 가장 적다)
 */
function chooseMedia(master: MasterPlaylist): string | null {
  const audio = [...master.audio].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || Number(b.autoselect) - Number(a.autoselect))[0];
  if (audio) return audio.url;
  const lowest = [...master.variants].sort((a, b) => a.bandwidth - b.bandwidth)[0];
  return lowest?.url ?? null;
}

/** VOD 의 길이(초): 세그먼트 길이의 합(1ms 단위, 더하며 생기는 부동소수점 끝자리를 버린다) */
const lengthOf = (playlist: MediaPlaylist) => Math.round(playlist.segments.reduce((sum, segment) => sum + segment.duration, 0) * 1000) / 1000;

export { parsePlaylist, chooseMedia, lengthOf };
export type { Playlist, MasterPlaylist, MediaPlaylist, Segment, ByteRange, Key };
