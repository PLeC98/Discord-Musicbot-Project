// 재생 조작이 된 뒤의 응답 문장. 명령과 패널 버튼이 같은 조작을 하면 같은 함수를 부른다.
// 헤더 줄과 본문이 있는 응답은 { icon, title, body } 로 돌려준다(ui/control-replies 가 그리고, 누가 했나 줄을 붙인다). icon 은 아이콘 표(ui/icons)의 키

import { josa } from "../../../rules/josa.ts";
import { icon, type IconKey } from "../../icons.ts";
import { songTitle } from "./labels.ts";
import type { Hold } from "../../../rules/holds.ts";

type Linked = { title: string | null; pageUrl: string };
/** 헤더 줄(아이콘 키 + 제목)과 본문 */
type Head = { icon: IconKey; title: string; body: string };

const link = (track: Linked) => `**[${songTitle(track.title)}](${track.pageUrl})**`;
// 곡 링크 뒤에 목적격 조사(보이는 제목의 끝소리로 정한다)
const linkObject = (track: Linked) => `${link(track)}${josa(songTitle(track.title), "을")}`;

/** 누가 했나 줄의 라벨 */
const requestedBy = () => `${icon("person")} 요청한 사람`;
/** 대시보드에서 한 조작의 누가 했나(사람 멘션 뒤에 붙인다) */
const viaDashboard = (who: string) => `${who} (대시보드)`;

// 억제 사유(rules/holds)로 소리가 함께 멈춰 있을 때 덧붙이는 말: 멈춘 채로 둠, 아직 멈춘 까닭, 언제 이어 트나
const HELD_AFTER: Record<Hold, { keep: string; still: string; when: string }> = {
  mute: { keep: "음소거가 풀려도 멈춘 채로 둘게요.", still: "아직 음소거 상태라 멈춰 있어요.", when: "음소거가 풀리면" },
  stage: { keep: "발언자가 돼도 멈춘 채로 둘게요.", still: "아직 스테이지 청중이라 멈춰 있어요.", when: "발언자가 되면" },
  alone: { keep: "누가 들어와도 멈춘 채로 둘게요.", still: "아직 채널에 저 혼자라 멈춰 있어요.", when: "누가 들어오면" },
};

/** 일시정지, 재개. heldBy: 소리를 함께 멈추고 있는 억제 사유(있으면 그 사유가 풀린 뒤를 말한다) */
function paused(isPaused: boolean, track: Linked, heldBy: Hold | null = null): Head {
  if (isPaused) return { icon: "pause", title: "일시정지했어요!", body: `${linkObject(track)} 일시정지했어요.${heldBy ? ` ${HELD_AFTER[heldBy].keep}` : ""}` };
  const held = heldBy ? HELD_AFTER[heldBy] : null;
  return { icon: "play", title: "일시정지를 해제했어요!", body: held ? `${held.still} ${held.when} ${linkObject(track)} 다시 재생할게요.` : `${linkObject(track)} 다시 재생할게요.` };
}

/** 건너뛰기, 이전 곡인데 한 곡 반복이라 지금 곡을 처음부터 다시 틀었다 */
const restartedOnRepeat = (): Head => ({ icon: "repeat_one", title: "곡을 되감았어요!", body: "한 곡 반복 중이라 지금 곡을 처음부터 다시 틀어요." });
/** 건너뛰기. track 은 건너뛴 곡 */
const skipped = (track: Linked): Head => ({ icon: "next", title: "곡을 건너뛰었어요!", body: `${linkObject(track)} 건너뛰었어요.` });
/** 이전 곡. track 은 되돌아간 곡 */
const previous = (track: Linked): Head => ({ icon: "prev", title: "이전 곡으로 되돌렸어요!", body: `${linkObject(track)} 다시 재생할게요.` });
/** 곡으로 건너뛰기 메뉴 */
const jumped = (track: Linked): Head => ({ icon: "next", title: "선택한 곡으로 건너뛰었어요!", body: `${linkObject(track)} 재생할게요.` });

/** 정지. cleared 는 비운 대기열 곡 수(0 이면 말하지 않는다) */
const stopped = (cleared: number): Head => ({ icon: "stopped", title: "재생을 중지했어요!", body: `${cleared > 0 ? `대기열에 남아 있던 ${cleared}곡을 삭제하고 ` : ""}채널에서 나갔어요.` });

/** 상주 모드에서 정지: 대기열만 비우고 채널에 남는다. cleared 는 비운 대기열 곡 수(0 이면 말하지 않는다) */
const stoppedStaying = (cleared: number): Head => ({ icon: "stopped", title: "재생을 중지했어요!", body: `${cleared > 0 ? `대기열에 있던 ${cleared}곡을 삭제했어요. ` : ""}상주 모드가 켜져 있으니 채널에 남아 있을게요.` });

/** 상주 모드 켬. channel 은 자리 채널(멘션), already 면 이미 그 채널에 켜져 있었다 */
const stayOn = (channel: string, already: boolean): Head => (already ? { icon: "stay", title: "이미 상주 모드가 켜져 있어요.", body: `${channel}에 머물고 있어요.` } : { icon: "stay", title: "상주 모드를 켰어요!", body: `${channel}에 자리를 잡았어요. 대기열이 끝나거나 혼자 남아도 나가지 않아요.` });
/** 상주 모드 끔. already 면 이미 꺼져 있었다 */
const stayOff = (already: boolean): Head => (already ? { icon: "done", title: "이미 상주 모드가 꺼져 있어요.", body: "대기열이 끝나거나 혼자 남으면 평소처럼 쉬러 가요." } : { icon: "done", title: "상주 모드를 껐어요!", body: "이제 대기열이 끝나거나 혼자 남으면 평소처럼 쉬러 갈게요." });

