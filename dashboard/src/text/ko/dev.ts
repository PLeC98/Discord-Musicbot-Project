// 운영자 패널: 개발자 옵션 탭(권한 적용해서 보기 · 유지 관리. 초기화는 백업 · 초기화 탭, text/ko/reset)

/** 권한 적용해서 보기 */
const viewAs = {
  title: "권한 적용해서 보기",
  desc: "설정한 권한으로 대시보드를 표시해요.",
  tip: "화면뿐 아니라 서버가 허용하는 동작도 그 권한을 따라요.\n이 패널은 어느 권한으로 보든 계속 열 수 있어요.",
  label: "권한 수준",
  none: { label: "오버라이드 안 함 (운영자)", desc: "일반 사용 시의 권한과 같아요." },
  failed: "권한 수준을 바꾸지 못했어요.",
};

/** 유지 관리 */
const maintenance = "유지 관리";
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

export { viewAs, maintenance, redeploy };
