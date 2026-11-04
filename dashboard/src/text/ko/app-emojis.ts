// 운영자 패널: 앱 이모지 탭의 카드와 추가 창

import { formatNumber } from "../../utils/locale.ts";

const title = "앱 이모지";
const desc = "음성 채널 상태, 자동재생 장르, 공지에 쓰는 봇 전용 커스텀 이모지예요.";
/** 남은 슬롯(운영자 색을 바꿀 때 아이콘을 다시 올릴 자리는 뺀다), 쓰는 수, 한도 */
const room = (n: number, used: number, limit: number) => `슬롯 ${formatNumber(n)}개 사용 가능(${formatNumber(used)}/${formatNumber(limit)})`;
const add = "추가하기";
const empty = "아직 추가한 앱 이모지가 없어요.";
const icons = "봇 내장 아이콘";
const iconsTip = "봇이 직접 관리해서 이름을 바꾸거나 삭제할 수 없어요.";
const loadFailed = "앱 이모지 목록을 불러오지 못했어요.";

/** 이모지 하나의 이름 입력란, 삭제(화면 읽기 프로그램용 이름, 툴팁) */
const nameLabel = (name: string) => `${name} 이모지 이름`;
const removeOne = (name: string) => `${name} 삭제`;
/** 이름 입력란 아래의 짧은 글(문제 코드마다) */
const nameIssue: Record<string, string> = {
  "emoji-name-bad": "영문, 숫자, 밑줄(_)로 2 ~ 32자여야 해요.",
  "emoji-name-taken": "이미 사용 중인 이름이에요.",
  "emoji-name-reserved": "봇 내장 아이콘이 쓰는 이름이에요.",
};
/** 한 번 누른 삭제 버튼: 글, 화면 읽기 프로그램용 이름 */
const removeArmed = "삭제";
const removeNow = (name: string) => `${name} 이모지 삭제 확인`;
/** 한 번 누른 칸 아래: 이 이모지를 쓰는 곳 */
const usedIn = (places: string[]) => `${places.join(", ")}에서 쓰고 있어요. 삭제하면 그 자리에는 이모지 없이 표시돼요.`;
const genreUse = (id: string) => `자동재생 장르(${id})`;
/** 저장 띠로 이름을 바꾼 뒤 */
const renamed = (n: number) => `이모지 이름 ${n}개를 바꿨어요`;
const renameFailed = "이모지 이름을 바꾸지 못했어요.";

/** 추가 창을 열기 전에 거절한 까닭(화면이 미리 본다). name 은 파일 이름 */
const refuse = {
  format: (name: string) => `${name}: 지원하지 않는 형식이에요. PNG, JPEG, GIF, WebP, AVIF 파일을 선택해 주세요.`,
  tooBig: (name: string, max: string) => `${name}: ${max} 보다 큰 파일은 쓸 수 없어요.`,
  unreadable: (name: string) => `${name}: 이미지를 읽지 못했어요.`,
};
const refusedTitle = "추가하지 않았어요";

/** 추가 창 */
const dialog = {
  title: "앱 이모지 추가하기",
  name: "이모지 이름",
  preview: "미리보기",
  /** 미리보기 하나의 툴팁: 그 크기로 그려지는 곳 */
  previewAt: (where: string, px: number) => `${where}(${px}px)`,
  where: {
    jumbo: "디스코드 메시지, 이모지만 있을 때",
    picker: "대시보드 이모지 선택 창, 장르 아이콘",
    message: "디스코드 메시지 본문",
    announcePreview: "대시보드 공지 미리보기",
    announce: "디스코드 공지",
    voiceStatus: "디스코드 음성 채널 상태",
    input: "대시보드 입력란",
  },
  add: "추가하기",
};
const added = (name: string) => `${name} 이모지를 추가했어요`;
const addFailed = "이모지를 추가하지 못했어요.";

const removed = (name: string) => `${name} 이모지를 삭제했어요`;
const removeFailed = "이모지를 삭제하지 못했어요.";

export { title, desc, room, add, empty, icons, iconsTip, loadFailed, nameIssue, nameLabel, removeOne, removeArmed, removeNow, usedIn, genreUse, renamed, renameFailed, refuse, refusedTitle, dialog, added, addFailed, removed, removeFailed };
