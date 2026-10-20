// 재생 패널(지금 곡 · 끝난 패널)의 문구

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

// 멈춘 까닭(Player.pauseReasons)마다 [아이콘, 글]
const PAUSED = { mute: ["muted", "음소거됨"], alone: ["alone", "혼자 남음"], other: ["pause", "일시정지"] } as const satisfies Record<string, readonly [IconKey, string]>;
/** 상태 줄의 멈춤 */
const pausedStatus = (reason: keyof typeof PAUSED) => `${icon(PAUSED[reason][0])} ${PAUSED[reason][1]}`;
/** 상태 줄의 대기열 곡 수 */
const queuedStatus = (count: number) => `대기열 ${count}곡`;
/** 상태 줄의 건너뛸 구간 수(SponsorBlock) */
const segmentsStatus = (count: number) => `건너뛸 구간 ${count}개`;
/** 패널 아래의 대시보드 링크 */
const dashboardLink = (url: string) => `${icon("dashboard")} [대시보드](${url})`;

/**
 * 끝난 패널. reason 은 nowPlayingPanel.createIdleContainer 와 같다. leavesAt 은 음성에서 나갈 시각(ms),
 * dedicated 는 전용 채널의 패널인지(그러면 곡 이름만 적어도 다시 온다)
 */
function idle({ reason, leavesAt, dedicated }: { reason: string; leavesAt?: number | null; dedicated: boolean }) {
  let title: string, status: string;
  if (reason === "leave") {
    [title, status] = ["듣고 있던 곡이 있어요", `${icon("resume")} \`/join\`으로 이어 들을 수 있어요`];
  } else if (reason === "failures") {
    [title, status] = ["곡 재생에 연달아 실패해서 재생을 멈췄어요", `${icon("music")} 곡을 넣으면 다시 틀게요`];
  } else if (leavesAt) {
    [title, status] = [reason === "joined" ? "곡을 기다리고 있어요" : "재생이 끝났어요", `🌙 <t:${Math.round(leavesAt / 1000)}:R> 쉬러 갈게요`];
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
  "inactivity-timeout": "한동안 곡이 없거나 듣는 사람이 없어서 쉬러 갔어요. `/play`로 부르면 다시 올게요.",
  "forced-disconnect": "누군가 저를 음성 채널에서 내보냈어요. `/play`로 부르면 다시 올게요.",
  "operator-leave": "봇 운영자가 이 서버에서 저를 내보냈어요.",
  "voice-lost": "음성 연결이 끊겨 다시 연결하지 못했어요. `/join`으로 이어 들을 수 있어요.",
  "channel-gone": "제가 있던 음성 채널이 사라졌어요. `/play`로 부르면 다시 올게요.",
  fault: "같은 오류가 반복되어 재생을 멈췄어요. 계속되면 봇 운영자에게 알려주세요.",
};
/** 전용 채널 밖에서 끊겨 끝났다는 안내. 알릴 까닭이 아니면(stop · leave 등) null */
const cutOff = (cause: string): EndNotice | null => (CUT_OFF[cause] ? { title: "👋 음성 채널에서 나왔어요", body: CUT_OFF[cause] } : null);

export { playingTitle, loopLabel, buttons, jumpPlaceholder, pausedStatus, queuedStatus, segmentsStatus, dashboardLink, idle, ended, cutOff };
