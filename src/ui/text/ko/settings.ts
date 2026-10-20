// 서버 설정 화면(/setchannel · /setdjrole · /setplaylistlimit · /sponsorblock)의 문구. icon 은 헤더 줄 아이콘의 키(ui/settings-screens 가 화면 색으로 그린다)

import { icon } from "../../icons.ts";

const roleMentions = (roleIds: string[]) => roleIds.map((id) => `<@&${id}>`).join(" ");

/** 저장 · 취소 버튼 */
const buttons = () => ({ save: "저장", cancel: "취소" });

/** 전용 채널을 풀었다 */
const channelRemoved = () => ({ icon: "channel" as const, title: "전용 채널 해제됨", description: "이제 명령어로만 곡을 재생할 수 있어요." });
/** 전용 채널을 정했다. channel 은 채널 멘션 */
const channelSet = (channel: string) => ({
  icon: "done" as const,
  title: "전용 채널 설정됨",
  description: `${channel} 채널을 봇 전용 채널로 설정했어요.\n\n` + `이 채널에 링크나 검색어를 적으면 바로 재생해요.\n` + `대시보드의 공지도 이 채널로 발송돼요.`,
  inputs: `${icon("inputs")} 입력할 수 있는 것`,
  inputsValue: "• 지원하는 플랫폼 링크 (유튜브, 스포티파이, 사운드클라우드)\n• 재생 가능한 미디어 링크\n• 곡 이름이나 아티스트 이름 등의 검색어",
});

/** DJ 역할 선택 화면. roleIds 는 지금 DJ 역할(없으면 모두가 조작) */
const djRoleMenu = (roleIds: string[]) => ({
  icon: "dj_role" as const,
  title: "DJ 역할",
  description: [roleIds.length ? `현재 DJ 역할: ${roleMentions(roleIds)}` : "DJ 역할이 없어 **모두**가 재생을 조작할 수 있어요.", "", "아래 메뉴에서 DJ로 지정할 역할을 선택한 뒤 **저장**을 누르세요. (여러 역할을 지정할 수 있어요)", "아무 역할도 선택하지 않으면 모두가 DJ 권한을 가져요.", "서버 관리자는 설정과 상관없이 항상 조작할 수 있어요."].join("\n"),
  placeholder: "DJ로 지정할 역할 선택",
});
const djRoleCancelled = () => ({ icon: "dj_role" as const, title: "DJ 역할 설정을 취소했어요", description: "변경 사항은 반영하지 않았어요." });
/** 역할 없이 저장했다 */
const djRoleCleared = () => ({ icon: "dj_role" as const, title: "DJ 역할을 지정하지 않았어요", description: "모두가 재생을 조작할 수 있어요." });
const djRoleSaved = (roleIds: string[]) => ({
  icon: "done" as const,
  title: "DJ 역할을 설정했어요",
  description: `DJ 역할: ${roleMentions(roleIds)}\n\n이제 ${icon("dj")} 재생 조작(건너뛰기 · 정지 · 볼륨 등)은 이 역할이 있는 사람만 할 수 있어요.\n특정 권한을 가진 서버 관리자들은 항상 조작할 수 있어요.`,
});

const onOff = (enabled: boolean) => (enabled ? "켬" : "끔");
/** SponsorBlock 설정 화면. enabled 는 이 서버에서 켰는지 */
const sponsorMenu = (enabled: boolean) => ({
  icon: "sponsorblock" as const,
  title: "SponsorBlock 자동 건너뛰기",
  description: `현재 설정: **${onOff(enabled)}**\n건너뛸 구간 종류를 아래에서 선택하고 **저장**을 누르세요. 켜고 끄기는 버튼으로 해요.`,
  placeholder: "건너뛸 구간 종류 선택",
  toggle: enabled ? "켜짐 (끄기)" : "꺼짐 (켜기)",
});
/** 저장한 구간을 한 줄로. categories 는 구간 종류의 라벨 */
const sponsorSummary = (enabled: boolean, categories: string[]) => {
  if (!enabled) return onOff(false);
  return categories.length ? categories.join(", ") : "선택한 구간 없음 (건너뛰지 않아요)";
};
const sponsorCancelled = () => ({ icon: "sponsorblock" as const, title: "SponsorBlock 설정을 취소했어요", description: "변경 사항은 반영하지 않았어요." });
const sponsorSaved = (enabled: boolean, summary: string) => ({ icon: "sponsorblock" as const, title: "SponsorBlock 설정을 저장했어요", description: `현재 설정: **${onOff(enabled)}**\n구간: ${summary}` });

/** 재생목록 한 번에 넣는 곡 수를 기본값으로 되돌렸다. count 는 되돌린 값 */
const playlistLimitReset = (count: number) => ({ icon: "playlist_add" as const, title: "기본값으로 되돌렸어요", description: `재생목록을 넣으면 한 번에 **${count}곡**씩 들어가요.` });
/** 지금 값. isDefault 는 서버가 정하지 않아 기본값인지 */
const playlistLimitNow = ({ count, isDefault, min, max }: { count: number; isDefault: boolean; min: number; max: number }) => ({
  icon: "playlist_add" as const,
  title: "재생목록에 한 번에 넣을 곡 수",
  description: `지금은 **${count}곡**이에요${isDefault ? " (기본값)" : ""}.\n\`/setplaylistlimit count:<곡 수>\`로 바꿀 수 있어요 (${min}~${max}곡).`,
});
const playlistLimitSet = (count: number) => ({ icon: "done" as const, title: "재생목록에 한 번에 넣을 곡 수를 바꿨어요", description: `이제 재생목록을 넣으면 한 번에 **${count}곡**씩 들어가요.\n남은 곡은 "더 넣기"로 이어 넣을 수 있어요.` });

export { buttons, channelRemoved, channelSet, djRoleMenu, djRoleCancelled, djRoleCleared, djRoleSaved, sponsorMenu, sponsorSummary, sponsorCancelled, sponsorSaved, playlistLimitReset, playlistLimitNow, playlistLimitSet };
