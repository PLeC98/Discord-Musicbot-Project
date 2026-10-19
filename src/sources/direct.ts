import { createHash } from "node:crypto";
import path from "path";
import { inputKind } from "../rules/input-kind.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "link" });
import * as SafeUrl from "../infra/safe-url.ts";
import { messageOf, codedError, codeOf } from "../rules/error-kind.ts";
import * as embeddedArt from "./embedded-art.ts";
import { openLink, OPEN_ACCEPT, type AudioStream, type StreamNet, type Opened } from "./direct-open.ts";
import { openHls, type Hls } from "./hls.ts";
import { audioKeyOf } from "../rules/audio-key-of.ts";
import type { Tags as FileTags } from "./file-tags.ts";

/**
 * tags: 본문의 태그를 읽어 넘길 곳(곡 찾기만). 1.5초 안에 읽으면 돌려주기 전에, 아니면 나중에 부른다. 없으면 헤더만 보고 끊는다.
 * net 은 테스트가 가짜를 넘기는 곳
 */
type InfoOptions = { tags?: (track: DirectTrack, tags: FileTags) => void; net?: StreamNet };

/** 홉마다의 응답 대기. 재생을 시작하는 길(지정한 음원이 라디오인지)도 부르므로 HEAD 와 같다 */
const INFO_ACCEPT: SafeUrl.Accept = { ...OPEN_ACCEPT, timeoutMs: SafeUrl.HEAD_TIMEOUT_MS };
/** 담기 응답이 태그를 기다리는 시간(요청을 보낸 때부터). 넘으면 파일 이름으로 담고 마저 읽는다(결과는 embedded-art 가 기억하고 알린다) */
const TAG_WAIT_MS = 1500;

/**
 * 직접 링크의 곡 정보. GET 하나(direct-open)로 무엇인지 판정하고, 응답 헤더로 종류 · 크기 · 파일 이름 · 라디오를 보고, tags 를 주면 본문 머리의 태그를 읽는다.
 * HLS 는 목록으로 VOD(길이) · 라이브를 본다. 단순 목록(PLS · M3U)은 첫 주소를 열어 본다(곡의 음원 주소는 목록 주소 그대로, 열 때마다 다시 푼다).
 * 다른 플랫폼의 search()와 동일한 배열 계약을 따른다. 직접 링크가 아니면 [], 음원이 아니면(웹 페이지 · 그림 등) unsupported-link, 링크를 열지 못하면 direct-unavailable 로 던진다.
 * 네트워크 요청은 SafeUrl(SSRF 가드)을 통과한다. HEAD 를 거절하는 서버(AnimeThemes CDN 의 403)에서도 된다
 */
async function getInfo(url: string, { tags, net = { getStream: SafeUrl.getStream } }: InfoOptions = {}): Promise<DirectTrack[]> {
  const started = Date.now();
  let body: AudioStream | null = null;
  try {
    if (inputKind(url) !== "direct") return [];

    // SSRF 가드를 지나는 GET 하나로 판정한다. 종류 · 크기도 거기서 본다
    const opened = await openFollowing(url, { net, accept: INFO_ACCEPT });
    if (opened.kind === "hls") return [hlsTrack(url, await openHls(opened.text, opened.url, { net }))];
    if (opened.kind !== "file") throw notAudio(opened.kind);
    body = opened.body;
    const { radio } = opened;
    const track = trackOf(url, opened.headers, radio);
    // 라디오는 끝이 없어 본문을 읽지 않는다
    if (!tags || radio) return [track];
    const source = body;
    body = null;
    const reading = embeddedArt.readFromBody(audioKeyOf(url) ?? url, url, source).then(
      (read) => {
        if (read) tags(track, read);
      },
      (error) => log.debug(`직접 링크 태그를 읽지 못함(파일 이름으로): ${messageOf(error)}`),
    );
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([reading, new Promise((resolve) => (timer = setTimeout(resolve, Math.max(0, TAG_WAIT_MS - (Date.now() - started)))))]);
    clearTimeout(timer);
    return [track];
  } catch (error) {
    // 음원이 아닌 링크 · 옛 SHOUTcast 는 그대로(곡 찾기가 그 문장으로). 받은 응답을 보고 안 것이라 숨길 것이 없다
    if (judged(error)) throw error;
    // SSRF 오라클 방지: 차단 사유(막힌 주소)는 원인에만 둔다. 곡 찾기가 로그 한 줄에 원인을 붙인다
    throw codedError("direct-unavailable", "재생할 수 없는 링크입니다", { cause: error });
  } finally {
    body?.destroy();
  }
}

