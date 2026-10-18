// 운영자 패널 백업 · 초기화 탭의 초기화 카드.
// 크롬의 "인터넷 사용 기록 삭제"처럼 짧게: 항목은 이름과 양, 설명은 그 위치에서만 알 수 있는 것(복원할 곳 · 다시 시작)만

import type { AudioCachePart } from "../../../../src/dashboard/contract/reset.ts";

const title = "초기화";

const rows = {
  "audio-cache": { title: "오디오 캐시 초기화", desc: "캐시 파일 · 자동 검색 결과 · 외부 서비스 데이터를 삭제해요." },
  "bot-settings": { title: "봇 설정 초기화", desc: "봇 설정을 기본값으로 되돌리고 API 키 · 쿠키를 삭제해요." },
  "guild-settings": { title: "서버별 설정 초기화", desc: "모든 서버의 서버별 설정을 삭제해요." },
  display: { title: "디스플레이 설정 초기화", desc: "파비콘과 로그인 배경을 삭제해요." },
  all: { title: "봇 전체 초기화", desc: ".env · 설정 스냅샷 · 전체 백업 · 로그를 제외한 모든 데이터를 삭제해요." },
} as const;
const run = "초기화";
const running = "초기화 중…";

/** 오디오 캐시에서 선택하는 것: 이름과 양 */
const parts: Record<AudioCachePart, { label: string; desc: (n: { files: number; bytes: string; ledger: number; checks: number; sponsorSegments: number; ageRestricted: number; pins: number }) => string }> = {
  files: { label: "캐시 파일", desc: (n) => `${n.files}개 · ${n.bytes}` },
  ledger: { label: "자동 검색 결과", desc: (n) => `요청 ${n.ledger}개 · 재생 테스트 결과 ${n.checks}개` },
  external: { label: "외부 서비스 데이터", desc: (n) => `SponsorBlock 구간 ${n.sponsorSegments}개 · 연령 제한 기록 ${n.ageRestricted}개` },
  pins: { label: "직접 지정한 음원", desc: (n) => `${n.pins}개` },
};

/** 확인 창. 스냅샷이 남는 것은 복원할 곳을 알린다 */
const confirm = {
  "audio-cache": { title: "오디오 캐시 초기화", button: "초기화" },
  "bot-settings": { title: "봇 설정을 초기화할까요?", body: (n: { changed: number; secrets: number }) => `변경한 설정 ${n.changed}개가 기본값으로 돌아가고 API 키 · 쿠키 ${n.secrets}개가 삭제돼요.\n설정 스냅샷으로 복원할 수 있어요.`, button: "초기화" },
  "guild-settings": { title: "서버별 설정을 초기화할까요?", body: (n: number) => `서버 ${n}곳의 설정이 삭제돼요.\n설정 스냅샷으로 복원할 수 있어요.`, button: "초기화" },
  display: { title: "디스플레이 설정을 초기화할까요?", body: (n: { favicons: number; backgrounds: number }) => `파비콘 ${n.favicons}개 · 로그인 배경 ${n.backgrounds}개가 삭제돼요.`, button: "초기화" },
  all: {
    title: "봇 전체를 초기화할까요?",
    /** launcher: 실행기로 켠 봇(곧바로 다시 시작해 삭제한다) */
    body: (launcher: boolean) => (launcher ? "모든 데이터가 삭제되고 봇이 다시 시작돼요." : "모든 데이터가 삭제돼요.\n실행기 없이 켠 봇이라, 봇을 직접 다시 시작하면 삭제돼요."),
    restore: "예약한 복원은 취소돼요.",
    typeName: (name: string) => `봇 이름(${name})을 입력해 주세요`,
    button: "전체 초기화",
  },
};

/** 실행기 없이 켠 봇: 다시 시작할 때까지 남는 예약 */
const staged = "봇 전체 초기화가 예약돼 있어요. 봇을 다시 시작하면 삭제돼요.";
const unstage = "예약 취소";
const done = {
  cache: "오디오 캐시를 초기화했어요",
  "audio-cache": (files: number, size: string, kept: number) => `캐시 파일 ${files}개 · ${size}${kept ? ` · 재생 중 · 대기열 앞인 ${kept}개는 남겼어요` : ""}`,
  "bot-settings": "봇 설정을 초기화했어요",
  "guild-settings": (n: number) => `서버 ${n}곳의 설정을 지웠어요`,
  display: "디스플레이 설정을 초기화했어요",
  allStaged: "봇 전체 초기화를 예약했어요",
  allStagedBody: "봇을 다시 시작하면 삭제돼요.",
};
const failed = "초기화하지 못했어요.";
const loadFailed = "초기화 정보를 불러오지 못했어요.";

export { title, rows, run, running, parts, confirm, staged, unstage, done, failed, loadFailed };
