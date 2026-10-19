// 직접 링크를 연다: GET 하나(SSRF 가드)의 응답 헤더와 본문 앞부분으로 무엇인지 판정하고(rules/link-content), 읽은 앞부분은 되돌려 넣는다.
// 담을 때 · 재생 · 다운로드 · 재생 테스트 · 파일 태그 찾기가 모두 이것을 지나므로 판정 결과를 곡 · DB 에 적지 않는다.
//   file  본문 Readable(앞부분 포함) · 헤더 · 크기 · 인터넷 라디오(icy-*)인가
//   hls   재생목록 글(작다, 다 받는다)과 그 마지막 주소(리다이렉트를 거친, 상대 주소의 기준)
//   list  단순 목록(PLS · M3U)의 첫 주소. openFollowing 은 그 주소를 다시 연다(목록 안의 목록은 한 번까지)
//   page · other  음원이 아니다(부르는 쪽이 거절한다)
// 옛 SHOUTcast(v1)는 첫 줄을 `ICY 200 OK` 로 답해 Node 가 응답을 읽지 못한다. 그 방송은 shoutcast-v1 로 거절한다(받은 응답으로 안 것이라 숨기지 않는다).

import { PassThrough, type Readable } from "node:stream";
import * as SafeUrl from "../infra/safe-url.ts";
import { contentOf, listTarget, HEAD_BYTES, type LinkContent } from "../rules/link-content.ts";
import { codedError, codeOf } from "../rules/error-kind.ts";

/** 받는 쪽이 음원의 버전을 헤더에서, 이어 받기가 됐는지를 상태에서 읽는다 */
type AudioStream = Readable & { headers?: Record<string, unknown>; status?: number; url?: string };
type OpenOptions = { bodyIdleMs?: number; accept?: SafeUrl.Accept; from?: number; to?: number; ifRange?: string };
// 바깥 경계(SafeUrl). 테스트가 가짜를 넘긴다
type StreamNet = { getStream: (url: string, deps?: undefined, opts?: OpenOptions) => Promise<AudioStream> };

type Opened = { kind: "file"; body: AudioStream; headers: Record<string, unknown>; status: number; length: number | null; radio: boolean } | { kind: "hls"; text: string; url: string } | { kind: "list"; target: string | null } | { kind: "page" | "other" };
type OpenedFile = Extract<Opened, { kind: "file" }>;

/** 판정하려면 웹 페이지 · 그림도 받아 봐야 한다(판정이 거절한다). 크기 상한 · 홉 대기는 음원과 같다 */
const OPEN_ACCEPT: SafeUrl.Accept = { ...SafeUrl.DIRECT_LINK, contentType: /(?:)/ };
/** 재생목록 · 단순 목록은 다 받아 읽는다(작다) */
const LIST_MAX_BYTES = 1024 * 1024;

/** 첫 바이트를 받은 뒤 앞부분을 더 기다리는 시간. 넘으면 받은 만큼으로 판정한다(조금 보내고 멈추는 서버 · 느린 라디오) */
const HEAD_WAIT_MS = 1500;

/** 앞부분을 want 바이트(또는 끝 · 첫 바이트 뒤 HEAD_WAIT_MS)까지 읽는다. 다 읽으면 멈춰 둔다 */
function readHead(stream: Readable, want: number): Promise<{ head: Buffer; ended: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    let timer: NodeJS.Timeout | null = null;
    const done = (ended: boolean) => {
      if (timer) clearTimeout(timer);
      stream.off("data", onData).off("end", onEnd).off("error", onError);
      if (!ended) stream.pause();
      resolve({ head: Buffer.concat(chunks), ended });
    };
    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      length += chunk.length;
      if (length >= want) done(false);
      else timer ??= setTimeout(() => done(false), HEAD_WAIT_MS);
    };
    const onEnd = () => done(true);
    const onError = (error: unknown) => {
      if (timer) clearTimeout(timer);
      stream.off("data", onData).off("end", onEnd);
      reject(error);
    };
    stream.on("data", onData).once("end", onEnd).once("error", onError);
  });
}

/** 읽은 앞부분을 되돌려 넣은 본문. 헤더 · 상태를 그대로 단다 */
function withHead(source: AudioStream, head: Buffer, ended: boolean): AudioStream {
  // 본문을 부수면 원본(연결)도 그 자리에서 부순다
  const passing = new PassThrough({
    destroy(error, callback) {
      source.destroy();
      callback(error);
    },
  });
  const body = Object.assign(passing, { headers: source.headers, status: source.status, url: source.url });
  body.write(head);
  if (ended) body.end();
  else {
    source.once("error", (error) => body.destroy(error));
    source.pipe(body);
    source.resume();
  }
  return body;
}

