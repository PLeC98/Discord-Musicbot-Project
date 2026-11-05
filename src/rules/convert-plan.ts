// 판정: 다운로드한 오디오를 캐시 규격(`.opus`)으로 어떻게 만드나. probe 결과 하나로 copy 냐 transcode 냐만 답한다.
// 상한(REMUX_MAX_KBPS)은 Opus 를 Opus 로 다시 인코딩할지에만 걸린다. 코덱이 다르면 비트레이트를 비교할 수 없다(mp3 128k 와 Opus 128k 는 다르다).
// 변환 목표는 소스 비트레이트와 무관하다. 송출이 128k 라 그 위는 버려진다.

/** Opus 소스에만 걸리는 상한(kbps). 상시 작동하는 값이 아니라 폭주를 막는 안전망이다. */
const REMUX_MAX_KBPS = 320;

/**
 * 상한을 이 배수만큼 넘어야 다시 인코딩한다. libopus 는 VBR 이라 목표를 그대로 지키지 않아서,
 * 아슬아슬하게 넘긴 것을 다시 인코딩하면 비트레이트가 되레 오르고 파일도 커진다.
 */
const REMUX_SLACK = 1.25;

/** Opus 가 아닌 것을 인코딩할 때의 목표(kbps). 소스가 무엇이든 같다. */
const TRANSCODE_TARGET_KBPS = 128;

type CacheAudioInfo = { codec?: string | null; bitrateKbps?: number | string | null };
/** 무엇을 할지와 비트레이트. 다시 인코딩할 때는 늘 정해져 있다 */
type CodecPlan = { action: "copy"; bitrateKbps: number | null } | { action: "transcode"; bitrateKbps: number };
type ConvertPlan = CodecPlan & { why: string };

/**
 * probe 결과로 무엇을 할지 정한다. 부수 효과가 없어 정책은 여기만 보면 되고,
 * 테스트도 ffmpeg 없이 이 함수만 고정한다.
 */
function planFor(info: CacheAudioInfo | null | undefined): ConvertPlan {
  const codec = info?.codec ? String(info.codec).toLowerCase() : null;
  const kbps = Number(info?.bitrateKbps) > 0 ? Number(info?.bitrateKbps) : null;

  if (codec !== "opus") {
    // 코덱을 못 읽은 경우도 여기로 온다. 모르면 인코딩하는 쪽이 안전하다(리먹싱은 컨테이너가 맞아야 한다).
    return { action: "transcode", bitrateKbps: TRANSCODE_TARGET_KBPS, why: codec ? `${codec} → opus` : "코덱을 읽지 못함" };
  }
  if (kbps !== null && kbps > REMUX_MAX_KBPS * REMUX_SLACK) {
    return { action: "transcode", bitrateKbps: REMUX_MAX_KBPS, why: `opus ${kbps}k, 상한 ${REMUX_MAX_KBPS}k 를 크게 넘음` };
  }
  return { action: "copy", bitrateKbps: kbps, why: kbps ? `이미 opus ${kbps}k` : "이미 opus" };
}

export { planFor, REMUX_MAX_KBPS, REMUX_SLACK, TRANSCODE_TARGET_KBPS };
export type { CacheAudioInfo, CodecPlan, ConvertPlan };
