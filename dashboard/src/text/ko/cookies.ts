// 운영자 패널: 쿠키 설정 탭(유튜브 쿠키 파일)

const title = "유튜브 쿠키";
const unknown = "저장돼 있는지 몰라요";
const saved = "저장된 쿠키 있음";
const none = "저장된 쿠키 없음";
const purpose = "연령 제한 영상을 받을 때만 써요.";
const purposeTip = "유튜브가 세션을 바꾸면 만료 시각 전에도 무효가 돼요.\n로그에 cookies are no longer valid 가 보이면 새로 붙여넣어 주세요.";
/** 지금 쓰는 중인 받기가 있어 저장이 되돌려질 수 있을 때. count 는 그 수 */
const inFlight = (count: number) => `지금 연령 제한 영상 ${count}건이 이 쿠키를 쓰고 있어요. 그쪽이 끝나면서 방금 저장한 내용을 되돌릴 수 있으니, 잠시 뒤 한 번 더 저장해 주세요.`;
const save = "저장";
const saving = "저장 중…";
const clear = "저장된 쿠키 지우기";
const pasteHint = "브라우저 확장에서 복사한 내용이나 내려받은 파일의 내용 전부를 그대로 붙여넣으세요.";
const pasteHintTip = "내보내는 방법은 README를 참고하세요.";
const insecure = "지금 평문(HTTP)으로 접속 중이에요. 쿠키가 그대로 네트워크를 지나가요.";
/** 저장된 쿠키가 있을 때 입력칸 자리 글 */
const replacePlaceholder = "바꾸려면 새 쿠키를 붙여넣어요";
const savedDone = "쿠키를 저장했어요";
const clearedDone = "쿠키를 지웠어요";
const saveFailed = "쿠키를 저장하지 못했어요.";
const clearFailed = "쿠키를 지우지 못했어요.";
const loadFailed = "쿠키 상태를 읽지 못했어요.";

export { title, unknown, saved, none, purpose, purposeTip, inFlight, save, saving, clear, pasteHint, pasteHintTip, insecure, replacePlaceholder, savedDone, clearedDone, saveFailed, clearFailed, loadFailed };
