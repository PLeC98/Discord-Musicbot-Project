// 운영자 패널: 일반 탭의 연령 제한 콘텐츠 카드 · 켜기 확인창

const title = "연령 제한 콘텐츠";
const allow = "연령 제한 영상 틀기";
const allowDesc = "켜면 연령 제한 탭이 생기고, 거기에 넣은 쿠키로 연령 제한 영상을 받아요. 끄면 넣어 둔 쿠키는 지우지 않고 쓰지 않아요.";
const confirm = {
  title: "연령 제한 콘텐츠를 켤까요?",
  body: "연령 제한 영상을 틀 수 있게 돼요. 연령 제한 탭에 넣은 쿠키의 계정으로 받아요.\n봇은 듣는 사람의 나이를 확인하지 않아요.",
  run: "이해했어요, 켜기",
};
const saveFailed = "연령 제한 콘텐츠를 바꾸지 못했어요.";

export { title, allow, allowDesc, confirm, saveFailed };
