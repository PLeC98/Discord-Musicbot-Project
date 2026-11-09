// 플레이어가 알린 일(player/events 의 notice)을 텍스트 채널에 보낼 안내. 세부(detail)는 알린 쪽이 준 것

import { noticeOf } from "../notice.ts";
import { escapeMd } from "../../mentions.ts";
import { josa } from "../../../rules/josa.ts";
import { songTitle } from "./labels.ts";

// 저장된 세션의 장르가 장르 목록에서 없어졌다
const autoplayUnknownGenre = (genre: string) => noticeOf("warning", "autoplay", "알 수 없는 장르예요!", `장르 목록이 변경되어 \`${genre}\`${josa(genre, "이")} 없어져서 자동재생을 껐어요. 장르를 다시 선택해 주세요.`);
// 장르의 소스가 모두 키가 없어 못 쓴다
const autoplayGenreUnusable = (genre: string, keys: string) => noticeOf("warning", "autoplay", "지금은 쓸 수 없는 장르예요!", `\`${genre}\` 장르가 쓰는 소스(${keys})의 키가 없어 자동재생을 껐어요. 봇 운영자에게 알려 주세요.`);
const autoplayGaveUp = (genre: string) => noticeOf("warning", "autoplay", `\`${genre}\` 장르에서 틀 곡을 찾지 못해 자동재생을 종료했어요.`);
/** 곡을 열지 못해 그 곡에서 일시정지했다(다음 곡도 같은 이유로 안 된다). 까닭 안내 끝에 붙는 줄 */
const parkedLine = () => "다음 곡으로 넘기지 않고 일시정지했어요. 재생 버튼을 누르면 다시 시도해요.";
/** 까닭을 모르는 실패가 이어져 그 곡에서 일시정지했다 */
const parkedFailures = (count: number) => noticeOf("error", "failed", `${count}곡이 연달아 재생되지 않아 일시정지했어요.`, "재생 버튼으로 다시 시도하거나 다음 곡 버튼으로 넘길 수 있어요.");
/** 들리던 곡이 끊겨 다시 열지 못해 그 자리에서 일시정지했다 */
const parkedDropped = () => noticeOf("error", "failed", "재생이 중간에 끊겨 일시정지했어요.", "재생 버튼을 누르면 끊긴 위치부터 다시 재생해요.");
/** 넘긴 곡과 같은 곡을 대기열에서도 뺐다 */
const copiesRemoved = (count: number) => `대기열에 같은 곡이 ${count}번 더 있어서 함께 뺐어요.`;
/** 재생할 수 없어 넘긴 곡 중 하나씩 알리지 않은 것 */
const skippedMore = (count: number) => noticeOf("error", "failed", `재생할 수 없는 ${count}곡을 더 넘겼어요.`);
/** /join 없이 새로 틀어 저장해 둔 대기열을 지웠다. count 는 사람이 넣은 곡 수 */
const savedSessionReplaced = (count: number) => noticeOf("warning", "state", `저장해 둔 대기열 ${count}곡을 지우고 새로 시작했어요.`, "다음부터 이어 들으려면 곡을 넣기 전에 `/join`을 먼저 써 주세요.");
/** 봇을 다시 시작해 저장한 세션을 복원했다 { icon, title, body }(icon 은 헤더 줄 아이콘의 키). at 은 이어 튼 위치를 말로 적은 것 */
const restored = (title: string | null | undefined, at: string, paused: boolean) => {
  const line = `• **${escapeMd(songTitle(title))}** (${at})`;
  return paused ? { icon: "restored" as const, title: "봇이 복구됐어요", body: `마지막 일시정지 상태를 유지할게요.\n${line}` } : { icon: "restored" as const, title: "봇이 복구됐어요", body: `기록된 마지막 재생 상태를 이어갈게요.\n${line}` };
};

/** 스테이지에 청중으로 들어와 발언을 요청했다 */
const stageRequested = () => noticeOf("warning", "voice", "스테이지 발언을 요청했어요!", "스테이지 모더레이터가 요청을 수락하면 곡을 틀게요.");
/** 스테이지에서 발언자가 될 수도, 요청할 수도 없다 */
const stageCannotSpeak = () => noticeOf("error", "permission", "이 스테이지에서는 말할 수 없어요.", "봇에게 멤버 음소거 권한이나 발언권 요청 권한을 주거나, 모더레이터가 저를 발언자로 초대해 주세요.");

/** 상주 모드를 스스로 껐다(자리 지킴이). 다시 켜는 법을 싣는다. channel 은 자리 채널(멘션) */
const stayKicked = () => noticeOf("warning", "voice", "누가 저를 내보내서 상주 모드를 껐어요.", "`/247`로 다시 켤 수 있어요.");
const stayChannelGone = () => noticeOf("warning", "voice", "머물던 음성 채널이 삭제돼서 상주 모드를 껐어요.", "다른 음성 채널에서 `/247`로 다시 켤 수 있어요.");
const stayNoPermission = (channel: string) => noticeOf("error", "permission", `${channel}에 들어갈 권한이 없어서 상주 모드를 껐어요.`, "저에게 연결과 말하기 권한을 준 뒤 `/247`로 다시 켜 주세요.");

export { stayKicked, stayChannelGone, stayNoPermission, autoplayUnknownGenre, autoplayGenreUnusable, autoplayGaveUp, parkedLine, parkedFailures, parkedDropped, copiesRemoved, skippedMore, savedSessionReplaced, restored, stageRequested, stageCannotSpeak };
