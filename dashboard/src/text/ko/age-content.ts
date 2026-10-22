// 운영자 패널: 일반 탭의 연령 제한 콘텐츠 카드 · 켜기 확인창

const title = "연령 제한 콘텐츠";
const allow = "연령 제한 콘텐츠 재생";
const allowDesc = "연령 제한 콘텐츠 재생을 위한 설정 메뉴가 표시돼요. 설정을 했더라도 이 옵션을 끄면 재생을 막아요.";
const confirm = {
  title: "연령 제한 콘텐츠 재생을 켤까요?",
  body: "설정에는 각 플랫폼에서 연령 인증이 된 계정이 필요하며,\n그 계정의 정보를 사용해서 재생해요.",
  /** 본문 아래 굵게 한 줄 */
  emphasis: "봇은 청취자의 연령을 확인하지 않아요.",
  run: "이해했으며, 켜기를 원해요",
};
const saveFailed = "연령 제한 콘텐츠를 바꾸지 못했어요.";

export { title, allow, allowDesc, confirm, saveFailed };
