// 재생 패널(지금 곡, 끝난 패널)의 문구

import { icon, type IconKey } from "../../icons.ts";

/** 재생 패널의 헤더 */
const playingTitle = () => `${icon("music")} 현재 재생 중`;

// 반복 버튼의 라벨
const LOOP_LABEL = { track: "한 곡 반복", queue: "대기열 반복", off: "반복 꺼짐" } as const;
const loopLabel = (mode: keyof typeof LOOP_LABEL) => LOOP_LABEL[mode];
/** 라벨이 붙은 버튼 */
const buttons = () => ({ queue: "대기열", autoplay: "자동재생" });
/** 곡으로 건너뛰기 메뉴 */
const jumpPlaceholder = () => "⏭ 이 곡 먼저 재생하기";

// 멈춘 까닭(억제 사유 rules/holds, 사람이 멈췄으면 other)마다 [아이콘, 글]
const PAUSED = { mute: ["muted", "음소거됨"], stage: ["voice", "발언자 기다림"], alone: ["alone", "혼자 남음"], other: ["pause", "일시정지"] } as const satisfies Record<string, readonly [IconKey, string]>;
/** 상태 줄의 멈춤 */
const pausedStatus = (reason: keyof typeof PAUSED) => `${icon(PAUSED[reason][0])} ${PAUSED[reason][1]}`;
/** 멈춘 까닭의 아이콘, 글(대시보드 배지가 패널과 같은 말을 쓴다) */
const pausedLabel = (reason: keyof typeof PAUSED) => ({ icon: PAUSED[reason][0], text: PAUSED[reason][1] });
/** 억제 사유 옆에 붙이는 사람의 일시정지 표시(그 사유가 풀려도 멈춘 채) */
const userPausedMark = () => "일시정지";
/** 상태 줄의 대기열 곡 수 */
const queuedStatus = (count: number) => `대기열 ${count}곡`;
/** 상태 줄의 건너뛸 구간 수(SponsorBlock) */
const segmentsStatus = (count: number) => `건너뛸 구간 ${count}개`;
/** 상주 모드의 자리에서 트는 중 */
const stayStatus = () => `${icon("stay")} 상주 모드`;
/** 패널 아래의 대시보드 링크 */
const dashboardLink = (url: string) => `${icon("dashboard")} [대시보드](${url})`;

// 복원을 건너뛴 기동의 끝난 패널 제목. 채널 안내의 제목과 같다
const RESTORE_SKIPPED_TITLE = "오류가 반복되어 재생을 멈췄어요";

/**
 * 끝난 패널. reason 은 nowPlayingPanel.createIdleContainer 와 같다. leavesAt 은 음성에서 나갈 시각(ms),
 * staying 은 상주 모드의 자리에서 곡을 기다리는지, dedicated 는 전용 채널의 패널인지(그러면 곡 이름만 적어도 다시 온다)
 */
function idle({ reason, leavesAt, staying = false, dedicated }: { reason: string; leavesAt?: number | null; staying?: boolean; dedicated: boolean }) {
  let title: string, status: string;
  const waitingTitle = reason === "queue-end" ? "재생이 끝났어요" : "곡을 기다리고 있어요";
  if (reason === "leave") {
    [title, status] = ["듣고 있던 곡이 있어요", `${icon("resume")} \`/join\`으로 이어 들을 수 있어요`];
  } else if (reason === "restore-skipped") {
    [title, status] = [RESTORE_SKIPPED_TITLE, `${icon("resume")} \`/join\`으로 이어 들을 수 있어요`];
  } else if (staying) {
    [title, status] = [waitingTitle, `${icon("stay")} 상주 모드라 나가지 않고 다음 곡을 기다려요`];
  } else if (leavesAt) {
    [title, status] = [waitingTitle, `🌙 <t:${Math.round(leavesAt / 1000)}:R> 쉬러 갈게요`];
  } else {
    [title, status] = ["쉬는 중이에요", dedicated ? "👋 곡을 입력하면 다시 올게요" : "👋 `/play`로 부르면 다시 올게요"];
  }
  return `### ${icon("idle")} 재생 대기 중\n**${title}**\n-# ${status}`;
}

/** 채널에 보내는 끝 안내. icon 은 헤더 줄 아이콘의 키(없으면 제목에 든 이모지만) */
type EndNotice = { icon?: IconKey; title: string; body: string };

/** 전용 채널 밖에서 대기열을 다 틀었다는 안내 */
const ended = (): EndNotice => ({ icon: "music", title: "재생이 끝났어요", body: "`/play`로 곡을 넣으면 다시 틀어요." });

// 끊겨서 음성 채널에서 나왔다. 까닭(Player.dispose 의 end)마다의 본문
const CUT_OFF: Record<string, string> = {
  "alone-timeout": "한동안 듣는 사람이 없어서 쉬러 갔어요. `/play`로 부르면 다시 올게요.",
  kicked: "누군가 저를 음성 채널에서 내보냈어요. `/play`로 부르면 다시 올게요.",
  "stage-ended": "스테이지가 끝나서 나왔어요. `/play`로 부르면 다시 올게요.",
  "stage-disconnect": "스테이지가 끝났거나 누군가 저를 음성 채널에서 내보냈어요. `/play`로 부르면 다시 올게요.",
  "operator-leave": "봇 운영자가 이 서버에서 저를 내보냈어요.",
  "dashboard-leave": "대시보드를 통해 이 서버에서 저를 내보냈어요.",
  "voice-lost": "음성 연결이 끊겨 다시 연결하지 못했어요. `/join`으로 이어 들을 수 있어요.",
  "channel-gone": "제가 있던 음성 채널이 사라졌어요. `/play`로 부르면 다시 올게요.",
  fault: "같은 오류가 반복되어 재생을 멈췄어요. 계속되면 봇 운영자에게 알려주세요.",
};
/** 전용 채널 밖에서 끊겨 끝났다는 안내. 알릴 까닭이 아니면(stop, leave 등) null */
const cutOff = (cause: string): EndNotice | null => (CUT_OFF[cause] ? { title: "👋 음성 채널에서 나왔어요", body: CUT_OFF[cause] } : null);

/** 짧게 끊긴 실행이 이어져 기동이 세션을 이어 틀지 않았다는 안내(전용 채널 밖). 봇이 이미 음성에서 빠져 있었을 수 있어 나왔다고 하지 않는다 */
const restoreSkipped = (): EndNotice => ({ title: `⚠️ ${RESTORE_SKIPPED_TITLE}`, body: "짧은 시간에 여러 번 꺼져서 일부러 이어 틀지 않았어요. `/join`으로 이어 들을 수 있어요." });

export { playingTitle, loopLabel, buttons, jumpPlaceholder, pausedStatus, pausedLabel, userPausedMark, queuedStatus, segmentsStatus, stayStatus, dashboardLink, idle, ended, cutOff, restoreSkipped };
