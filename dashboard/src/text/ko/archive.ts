// 설정 내보내기 · 불러오기(운영자 패널 백업 탭). 카드 둘: 백업 내보내기(안에 봇 설정만 · 암호화된 설정까지 · 파비콘 · 로그인 배경) · 백업 불러오기

import type { ArchiveItem, ArchiveKind } from "../../../../src/dashboard/contract/settings-archive.ts";

const exportTitle = "백업 내보내기";
/** 백업 내보내기 카드 안의 카드들 */
const exports: Record<ArchiveKind, { title: string; desc: string; button: string }> = {
  settings: {
    title: "봇 설정만",
    desc: "운영 조절값 · 장르 · 활동 문구 · AI 설정 · 프롬프트를 담아요. 다른 봇에 나눠 줄 때 써요.",
    button: "내보내기",
  },
  full: {
    title: "암호화된 설정까지",
    desc: "봇 설정에 서버별 설정 · API 키 · 쿠키까지 담아요. 남에게 주지 마세요.",
    button: "내보내기",
  },
  favicon: { title: "파비콘", desc: "크기별 파비콘과 기록을 담아요.", button: "내보내기" },
  "login-background": { title: "로그인 배경", desc: "쓰는 배경과 기록을 담아요.", button: "내보내기" },
};
/** 제목 옆 툴팁(길어지는 주의) */
const tips: Record<ArchiveKind | "import", string> = {
  favicon: "",
  "login-background": "영상이면 수백 MB 가 될 수 있어요.",
  settings: "서버별 설정 · API 키 · 쿠키와 이 PC 에만 맞는 값(쿠키 출처 · POToken)은 빠져요. AI 설정에 적은 주소는 들어가요.",
  full: "키 · 쿠키는 이 봇의 SECRETS_KEY 로 잠겨 .env 없이는 못 풀어요. 그래도 서버 · 채널과 쓰는 서비스가 보이고, .env 와 같은 곳에 두면 풀려요.",
  import: "키 · 쿠키는 지금 SECRETS_KEY 로 풀리는 것만 가져와요.",
};
const importTitle = "백업 불러오기";
const importDesc = "내보낸 파일을 올리면 지금과 비교해 보여 주고, 고른 항목만 덮어써요.";
const importButton = "파일 고르기";
const exported = "설정을 내보냈어요";
const exportFailed = "설정을 내보내지 못했어요.";
const previewFailed = "파일을 읽지 못했어요.";

const dialogTitle = "가져올 항목 고르기";
/** 파일에 적힌 종류 · 만든 때 · 봇 버전 */
const kinds: Record<ArchiveKind, string> = { settings: "봇 설정만", full: "암호화된 설정까지", favicon: "파비콘", "login-background": "로그인 배경" };
const madeAt = (kind: string, when: string, version: string | null) => `${kind} · ${when}에 만든 파일${version ? ` · 봇 ${version}` : ""}`;
const dialogNote = "고른 항목은 파일의 것으로 통째 바뀌고, 지금 값은 '가져오기 전' 스냅샷으로만 되돌릴 수 있어요(최근 5개까지 보관).";
const items: Record<ArchiveItem, string> = {
  tunables: "운영 조절값",
  genres: "자동재생 장르",
  status: "활동 문구",
  ai: "AI 설정",
  "ai-prompt": "AI 프롬프트",
  guilds: "서버별 설정",
  secrets: "API 키 · 쿠키",
  favicon: "파비콘",
  "login-background": "로그인 배경",
};
/** 서버 · 키 · 이미지 수 */
const counts: Partial<Record<ArchiveItem, (n: number) => string>> = { guilds: (n) => `서버 ${n}곳`, secrets: (n) => `쓸 수 있는 값 ${n}개`, favicon: (n) => `이미지 ${n}개`, "login-background": (n) => `배경 ${n}개` };
const notInFile = "파일에 없음";
const same = "지금과 같음";
const differs = "다름";
const problem = "가져올 수 없음";
const cancel = "취소";
const apply = (count: number) => (count ? `${count}개 가져오기` : "가져오기");
const imported = "설정을 가져왔어요";
const importedBody = "새 설정으로 화면을 다시 불러와요.";
const importFailed = "설정을 가져오지 못했어요.";

export { exportTitle, exports, importTitle, importDesc, importButton, exported, exportFailed, previewFailed, dialogTitle, kinds, madeAt, dialogNote, items, counts, notInFile, same, differs, problem, cancel, apply, imported, importedBody, importFailed, tips };
