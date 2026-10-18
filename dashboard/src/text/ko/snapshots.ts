// 설정 DB 스냅샷(운영자 패널 백업 탭)

import type { SnapshotKind } from "../../../../src/rules/snapshots.ts";

const title = "설정 스냅샷";
const desc = "하루 한 번, 그리고 백업 불러오기 · 복원 · 초기화 전에 설정을 자동으로 저장해요.";
/** 설명 옆 툴팁 */
const descTip = "일일 백업은 7개, 나머지는 5개까지 보관해요. API 키 · 쿠키는 암호화된 채로 저장돼 같은 SECRETS_KEY 에서만 복원돼요.";
const empty = "아직 저장된 스냅샷이 없어요.";
const kinds: Record<SnapshotKind, string> = { daily: "일일 백업", "before-import": "불러오기 전", "before-restore": "복원 전", "before-reset": "초기화 전" };
const restore = "복원";
const confirmTitle = "이 스냅샷으로 복원할까요?";
/** 고른 스냅샷의 때 · 지금 실행기 여부에 따라 */
const confirmBody = (when: string, restartNow: boolean) => `${when}의 설정으로 바뀌어요. 지금 설정은 스냅샷으로 저장해요.\n${restartNow ? "봇이 다시 시작돼요." : "실행기 없이 켠 봇이라, 봇을 직접 다시 시작하면 복원돼요."}`;
const confirm = "복원";
/** 예약한 복원(실행기 없이 켠 봇) */
const staged = (name: string) => `복원이 예약돼 있어요. 봇을 다시 시작하면 복원돼요: ${name}`;
const unstage = "예약 취소";
const stagedDone = "복원을 예약했어요";
const stagedDoneBody = "봇을 다시 시작하면 복원돼요.";
const failed = "복원하지 못했어요.";
const loadFailed = "스냅샷 목록을 불러오지 못했어요.";

export { title, desc, descTip, empty, kinds, restore, confirmTitle, confirmBody, confirm, staged, unstage, stagedDone, stagedDoneBody, failed, loadFailed };
