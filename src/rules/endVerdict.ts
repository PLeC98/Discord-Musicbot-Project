// 곡이 멈췄을 때 끝난 것인가 끊긴 것인가. 길이가 아니라 입력 쪽 사실로 가른다. 길이는 되감기를 막는 데만 쓴다.
//
// 위에서부터 먼저 걸리는 것:
//   우리가 멈춤            그 까닭대로(깨진 재생을 멈춘 까닭이면 끊김, 그 밖은 끝)
//   라이브                 ffmpeg 가 0 으로 끝났고 입력이 온전하면 끝(방송 종료), 아니면 끊김
//   재생 스트림이 덜 끝남   공급이 모자라 플레이어가 멈춘 것. 끊김
//   입력 깨짐 표시          끊김
//   온전함을 모르는 입력    길이보다 3초 넘게 일찍 끝났으면 한 번만 끊김
//   그 밖                  끝
// 끊겼어도 다시 열 위치가 길이 끝 1.5초 안이면 끝으로 본다(끝부분을 되풀이해 틀지 않게).

type EndFacts = {
  reason: string; // 멈춘 까닭. 저절로 멈췄으면 "idle"
  live: boolean; // 라이브를 주소 갈래로 틀었다
  streamEnded: boolean; // 재생 스트림이 끝까지 읽혔다(playStream.readableEnded)
  broken: string | null; // 입력 깨짐 표시
  exitCode: number | null; // 지금 소스 ffmpeg 의 종료 코드. 아직 살아 있으면 null
  positionMs: number; // 곡 안의 멈춘 위치
  lengthMs: number | null; // 믿을 수 있는 음원 길이. 모르면 null
  unverified: boolean; // 온전히 끝났는지 가를 수 없는 입력이고, 이번이 다시 연 재생이 아니다
};

type Verdict = { dropped: boolean; why: string };

// 우리가 멈췄지만 재생이 깨져서 멈춘 까닭. 같은 곡을 멈춘 위치부터 다시 연다
const BROKEN_STOPS: Record<string, string> = {
  "stream-error": "재생 스트림 오류",
  "buffering-stall": "재생이 시작되지 않음",
  error: "재생 재개 실패",
};

const UNVERIFIED_SLACK_MS = 3000; // 온전함을 모르는 입력이 길이보다 이만큼 넘게 일찍 끝나면 끊김
const REWIND_GUARD_MS = 1500; // 다시 열 위치가 길이 끝 이만큼 안이면 끝

const ended = (why: string): Verdict => ({ dropped: false, why });

// 끊긴 까닭. 끊기지 않았으면 null
function dropCause(f: EndFacts): string | null {
  if (f.reason !== "idle") return BROKEN_STOPS[f.reason] ?? null;
  if (f.live) return f.exitCode === 0 && !f.broken ? null : (f.broken ?? `ffmpeg 종료 코드 ${f.exitCode ?? "없음"}`);
  if (!f.streamEnded) return "공급이 끊겨 플레이어가 멈춤";
  if (f.broken) return f.broken;
  if (f.unverified && f.lengthMs && f.positionMs + UNVERIFIED_SLACK_MS < f.lengthMs) return "길이보다 일찍 끝남";
  return null;
}

function endVerdict(f: EndFacts): Verdict {
  const cause = dropCause(f);
  if (!cause) return ended(f.reason === "idle" ? (f.live ? "방송이 끝남" : "입력 끝") : `멈춤(${f.reason})`);
  if (f.lengthMs && f.positionMs >= f.lengthMs - REWIND_GUARD_MS) return ended(`${cause}. 끝에 닿아 다시 열지 않음`);
  return { dropped: true, why: cause };
}

/** 믿을 수 있는 음원 길이(ms). 모르거나 추정값이면 null */
const knownLengthMs = (track: { duration: number; durationSource?: string }) => (track.duration > 0 && track.durationSource !== "추정" ? track.duration * 1000 : null);

export { endVerdict, knownLengthMs };
export type { EndFacts, Verdict };
