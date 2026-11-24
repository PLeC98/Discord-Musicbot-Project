// 곡이 멈췄을 때 끝난 것인가 끊긴 것인가. 길이가 아니라 입력 쪽 사실로 구분한다. 길이는 되감기를 막는 데만 쓴다.
//
// 위에서부터 먼저 걸리는 것:
//   우리가 멈춤            멈춘 원인에 따라(재생이 깨져서 멈췄으면 끊김, 그 밖은 끝)
//   라이브                 ffmpeg가 0으로 끝났고 입력이 온전하면 끝(방송 종료), 아니면 끊김
//   재생 스트림이 덜 끝남   패킷 공급이 모자라 플레이어가 멈춘 것. 끊김
//   입력 깨짐 표시          끊김(HLS가 세그먼트를 건너뛴 것도 여기로 온다. media/playback-input)
//   그 밖                  끝
// 끊겼어도 다시 열 위치가 길이 끝 1.5초 안이면 끝으로 본다(끝부분을 되풀이해 틀지 않게).

import { L } from "../infra/log/text.ts";
import type { LogText } from "../infra/log/log-text.ts";

type EndFacts = {
  reason: string; // 멈춘 이유. 저절로 멈췄으면 "idle"
  live: boolean; // 라이브를 주소 경로로 틀었다
  streamEnded: boolean; // 재생 스트림이 끝까지 읽혔다(playStream.readableEnded)
  broken: LogText | null; // 입력 깨짐 표시
  exitCode: number | null; // 지금 소스 ffmpeg의 종료 코드. 아직 살아 있으면 null
  positionMs: number; // 곡 안의 멈춘 위치
  lengthMs: number | null; // 트는 음원의 길이(표시 길이가 아니다). 되감기를 막는 데만 쓴다. 모르면 null
};

type Verdict = { dropped: boolean; why: LogText };

// 우리가 멈췄지만 재생이 깨져서 멈춘 이유. 같은 곡을 멈춘 위치부터 다시 연다
const BROKEN_STOPS: Record<string, LogText> = {
  "stream-error": L.player.stopStreamError(),
  "buffering-stall": L.player.stopBufferingStall(),
  error: L.player.stopResumeFailed(),
};

// 다시 열 위치가 끝에서 이만큼 안이면 다시 열지 않고 끝난 것으로 본다. 출처가 준 길이는 정수 초라 실제 끝보다 1초 넘게 길 수 있어 그보다 조금 크게 잡는다
const REWIND_GUARD_MS = 1500;

const ended = (why: LogText): Verdict => ({ dropped: false, why });

// 끊긴 원인. 끊기지 않았으면 null
function dropCause(f: EndFacts): LogText | null {
  if (f.reason !== "idle") return BROKEN_STOPS[f.reason] ?? null;
  if (f.live) return f.exitCode === 0 && !f.broken ? null : (f.broken ?? L.player.ffmpegExit({ code: f.exitCode }));
  if (!f.streamEnded) return L.player.stopPacketsCut();
  return f.broken;
}

function endVerdict(f: EndFacts): Verdict {
  const cause = dropCause(f);
  if (!cause) return ended(f.reason === "idle" ? (f.live ? L.player.endLiveEnded() : L.player.endInputEnded()) : L.player.endStopped({ reason: f.reason }));
  if (f.lengthMs && f.positionMs >= f.lengthMs - REWIND_GUARD_MS) return ended(L.player.endAtEnd({ cause }));
  return { dropped: true, why: cause };
}

export { endVerdict };
export type { EndFacts, Verdict };
