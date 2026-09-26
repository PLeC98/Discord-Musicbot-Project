import { createHash } from "node:crypto";
import path from "path";
import * as links from "../rules/links.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "link" });
import * as SafeUrl from "../infra/safeUrl.ts";
import type { Readable } from "stream";
import { messageOf, codedError } from "../rules/errorKind.ts";

// 바깥 경계(SafeUrl). 테스트가 가짜를 넘긴다. 여기서 읽는 칸만
type HeadNet = { head: (url: string) => Promise<{ headers: object }> };
/** 받는 쪽이 음원의 판을 헤더에서 읽는다 */
type AudioStream = Readable & { headers?: Record<string, unknown> };
type StreamNet = { getStream: (url: string) => Promise<AudioStream> };

/**
 * 직접 오디오 링크의 메타데이터 조회.
 * 다른 플랫폼의 search()와 동일한 배열 계약을 따른다. 직접 링크가 아니면 [], 링크를 열지 못하면 던진다.
 * 네트워크 요청은 SafeUrl(SSRF 가드)을 통과한다. net 은 테스트가 가짜를 넘기는 자리
 */
async function getInfo(url: string, net: HeadNet = { head: SafeUrl.head }) {
  try {
    if (!links.isDirectAudioLink(url)) {
      return [];
    }

    // SSRF 가드된 HEAD. Content-Type/크기 검증 포함
    const headers = (await net.head(url)).headers as Record<string, unknown>;
    const contentType = String(headers["content-type"] || "");
    const contentLength = headers["content-length"];

    // 서버가 알려 준 파일 이름이 먼저다(서명된 주소 · 다운로드 주소는 경로가 파일 이름이 아닐 수 있다)
    const urlPath = new URL(url).pathname;
    const filename = dispositionName(headers["content-disposition"]) || path.basename(urlPath) || "알 수 없는 파일";
    const extension = path.extname(filename).toLowerCase();
    const estimatedDuration = estimateDuration(contentLength, contentType);

    return [
      {
        title: extractTitle(filename),
        artist: "직접 링크",
        // 서명된 주소는 쿼리에 토큰이 있어 다듬지 않는다(canonicalUrl 도 그대로 돌려준다)
        pageUrl: url,
        requestKey: url,
        audioUrl: url,
        duration: estimatedDuration,
        // Content-Length 기반 추정. 다운로드 후 probeDurationSec가 실측으로 교체한다.
        durationSource: "추정",
        // 임의의 오디오 URL이라 앨범아트를 알 방법이 없다. 대시보드가 파일 아이콘으로 대체 표시한다.
        thumbnail: null,
        platform: "direct",
        id: generateId(url),
        fileSize: contentLength ? parseInt(String(contentLength)) : null,
        contentType: contentType,
        extension: extension,
        filename: filename,
      },
    ];
  } catch (error) {
    // SSRF 오라클 방지: 차단 사유(막힌 주소)는 원인에만 둔다. 곡 찾기가 로그 한 줄에 원인을 붙인다
    throw codedError("link-unavailable", "재생할 수 없는 링크입니다", { cause: error });
  }
}

/**
 * 재생/다운로드용 스트림 획득. SSRF 가드된 Readable 반환.
 * 직접 링크는 URL 기반 탐색을 지원하지 않음. 탐색은 MusicPlayer의 FFmpeg가 처리하므로
 * startSeconds는 여기서 무시한다. net 은 테스트가 가짜를 넘기는 자리
 */
async function getStream(url: string, net: StreamNet = { getStream: SafeUrl.getStream }): Promise<AudioStream> {
  try {
    if (!links.isDirectAudioLink(url)) {
      throw new Error("지원되지 않는 직접 오디오 파일 링크");
    }
    return await net.getStream(url);
  } catch (error) {
    // SSRF 오라클 방지: 차단 사유는 로그로만, 사용자에겐 일반화된 오류만 (cause는 스택용. 사용자 노출 없음)
    log.error("직접 링크 스트림 실패:", messageOf(error));
    throw codedError("link-unavailable", "재생할 수 없는 링크입니다", { cause: error });
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
 * 대소문자는 건드리지 않는다(iPhone 같은 이름을 바꾼다). 받은 뒤 파일의 태그가 있으면 그쪽으로 고친다(media/cacheDownload)
 */
function extractTitle(filename: string): string {
  const name = decoded(path.parse(filename).name);
  const title = /\s/.test(name) ? name.replace(/_+/g, " ") : name.replace(/[-_.]+/g, " ");
  return title.replace(/\s+/g, " ").trim() || "알 수 없는 제목";
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

function estimateDuration(fileSize: unknown, contentType: string): number {
  if (!fileSize) return 0;

  // 파일 크기와 타입을 바탕으로 대략 추정
  // 매우 대략적인 추정값이므로 정확하지 않음
  let estimatedBitrate = 128; // 기본 kbps

  if (contentType.includes("mp3")) {
    estimatedBitrate = 128;
  } else if (contentType.includes("wav")) {
    estimatedBitrate = 1411; // CD 음질
  } else if (contentType.includes("flac")) {
    estimatedBitrate = 1000;
  } else if (contentType.includes("ogg")) {
    estimatedBitrate = 160;
  }

  // 파일 크기를 비트로 변환한 뒤 비트레이트로 나누어 초 단위 계산
  const fileSizeBits = Number(fileSize) * 8; // 헤더에서 온 글자일 수 있다
  const bitratePerSecond = estimatedBitrate * 1000;
  const estimatedSeconds = Math.floor(fileSizeBits / bitratePerSecond);

  return Math.max(0, estimatedSeconds);
}

export { getInfo, getStream, extractTitle, generateId, estimateDuration };
export type { AudioStream, HeadNet, StreamNet };
