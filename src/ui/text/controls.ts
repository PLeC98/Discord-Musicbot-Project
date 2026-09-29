// 재생 조작이 된 뒤의 응답 문장. 명령과 패널 버튼이 같은 조작을 하면 같은 함수를 부른다.
// 임베드로 보이는 것은 { title, description, by(바꾼 사람 칸 이름) … } 로 돌려준다

type Linked = { title: string; pageUrl: string };

const link = (track: Linked) => `**[${track.title}](${track.pageUrl})**`;

/** 일시정지 · 재개 */
const paused = (isPaused: boolean, track: Linked) => {
  const message = isPaused ? "음악 일시정지됨" : "음악 재개됨";
  return { title: `${isPaused ? "⏸️" : "▶️"} ${message}`, description: `${link(track)} ${message}!`, by: "👤 작업자" };
};

/** 건너뛰기. 한곡 반복이라 처음부터 다시 틀었다 */
const skipRestarted = (track: { title: string }) => `🔂 한곡 반복 중. **${track.title}**을(를) 처음부터 다시 재생합니다! (다음 곡으로 가려면 반복을 해제하세요)`;
/** 건너뛰기 */
const skipped = (track: Linked) => ({ title: "⏭️ 노래 건너뜀", description: `${link(track)} 건너뜀!`, by: "👤 건너뛴 사람" });

/** 이전 곡. 한곡 반복이면 처음부터 다시 틀었다 */
const previous = (restarted: boolean) => (restarted ? "🔂 한곡 반복 중. 현재 곡을 처음부터 다시 재생합니다!" : "⏮️ 이전 노래로 이동했습니다!");

/** 곡으로 건너뛰기 메뉴 */
const jumped = (track: { title: string }) => `⏭️ **${track.title}**로 이동했습니다!`;

/** 정지. cleared 는 비운 대기열 곡 수(0 이면 꼬리말 없음) */
const stopped = (track: Linked | null | undefined, cleared: number) => ({
  title: "⏹️ 음악 중지됨",
  description: `${track ? link(track) : "Music"} 중지됨!`,
  by: "👤 중지한 사람",
  footer: cleared > 0 ? `대기열에서 ${cleared}개의 노래가 제거되었습니다` : null,
});

/** 섞기 */
const shuffled = (count: number) => ({ title: "🔀 대기열 셔플됨", description: `${count}개의 노래가 셔플되었습니다!`, by: "👤 셔플한 사람" });

/** 하이라이트로 이동. 패널 버튼 */
const highlightButton = () => "✨ 하이라이트 지점으로 이동했어요.";
/** 하이라이트로 이동. 명령 */
const highlighted = (track: Linked) => ({ title: "✨ 하이라이트로 이동", description: link(track), at: "⏱️ 위치" });

/** 처음부터 다시 */
const replayed = (track: Linked) => ({ title: "🔄 처음부터 다시 재생", description: link(track), by: "👤 요청한 사람" });

/** 시간 이동 */
const seeked = (track: Linked) => ({ title: "⏩ 시간 이동", description: link(track), at: "⏱️ 이동한 위치" });

/** 대기열 비우기. track 이 있으면 지금 곡 칸을 단다 */
const cleared = (count: number) => ({ title: "🗑️ 대기열 비워짐", description: `대기열에서 ${count}개의 노래가 제거되었습니다`, by: "👤 변경한 사람", current: "🎵 현재 재생 중" });

/** 대기열에서 한 곡 빼기 */
const removed = (track: Linked) => ({ title: "🗑️ 곡 제거됨", description: link(track), by: "👤 제거한 사람", left: "📋 남은 대기열" });

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
  track: ["🔂", "반복 모드가 **트랙 반복**으로 설정되었습니다. 현재 곡이 계속 재생됩니다."],
  queue: ["🔁", "반복 모드가 **대기열 반복**으로 설정되었습니다. 대기열이 끝나면 다시 시작됩니다."],
  false: ["➡️", "반복 모드가 이제 **꺼졌습니다**"],
};
/** 반복 모드 바꾸기. 명령 */
const loopSet = (mode: string | false) => {
  const [emoji, message] = LOOP[String(mode)];
  return { title: `${emoji} 반복 모드 변경됨`, description: message, by: "👤 변경한 사람" };
};
/** 반복 모드 바꾸기. 패널 버튼 */
const loopSetButton = (mode: string | false) => {
  const [emoji, message] = LOOP[String(mode)];
  return { title: `${emoji} 🔁 반복 모드 변경됨`, description: message, by: "👤 변경한 사람" };
};

/** 음량. before · level 은 0~100 */
const volumeSet = (before: number, level: number) => ({
  title: "🔊 볼륨이 변경되었습니다",
  description: before === level ? `볼륨은 그대로 **${level}%**입니다.` : `**${before}%** → **${level}%**`,
  by: "👤 변경한 사람",
});
/** 음량 입력 창 */
const volumeModal = () => ({ title: "볼륨 설정", label: "볼륨 (0-100)" });

/** 음성 채널에서 나가기. 플레이어 없이 봇만 남아 있었다 */
const leftVoiceOnly = () => "👋 음성 채널에서 나갔습니다!";
/** 음성 채널에서 나가기. 곡이 있었으면 저장한 자리 · 대기열 칸을 단다 */
const left = () => ({ title: "👋 채널에서 나갔습니다", by: "👤 실행한 사람", position: "⏱️ 저장된 위치", queue: "📋 저장된 대기열", footer: "/join 으로 이전 세션을 복구할 수 있습니다." });

/** 음성 채널에 들어오기 */
const joined = () => "✅ 음성 채널에 접속했어요!";
const alreadyJoined = () => "✅ 이미 채널에 접속해 있어요.";
/** 저장한 세션을 되살렸다. title 은 마크다운을 이스케이프한 곡 제목 */
const restored = (title: string, isPaused: boolean) => (isPaused ? `⏸️ 이전 세션을 복구했어요! **${title}** 일시정지 중` : `▶️ 이전 세션을 복구했어요! **${title}** 재생 중`);
/** 세션을 되살렸는데 틀 곡이 없다 */
const restoredEmpty = () => "✅ 음성 채널에 접속했어요. (세션 복구 실패 - 곡을 찾을 수 없음)";
/** 세션을 되살리다 오류가 났다 */
const restoreFailed = () => "⚠️ 이전 세션 복구 중 오류가 발생했습니다. `/play`로 다시 시작해 주세요.";

export { paused, skipRestarted, skipped, previous, jumped, stopped, shuffled, highlightButton, highlighted, replayed, seeked, cleared, removed, moved, loopSet, loopSetButton, volumeSet, volumeModal, leftVoiceOnly, left, joined, alreadyJoined, restored, restoredEmpty, restoreFailed };
