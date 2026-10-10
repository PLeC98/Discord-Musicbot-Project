// 설정 내보내기 · 가져오기(운영자 패널 설정 탭)

import type { ArchiveItem } from "../../../../src/dashboard/contract/settings-archive.ts";

const title = "설정 내보내기 · 가져오기";
const desc = "설정을 ZIP 파일 하나로 내려받거나, 내려받은 파일에서 고른 항목만 되돌려요. API 키 · 쿠키는 들어가지 않아요(다시 넣어야 해요).";
const exportButton = "내보내기";
const importButton = "가져오기";
const exported = "설정을 내보냈어요";
const exportFailed = "설정을 내보내지 못했어요.";
const previewFailed = "파일을 읽지 못했어요.";

const dialogTitle = "가져올 항목 고르기";
/** 파일에 적힌 만든 때 · 봇 버전 */
const madeAt = (when: string, version: string | null) => `${when}에 만든 파일${version ? ` · 봇 ${version}` : ""}`;
const dialogNote = "고른 항목은 파일의 것으로 통째 바뀌어요. 가져오기 전에 지금 설정의 스냅숏을 남겨요.";
const items: Record<ArchiveItem, string> = {
  tunables: "운영 조절값",
  genres: "자동재생 장르",
  status: "활동 문구",
  ai: "AI 설정",
  "ai-prompt": "AI 프롬프트",
  guilds: "서버별 설정",
  favicon: "파비콘 그림",
};
/** 서버 · 그림 수 */
const counts: Partial<Record<ArchiveItem, (n: number) => string>> = { guilds: (n) => `서버 ${n}곳`, favicon: (n) => `그림 ${n}장` };
const notInFile = "파일에 없음";
const same = "지금과 같음";
const differs = "다름";
const problem = "가져올 수 없음";
const cancel = "취소";
const apply = (count: number) => (count ? `${count}개 가져오기` : "가져오기");
const imported = "설정을 가져왔어요";
const importedBody = "새 설정으로 화면을 다시 불러와요.";
const importFailed = "설정을 가져오지 못했어요.";

export { title, desc, exportButton, importButton, exported, exportFailed, previewFailed, dialogTitle, madeAt, dialogNote, items, counts, notInFile, same, differs, problem, cancel, apply, imported, importedBody, importFailed };
