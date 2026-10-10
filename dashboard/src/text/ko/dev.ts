// 운영자 패널: 개발자 옵션 탭(권한 적용해서 보기 · 유지 관리)

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
  desc: "봇 재시작 없이 현재 커맨드들을 디스코드에 다시 등록해요.",
  run: "재배포",
  running: "재배포 중…",
  done: "커맨드를 다시 배포했어요",
  /** 등록한 수와 범위 */
  summary: (count: number, guild: boolean) => `${count}개 · ${guild ? "서버" : "전역"}`,
  failed: "커맨드를 다시 배포하지 못했어요.",
};
const reset = {
  title: "캐시 초기화",
  desc: "받아 둔 오디오 파일과 조회 기록을 모두 지워요. 서버 설정과 저장된 대기열은 남아요.",
  run: "초기화",
  running: "지우는 중…",
  confirmTitle: "캐시를 모두 지울까요?",
  confirmBody: "되돌릴 수 없어요. 오디오 파일 · 조회 기록 · SponsorBlock 구간 캐시 · 연령 제한 표시가 사라지고, 다음 재생부터 다시 받아요.\n서버 설정(전용 채널 · DJ 역할 · SponsorBlock)과 저장된 대기열(봇을 다시 켤 때 이어 틀 곡)은 남아요.",
  confirm: "모두 지우기",
  done: "캐시를 비웠어요",
  /** 지운 것과 남긴 것(재생 중이라) */
  summary: (removed: number, mb: number, kept: number) => `파일 ${removed}개 · ${mb}MB${kept > 0 ? `\n${kept}개는 재생 중이라 남겼어요` : ""}`,
  failed: "캐시를 비우지 못했어요.",
};

export { viewAs, maintenance, redeploy, reset };
