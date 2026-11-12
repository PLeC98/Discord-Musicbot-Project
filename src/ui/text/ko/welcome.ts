// 봇이 새 서버에 들어왔을 때 올리는 안내의 문구

/**
 * 명령은 멘션(누르면 입력창에 채워진다)으로, server 는 마크다운을 이스케이프한 서버 이름으로 받는다.
 * dashboard 는 웹 대시보드 버튼이 있는지, fork 는 운영 중인 봇이 수정본인지(SOURCE_REPO_URL 을 따로 정했다)
 */
const welcome = ({ server, play, setchannel, help, dashboard, projectRepo, sourceRepo, fork }: { server: string; play: string; setchannel: string; help: string; dashboard: boolean; projectRepo: string; sourceRepo: string; fork: boolean }) => ({
  title: "서버에 초대해 주셔서 고마워요!",
  intro: `**${server}** 서버에서 쓸 기본적인 사용법을 알려 드릴게요.`,
  usage: [`- 음성 채널에 접속해서 ${play}로 곡을 재생해요.`, `- 서버 관리자가 ${setchannel}로 전용 채널을 지정할 수 있어요.`, "  - 전용 채널에서는 명령어 없이 곡 이름이나 링크만 넣어도 돼요!", "", `- 다른 명령어들에 대해 알고 싶다면 ${help}를 사용해 보세요!`, ...(dashboard ? ["- 모든 조작과 설정은 대시보드에서도 가능해요!"] : [])],
  source: [`- 봇을 직접 운영하는 데에 관심이 있다면 [GitHub 페이지](${projectRepo})에 방문해 보세요!`, ...(fork ? ["- 이 봇은 해당 프로젝트의 포크 버전이에요.", `  사용 중인 봇에 관심이 있다면 [이쪽](${sourceRepo})을 확인해 보세요!`] : [])],
  license: fork ? "GNU AGPL-3.0-or-later" : "Copyright (C) 2026 PLeC - GNU AGPL-3.0-or-later",
});

/** 버튼. project 는 원본 저장소, source 는 수정본 저장소(fork 일 때만) */
const buttons = (fork: boolean) => ({ dashboard: "웹 대시보드", project: fork ? "원본 GitHub" : "GitHub", source: "운영 버전 GitHub" });

export { welcome, buttons };
