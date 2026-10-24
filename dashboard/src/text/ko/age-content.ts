// 운영자 패널: 일반 탭의 연령 제한 콘텐츠 카드 · 켜기 확인창

const title = "연령 제한 콘텐츠";
const allow = "연령 제한 콘텐츠 재생";
const allowDesc = "연령 제한 콘텐츠 재생을 위한 설정 메뉴가 표시돼요. 설정을 했더라도 이 옵션을 끄면 재생을 막아요.";
const confirm = {
  title: "연령 제한 콘텐츠 재생을 켤까요?",
  account: "설정에는 각 플랫폼에서 연령 인증이 된 계정이 필요하며,\n그 계정의 정보를 사용해서 재생해요.",
  /** 서버마다 틀 곳: 앞 · 굵게 · 뒤 */
  placeBefore: "서버별로 연령 제한 채널 혹은 ",
  placeStrong: "모든 채널",
  placeAfter: "에서 재생되도록\n서버 관리자가 설정할 수 있어요.",
  /** 굵은 마지막 문단 */
  emphasis: "봇은 청취자의 연령을 확인하지 않아요.",
  run: "이해했으며, 켜기를 원해요",
};
const saveFailed = "연령 제한 콘텐츠를 바꾸지 못했어요.";

export { title, allow, allowDesc, confirm, saveFailed };
