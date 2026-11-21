// 슬래시 명령의 문구: 명령 설명, 옵션 이름과 설명, 선택지 이름. 명령 이름, 옵션의 코드 이름, 선택지 값은 discord/commands가 정한다(언어마다 같다).
// 옵션 이름은 디스코드 규칙을 따른다(소문자, 32자 이내, 띄어쓰기 없음). 설명과 선택지 이름은 100자 이내. /help 분류의 선택지 이름은 도움말의 분류 이름이다

import * as help from "./help.ts";
import { VOLUME_MAX } from "../../../rules/limits.ts";

/** 옵션 하나. name은 이 언어로 보이는 옵션 이름, choices는 선택지 값마다의 이름 */
type Option = { name: string; description: string; choices?: Record<string, string> };
/** 명령 하나 */
type Command = { description: string; options?: Record<string, Option> };

const commands = {
  play: { description: "곡을 재생해요", options: { query: { name: "곡", description: "지원하는 플랫폼이나 미디어 파일 링크, 유튜브 검색어" } } },
  playfirst: { description: "대기열 맨 앞에 곡을 넣어요", options: { query: { name: "곡", description: "지원하는 플랫폼이나 미디어 파일 링크, 유튜브 검색어" } } },
  pause: { description: "일시정지 상태를 전환해요" },
  stop: { description: "재생을 멈추고 음성 채널에서 나가요" },
  skip: { description: "현재 재생 중인 곡을 건너뛰어요" },
  previous: { description: "이전 곡으로 되돌아가요" },
  replay: { description: "현재 곡을 처음부터 재생해요" },
  seek: { description: "현재 곡의 특정 시간으로 이동해요", options: { time: { name: "시간", description: "이동할 시간 (예: 1:30, 3m20s, 90)" } } },
  highlight: { description: "현재 곡의 하이라이트로 이동해요" },
  queue: { description: "대기열을 보여줘요", options: { page: { name: "페이지", description: "페이지 번호 (기본값: 1)" } } },
  clear: { description: "대기열을 비워요" },
  remove: { description: "대기열에서 곡이나 구간을 빼요", options: { position: { name: "번호", description: "대기열 순번 (1 = 다음 곡)" }, end: { name: "끝번호", description: "여기까지 함께 빼요 (비우면 한 곡)" } } },
  move: { description: "대기열에서 곡의 순번을 옮겨요", options: { from: { name: "옮길곡", description: "순서를 옮기고 싶은 곡" }, to: { name: "옮길위치", description: "그 곡을 옮겨 넣을 위치" } } },
  shuffle: { description: "대기열을 무작위로 섞어요" },
  loop: { description: "반복 모드를 설정해요", options: { mode: { name: "모드", description: "반복 모드 (모드를 정하지 않으면 순서대로 순환해요: 끔 → 한 곡 반복 → 대기열 반복)", choices: { off: "끔", track: "한 곡 반복", queue: "대기열 반복" } } } },
  autoplay: { description: "자동재생을 켜거나 꺼요" },
  volume: { description: "볼륨을 설정해요", options: { level: { name: "볼륨", description: `설정할 볼륨 (0~${VOLUME_MAX})` } } },
  normalize: { description: "볼륨 정규화를 켜거나 꺼요", options: { action: { name: "동작", description: "켜기 또는 끄기 (비우면 지금 상태 표시)", choices: { on: "켜기", off: "끄기" } } } },
  search: { description: "곡을 검색해요", options: { query: { name: "검색어", description: "검색할 키워드" } } },
  nowplaying: { description: "재생 중인 곡의 정보를 보여줘요" },
  join: { description: "봇을 음성 채널에 참가시켜요" },
  leave: { description: "대기열을 저장하고 음성 채널에서 나가요" },
  language: { description: "내 언어와 서버 언어를 정해요" },
  "247": { description: "상주 모드를 켜거나 꺼요. 켜면 음성 채널에서 나가지 않고 계속 머물러요" },
  setchannel: { description: "제 전용 채널을 설정해요 (곡 요청 및 공지에 사용돼요)", options: { channel: { name: "채널", description: "설정할 채널 (비우면 명령어를 입력한 채널)" }, action: { name: "동작", description: "설정 또는 해제", choices: { set: "설정", remove: "해제" } } } },
  setting: { description: "서버 설정을 열어요" },
  setplaylistlimit: { description: "재생목록을 넣을 때 한 번에 넣을 곡 수를 정해요", options: { count: { name: "곡수", description: "한 번에 넣을 곡 수 (비우면 현재 설정 값 표시)" }, action: { name: "동작", description: "설정 또는 기본값으로 되돌리기", choices: { set: "설정", reset: "기본값" } } } },
  dashboard: { description: "재생 패널을 이 채널의 맨 아래에 다시 표시해요" },
  ping: { description: "봇의 응답 시간을 측정해요" },
  system: { description: "봇의 시스템 정보를 보여줘요" },
  license: { description: "라이선스와 소스 코드 저장소를 표시해요" },
  invite: { description: "봇 초대 링크를 보여줘요" },
  help: { description: "명령어 목록과 쓰는 법을 알려줘요", options: { category: { name: "분류", description: "바로 볼 명령어 분류", choices: { play: help.section("play").name, queue: help.section("queue").name, mode: help.section("mode").name, explore: help.section("explore").name, channel: help.section("channel").name, info: help.section("info").name } } } },
} satisfies Record<string, Command>;

export { commands };
