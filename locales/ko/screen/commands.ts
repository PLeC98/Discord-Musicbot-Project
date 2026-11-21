// 운영자 패널: 설정(일반) 탭의 디스코드 명령 카드

const title = "디스코드 명령";
const redeploy = {
  title: "슬래시 커맨드 재배포",
  desc: "봇 재시작 없이 현재 커맨드를 디스코드에 다시 등록해요.",
  run: "재배포",
  running: "재배포 중…",
  done: "커맨드를 다시 배포했어요",
  /** 등록한 수와 범위 */
  summary: (count: number, guild: boolean) => `${count}개 · ${guild ? "서버" : "전역"}`,
  failed: "커맨드를 다시 배포하지 못했어요.",
};

export { title, redeploy };
