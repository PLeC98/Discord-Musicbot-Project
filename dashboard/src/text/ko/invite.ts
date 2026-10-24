// 봇 초대 화면 · 사이드바 ⊕

const title = "봇 초대";
const count = (n: number) => `${n}곳`;
const refresh = "서버 목록 새로 받기";
const invite = "이 서버에 초대";
const opensNewTab = "새 탭에서 디스코드 승인 화면이 열려요";
const empty = { title: "초대할 서버가 없어요", body: "서버 관리 권한이 있는 서버에 봇이 이미 다 있어요." };
const relogin = { title: "서버 목록을 받으려면 다시 로그인해야 해요", body: "로그인 창에서 디스코드로 다시 로그인하면 목록을 받아요.", action: "다시 로그인" };
const failed = "서버 목록을 받지 못했어요";
/** 모든 서버 화면이 비었을 때 초대 화면으로 가는 버튼 */
const goInvite = "봇 초대하기";

export { title, count, refresh, invite, opensNewTab, empty, relogin, failed, goInvite };
