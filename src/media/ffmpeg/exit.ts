// ffmpeg 가 끝난 까닭. ffmpeg 는 실패하면 음수 AVERROR 를 종료 코드로 돌려준다.
// Windows 는 종료 코드를 부호 없는 32비트로 주므로(-22 → 4294967274) 부호를 되돌려 이름을 붙인다.
// 그 밖의 OS 는 하위 8비트만 남아(-22 → 234) 되돌릴 수 없으니 숫자 그대로 둔다.

import os from "os";

// FFERRTAG(a, b, c, d) = -(a | b << 8 | c << 16 | d << 24). libavutil/error.h
const tag = (a: string | number, b: string, c: string, d: string) => -((typeof a === "number" ? a : a.charCodeAt(0)) | (b.charCodeAt(0) << 8) | (c.charCodeAt(0) << 16) | (d.charCodeAt(0) << 24));
const AVERRORS = new Map<number, string>([
  [tag(0xf8, "B", "S", "F"), "BSF_NOT_FOUND"],
  [tag("B", "U", "G", "!"), "BUG"],
  [tag("B", "U", "F", "S"), "BUFFER_TOO_SMALL"],
  [tag(0xf8, "D", "E", "C"), "DECODER_NOT_FOUND"],
  [tag(0xf8, "D", "E", "M"), "DEMUXER_NOT_FOUND"],
  [tag(0xf8, "E", "N", "C"), "ENCODER_NOT_FOUND"],
  [tag("E", "O", "F", " "), "EOF"],
  [tag("E", "X", "I", "T"), "EXIT"],
  [tag("E", "X", "T", " "), "EXTERNAL"],
  [tag(0xf8, "F", "I", "L"), "FILTER_NOT_FOUND"],
  [tag("I", "N", "D", "A"), "INVALIDDATA"],
  [tag(0xf8, "M", "U", "X"), "MUXER_NOT_FOUND"],
  [tag(0xf8, "O", "P", "T"), "OPTION_NOT_FOUND"],
  [tag("P", "A", "W", "E"), "PATCHWELCOME"],
  [tag(0xf8, "P", "R", "O"), "PROTOCOL_NOT_FOUND"],
  [tag(0xf8, "S", "T", "R"), "STREAM_NOT_FOUND"],
  [tag("B", "U", "G", " "), "BUG"],
  [tag("U", "N", "K", "N"), "UNKNOWN"],
  [tag(0xf8, "4", "0", "0"), "HTTP_BAD_REQUEST"],
  [tag(0xf8, "4", "0", "1"), "HTTP_UNAUTHORIZED"],
  [tag(0xf8, "4", "0", "3"), "HTTP_FORBIDDEN"],
  [tag(0xf8, "4", "0", "4"), "HTTP_NOT_FOUND"],
  [tag(0xf8, "4", "2", "9"), "HTTP_TOO_MANY_REQUESTS"],
  [tag(0xf8, "4", "X", "X"), "HTTP_OTHER_4XX"],
  [tag(0xf8, "5", "X", "X"), "HTTP_SERVER_ERROR"],
]);
// errno 값은 OS 마다 다르다. ffmpeg 빌드도 그 OS 의 값을 쓴다(AVERROR(e) = -e)
const ERRNO_NAMES = new Map(Object.entries(os.constants.errno).map(([name, value]) => [value, name]));

const unsigned32 = (platform: NodeJS.Platform) => platform === "win32";

/** 부호를 되돌린 코드. 되돌릴 수 없으면(하위 8비트만 남는 OS) null */
function signedCode(code: number, platform: NodeJS.Platform = process.platform): number | null {
  if (!unsigned32(platform)) return null;
  return code > 0x7fffffff ? code - 2 ** 32 : code;
}

/** 로그에 남길 글. 예: "-22(EINVAL)" · "INVALIDDATA" · "SIGKILL" */
function exitText(code: number | null, signal: string | null, platform: NodeJS.Platform = process.platform): string {
  if (code === null) return signal ?? "없음";
  const signed = signedCode(code, platform);
  if (signed === null || signed >= 0) return String(code);
  const name = AVERRORS.get(signed) ?? ERRNO_NAMES.get(-signed);
  return name ? `${signed}(${name})` : String(signed);
}

// 출력 파이프에 쓰다 실패한 것. 소비자가 stdout 을 닫으면 ffmpeg 는 이것으로 스스로 끝난다(Windows 는 EINVAL, 그 밖은 EPIPE)
function isPipeWriteFailure(code: number | null, platform: NodeJS.Platform = process.platform): boolean {
  if (code === null) return false;
  const pipeErrors = [os.constants.errno.EINVAL, os.constants.errno.EPIPE];
  const signed = signedCode(code, platform);
  if (signed !== null) return pipeErrors.some((e) => signed === -e);
  return pipeErrors.some((e) => code === 256 - e);
}

const CRASH_SIGNALS = new Set(["SIGSEGV", "SIGABRT", "SIGBUS", "SIGILL", "SIGFPE"]);
const OUR_SIGNALS = new Set(["SIGKILL", "SIGTERM"]);

/**
 * 끝난 ffmpeg 를 어떻게 남길지.
 *   crash    비정상 신호
 *   cleanup  우리가 출력을 닫아서 끝났다(그 뒤의 신호 · 파이프 쓰기 실패 · 정상 종료)
 *   failed   자체 실패했다. 우리가 닫았더라도 종료 코드가 파이프 쓰기 실패가 아니면 그 전에 이미 실패한 것이다
 *   ok       정상 종료
 * @param o.closedByUs  끝까지 읽지 않은 stdout 을 우리가 닫았다
 */
function exitVerdict(o: { code: number | null; signal: string | null; closedByUs: boolean; platform?: NodeJS.Platform }): "crash" | "cleanup" | "failed" | "ok" {
  const { code, signal, closedByUs, platform = process.platform } = o;
  if (signal !== null && CRASH_SIGNALS.has(signal)) return "crash";
  if (closedByUs && ((signal !== null && OUR_SIGNALS.has(signal)) || code === 0 || isPipeWriteFailure(code, platform))) return "cleanup";
  if (code === 0 || (code === null && signal !== null && OUR_SIGNALS.has(signal))) return "ok";
  return "failed";
}

export { exitText, exitVerdict, isPipeWriteFailure, signedCode };
