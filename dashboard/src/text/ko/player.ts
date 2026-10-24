// 재생 조작 · 탐색 · 볼륨 · 곡 표. 서버 화면 · 재생 바 · 대기열 판이 같이 쓴다

const shuffle = "셔플";
const previous = "이전곡";
const next = "다음곡";
const play = "재생";
const pause = "일시정지";
/** 재생 버튼: 재생 중이면 일시정지 */
const playPause = (running: boolean) => (running ? pause : play);
const stop = "정지";
const highlight = "하이라이트";
const toHighlight = "하이라이트로 가기";
const volume = "볼륨";
const live = "라이브";
const queue = "대기열";
const mine = "내가 넣은 곡";
/** 크게 보기의 화면 읽기 이름 */
const albumArt = (title: string) => `${title} 앨범아트`;
/** 접힌 대기열 판의 다음 곡 */
const upNext = (title: string) => `다음: ${title}`;
const nothingPlaying = "재생 중인 곡이 없어요";
const openServer = "이 서버 화면으로";
const seekCancelled = "곡이 바뀌어 위치 이동을 취소했어요.";
const volumeFailed = "볼륨을 바꾸지 못했어요.";
/** 조작이 거절되거나 실패했을 때(봇이 문장을 주지 않은 경우) */
const failed = {
  pause: "조작하지 못했어요.",
  skip: "다음 곡으로 넘기지 못했어요.",
  previous: "이전 곡으로 가지 못했어요.",
  shuffle: "대기열을 섞지 못했어요.",
  loop: "반복 모드를 바꾸지 못했어요.",
  seek: "위치를 옮기지 못했어요.",
};
/** 반복 버튼: 지금 모드와 누르면 바뀔 모드 */
const loopTip = (now: string, next: string) => `${now} (다음: ${next})`;

export { shuffle, previous, next, play, pause, playPause, stop, highlight, toHighlight, volume, live, queue, mine, albumArt, upNext, nothingPlaying, openServer, seekCancelled, volumeFailed, failed, loopTip };