/** 응답 헤더로 만든 곡(제목 · 크기 · 종류 · 파일 이름 · 라디오) */
function trackOf(url: string, headers: Record<string, unknown>, radio: boolean): DirectTrack {
  const contentType = String(headers["content-type"] || "");
  const contentLength = headers["content-length"];

  // 서버가 알려 준 파일 이름이 먼저다(서명된 주소 · 다운로드 주소는 경로가 파일 이름이 아닐 수 있다)
  const urlPath = new URL(url).pathname;
  const filename = dispositionName(headers["content-disposition"]) || path.basename(urlPath);
  const extension = path.extname(filename).toLowerCase();
  return {
    title: titleOf(filename, headers, radio) ?? new URL(url).hostname,
    // 서명된 주소는 쿼리에 토큰이 있어 다듬지 않는다(canonicalUrl 도 그대로 돌려준다)
    pageUrl: url,
    requestKey: url,
    audioUrl: url,
    // 크기로 길이를 어림하면 VBR 에서 크게 어긋난다. 모르는 채로 두고 다운로드한 뒤 잰 값으로 채운다(cacheDownload)
    duration: 0,
    durationSource: "unknown",
    // 인터넷 라디오(Icecast · SHOUTcast)는 icy-* 헤더를 붙인다(radio). 끝이 없는 방송이라 라이브로 다룬다(위치 이동 · 반복 · 캐시 없음)
    ...(radio ? { isLive: true, liveStatus: "is_live" } : {}),
    // 곡에 그림 주소는 없다. 파일 태그의 그림은 따로 찾는다
    thumbnail: null,
    platform: "direct",
    id: generateId(url),
    fileSize: contentLength ? parseInt(String(contentLength)) : null,
    contentType: contentType,
    extension: extension,
    filename: filename,
  };
}

/** HLS 곡. 라이브면 라이브로(캐시 · 위치 이동 없음), VOD 면 목록의 길이. 제목은 호스트(목록 파일 이름은 index · playlist 같은 이름이다) */
function hlsTrack(url: string, hls: Hls): DirectTrack {
  const track = { ...trackOf(url, {}, false), title: new URL(url).hostname };
  if (hls.live) return { ...track, isLive: true, liveStatus: "is_live" };
  return { ...track, duration: (hls.durationMs ?? 0) / 1000, durationSource: "provided" };
}

/** 음원이 아닌 응답의 거절(받은 응답을 보고 안 것이라 숨기지 않는다) */
const notAudio = (kind: string) => codedError("unsupported-link", `음원이 아닌 링크입니다(${kind})`);
/** 받은 응답으로 판정한 거절(숨기지 않는다) */
const judged = (error: unknown) => ["unsupported-link", "shoutcast-v1"].includes(String(codeOf(error)));

/** 목록 안의 목록은 한 번까지 따라간다 */
const LIST_DEPTH = 2;

/** 열고, 단순 목록이면 그 첫 주소를 다시 연다(가드도 다시). 목록에 주소가 없거나 너무 깊으면 unsupported-link */
async function openFollowing(url: string, options: Parameters<typeof openLink>[1], depth = 0): Promise<Exclude<Opened, { kind: "list" }>> {
  const opened = await openLink(url, options);
  if (opened.kind !== "list") return opened;
  if (!opened.target || depth >= LIST_DEPTH) throw notAudio(opened.target ? "목록이 너무 깊음" : "빈 목록");
  return openFollowing(opened.target, options, depth + 1);
}

/** 재생 · 다운로드 · 재생 테스트가 여는 것: 파일(본문 · 인터넷 라디오인가) 또는 HLS(조각은 media 가 받는다) */
type DirectOpen = { kind: "file"; body: AudioStream; radio: boolean; length: number | null } | { kind: "hls"; hls: Hls };

