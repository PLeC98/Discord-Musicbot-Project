// 재생 조작이 된 뒤의 응답 문장. 명령과 패널 버튼이 같은 조작을 하면 같은 함수를 부른다.
// 머리 줄과 본문이 있는 응답은 { title, body } 로 돌려준다(ui/controlReplies 가 그리고, 누가 했나 줄을 붙인다)

import { josa } from "../../../rules/josa.ts";
import { songTitle } from "./labels.ts";

type Linked = { title: string | null; pageUrl: string };

const link = (track: Linked) => `**[${songTitle(track.title)}](${track.pageUrl})**`;
// 곡 링크 뒤에 목적격 조사(보이는 제목의 끝소리로 고른다)
const linkObject = (track: Linked) => `${link(track)}${josa(songTitle(track.title), "을")}`;

/** 누가 했나 줄의 이름표 */
const requestedBy = () => "👤 요청한 사람";

/** 일시정지 · 재개 */
const paused = (isPaused: boolean, track: Linked) => (isPaused ? { title: "⏸️ 일시정지했어요!", body: `${linkObject(track)} 일시정지 했어요.` } : { title: "▶️ 일시정지를 해제했어요!", body: `${linkObject(track)} 다시 재생할게요.` });

/** 건너뛰기 · 이전 곡인데 한 곡 반복이라 지금 곡을 처음부터 다시 틀었다 */
const restartedOnRepeat = () => ({ title: "🔂 곡을 되감았어요!", body: "한 곡 반복 중이라 지금 곡을 처음부터 다시 틀어요." });
/** 건너뛰기. track 은 건너뛴 곡 */
const skipped = (track: Linked) => ({ title: "⏭️ 곡을 건너뛰었어요!", body: `${linkObject(track)} 건너뛰었어요.` });
/** 이전 곡. track 은 되돌아간 곡 */
const previous = (track: Linked) => ({ title: "⏮️ 이전 곡으로 되돌렸어요!", body: `${linkObject(track)} 다시 재생할게요.` });
/** 곡으로 건너뛰기 메뉴 */
const jumped = (track: Linked) => ({ title: "⏭️ 선택한 곡으로 건너뛰었어요!", body: `${linkObject(track)} 재생할게요.` });

/** 정지. cleared 는 비운 대기열 곡 수(0 이면 말하지 않는다) */
const stopped = (cleared: number) => ({ title: "⏹️ 재생을 중지했어요!", body: `${cleared > 0 ? `대기열에 남아있던 ${cleared}곡을 버리고 ` : ""}채널에서 나갔어요.` });

/** 섞기 */
const shuffled = (count: number) => ({ title: "🔀 대기열을 셔플했어요!", body: `${count}개의 곡을 섞었어요.` });

/** 하이라이트로 건너뛰는 동안 */
const highlighting = () => "✨ 하이라이트로 건너뛰는 중...";
/** 하이라이트로 건너뛰었다. at 은 옮긴 위치를 적은 것 */
const highlighted = (at: string) => ({ title: "✨ 하이라이트로 건너 뛰었어요!", body: `⏱️ 위치: \`${at}\`` });

/** 처음부터 다시 트는 동안 */
const replaying = () => "🔄 처음부터 다시 트는 중...";
/** 처음부터 다시 */
const replayed = (track: Linked) => ({ title: "🔄 곡을 되감았어요!", body: `${linkObject(track)} 처음부터 재생할게요.` });

/** 위치를 옮기는 동안 */
const seeking = () => "⏩ 위치를 옮기는 중...";
/** 위치를 옮겼다. at 은 옮긴 위치를 적은 것 */
const seeked = (at: string) => ({ title: "⏩ 위치를 옮겼어요!", body: `⏱️ 옮긴 위치: \`${at}\`` });

/** 대기열 비우기. count 는 버린 곡 수 */
const cleared = (count: number) => ({ title: "🗑️ 대기열을 비웠어요!", body: `대기열에 있던 ${count}곡을 버렸어요.` });

/** 대기열에서 한 곡 빼기. left 는 남은 곡 수 */
const removed = (left: number) => ({ title: "🗑️ 선택한 곡을 버렸어요!", body: `대기열에 ${left}곡이 남았어요.` });

/** 대기열 순서 바꾸기. from · to 는 사람이 센 자리(1부터) */
const moved = (track: Linked, from: number, to: number) => ({
  title: "🔀 순서 변경됨",
  description: link(track),
  from: "📍 이동 전",
  fromValue: `${from}번째`,
  to: "📍 이동 후",
  toValue: `${to}번째`,
  by: "👤 변경한 사람",
});

// 반복 모드마다 [이모지, 문장]
const LOOP: Record<string, [emoji: string, message: string]> = {
  track: ["🔂", "**한 곡 반복** 모드로 설정했어요. 현재 곡을 계속해서 재생해요."],
  queue: ["🔁", "**대기열 반복** 모드로 설정했어요. 대기열이 끝나면 처음부터 다시 틀어요."],
  false: ["➡️", "반복 모드를 **해제**했어요."],
};
/** 반복 모드 바꾸기 */
const loopSet = (mode: string | false) => {
  const [emoji, message] = LOOP[String(mode)];
  return { title: `${emoji} 반복 모드를 바꿨어요!`, body: message };
};

/** 음량. before · level 은 0~100 */
const volumeSet = (before: number, level: number) => ({ title: "🔊 볼륨을 조절했어요!", body: before === level ? `볼륨이 이미 ${level}%라서 그대로 둘게요.` : `**${before}%** → **${level}%**` });
/** 음량 입력 창 */
const volumeModal = () => ({ title: "볼륨 설정", label: "0에서 100까지의 숫자로 입력해 주세요!" });

/** 음성 채널에서 나갔다. 곡이 있었으면 저장한 곡 · 자리(at, 적은 것) · 대기열 곡 수와 되살리는 법 */
const left = (saved: { track: Linked; at: string; queue: number } | null) => ({
  title: "👋 음성 채널에서 나갔어요",
  body: saved ? [`재생 중이던 곡: ${link(saved.track)}`, `⏱️ 저장한 위치 \`${saved.at}\` · 📋 저장한 대기열 ${saved.queue}곡`, "`/join`으로 이어 들을 수 있어요."].join("\n") : null,
});

/** 음성 채널에 들어오기 */
const joined = () => ({ title: "✅ 음성 채널에 접속했어요!", body: "언제든지 곡을 넣어 주세요." });
const alreadyJoined = () => ({ title: "✅ 이미 음성 채널에 있어요.", body: "저는 준비됐어요. 언제든지 곡을 넣어 주세요." });
/** /join 이 저장한 세션을 되살리는 동안 */
const restoring = () => "💾 듣던 곡을 불러오는 중...";
/** /join 이 저장한 세션을 되살렸다 */
const restored = (track: Linked, isPaused: boolean) => (isPaused ? { title: "⏸️ 듣던 곡이 있어요!", body: `이전에 ${linkObject(track)} 일시정지 해 둔 상태였어요. 이어 들으려면 일시정지를 해제해주세요!` } : { title: "▶️ 듣던 곡이 있어요!", body: `이전에 ${linkObject(track)} 듣고 있었어요. 이어서 재생할게요!` });

export { requestedBy, paused, restartedOnRepeat, skipped, previous, jumped, stopped, shuffled, highlighting, highlighted, replaying, replayed, seeking, seeked, cleared, removed, moved, loopSet, volumeSet, volumeModal, left, joined, alreadyJoined, restoring, restored };