/** 본문을 끝까지(상한 안에서) 글로 */
async function readAll(source: Readable, head: Buffer, ended: boolean): Promise<string | null> {
  const chunks = [head];
  let length = head.length;
  if (!ended) {
    for await (const chunk of source as AsyncIterable<Buffer>) {
      length += chunk.length;
      if (length > LIST_MAX_BYTES) return null;
      chunks.push(chunk);
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Node 의 HTTP 해석기가 첫 줄 `ICY …`(SHOUTcast v1)를 거절한 오류인가 */
function isIcyStatusLine(error: unknown): boolean {
  const { code, rawPacket } = (error ?? {}) as { code?: unknown; rawPacket?: unknown };
  return code === "HPE_INVALID_CONSTANT" && Buffer.isBuffer(rawPacket) && rawPacket.subarray(0, 4).toString("latin1") === "ICY ";
}

/** 음원으로 연 응답: 헤더 · 크기 · 인터넷 라디오(icy-*)인가. body 는 앞부분을 되돌려 넣은 본문(없으면 원본) */
function fileOf(source: AudioStream, body: AudioStream = source): OpenedFile {
  const headers = (source.headers ?? {}) as Record<string, unknown>;
  const length = Number(headers["content-length"]) > 0 ? Number(headers["content-length"]) : null;
  const radio = Object.keys(headers).some((name) => name.toLowerCase().startsWith("icy-"));
  return { kind: "file", body, headers, status: source.status ?? 200, length, radio };
}

/**
 * 직접 링크를 열어 판정한다. from · to · ifRange 를 주면 그 구간으로 연다(이어받기, 판정 없이 file).
 * 막힌 주소 · 열리지 않음은 SafeUrl 의 오류를 그대로 던진다(부르는 쪽이 일반 문장으로 숨긴다)
 */
async function openLink(url: string, { net = { getStream: SafeUrl.getStream }, ...opts }: OpenOptions & { net?: StreamNet } = {}): Promise<Opened> {
  let source: AudioStream;
  try {
    source = await net.getStream(url, undefined, { accept: OPEN_ACCEPT, ...opts });
  } catch (error) {
    if (isIcyStatusLine(error)) throw codedError("shoutcast-v1", `옛 SHOUTcast(ICY 첫 줄) 방송입니다: ${url}`, { cause: error });
    throw error;
  }
  const file = fileOf(source);
  if (opts.from !== undefined) return file;
  // 인터넷 라디오는 헤더로 안다(끝이 없어 앞부분을 기다릴 까닭이 없다)
  if (file.radio && /^\s*audio\//i.test(String(file.headers["content-type"] ?? ""))) return file;
  return judge(source, url);
}

/** 앞부분을 읽어 판정한다. 음원이 아니면 연결을 닫는다 */
async function judge(source: AudioStream, url: string): Promise<Opened> {
  let head: Buffer;
  let ended: boolean;
  try {
    ({ head, ended } = await readHead(source, HEAD_BYTES));
  } catch (error) {
    source.destroy();
    throw error;
  }
  const kind: LinkContent = await contentOf(String(source.headers?.["content-type"] ?? ""), head);
  if (kind === "audio") return fileOf(source, withHead(source, head, ended));
  try {
    if (kind === "hls" || kind === "list") {
      const text = await readAll(source, head, ended);
      if (text === null) return { kind: "other" };
      // 상대 주소는 리다이렉트를 거친 마지막 주소 기준
      const base = source.url ?? url;
      return kind === "hls" ? { kind, text, url: base } : { kind, target: listTarget(text, base) };
    }
    return { kind };
  } finally {
    source.destroy();
  }
}

/** 목록 안의 목록은 한 번까지 따라간다 */
const LIST_DEPTH = 2;

/** 받은 응답으로 판정한 거절(음원이 아님 · 옛 SHOUTcast). 부르는 쪽이 숨기지 않는다 */
const refusedByResponse = (error: unknown) => ["unsupported-link", "shoutcast-v1"].includes(String(codeOf(error)));

/** 열고, 단순 목록이면 그 첫 주소를 다시 연다(가드도 다시). 목록에 주소가 없거나 너무 깊으면 unsupported-link */
async function openFollowing(url: string, options: Parameters<typeof openLink>[1], depth = 0): Promise<Exclude<Opened, { kind: "list" }>> {
  const opened = await openLink(url, options);
  if (opened.kind !== "list") return opened;
  if (!opened.target || depth >= LIST_DEPTH) throw codedError("unsupported-link", `음원이 아닌 링크입니다(${opened.target ? "목록이 너무 깊음" : "빈 목록"})`);
  return openFollowing(opened.target, options, depth + 1);
}

export { openLink, openFollowing, refusedByResponse, OPEN_ACCEPT };
export type { Opened, AudioStream, StreamNet, OpenOptions };