/**
 * 재생 · 다운로드용으로 연다(SSRF 가드를 지난 GET 하나, direct-open 으로 판정). 직접 링크 파일은 주소로 위치를 옮길 수 없어 위치 이동은 ffmpeg 가 한다.
 * 음원이 아니면(웹 페이지 · DRM 등) unsupported-link, 열지 못하면 direct-unavailable. net 은 테스트가 가짜를 넘기는 곳
 */
async function open(url: string, net: StreamNet = { getStream: SafeUrl.getStream }, opts: { bodyIdleMs?: number } = {}): Promise<DirectOpen> {
  let opened: Opened;
  try {
    if (inputKind(url) !== "direct") throw new Error("직접 링크가 아님");
    opened = await openFollowing(url, { net, ...opts });
    if (opened.kind === "hls") return { kind: "hls", hls: await openHls(opened.text, opened.url, { net }) };
  } catch (error) {
    if (judged(error)) throw error;
    // SSRF 오라클 방지: 차단 사유는 로그로만, 사용자에겐 일반화된 오류만 (cause는 스택용. 사용자 노출 없음)
    log.error("직접 링크 스트림 실패:", messageOf(error));
    throw codedError("direct-unavailable", "재생할 수 없는 링크입니다", { cause: error });
  }
  if (opened.kind !== "file") throw notAudio(opened.kind);
  return { kind: "file", body: opened.body, radio: opened.radio, length: opened.length };
}

// 주소의 퍼센트 인코딩을 푼다. 깨진 인코딩이면 그대로
function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * 파일 이름에서 제목. 확장자를 떼고 인코딩을 푼다. 띄어쓰기가 없는 이름(my-song_name)만 구분자를 공백으로 바꾼다.
 * 대소문자는 건드리지 않는다(iPhone 같은 이름을 바꾼다). 다운로드한 뒤 파일의 태그가 있으면 그쪽으로 고친다(media/cache-download)
 */
function extractTitle(filename: string): string | null {
  const name = decoded(path.parse(filename).name);
  const title = /\s/.test(name) ? name.replace(/_+/g, " ") : name.replace(/[-_.]+/g, " ");
  return title.replace(/\s+/g, " ").trim() || null;
}

/** 방송 이름(icy-name). 헤더는 latin1 로 읽히므로 UTF-8 로 맞으면 그것으로 */
function stationName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const utf8 = Buffer.from(value, "latin1").toString("utf8");
  return (utf8.includes("\uFFFD") ? value : utf8).trim() || null;
}

/** 담을 때의 제목: 인터넷 라디오는 방송 이름, 아니면 파일 이름. 둘 다 없으면 null(부르는 쪽이 호스트로) */
function titleOf(filename: string, headers: Record<string, unknown>, radio: boolean): string | null {
  return (radio ? stationName(headers["icy-name"]) : null) ?? extractTitle(filename);
}

/** Content-Disposition 의 파일 이름(filename* 가 먼저). 없으면 null */
function dispositionName(header: unknown): string | null {
  const text = String(header || "");
  const star = text.match(/filename\*\s*=\s*[^']*'[^']*'([^;]+)/i);
  if (star) return decoded(star[1].trim());
  const plain = text.match(/filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i);
  return plain ? (plain[1] ?? plain[2]).trim() : null;
}

// 주소 전체의 해시. 같은 호스트의 다른 파일이 같은 ID 가 되지 않게
function generateId(url: string): string {
  return createHash("sha256").update(url).digest("base64url").slice(0, 16);
}

type DirectTrack = {
  title: string | null;
  pageUrl: string;
  requestKey: string;
  audioUrl: string;
  duration: number;
  durationSource: "unknown" | "provided";
  isLive?: boolean;
  liveStatus?: string;
  thumbnail: null;
  platform: string;
  id: string;
  fileSize: number | null;
  contentType: string;
  extension: string;
  filename: string;
  artist?: string;
  album?: string | null;
};

export { getInfo, open, extractTitle, generateId };
export type { AudioStream, StreamNet, InfoOptions, DirectTrack, DirectOpen };
