// 설정 내보내기 · 불러오기(운영자 패널 백업 · 초기화 탭).
// 카드 둘: 백업 내보내기(안에 봇 설정만 · 파비콘 · 로그인 배경 · 오디오 캐시) · 백업 불러오기.
// 짧게: 내보내기 카드의 설명은 담기는 것 목록만, 주의는 제목 옆 툴팁으로

import type { ArchiveItem, ArchiveKind } from "../../../../src/dashboard/contract/settings-archive.ts";

const exportTitle = "백업 내보내기";
/** 카드 첫 줄: 전체 백업은 여기 없다(명령은 상자로) */
const exportDescBefore = "전체 백업(.env · 설정 DB 포함)은 봇 폴더에서 ";
const backupCommand = "pnpm run backup";
const exportDescAfter = " 명령으로만 만들 수 있어요.";
/** 백업 내보내기 카드 안의 카드들 */
const exports: Record<ArchiveKind, { title: string; desc: string; button: string }> = {
  settings: {
    title: "봇 설정만",
    desc: "운영 조절값 · 자동재생 장르 · 상태 문구 · AI 설정 · 프롬프트",
    button: "내보내기",
  },
  favicon: { title: "파비콘", desc: "크기별 파비콘 · 파비콘 기록", button: "내보내기" },
  "login-background": { title: "로그인 배경", desc: "현재 배경 · 배경 기록", button: "내보내기" },
  "audio-cache": { title: "오디오 캐시", desc: "캐시 파일 · 자동 검색 결과 · 직접 지정한 음원 · 연령 제한 기록 · SponsorBlock 구간", button: "내보내기" },
};
/** 오디오 캐시: 캐시 파일 빼고(자동 검색 결과 · 직접 지정한 음원만 옮길 때) */
const withoutFiles = "캐시 파일 제외";
const withoutFilesTip = "곡은 재생할 때 다시 다운로드해요.";
/** 제목 옆 툴팁(길어지는 주의) */
const tips: Record<ArchiveKind | "import", string> = {
  favicon: "",
  "login-background": "영상이면 수백 MB 가 될 수 있어요.",
  settings: "API 키 · 쿠키 · 서버별 설정은 빠져요.",
  "audio-cache": "곡이 많으면 수백 MB ~ 수 GB 가 될 수 있어요.",
  import: "오디오 캐시는 지금 캐시에 합쳐요.",
};
const importTitle = "백업 불러오기";
const importDesc = "백업 파일을 불러와 원하는 항목만 적용해요.";
/** 전체 백업은 불러오지 않는다 */
const importFullBackup = "전체 백업은 불러올 수 없어요. 봇을 끄고 봇 폴더에 풀어 덮어써 주세요.";
const importButton = "파일 선택";
const exported = "내보냈어요";
const exportFailed = "내보내지 못했어요.";
const previewFailed = "파일을 읽지 못했어요.";

const dialogTitle = "불러올 항목 선택";
/** 파일에 적힌 종류 · 만든 때 · 봇 버전 */
const kinds: Record<ArchiveKind, string> = { settings: "봇 설정만", favicon: "파비콘", "login-background": "로그인 배경", "audio-cache": "오디오 캐시" };
const madeAt = (kind: string, when: string, version: string | null) => `${kind} · ${when}에 만든 백업${version ? ` · 봇 ${version}` : ""}`;
const dialogNote = "지금 값은 설정 스냅샷으로 복원할 수 있어요.";
const dialogNoteMerge = "지금 캐시에 합쳐요. 직접 지정한 음원은 백업 값으로 바뀌어요.";
const items: Record<ArchiveItem, string> = {
  tunables: "운영 조절값",
  genres: "자동재생 장르",
  status: "상태 문구",
  ai: "AI 설정",
  "ai-prompt": "AI 프롬프트",
  favicon: "파비콘",
  "login-background": "로그인 배경",
  "audio-files": "캐시 파일",
  "audio-ledger": "자동 검색 결과",
  "audio-pins": "직접 지정한 음원",
  "audio-age": "연령 제한 기록",
  "audio-sponsorblock": "SponsorBlock 구간",
};
/** 이미지 · 배경 수 */
const counts: Partial<Record<ArchiveItem, (n: number) => string>> = { favicon: (n) => `이미지 ${n}개`, "login-background": (n) => `배경 ${n}개` };
/** 합치는 항목의 내역 */
const breakdown = {
  added: (n: number) => `새로 ${n}`,
  existing: (n: number) => `같음 ${n}`,
  changed: (n: number) => `바뀜 ${n}`,
  overLimit: (n: number) => `용량 한도로 ${n}개 제외`,
};
const room = (size: string) => `남은 용량 ${size}`;
const notInFile = "백업에 없음";
const same = "지금과 같음";
const differs = "다름";
const problem = "불러올 수 없음";
const cancel = "취소";
const apply = (count: number) => (count ? `${count}개 불러오기` : "불러오기");
const imported = "백업을 불러왔어요";
const importedBody = "화면을 새로고침해요.";
const importFailed = "백업을 불러오지 못했어요.";
/** 불러온 뒤: 쿠키 출처가 바뀌었다(file: 쿠키 직접 입력, 그 밖은 브라우저) */
const cookiesChanged = (source: string) => (source === "file" ? { title: "쿠키 출처가 '쿠키 직접 입력'으로 바뀌었어요", body: "쿠키는 백업에 없어요. 유튜브 탭에서 입력해 주세요." } : { title: `쿠키 출처가 '${source}'(으)로 바뀌었어요`, body: "유튜브 탭에서 확인해 주세요." });

export { exportTitle, exportDescBefore, backupCommand, exportDescAfter, exports, withoutFiles, withoutFilesTip, importTitle, importDesc, importFullBackup, importButton, exported, exportFailed, previewFailed, dialogTitle, kinds, madeAt, dialogNote, dialogNoteMerge, items, counts, breakdown, room, notInFile, same, differs, problem, cancel, apply, imported, importedBody, importFailed, cookiesChanged, tips };
