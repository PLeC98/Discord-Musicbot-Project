// 재생 조작의 판정 중 디스코드 · 대시보드가 같이 쓰는 것. 서버의 판정(usecases)과 디스코드 패널 · 대시보드 버튼이 이 규칙을 부른다

import type { Loop } from "./loop-cycle.ts";

/** 이전 곡: 기록이 있거나 반복 중이면 된다(한 곡 반복은 지금 곡을 처음부터, 대기열 반복은 대기열이 고리라 끝 곡으로) */
const canGoBack = ({ history, loop }: { history: number; loop: Loop | undefined }) => history > 0 || (loop !== undefined && loop !== false);

/** 다음 곡: 대기열이 있거나, 한 곡 반복(지금 곡을 처음부터) · 자동재생(골라 온다. 켜 둔 장르가 있으면 참)이면 된다 */
const canGoNext = ({ queue, loop, autoplay }: { queue: number; loop: Loop | undefined; autoplay: unknown }) => queue > 0 || loop === "track" || Boolean(autoplay);

/**
 * 넣은 사람도 하는 조작(넘기기 · 대기열 빼기)이 막힌 까닭. 조작 권한이 막지 않으면 통과(null),
 * 그 곡을 넣은 사람이면 재적 규칙이 막은 까닭, 아니면 조작 권한이 막은 까닭
 */
function ownTrackDenied<Why>({ control, requester, voice }: { control: Why | null; requester: boolean; voice: () => Why | null }): Why | null {
  if (control === null) return null;
  return requester ? voice() : control;
}

export { canGoBack, canGoNext, ownTrackDenied };
