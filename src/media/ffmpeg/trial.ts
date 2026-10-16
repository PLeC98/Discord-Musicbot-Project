// ffmpeg 가 실제로 할 수 있는지 아주 작은 시험으로 본다. 목록(-encoders)에 있어도 장치 · 드라이버가 없으면 열 때 실패하므로 돌려 본다.
// 인코더: 256×144 시험 영상 8장을 구워 버린다(하나에 0.1 ~ 0.5초, 없는 장치는 바로 오류). 움직이는 WebP: 두 장짜리 그림을 읽어 장 수를 센다(9.0 아래는 한 장도 못 읽는다)

import { runFfmpeg } from "./job.ts";

/** 시험 하나의 시간 상한 */
const TRIAL_MS = 15_000;
/** 두 장짜리 움직이는 WebP(16×16, 무손실) */
const ANIMATED_WEBP = Buffer.from("UklGRoQAAABXRUJQVlA4WAoAAAACAAAADwAADwAAQU5JTQYAAAD/////AABBTk1GKAAAAAAAAAAAAA8AAA8AAPQBAAJWUDhMDwAAAC8PwAMABxD9j/4HIqL/AQBBTk1GKAAAAAAAAAAAAAcAAAcAAPQBAABWUDhMDwAAAC8HwAEABxDR//4HIqL/AQA=", "base64");

/** 인코더가 낸 까닭: 그 인코더 이름이 붙은 줄(앞의 "[이름 @ 주소]" 는 뗀다), 없으면 마지막 줄 */
function reasonOf(stderr: string, encoder: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const own = lines.filter((line) => line.includes(`[${encoder} @`)).map((line) => line.replace(/^\[[^\]]*\]\s*/, ""));
  return (own.length ? own.join(" ") : (lines.at(-1) ?? "")).slice(0, 300);
}

/** 그 인코더 · 옵션으로 시험 영상을 구워 본다. 실패하면 ffmpeg 가 낸 까닭 */
async function tryEncoder(encoder: string, options: string[]): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { code, stderr } = await runFfmpeg(["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=256x144:rate=30", "-frames:v", "8", "-c:v", encoder, ...options, "-f", "null", "-"], { timeoutMs: TRIAL_MS });
  return code === 0 ? { ok: true } : { ok: false, reason: reasonOf(stderr, encoder) || `끝난 코드 ${code}` };
}

/** 움직이는 WebP 를 읽는가(두 장을 다 읽어야 참). 형식은 ffmpeg 가 알아보게 둔다(webp_pipe 로 정하면 움직이는 그림을 못 읽는다) */
async function readsAnimatedWebp(): Promise<boolean> {
  const { code, stdout } = await runFfmpeg(["-v", "error", "-i", "pipe:0", "-f", "framecrc", "-"], { input: ANIMATED_WEBP, timeoutMs: TRIAL_MS });
  return code === 0 && stdout.split("\n").filter((line) => line && !line.startsWith("#")).length >= 2;
}

export { tryEncoder, readsAnimatedWebp, reasonOf };
