// 서버 화면(재생, 대기열, 곡 넣기)

import { formatNumber } from "../../utils/locale.ts";

/** 봇은 음성에 있는데 서버에 플레이어가 없다(디스코드 음성 상태와 봇 내부 상태가 어긋남). 곡 넣기 입력란 자리에 */
const noPlayerState = "봇이 음성 채널에 있지만 재생 상태를 읽을 수 없어요. 잠시 후 다시 시도해 주세요.";
/** 정지 버튼의 확인 */
const stopConfirm = { title: "재생을 중지할까요?", body: "재생을 멈추고 대기열을 비워요." };

// 곡 넣기 입력란
const joinBot = "봇 부르기";
// 휴대폰에서 칸 전체가 부르기 버튼일 때. 안내 문장 없이 버튼 글이 상황까지 말한다
const joinBotToVoice = "봇을 음성 채널로 부르기";
const joining = "부르는 중...";
const addPlaceholder = "곡 이름 또는 링크";
const addSubmit = "넣기";
/** 재생목록 링크에서 그 곡(곡 + 목록 주소면 그 곡, 목록만이면 첫 곡)만 넣는 버튼 */
const addOne = "한 곡만";
/** 넣을 자리(DJ 만): 보내기 옆 메뉴의 이름과 항목, 검색 결과 줄의 버튼 */
const addPlace = "넣을 자리";
const addFirst = "맨 앞에 넣기";
const addOneFirst = "한 곡만 맨 앞에 넣기";
/** 검색 결과가 이미 대기열에 있는 곡의 배지 */
const inQueue = "대기열";
/** 검색 실패(결과 자리의 제목 줄, 보조 줄). 끝 줄에는 오류 코드 */
const searchLimited = { title: "유튜브 검색이 일시적으로 제한됐어요.", hint: "몇 분 뒤에 다시 검색해 주세요." };
const searchFailed = { title: "검색 결과를 불러오지 못했어요.", hint: "잠시 뒤에 다시 검색해 주세요." };
const addFailed = "추가에 실패했어요.";
const joinFailed = "참가에 실패했어요.";

// 위 막대, 재생 판
const serverSettings = "서버 설정";
const enlarge = "크게 보기";
const enlargeArt = "앨범아트 크게 보기";
/** 곡이 없을 때 가수 자리 */
const addToPlay = "곡을 넣으면 바로 재생해요.";
const volumeLabel = (volume: number | string) => `볼륨 ${volume}`;
/** 음성 채널 상태 한 줄 */
const voice = {
  same: "봇과 같은 음성 채널에 있어요",
  botElsewhere: "봇이 다른 음성 채널에 있어요",
  botInVoice: "봇이 음성 채널에 있어요",
  userOutside: "봇이 음성 채널 밖에 있어요",
  resting: "봇이 쉬고 있어요",
};

// 대기열
const songs = (count: number) => `${formatNumber(count)}곡`;
// 대기열 합계. 길이를 모르는 곡이 있으면 이상
const queueLength = (length: string, partial: boolean) => (partial ? `${length} 이상` : length);
const moreSongs = (count: number) => `${formatNumber(count)}곡 더`;
const autoplay = "자동재생";
const autoplayOn = "자동재생 켜기";
const autoplayOff = "자동재생 끄기";
const whichGenre = "어떤 장르의 곡들을 틀까요?";
const dragToReorder = "드래그해서 순서 바꾸기";
const pickedByAutoplay = "자동재생";
const removeSong = "빼기";
const queueEmpty = "대기열이 비어 있어요";
/** 아직 받지 않은 곡이 뒤에 있어 맨 끝으로 옮길 수 없을 때 */
const moveNeedsAll = { title: "아직 불러오지 않은 곡이 뒤에 있어요.", body: "대기열을 끝까지 스크롤해 모두 불러온 뒤 맨 끝으로 옮길 수 있어요." };

// 실패(봇이 문장을 주지 않은 경우). 재생 조작은 text.player.failed
const failed = {
  queueMore: "대기열을 더 불러오지 못했어요.",
  state: "재생 상태를 읽지 못했어요.",
  stop: "정지하지 못했어요.",
  remove: "곡을 빼지 못했어요.",
  move: "곡을 옮기지 못했어요.",
  highlight: "하이라이트로 가지 못했어요.",
  genres: "장르 목록을 불러오지 못했어요.",
  autoplayOn: "자동재생을 켜지 못했어요.",
  autoplayOff: "자동재생을 끄지 못했어요.",
};

export { noPlayerState, stopConfirm, joinBot, joinBotToVoice, joining, addPlaceholder, addSubmit, addOne, addPlace, addFirst, addOneFirst, inQueue, searchLimited, searchFailed, addFailed, joinFailed, serverSettings, enlarge, enlargeArt, addToPlay, volumeLabel, voice, songs, queueLength, moreSongs, autoplay, autoplayOn, autoplayOff, whichGenre, dragToReorder, pickedByAutoplay, removeSong, queueEmpty, moveNeedsAll, failed };
