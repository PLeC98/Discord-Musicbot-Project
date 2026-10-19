import { createHash } from "node:crypto";
import path from "path";
import * as links from "../rules/links.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "link" });
import * as SafeUrl from "../infra/safe-url.ts";
import type { Readable } from "stream";
import { messageOf, codedError } from "../rules/error-kind.ts";
import * as Tags from "./file-tags.ts";
import type { Tags as FileTags } from "./file-tags.ts";

/** 받는 쪽이 음원의 버전을 헤더에서, 이어 받기가 됐는지를 상태에서 읽는다 */
type AudioStream = Readable & { headers?: Record<string, unknown>; status?: number };
type StreamOptions = { bodyIdleMs?: number; accept?: SafeUrl.Accept; from?: number };
// 바깥 경계(SafeUrl). 테스트가 가짜를 넘긴다
type StreamNet = { getStream: (url: string, deps?: undefined, opts?: StreamOptions) => Promise<AudioStream> };
/**
 * tags: 본문의 태그를 읽어 넘길 곳(곡 찾기만). 1.5초 안에 읽으면 돌려주기 전에, 아니면 나중에 부른다. 없으면 헤더만 보고 끊는다.
 * net 은 테스트가 가짜를 넘기는 곳
 */
type InfoOptions = { tags?: (track: DirectTrack, tags: FileTags) => void; net?: StreamNet };

/** 홉마다의 응답 대기. 재생을 시작하는 길(지정한 음원이 라디오인지)도 부르므로 HEAD 와 같다 */
const INFO_ACCEPT: SafeUrl.Accept = { ...SafeUrl.DIRECT_LINK, timeoutMs: SafeUrl.HEAD_TIMEOUT_MS };
/** 담기 응답이 태그를 기다리는 시간(요청을 보낸 때부터). 넘으면 파일 이름으로 담고 마저 읽는다 */
const TAG_WAIT_MS = 1500;
/** 태그 읽기의 상한(그림이 든 머리 · 끝 moov 포함) */
const TAG_LIMITS = { maxBytes: 8 * 1024 * 1024, timeoutMs: 10_000 };

/**
 * 직접 링크의 곡 정보. GET 하나의 응답 헤더로 종류 · 크기 · 파일 이름 · 라디오를 보고, tags 를 주면 본문 머리의 태그를 읽는다.
 * 다른 플랫폼의 search()와 동일한 배열 계약을 따른다. 직접 링크가 아니면 [], 링크를 열지 못하면 던진다.
 * 네트워크 요청은 SafeUrl(SSRF 가드)을 통과한다. HEAD 를 거절하는 서버(AnimeThemes CDN 의 403)에서도 된다
 */
async function getInfo(url: string, { tags, net = { getStream: SafeUrl.getStream } }: InfoOptions = {}): Promise<DirectTrack[]> {
  const started = Date.now();
  let body: AudioStream | null = null;
  try {
    if (!links.isDirectAudioLink(url)) {
      return [];
    }

    // SSRF 가드를 지나는 GET. 종류 · 크기도 거기서 본다
    body = await net.getStream(url, undefined, { accept: INFO_ACCEPT });
    const headers = (body.headers ?? {}) as Record<string, unknown>;
    const contentType = String(headers["content-type"] || "");
    const contentLength = headers["content-length"];

    // 서버가 알려 준 파일 이름이 먼저다(서명된 주소 · 다운로드 주소는 경로가 파일 이름이 아닐 수 있다)
    const urlPath = new URL(url).pathname;
    const filename = dispositionName(headers["content-disposition"]) || path.basename(urlPath);
    const extension = path.extname(filename).toLowerCase();
    // 인터넷 라디오(Icecast · SHOUTcast)는 icy-* 헤더를 붙인다. 끝이 없는 방송이라 라이브로 다룬다(위치 이동 · 반복 · 캐시 없음)
    const radio = Object.keys(headers).some((name) => name.toLowerCase().startsWith("icy-"));

    const track: DirectTrack = {
      title: extractTitle(filename),
      // 서명된 주소는 쿼리에 토큰이 있어 다듬지 않는다(canonicalUrl 도 그대로 돌려준다)
      pageUrl: url,
      requestKey: url,
      audioUrl: url,
      // 크기로 길이를 어림하면 VBR 에서 크게 어긋난다. 모르는 채로 두고 다운로드한 뒤 잰 값으로 채운다(cacheDownload)
      duration: 0,
      durationSource: "unknown",
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
    // 라디오는 끝이 없어 본문을 읽지 않는다
    if (!tags || radio) return [track];
    const source = body;
    body = null;
    const reading = Tags.fromStream(source, { ...TAG_LIMITS, rangeFrom: (start) => rangeFrom(url, start, net) }).then(
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
    // SSRF 오라클 방지: 차단 사유(막힌 주소)는 원인에만 둔다. 곡 찾기가 로그 한 줄에 원인을 붙인다
    throw codedError("direct-unavailable", "재생할 수 없는 링크입니다", { cause: error });
  } finally {
    body?.destroy();
  }
}

/** 이어 받기(MP4 의 끝 moov). 서버가 그 자리부터 주지 않으면 null */
async function rangeFrom(url: string, start: number, net: StreamNet): Promise<Readable | null> {
  const part = await net.getStream(url, undefined, { accept: INFO_ACCEPT, from: start });
  if (SafeUrl.servedFrom({ status: part.status ?? 200, headers: part.headers ?? {} }) === start) return part;
  part.destroy();
  return null;
}

/**
 * 재생 · 다운로드용 스트림(SSRF 가드를 지난 Readable). 직접 링크는 주소로 위치를 옮길 수 없어 위치 이동은 ffmpeg 가 한다.
 * net 은 테스트가 가짜를 넘기는 곳
 */
async function getStream(url: string, net: StreamNet = { getStream: SafeUrl.getStream }, opts: { bodyIdleMs?: number } = {}): Promise<AudioStream> {
  try {
    if (!links.isDirectAudioLink(url)) {
      throw new Error("지원되지 않는 직접 오디오 파일 링크");
    }
    return await net.getStream(url, undefined, opts);
  } catch (error) {
    // SSRF 오라클 방지: 차단 사유는 로그로만, 사용자에겐 일반화된 오류만 (cause는 스택용. 사용자 노출 없음)
    log.error("직접 링크 스트림 실패:", messageOf(error));
    throw codedError("direct-unavailable", "재생할 수 없는 링크입니다", { cause: error });
  }
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
  durationSource: "unknown";
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

export { getInfo, getStream, extractTitle, generateId };
export type { AudioStream, StreamNet, InfoOptions, DirectTrack };
