// 설정 DB 스냅샷(운영자 패널 백업 탭)

import type { SnapshotKind } from "../../../../src/rules/snapshots.ts";

const title = "설정 스냅샷";
const desc = "설정을 하루 한 번, 가져오기 · 복원 전에 자동으로 남겨요.";
/** 설명 옆 툴팁 */
const descTip = "매일 것은 7개, 가져오기 · 복원 전 것은 5개까지 남겨요. 키 · 쿠키는 잠긴 그대로라 같은 SECRETS_KEY 에서만 풀려요.";
const empty = "아직 남긴 스냅샷이 없어요.";
const kinds: Record<SnapshotKind, string> = { daily: "매일", "before-import": "가져오기 전", "before-restore": "복원 전" };
const restore = "복원";
const confirmTitle = "이 스냅샷으로 복원할까요?";
/** 고른 스냅샷의 때 · 지금 실행기 여부에 따라 */
const confirmBody = (when: string, restartNow: boolean) => `${when}의 설정으로 통째 바뀌어요. 지금 설정은 스냅샷으로 남겨요.\n${restartNow ? "봇을 곧바로 다시 시작해 바꿔 끼워요." : "봇을 다시 켤 때 바꿔 끼워요(실행기 없이 켠 봇이라 여기서 다시 시작할 수 없어요)."}`;
const confirm = "복원";
/** 걸어 둔 복원 */
const staged = (name: string) => `다음 기동에 복원해요: ${name}`;
const unstage = "거두기";
const stagedDone = "복원을 걸어 두었어요";
const stagedDoneBody = "봇을 다시 켜면 바꿔 끼워요.";
const failed = "복원을 걸지 못했어요.";
const loadFailed = "스냅샷 목록을 읽지 못했어요.";

export { title, desc, descTip, empty, kinds, restore, confirmTitle, confirmBody, confirm, staged, unstage, stagedDone, stagedDoneBody, failed, loadFailed };
