// 판정: 받은 파일을 어떻게 굽나. probe 결과 하나로 copy 냐 transcode 냐만 답한다.

/**
 * 받아 온 오디오를 캐시 규격(`.opus`)으로 만든다. 무엇을 할지 정하는 단일 출처다.
 *
 * 숫자가 둘이다. 상한은 Opus 를 Opus 로 다시 쓸지 재는 자리에만 걸리므로 비교 대상이 둘 다
 * Opus 다. 코덱이 다르면 그 가지에 들어오지 않으니 "mp3 320k 니까 320k Opus 로" 같은 판단이
 * 나올 여지가 없다. mp3 128k 와 Opus 128k 는 같은 값이 아니다.
 *
 * 변환 목표는 소스 비트레이트와 무관하다. 어차피 손실 세대를 하나 쓰는 길이고, 송출이 128k 라
 * 그 위는 버려진다. 리먹싱은 그대로 두는 비용이 0 이고, 변환은 목표를 올려도 얻는 것이 없다.
 */

/** Opus 소스에만 걸리는 상한. 상시 작동하는 값이 아니라 폭주를 막는 안전망이다. */
const REMUX_MAX_KBPS = 320;

/**
 * 상한을 이 배수만큼 넘어야 굽는다. libopus 는 VBR 이라 목표를 그대로 지키지 않아서,
 * 아슬아슬하게 넘긴 것을 구우면 비트레이트가 되레 오르고 파일도 커진다(323k 를 320k 로 → 324k).
 * 손실 세대와 CPU 를 쓰고 용량까지 손해면 할 이유가 없다.
 */
const REMUX_SLACK = 1.25;

/** Opus 가 아닌 것을 구울 때의 목표. 소스가 무엇이든 같다. */
const TRANSCODE_TARGET_KBPS = 128;

/**
 * probe 결과로 무엇을 할지 정한다. 부수 효과가 없어 정책은 여기만 보면 되고,
 * 테스트도 ffmpeg 없이 이 함수만 고정한다.
 *
 * @param {{codec: string|null, bitrateKbps: number|null}} info
 * @returns {{action: "copy"|"transcode", bitrateKbps: number|null, why: string}}
 */
type CacheAudioInfo = { codec?: string | null; bitrateKbps?: number | string | null };
type ConvertPlan = { action: "copy" | "transcode"; bitrateKbps: number | null; why: string };

function planFor(info: CacheAudioInfo | null | undefined): ConvertPlan {
  const codec = info?.codec ? String(info.codec).toLowerCase() : null;
  const kbps = Number(info?.bitrateKbps) > 0 ? Number(info?.bitrateKbps) : null;

  if (codec !== "opus") {
    // 코덱을 못 읽은 경우도 여기로 온다. 모르면 굽는 쪽이 안전하다(리먹싱은 컨테이너가 맞아야 한다).
    return { action: "transcode", bitrateKbps: TRANSCODE_TARGET_KBPS, why: codec ? `${codec} → opus` : "코덱을 읽지 못함" };
  }
  if (kbps !== null && kbps > REMUX_MAX_KBPS * REMUX_SLACK) {
    return { action: "transcode", bitrateKbps: REMUX_MAX_KBPS, why: `opus ${kbps}k, 상한 ${REMUX_MAX_KBPS}k 를 크게 넘음` };
  }
  return { action: "copy", bitrateKbps: kbps, why: kbps ? `이미 opus ${kbps}k` : "이미 opus" };
}

export { planFor, REMUX_MAX_KBPS, REMUX_SLACK, TRANSCODE_TARGET_KBPS };
