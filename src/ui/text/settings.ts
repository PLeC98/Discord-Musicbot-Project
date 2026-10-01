// 서버 설정 화면(/setchannel · /setdjrole · /setplaylistlimit · /sponsorblock)의 글자

const roleMentions = (roleIds: string[]) => roleIds.map((id) => `<@&${id}>`).join(" ");

/** 저장 · 취소 버튼 */
const buttons = () => ({ save: "저장", cancel: "취소" });

/** 전용 채널을 풀었다 */
const channelRemoved = () => ({ title: "🔧 봇 채널 제거됨", description: "봇 전용 채널 설정이 해제됐어요.\n이제 `/play` 명령어로만 음악을 요청할 수 있어요." });
/** 전용 채널을 정했다. channel 은 채널 멘션 */
const channelSet = (channel: string) => ({
  title: "✅ 봇 채널 설정됨",
  description: `${channel}이(가) 봇 전용 채널로 설정됐어요!\n\n` + `이 채널에 음악 링크나 검색어를 입력하면 자동으로 재생해요.\n` + `대시보드의 공지 발송도 이 채널을 우선으로 사용해요.`,
  inputs: "📋 지원 입력",
  inputsValue: "• YouTube, Spotify, SoundCloud URL\n• 곡 이름이나 아티스트 검색어",
});

/** DJ 역할 고르기 화면. roleIds 는 지금 DJ 역할(없으면 모두가 제어) */
const djRoleMenu = (roleIds: string[]) => ({
  title: "🎧 DJ 역할 설정",
  description: [roleIds.length ? `현재 DJ 역할: ${roleMentions(roleIds)}` : "현재 DJ 역할이 설정되어 있지 않아 **모든 유저**가 재생을 제어할 수 있습니다.", "", "아래 메뉴에서 DJ로 지정할 역할을 고른 뒤 **저장**을 누르세요. (복수 선택 가능)", "아무 역할도 선택하지 않고 저장하면 제한이 해제됩니다.", "모더레이터(서버 관리·추방·차단·타임아웃 권한 보유자)는 설정과 무관하게 항상 제어할 수 있어요."].join("\n"),
  placeholder: "DJ로 지정할 역할 선택",
});
const djRoleCancelled = () => ({ title: "🎧 DJ 역할 설정 취소됨", description: "변경 사항 없이 닫았어요." });
/** 역할 없이 저장했다 */
const djRoleCleared = () => ({ title: "🎧 DJ 역할 제한 해제됨", description: "이제 모든 유저가 재생을 제어할 수 있어요.\n(모더레이터는 설정과 무관하게 항상 가능합니다)" });
const djRoleSaved = (roleIds: string[]) => ({
  title: "✅ DJ 역할 설정됨",
  description: `DJ 역할: ${roleMentions(roleIds)}\n\n이제 🔒 재생 제어(스킵/정지/볼륨 등)는 이 역할 보유자만 사용할 수 있어요.\n모더레이터(서버 관리·추방·차단·타임아웃 권한 보유자)는 항상 제어할 수 있습니다.`,
});

/** SponsorBlock 설정 화면. globalOff 는 봇 전체에서 꺼져 있어 이 서버의 설정이 듣지 않는지 */
const sponsorMenu = ({ enabled, globalOff }: { enabled: boolean; globalOff: boolean }) => ({
  title: "⏭️ SponsorBlock 자동 스킵 설정",
  description: [globalOff ? "⚠️ 봇 전역 설정에서 SponsorBlock이 꺼져 있어 이 설정은 적용되지 않습니다." : "", `현재: ${enabled ? "**사용**" : "**미사용**"}`, "", "건너뛸 구간 종류를 아래에서 고르고 **저장**을 누르세요. 사용 여부는 버튼으로 토글합니다."].filter((l) => l !== "").join("\n"),
  placeholder: "건너뛸 구간 종류 선택",
  toggle: enabled ? "사용 중 (끄기)" : "미사용 (켜기)",
});
/** 저장한 구간을 한 줄로. categories 는 구간 종류의 이름표 */
const sponsorSummary = (enabled: boolean, categories: string[]) => {
  if (!enabled) return "미사용";
  return categories.length ? categories.join(", ") : "선택된 구간 없음(사실상 미적용)";
};
const sponsorCancelled = () => ({ title: "⏭️ SponsorBlock 설정 취소됨", description: "변경 사항 없이 닫았어요." });
const sponsorSaved = (enabled: boolean, summary: string) => ({ title: "⏭️ SponsorBlock 설정 저장됨", description: `사용: **${enabled ? "예" : "아니오"}**\n구간: ${summary}` });

/** 재생목록 한 번에 넣는 곡 수를 기본값으로 되돌렸다. count 는 되돌린 값 */
const playlistLimitReset = (count: number) => ({ title: "🔧 기본값으로 되돌렸어요", description: `재생목록을 넣으면 한 번에 **${count}곡**씩 들어가요.` });
/** 지금 값. isDefault 는 서버가 정하지 않아 기본값인지 */
const playlistLimitNow = ({ count, isDefault, min, max }: { count: number; isDefault: boolean; min: number; max: number }) => ({
  title: "📃 재생목록 한 번에 넣는 곡 수",
  description: `지금은 **${count}곡**이에요${isDefault ? " (기본값)" : ""}.\n\`/setplaylistlimit count:<곡 수>\`로 바꿀 수 있어요 (${min}~${max}곡).`,
});
const playlistLimitSet = (count: number) => ({ title: "✅ 재생목록 한 번에 넣는 곡 수를 바꿨어요", description: `이제 재생목록을 넣으면 한 번에 **${count}곡**씩 들어가요.\n남은 곡은 "더 넣기"로 이어 넣을 수 있어요.` });

export { buttons, channelRemoved, channelSet, djRoleMenu, djRoleCancelled, djRoleCleared, djRoleSaved, sponsorMenu, sponsorSummary, sponsorCancelled, sponsorSaved, playlistLimitReset, playlistLimitNow, playlistLimitSet };
