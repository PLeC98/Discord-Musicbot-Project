// 운영자 패널 백업 · 초기화 탭의 초기화 카드

const title = "초기화";
const cache = {
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

export { title, cache };
