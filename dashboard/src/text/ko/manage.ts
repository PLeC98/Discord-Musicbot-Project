// 운영자 패널: 서버 관리 탭(전체 공지 · 참가 서버 목록)

import { formatNumber } from "../../utils/locale.ts";

/** 전체 공지 */
const announce = {
  title: "전체 공지",
  desc: "봇이 들어간 모든 서버에 공지를 보내요.",
  kind: "공지 종류",
  /** 공지 종류의 짧은 이름(고르기 단추). 임베드 제목은 계약 ANNOUNCE_STYLE */
  kinds: { maintenance: "점검", update: "업데이트", alert: "긴급", info: "공지" },
  toolbar: "서식",
  placeholder: "공지 내용",
  emoji: "이모지 넣기",
  tooLong: (over: number) => `${formatNumber(over)}자를 줄여 주세요`,
  preview: "디스코드 메시지 미리보기",
  previewEmpty: "입력한 공지 내용이 여기에 표시돼요",
  /** 미리보기 임베드의 바닥글(봇이 보낼 때와 같은 형식) */
  previewFooter: (sentAt: string) => `봇 운영자 • ${sentAt}`,
  today: (time: string) => `오늘 ${time}`,
  sending: "보내는 중...",
  send: (title: string) => `${title} 전송`,
  confirmTitle: (count: number) => `${count}곳에 공지를 보낼까요?`,
  confirmBody: (title: string) => `${title}\n보낸 뒤에는 취소할 수 없어요.`,
  confirm: "보내기",
  partial: { title: "공지를 일부만 보냈어요", body: (sent: number, failed: number) => `${sent}곳에 보내고 ${failed}곳에는 보내지 못했어요` },
  done: "공지를 보냈어요",
  doneBody: (sent: number) => `서버 ${sent}곳`,
  failed: "공지를 보내지 못했어요.",
};

/** 참가 서버 목록 */
const guilds = {
  title: "참가 서버 목록",
  desc: "봇이 참가 중인 서버예요. 내보내면 되돌릴 수 없고, 다시 초대할 때까지 봇을 사용하지 못해요.",
  search: (count: number) => `${count}곳 중에서 찾기`,
  sort: "정렬",
  filter: "필터",
  playingOnly: "재생 중인 서버",
  playingOnlyShort: "재생 중만",
  sorts: { name: "이름순", nameDesc: "이름 역순", membersDesc: "멤버 많은 순", membersAsc: "멤버 적은 순" },
  members: (count: number) => `멤버 ${formatNumber(count)}명`,
  playing: "재생 중",
  leave: "나가기",
  noMatch: "해당하는 서버가 없어요",
  none: "참가 중인 서버가 없어요",
  leaveTitle: (name: string) => `'${name}'에서 나갈까요?`,
  leaveBody: (playing: boolean) => `되돌릴 수 없어요. 다시 쓰려면 봇을 다시 초대해야 해요.${playing ? "\n지금 재생 중이라 재생도 멈춰요." : ""}`,
  left: "서버에서 나갔어요",
  leaveFailed: "서버에서 나가지 못했어요.",
};

export { announce, guilds };
