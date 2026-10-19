// 판정: 직접 링크의 응답이 무엇인가. 보는 것은 응답 헤더(Content-Type)와 본문 앞부분뿐이다(통신 없음). 화면은 부르지 않는다(file-type).
//   audio  음원(파일 · 인터넷 라디오)
//   hls    HLS 재생목록(#EXTM3U 에 #EXT-X- 줄)
//   list   단순 목록(PLS · 주소 줄만 있는 M3U). 첫 주소로 다시 판정한다
//   page   웹 페이지. "알 수 없는 링크"로 거절한다
//   other  그 밖(그림 · 문서 · 모르는 바이트). 거절한다
// 앞부분이 헤더보다 앞선다(거짓 Content-Type). application/octet-stream · text/plain 은 오디오 · 재생목록 둘 다 흔하다.
// 형식 판별은 file-type 이 하고, 그것이 하지 않는 넷(#EXTM3U · [playlist] · 맨 앞 '<' · MPEG 프레임 둘 연속)만 여기서 본다

import { fileTypeFromBuffer } from "file-type";

type LinkContent = "audio" | "hls" | "list" | "page" | "other";

/** 판정에 읽는 앞부분(file-type 이 보는 양) */
const HEAD_BYTES = 4100;

const HLS_TYPES = new Set(["application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/mpegurl", "audio/x-mpegurl"]);
const PLS_TYPES = new Set(["audio/x-scpls", "application/pls+xml"]);

/** Content-Type 의 형식 부분(소문자, 매개변수 뺌) */
const mimeOf = (contentType: string | null | undefined) => (contentType ?? "").split(";")[0].trim().toLowerCase();

/** 앞부분의 글자(BOM 뺌, 앞 공백 뺌) */
function textOf(head: Uint8Array) {
  return new TextDecoder("utf-8", { fatal: false })
    .decode(head.subarray(0, 1024))
    .replace(/^\uFEFF/, "")
    .trimStart();
}

// MPEG 오디오 프레임 머리의 길이(바이트). 머리가 아니면 0. layer I · II · III, MPEG 1 · 2 · 2.5
const BITRATES: Record<string, number[]> = {
  "1-1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
function mpegFrameLength(b: Uint8Array, at: number): number {
  if (at + 4 > b.length || b[at] !== 0xff || (b[at + 1] & 0xe0) !== 0xe0) return 0;
  const version = (b[at + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
  const layer = 4 - ((b[at + 1] >> 1) & 3); // 1 · 2 · 3
  const bitrateIndex = b[at + 2] >> 4;
  const rateIndex = (b[at + 2] >> 2) & 3;
  if (version === 1 || layer === 4 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return 0;
  const table = version === 3 ? BITRATES[`1-${layer}`] : BITRATES[`2-${layer === 1 ? 1 : 2}`];
  const bitrate = table[bitrateIndex] * 1000;
  const rate = RATES[version][rateIndex];
  const padding = (b[at + 2] >> 1) & 1;
  if (layer === 1) return Math.floor((12 * bitrate) / rate + padding) * 4;
  const perFrame = layer === 3 && version !== 3 ? 72 : 144;
  return Math.floor((perFrame * bitrate) / rate) + padding;
}

// ADTS(AAC) 프레임 머리의 길이. 머리가 아니면 0
function adtsFrameLength(b: Uint8Array, at: number): number {
  if (at + 7 > b.length || b[at] !== 0xff || (b[at + 1] & 0xf6) !== 0xf0) return 0;
  const length = ((b[at + 3] & 3) << 11) | (b[at + 4] << 3) | (b[at + 5] >> 5);
  return length >= 7 ? length : 0;
}

/** 앞부분 어딘가에서 프레임 둘이 잇달아 나오는가(MPEG 오디오 · ADTS). 우연히 맞은 동기 바이트를 거른다 */
function twoFrames(head: Uint8Array): boolean {
  for (let at = 0; at + 8 < head.length; at++) {
    for (const lengthAt of [mpegFrameLength, adtsFrameLength]) {
      const length = lengthAt(head, at);
      if (length > 0 && at + length + 4 <= head.length && lengthAt(head, at + length) > 0) return true;
    }
  }
  return false;
}

const startsWithId3 = (head: Uint8Array) => head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33;

const isMedia = (mime: string) => mime.startsWith("audio/") || mime.startsWith("video/");

/** 앞부분의 글만으로 아는 것(재생목록 · 목록 · 웹 페이지). 모르면 null */
function byText(text: string): LinkContent | null {
  if (text.startsWith("#EXTM3U")) return /^#EXT-X-/m.test(text) ? "hls" : "list";
  if (/^\[playlist\]/i.test(text)) return "list";
  return text.startsWith("<") ? "page" : null;
}

/** file-type 이 알아본 형식. 동기 바이트로만 알아본 MPEG · ADTS 는 프레임 둘이 이어야 믿는다(ID3 로 시작하면 그대로) */
function bySniff(sniffed: { ext: string; mime: string }, head: Uint8Array, mime: string): LinkContent {
  if (!isMedia(sniffed.mime)) return "other";
  const bySync = (sniffed.ext === "mp3" || sniffed.ext === "mp2" || sniffed.ext === "aac") && !startsWithId3(head);
  if (bySync && !twoFrames(head)) return mime.startsWith("audio/") ? "audio" : "other";
  return "audio";
}

/** 헤더만으로 아는 것 */
function byHeader(mime: string, text: string): LinkContent {
  // 재생목록 · 목록 형식이라 하는데 글이 #EXTM3U · [playlist] 가 아니면 주소 줄만 있는 목록이다
  if (HLS_TYPES.has(mime) || PLS_TYPES.has(mime)) return /^https?:\/\//im.test(text) ? "list" : "other";
  if (mime === "text/html" || mime === "application/xhtml+xml") return "page";
  // 앞부분으로 모르지만 헤더가 음원이라 한다(라디오가 프레임 중간부터 흘리는 등)
  return isMedia(mime) ? "audio" : "other";
}

/** 응답이 무엇인가. head 는 본문 앞부분(HEAD_BYTES 쯤, 짧으면 받은 만큼) */
async function contentOf(contentType: string | null | undefined, head: Uint8Array): Promise<LinkContent> {
  const text = textOf(head);
  const known = byText(text);
  if (known) return known;
  const mime = mimeOf(contentType);
  const sniffed = head.length > 0 ? await fileTypeFromBuffer(head) : undefined;
  return sniffed ? bySniff(sniffed, head, mime) : byHeader(mime, text);
}

/**
 * 단순 목록(PLS · M3U)의 첫 주소. 상대 주소는 목록 주소 기준으로 푼다. http(s) 만. 없으면 null
 * PLS: File1=… 줄, M3U: # 로 시작하지 않는 줄
 */
function listTarget(text: string, baseUrl: string): string | null {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const pls = /^\s*\[playlist\]/i.test(lines[0] ?? "");
  for (const raw of lines) {
    const line = raw.trim();
    const value = pls ? /^file\d+\s*=\s*(.+)$/i.exec(line)?.[1] : line && !line.startsWith("#") ? line : undefined;
    if (!value) continue;
    try {
      const url = new URL(value.trim(), baseUrl);
      if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    } catch {
      /* 주소가 아닌 줄 */
    }
  }
  return null;
}

export { contentOf, listTarget, HEAD_BYTES };
export type { LinkContent };
