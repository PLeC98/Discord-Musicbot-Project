// 정보 화면(/ping, /license, /nowplaying)의 문구. 값은 호출부가 말로 적어 넘긴다.
// 핑의 🏓 는 유니코드 그대로

import { icon, type IconKey } from "../../icons.ts";
import type { AudioFoundBy } from "../../../rules/audio-found-by.ts";

/** 새로고침 버튼 */
const refresh = () => "새로고침";

/** /ping. 값마다 이름과, 무엇과 무엇 사이를 잰 것인지 짧게 */
const ping = () => ({
  title: "🏓 퐁!",
  response: { name: "응답 시간", note: "명령 → 봇 → 응답" },
  rest: { name: "REST 왕복", note: "봇 ↔ 디스코드 API" },
  gateway: { name: "게이트웨이", note: "봇 ↔ 디스코드 연결" },
  voice: { name: "음성", note: "봇 ↔ 이 서버의 음성 연결" },
  /** 게이트웨이 기록의 평균 */
  average: (minutes: number) => `${minutes}분 평균`,
  /** 봇이 막 켜져 아직 잰 값이 없을 때 */
  measuring: "측정 중...",
  again: "다시 재기",
});
/** 첫 응답. 그 응답이 닿은 시각으로 잰다 */
const pinging = () => "핑 측정 중...";

/** /license. 링크 버튼의 이름은 대시보드 라이선스 창과 같다 */
const license = () => ({
  title: `${icon("license")} 라이선스`,
  body: "이 봇은 오픈 소스예요. 이 봇을 쓰는 사람은 누구나 현재 사용 중인 봇의 소스 코드를 받을 수 있어요. (GNU AGPL-3.0)",
  thisBot: "이 봇",
  thirdParty: "글꼴, 그림, 라이브러리, 데이터의 라이선스는 저장소의 NOTICE.md, data/NOTICE에 있어요",
  runningSource: "운영 소스 코드",
  originalProject: "원본 프로젝트",
  fullText: "AGPL-3.0 전문",
});

/** /nowplaying의 문구. 작은 글씨 줄은 아이콘 + 굵은 항목 이름 + 값 */
const nowPlaying = () => ({
  title: `${icon("music")} 현재 재생 중`,
  artist: icon("artist"),
  album: icon("album"),
  line: (key: IconKey, name: string, value: string) => `-# ${icon(key)} **${name}** ${value}`,
  status: "상태",
  requester: "요청",
  autoplayPick: `${icon("autoplay")} 자동재생이 고름`,
  source: "출처",
  audio: "음원",
  // 음원 주소를 어떻게 알았나(rules/audio-found-by, 요청 그대로는 줄을 내지 않는다)
  foundBy: { ledger: "자동 검색 결과", search: "자동 검색 결과", pinned: "직접 지정한 음원" } satisfies Record<Exclude<AudioFoundBy, "given">, string>,
  next: "다음",
  nextByAutoplay: "자동재생이 골라요",
  nextNone: "없음",
  queue: "대기열",
  // 아는 길이가 없으면(다 라이브, 길이 모름) 곡 수만
  queued: (count: number, length: string | null, partial: boolean) => (length ? `${count}곡 · ${length}${partial ? " 이상" : ""}` : `${count}곡`),
  autoplay: "자동재생",
  autoplayOn: (genre: string) => `켜짐 · ${genre}`,
});
/** /nowplaying의 상태 값: 재생 상태, 볼륨, 반복 */
function nowPlayingStatus({ playing, paused, volume, loop }: { playing: boolean; paused: boolean; volume: number; loop: string | false }) {
  const parts = [playing ? `${icon("play")} 재생 중` : paused ? `${icon("pause")} 일시정지` : `${icon("waiting")} 준비 중`, `${icon("volume")} ${volume}%`];
  if (loop === "track") parts.push(`${icon("repeat_one")} 한 곡 반복`);
  else if (loop === "queue") parts.push(`${icon("repeat")} 대기열 반복`);
  return parts.join(" • ");
}

export { refresh, ping, pinging, license, nowPlaying, nowPlayingStatus };