/** 섞기 */
const shuffled = (count: number): Head => ({ icon: "shuffle", title: "대기열을 셔플했어요!", body: `${count}곡을 섞었어요.` });

/** 하이라이트로 건너뛰는 동안 */
const highlighting = () => `${icon("progress")} 하이라이트로 건너뛰는 중...`;
/** 하이라이트로 건너뛰었다. at 은 옮긴 위치를 적은 것 */
const highlighted = (at: string): Head => ({ icon: "highlight_jump", title: "하이라이트로 건너뛰었어요!", body: `${icon("time")} 위치: \`${at}\`` });

/** 처음부터 다시 트는 동안 */
const replaying = () => `${icon("progress")} 처음부터 다시 트는 중...`;
/** 처음부터 다시 */
const replayed = (track: Linked): Head => ({ icon: "replay", title: "곡을 되감았어요!", body: `${linkObject(track)} 처음부터 재생할게요.` });

/** 위치를 옮기는 동안 */
const seeking = () => `${icon("progress")} 위치를 옮기는 중...`;
/** 위치를 옮겼다. at 은 옮긴 위치를 적은 것 */
const seeked = (at: string): Head => ({ icon: "seek", title: "위치를 옮겼어요!", body: `${icon("time")} 옮긴 위치: \`${at}\`` });

/** 대기열 비우기. count 는 버린 곡 수 */
const cleared = (count: number): Head => ({ icon: "cleared", title: "대기열을 비웠어요!", body: `대기열에 있던 ${count}곡을 삭제했어요.` });

/** 대기열에서 한 곡 빼기. left 는 남은 곡 수 */
const removed = (left: number): Head => ({ icon: "cleared", title: "선택한 곡을 삭제했어요!", body: `대기열에 ${left}곡이 남았어요.` });

/** 대기열 순서 바꾸기. from, to 는 사람이 센 위치(1부터) */
const moved = (track: Linked, from: number, to: number): Head & { by: string } => ({
  icon: "shuffle",
  title: "곡의 순서를 바꿨어요",
  body: `${link(track)}\n${icon("position")} 기존 순번: ${from}번째\n${icon("position")} 현재 순번: ${to}번째`,
  by: `${icon("person")} 변경한 사람`,
});

// 반복 모드마다 [아이콘, 문장]
const LOOP: Record<string, [icon: IconKey, message: string]> = {
  track: ["repeat_one", "**한 곡 반복** 모드로 설정했어요."],
  queue: ["repeat", "**대기열 반복** 모드로 설정했어요."],
  false: ["repeat_off", "반복 모드를 **해제**했어요."],
};
/** 반복 모드 바꾸기 */
const loopSet = (mode: string | false): Head => {
  const [key, message] = LOOP[String(mode)];
  return { icon: key, title: "반복 모드를 바꿨어요!", body: message };
};

/** 볼륨. before, level 은 0 ~ VOLUME_MAX(rules/limits) */
const volumeSet = (before: number, level: number): Head => ({ icon: "volume", title: "볼륨을 조절했어요!", body: before === level ? `볼륨이 이미 ${level}%라서 그대로 둘게요.` : `**${before}%** → **${level}%**` });
/** 볼륨 입력 창 */
const volumeModal = () => ({ title: "볼륨 설정", label: "0에서 100까지의 숫자로 입력해 주세요!" });

/** 음성 채널에서 나갔다. 곡이 있었으면 저장한 곡, 위치(at, 적은 것), 대기열 곡 수와 복원하는 법. stayOff 면 상주 모드도 껐다 */
const left = (saved: { track: Linked; at: string; queue: number } | null, stayOff = false) => {
  const lines = saved ? [`재생 중이던 곡: ${link(saved.track)}`, `${icon("time")} 저장한 위치 \`${saved.at}\` · ${icon("queue")} 저장한 대기열 ${saved.queue}곡`, "`/join`으로 이어 들을 수 있어요."] : [];
  if (stayOff) lines.push("켜져 있던 상주 모드도 함께 껐어요.");
  return { title: "👋 음성 채널에서 나갔어요", body: lines.length ? lines.join("\n") : null };
};

/** 음성 채널에 들어오기 */
const joined = (): Head => ({ icon: "done", title: "음성 채널에 접속했어요!", body: "언제든지 곡을 넣어 주세요." });
/** parked: 곡을 열지 못해 그 곡에서 일시정지한 상태다 */
const alreadyJoined = (parked = false): Head => ({ icon: "done", title: "이미 음성 채널에 있어요.", body: parked ? "곡이 재생되지 않아 일시정지 상태예요. 재생 버튼을 누르면 다시 시도해요." : "저는 준비됐어요. 언제든지 곡을 넣어 주세요." });
/** /join 이 저장한 세션을 복원하는 동안 */
const restoring = () => `${icon("progress")} 듣던 곡을 불러오는 중...`;
/** /join 이 저장한 세션을 복원했다 */
const restored = (track: Linked, isPaused: boolean): Head => (isPaused ? { icon: "pause", title: "듣던 곡이 있어요!", body: `이전에 ${linkObject(track)} 일시정지해 둔 상태였어요. 이어 들으려면 일시정지를 해제해 주세요!` } : { icon: "play", title: "듣던 곡이 있어요!", body: `이전에 ${linkObject(track)} 듣고 있었어요. 이어서 재생할게요!` });

export { requestedBy, viaDashboard, paused, restartedOnRepeat, skipped, previous, jumped, stopped, stoppedStaying, stayOn, stayOff, shuffled, highlighting, highlighted, replaying, replayed, seeking, seeked, cleared, removed, moved, loopSet, volumeSet, volumeModal, left, joined, alreadyJoined, restoring, restored };
