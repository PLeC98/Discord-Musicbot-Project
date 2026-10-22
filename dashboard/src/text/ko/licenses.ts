// 라이선스 대화상자(계정 메뉴)

const title = "라이선스";
const thisBot = "이 봇";
const runningSource = "운영 소스 코드";
const runningSourceModified = "운영 소스 코드 · 수정됨";
const originalProject = "원본 프로젝트";
const originalSource = "원본 소스 코드";
const sourceUnknown = "소스 코드 주소를 불러오지 못했어요";
/** 포크해 온 원본(상류)의 줄 */
const upstreamPart = "포크해 온 원본에서 남은 부분";
const groupFontsArt = "글꼴 · 그림";
const groupLibraries = "라이브러리";
const groupData = "데이터";

/** 목록의 이름 · 설명(영어 이름 그대로인 것은 utils/licenses 에) */
const items = {
  twemojiArt: "Twemoji 그림",
  twemojiArtNote: "ⓒ Twitter, Inc 및 기여자",
  twemojiFont: "Twemoji COLR 글꼴",
  modelRegistry: "PocketRisu 모델 레지스트리",
  modelRegistryNote: "AI 모델 정보",
  cmudictNote: "영어 끝소리, 조사 선택",
  gemmaTokenizer: "Gemma 4 토크나이저",
  gemmaTokenizerNote: "토큰 수 세기",
  unihanNote: "한자 읽기, 조사 선택",
  dbipNote: "로그인한 기기의 위치(봇이 받아 둔다)",
};

export { title, thisBot, runningSource, runningSourceModified, originalProject, originalSource, sourceUnknown, upstreamPart, groupFontsArt, groupLibraries, groupData, items };
