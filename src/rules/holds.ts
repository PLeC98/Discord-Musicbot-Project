// 판정: 지금 음성 상태에서 소리를 멈춰야 할 까닭(억제 사유). 사람이 건 멈춤은 여기 없다(player/pause-state 의 userPaused).
// 바뀜을 받아 넣고 빼지 않고, 부를 때마다 지금 상태에서 다시 계산한다. 이벤트 하나를 놓쳐도 다음 계산이 바로잡는다.
//
//   mute   서버 음소거, 또는 일반 채널에서 말할 수 없음(suppress: AFK 채널 등). 서버 헤드셋 끄기는 듣기만 막으므로 까닭이 아니다
//   stage  스테이지 청중(suppress). 발언자가 되면 풀린다
//   alone  듣는 사람이 없다

/** 표시 우선순위 차례. 패널 상태 줄 · 대시보드 · 조작 결과가 첫째를 보인다 */
const HOLDS = ["mute", "stage", "alone"] as const;
type Hold = (typeof HOLDS)[number];

/** 계산에 쓰는 봇의 음성 상태와 듣는 사람 수 */
type VoiceView = { serverMute: boolean; suppress: boolean; onStage: boolean; listeners: number };

function holdsOf(view: VoiceView): Set<Hold> {
  const out = new Set<Hold>();
  if (view.serverMute || (view.suppress && !view.onStage)) out.add("mute");
  if (view.suppress && view.onStage) out.add("stage");
  if (view.listeners === 0) out.add("alone");
  return out;
}

/** 보여 줄 사유. 없으면 null */
const heldBy = (holds: ReadonlySet<Hold>): Hold | null => HOLDS.find((one) => holds.has(one)) ?? null;

/** 사람 수를 셀 때 보는 멤버의 필드 */
type Member = { user: { bot: boolean }; voice: { selfDeaf: boolean | null; serverDeaf: boolean | null } };

/** 듣는 사람 수: 봇이 아니고 헤드셋을 끄지 않은 사람. 헤드셋을 끄면(스스로든 서버가든) 들을 수 없다 */
function listenersIn(members: Iterable<Member>): number {
  let count = 0;
  for (const one of members) if (!one.user.bot && !one.voice.selfDeaf && !one.voice.serverDeaf) count++;
  return count;
}

export { HOLDS, holdsOf, heldBy, listenersIn };
export type { Hold, VoiceView };
