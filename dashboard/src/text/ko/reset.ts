// 운영자 패널 백업, 초기화 탭의 초기화 카드.
// 크롬의 "인터넷 사용 기록 삭제"처럼 짧게: 항목은 이름과 양, 설명은 그 위치에서만 알 수 있는 것(복원할 곳, 다시 시작)만

import type { AudioCachePart, OldTool, OldToolKept } from "../../../../src/dashboard/contract/reset.ts";
import { josa } from "../../../../src/rules/josa.ts";

const title = "초기화";

const rows = {
  "audio-cache": { title: "오디오 캐시 초기화", desc: "캐시 파일, 자동 검색 결과, 외부 서비스 데이터를 삭제해요." },
  "bot-settings": { title: "봇 설정 초기화", desc: "봇 설정을 기본값으로 되돌리고 API 키와 쿠키를 삭제해요." },
  "guild-settings": { title: "서버별 설정 초기화", desc: "모든 서버의 서버별 설정을 삭제해요." },
  display: { title: "디스플레이 설정 초기화", desc: "파비콘과 로그인 배경을 삭제해요." },
  "old-tools": { title: "외부 프로그램 이전 버전 삭제", desc: "yt-dlp와 ffmpeg의 이전 버전, 예전 설치 위치의 파일을 삭제해요. 지금 쓰는 버전은 남겨요." },
  all: { title: "봇 전체 초기화", desc: ".env, 설정 스냅샷, 전체 백업, 로그를 제외한 모든 데이터를 삭제해요." },
} as const;
const run = "초기화";
const running = "초기화 중…";
/** 외부 프로그램 이전 버전 줄의 버튼(설정을 되돌리는 것이 아니라 파일을 삭제한다) */
const remove = "삭제";
const removing = "삭제 중…";

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
  "bot-settings": { title: "봇 설정을 초기화할까요?", body: (n: { changed: number; secrets: number }) => `변경한 설정 ${n.changed}개가 기본값으로 돌아가고 API 키와 쿠키 ${n.secrets}개가 삭제돼요.\n설정 스냅샷으로 복원할 수 있어요.`, button: "초기화" },
  "guild-settings": { title: "서버별 설정을 초기화할까요?", body: (n: number) => `서버 ${n}곳의 설정이 삭제돼요.\n설정 스냅샷으로 복원할 수 있어요.`, button: "초기화" },
  display: { title: "디스플레이 설정을 초기화할까요?", body: (n: { favicons: number; backgrounds: number }) => `파비콘 ${n.favicons}개와 로그인 배경 ${n.backgrounds}개가 삭제돼요.`, button: "초기화" },
  "old-tools": { title: "외부 프로그램 이전 버전을 삭제할까요?", button: "삭제" },
  all: {
    title: "봇 전체를 초기화할까요?",
    /** launcher: 실행기로 켠 봇(곧바로 다시 시작해 삭제한다) */
    body: (launcher: boolean) => (launcher ? "모든 데이터가 삭제되고 봇이 다시 시작돼요." : "모든 데이터가 삭제돼요.\n실행기 없이 켠 봇이라, 봇을 직접 다시 시작하면 삭제돼요."),
    restore: "예약한 복원은 취소돼요.",
    typeName: (name: string) => `봇 이름(${name})을 입력해 주세요`,
    button: "전체 초기화",
  },
};

/** 외부 프로그램 이전 버전: 도구 이름, 삭제할 것 한 줄(버전은 yt-dlp 태그, ffmpeg 빌드 날짜), 남기는 사유 */
const oldTools: { name: Record<OldTool, string>; line: (name: string, versions: string[], size: string) => string; total: (size: string) => string; kept: Record<OldToolKept, string>; note: string; nothing: string } = {
  name: { ytdlp: "yt-dlp", ffmpeg: "ffmpeg", legacy: "예전 설치 위치 vendor/bin" },
  line: (name, versions, size) => `${name}${versions.length ? ` ${versions.join(", ")}` : ""} (${size})`,
  total: (size) => `합계 ${size}`,
  kept: {
    "in-use": "봇이 쓰고 있어서 남겨요. 봇을 다시 시작한 뒤에 삭제할 수 있어요.",
    starting: "봇이 아직 시작하는 중이라 남겨요.",
    broken: "설치 기록을 읽지 못해서 남겨요.",
    "only-build": "설치된 빌드가 하나뿐이라 남겨요.",
    link: "심볼릭 링크나 정션으로 연결된 폴더라 남겨요.",
    busy: "다른 프로그램이 폴더를 쓰고 있어서 남겨요. 잠시 뒤에 다시 시도해 주세요.",
    failed: "일부를 삭제하지 못했어요.",
  },
  note: "이전 버전을 삭제하면 지금 버전에 문제가 생겼을 때 되돌릴 수 없어요.",
  nothing: "삭제할 이전 버전이 없어요.",
};

/** 실행기 없이 켠 봇: 다시 시작할 때까지 남는 예약 */
const staged = "봇 전체 초기화가 예약돼 있어요. 봇을 다시 시작하면 삭제돼요.";
const unstage = "예약 취소";
const done = {
  cache: "오디오 캐시를 초기화했어요",
  "audio-cache": (files: number, size: string, kept: number) => `파일 ${files}개(${size})를 지웠어요.${kept ? ` 사용 중인 ${kept}개는 남겼어요.` : ""}`,
  "bot-settings": "봇 설정을 초기화했어요",
  "guild-settings": (n: number) => `서버 ${n}곳의 설정을 지웠어요`,
  display: "디스플레이 설정을 초기화했어요",
  "old-tools": "외부 프로그램 이전 버전을 삭제했어요",
  oldToolsFreed: (size: string) => `저장 공간 ${size}${josa(size, "을")} 확보했어요.`,
  oldToolsDeferred: "yt-dlp 이전 버전은 사용 중이라 다음 정리 때 삭제돼요.",
  oldToolsNone: "삭제한 이전 버전이 없어요",
  allStaged: "봇 전체 초기화를 예약했어요",
  allStagedBody: "봇을 다시 시작하면 삭제돼요.",
};
const failed = "초기화하지 못했어요.";
const loadFailed = "초기화 정보를 불러오지 못했어요.";

export { title, rows, run, running, remove, removing, parts, confirm, oldTools, staged, unstage, done, failed, loadFailed };
