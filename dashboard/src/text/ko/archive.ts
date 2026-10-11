// 설정 내보내기 · 불러오기(운영자 패널 백업 탭). 카드 셋: 봇 설정만 내보내기 · 암호화된 설정까지 내보내기 · 백업 불러오기

import type { ArchiveItem, ArchiveKind } from "../../../../src/dashboard/contract/settings-archive.ts";

/** 내보내기 카드 둘 */
const exports: Record<ArchiveKind, { title: string; desc: string; button: string }> = {
  settings: {
    title: "봇 설정만 내보내기",
    desc: "운영 조절값 · 자동재생 장르 · 활동 문구 · AI 설정 · 프롬프트 · 파비콘을 ZIP 하나로 내려받아요. 서버별 설정 · API 키 · 쿠키와 이 PC 에만 맞는 값(쿠키 출처 · POToken)은 빠져요. 다른 봇에 같은 설정을 쓰도록 나눠 줄 때 써요. AI 설정에 직접 적은 주소 · 프롬프트는 들어가요.",
    button: "내보내기",
  },
  full: {
    title: "암호화된 설정까지 내보내기",
    desc: "봇 설정에 더해 서버별 설정과 API 키 · 쿠키까지 내려받아요. 키 · 쿠키는 이 봇의 SECRETS_KEY 로 잠근 그대로라, 파일이 새도 .env 없이는 풀 수 없어요. 그래도 서버 · 채널과 쓰는 서비스가 보이니 남에게 줄 파일은 아니에요. .env 와 같은 곳에 두지 마세요.",
    button: "내보내기",
  },
};
const importTitle = "백업 불러오기";
const importDesc = "위의 두 가지 파일을 올리면 항목마다 지금과 같은지 · 다른지 · 가져올 수 없는지 보여 주고, 고른 항목만 파일의 것으로 덮어써요. 키 · 쿠키는 지금 SECRETS_KEY 로 풀리는 것만 가져와요.";
const importButton = "파일 고르기";
const exported = "설정을 내보냈어요";
const exportFailed = "설정을 내보내지 못했어요.";
const previewFailed = "파일을 읽지 못했어요.";

const dialogTitle = "가져올 항목 고르기";
/** 파일에 적힌 종류 · 만든 때 · 봇 버전 */
const kinds: Record<ArchiveKind, string> = { settings: "봇 설정만", full: "암호화된 설정까지" };
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
  favicon: "파비콘 그림",
};
/** 서버 · 키 · 그림 수 */
const counts: Partial<Record<ArchiveItem, (n: number) => string>> = { guilds: (n) => `서버 ${n}곳`, secrets: (n) => `쓸 수 있는 값 ${n}개`, favicon: (n) => `그림 ${n}장` };
const notInFile = "파일에 없음";
const same = "지금과 같음";
const differs = "다름";
const problem = "가져올 수 없음";
const cancel = "취소";
const apply = (count: number) => (count ? `${count}개 가져오기` : "가져오기");
const imported = "설정을 가져왔어요";
const importedBody = "새 설정으로 화면을 다시 불러와요.";
const importFailed = "설정을 가져오지 못했어요.";

export { exports, importTitle, importDesc, importButton, exported, exportFailed, previewFailed, dialogTitle, kinds, madeAt, dialogNote, items, counts, notInFile, same, differs, problem, cancel, apply, imported, importedBody, importFailed };
