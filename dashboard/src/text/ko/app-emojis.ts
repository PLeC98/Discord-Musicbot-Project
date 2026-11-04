// 운영자 패널: 디스플레이 탭의 앱 이모지 카드와 추가 창

import { josa } from "../../../../src/rules/josa.ts";
import { formatNumber } from "../../utils/locale.ts";

const title = "앱 이모지";
const desc = "음성 상태, 자동재생 장르, 공지에 쓸 수 있는 봇의 이모지예요.";
const room = (n: number) => `${formatNumber(n)}개 더 추가할 수 있어요`;
const add = "추가하기";
const empty = "추가한 이모지가 없어요.";
const icons = "봇 아이콘";
const iconsTip = "봇이 직접 관리해서 이름을 바꾸거나 삭제할 수 없어요.";
const loadFailed = "앱 이모지 목록을 읽지 못했어요.";

/** 이모지 하나의 조작(화면 읽기 프로그램용 이름, 툴팁) */
const renameOne = (name: string) => `${name} 이름 변경`;
const removeOne = (name: string) => `${name} 삭제`;
const nameLabel = (name: string) => `${name}의 새 이름`;
const save = "저장";
const renamed = (name: string) => `이름을 ${name}${josa(name, "으로")} 바꿨어요`;
const renameFailed = "이름을 바꾸지 못했어요.";

/** 추가 창을 열기 전에 거절한 까닭(화면이 미리 본다). name 은 파일 이름 */
const refuse = {
  format: (name: string) => `${name}: 이 형식은 쓸 수 없어요. PNG, JPEG, GIF, WebP, AVIF 이미지를 선택해 주세요.`,
  tooBig: (name: string, max: string) => `${name}: ${max} 보다 큰 파일은 쓸 수 없어요.`,
  unreadable: (name: string) => `${name}: 이미지를 읽지 못했어요.`,
};
const refusedTitle = "추가하지 않았어요";

/** 추가 창 */
const dialog = {
  title: "앱 이모지 추가하기",
  name: "이름",
  preview: "미리보기",
  /** 글 속 크기 미리보기 옆의 글 */
  previewText: "음악 듣는 중",
  add: "추가하기",
};
const added = (name: string) => `${name} 이모지를 추가했어요`;
const addFailed = "이모지를 추가하지 못했어요.";

/** 삭제 확인 */
const confirm = {
  title: (name: string) => `${name} 이모지를 삭제할까요?`,
  body: "디스코드에서도 삭제돼 되돌릴 수 없어요.",
  /** 쓰는 곳이 있을 때 덧붙인다 */
  uses: "지금 쓰는 곳에서는 이모지 없이 보여요.",
  genre: (id: string) => `자동재생 장르: ${id}`,
  run: "삭제",
};
const removed = (name: string) => `${name} 이모지를 삭제했어요`;
const removeFailed = "이모지를 삭제하지 못했어요.";

export { title, desc, room, add, empty, icons, iconsTip, loadFailed, renameOne, removeOne, nameLabel, save, renamed, renameFailed, refuse, refusedTitle, dialog, added, addFailed, confirm, removed, removeFailed };
