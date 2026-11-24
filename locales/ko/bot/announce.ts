// 봇 운영자 공지(서버 관리의 공지 보내기, 다시 시작 공지)의 디스코드 임베드 문구. 모양(아이콘, 색)은 공유 타입의 ANNOUNCE_STYLE.
// 대시보드의 미리보기도 이 문구를 부른다(봇이 보낼 때와 같게)

/** 공지 종류(maintenance, update, alert, info)마다 임베드 제목 */
const titles = { maintenance: "봇 점검 안내", update: "봇 업데이트 안내", alert: "긴급 공지", info: "공지사항" };
/** 임베드 바닥글(보낸 사람) */
const footer = "봇 운영자";
/** 대시보드에서 봇을 다시 시작한다(재생 중인 서버에만 점검 공지 모양으로, 다시 뜬 뒤 복원 안내가 뒤따른다) */
const restarting = () => ({ title: "봇 다시 시작 안내", body: "안정적인 서비스를 위해 봇을 다시 시작해요.\n곡이 잠시 끊어지지만, 봇이 다시 켜지면 재생 중이던 곡을 이어서 틀어요." });

export { titles, footer, restarting };
