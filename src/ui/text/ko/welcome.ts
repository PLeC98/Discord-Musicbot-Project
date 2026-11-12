// 봇이 새 서버에 들어왔을 때 올리는 안내의 문구

/** 명령은 멘션(누르면 입력창에 채워진다)으로 받는다 */
const welcome = ({ play, join, help, setchannel }: { play: string; join: string; help: string; setchannel: string }) => ({
  title: "초대해 주셔서 고마워요!",
  lines: [`음성 채널에 들어가서 ${play}로 곡을 틀어요. ${join}으로 봇만 먼저 부를 수도 있어요.`, `명령어 목록과 쓰는 법은 ${help}에서 볼 수 있어요.`, `서버 관리자는 ${setchannel}로 전용 채널을 정하면, 그 채널에 곡 이름이나 링크를 치기만 해도 곡이 들어가요.`],
  dashboard: "웹 대시보드",
});

export { welcome };
