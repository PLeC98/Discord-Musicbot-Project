// 재생 패널(지금 곡 · 끝난 패널)의 글자

/** 재생 패널의 머리 */
const playingTitle = () => "🎵 현재 재생 중";

// 반복 버튼의 이름표
const LOOP_LABEL = { track: "한 곡 반복", queue: "대기열 반복", off: "반복 꺼짐" } as const;
const loopLabel = (mode: keyof typeof LOOP_LABEL) => LOOP_LABEL[mode];
/** 이름표가 붙은 버튼 */
const buttons = () => ({ queue: "대기열", autoplay: "자동재생" });
/** 곡으로 건너뛰기 메뉴 */
const jumpPlaceholder = () => "⏭ 이 곡 먼저 재생하기";

// 멈춘 까닭(Player.pauseReasons)
const PAUSED = { mute: "🔇 음소거됨", alone: "⏳ 혼자 남음", other: "⏸️ 일시정지" } as const;
/** 상태 줄의 멈춤 */
const pausedStatus = (reason: keyof typeof PAUSED) => PAUSED[reason];
/** 상태 줄의 대기열 곡 수 */
const queuedStatus = (count: number) => `대기열 ${count}곡`;
/** 상태 줄의 건너뛸 구간 수(SponsorBlock) */
const segmentsStatus = (count: number) => `건너뛸 구간 ${count}개`;
/** 패널 아래의 대시보드 링크 */
const dashboardLink = (url: string) => `🔗 [대시보드](${url})`;

/**
 * 끝난 패널. reason 은 nowPlayingPanel.createIdleContainer 와 같다. leavesAt 은 음성에서 나갈 시각(ms),
 * dedicated 는 전용 채널의 패널인지(그러면 곡 이름만 적어도 다시 온다)
 */
function idle({ reason, leavesAt, dedicated }: { reason: string; leavesAt?: number | null; dedicated: boolean }) {
  let title: string, status: string;
  if (reason === "leave") {
    [title, status] = ["듣고 있던 곡이 있어요", "💾 `/join`으로 이어 들을 수 있어요"];
  } else if (reason === "failures") {
    [title, status] = ["곡 재생에 연달아 실패해서 재생을 멈췄어요", "🎵 곡을 넣으면 다시 틀게요"];
  } else if (leavesAt) {
    [title, status] = [reason === "joined" ? "곡을 기다리고 있어요" : "재생이 끝났어요", `🌙 <t:${Math.round(leavesAt / 1000)}:R> 쉬러 갈게요`];
  } else {
    [title, status] = ["쉬는 중이에요", dedicated ? "👋 곡을 입력하면 다시 올게요" : "👋 `/play`로 부르면 다시 올게요"];
  }
  return `### 💤 재생 대기 중\n**${title}**\n-# ${status}`;
}

/** 전용 채널 밖에서 재생이 끝났다는 안내 */
// 끝난 까닭마다의 문장과 보낼지는 9e(#35)에서 정한다
const ended = () => ({ title: "🎵 재생이 끝났어요", description: "`/play`로 곡을 넣으면 다시 틀어요." });

export { playingTitle, loopLabel, buttons, jumpPlaceholder, pausedStatus, queuedStatus, segmentsStatus, dashboardLink, idle, ended };
